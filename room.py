# -*- coding: utf-8 -*-
"""
방 하나의 게임 규칙 (로컬 서버용).

배포판은 같은 규칙을 supabase/migrations/*.sql 의 tr_api 가 따로 구현한다.
여기 상수나 규칙을 바꾸면 SQL 쪽도 같이 바꿔야 한다 (CLAUDE.md 참고).
"""
import threading
import time
import uuid

COLORS = ["#ff4d4d", "#3d8bff", "#ffd23d", "#3ddc84",
          "#b26bff", "#ff8c2e", "#2ee6e6", "#ff6fcf"]
MAX_PLAYERS = 8
NAME_MAX = 12
DEFAULT_NAME = "플레이어"
DIFFICULTIES = ("easy", "normal", "hard")
LAPS_MIN, LAPS_MAX = 1, 9
DEFAULT_SETTINGS = {"laps": 3, "difficulty": "easy"}

SEEN_TIMEOUT = 10        # 초. 이만큼 소식 없으면 대기실에선 삭제, 레이스 중엔 리타이어
COUNTDOWN = 3.5          # 시작 버튼 ~ 출발
GRACE = 30               # 첫 완주 후 나머지를 기다리는 시간
RACE_TIME_LIMIT = 600    # 레이스 최대 길이
MIN_SEC_PER_LAP = 4      # 이보다 빨리 완주하면 거부

# 이상한 숫자 값이 오면 무시할 때 잡는 예외
BAD_NUMBER = (TypeError, ValueError, OverflowError)


class ApiError(Exception):
    def __init__(self, status, message):
        Exception.__init__(self, message)
        self.status = status
        self.message = message


def _fresh_car():
    return {"x": 0, "y": 0, "a": 0, "v": 0, "progress": -1, "lap": 0,
            "rank": None, "time_ms": None, "dnf": False}


PUBLIC_PLAYER_KEYS = ("name", "color", "slot", "x", "y", "a", "v", "progress", "lap",
                      "rank", "time_ms", "dnf", "ai")


class Room(object):
    """모든 요청은 handle() 하나로 들어오고, 방 전체를 잠근 상태에서 처리한다."""

    def __init__(self, store, clock=time.time):
        self.store = store
        self.clock = clock
        self.lock = threading.Lock()
        self.players = {}          # id -> dict (참가 순서 유지)
        self.settings = dict(DEFAULT_SETTINGS)
        self.race_id = None
        self._clear_race()

    def _clear_race(self):
        self.phase = "lobby"       # lobby | racing | finished
        self.start_at = 0.0
        self.first_finish_at = 0.0
        self.finish_order = []
        self.results = []

    # ------------------------------------------------------------ 진입점
    def handle(self, action, body):
        handler = getattr(self, "_api_" + action, None)
        if handler is None:
            return 404, {"error": "not found"}
        with self.lock:
            try:
                return 200, handler(body)
            except ApiError as e:
                return e.status, {"error": e.message}

    # ------------------------------------------------------------ 공통
    def _touch(self, pid):
        if pid in self.players:
            self.players[pid]["seen"] = self.clock()

    def _state(self, pid):
        return {
            "now": self.clock(), "phase": self.phase, "start_at": self.start_at,
            "first_finish_at": self.first_finish_at, "grace": GRACE,
            "laps": self.settings["laps"], "settings": dict(self.settings),
            "me": pid if pid in self.players else None,
            "players": [dict({"id": k}, **{key: p[key] for key in PUBLIC_PLAYER_KEYS})
                        for k, p in self.players.items()],
            "results": self.results, "race_id": self.race_id,
        }

    def _reset_room(self):
        self._clear_race()
        for p in self.players.values():
            p.update(_fresh_car())

    def _active_count(self):
        return sum(1 for p in self.players.values() if p["rank"] is None and not p["dnf"])

    def _tick(self):
        """시간에 따른 규칙. 상태를 바꾸는 모든 요청에서 먼저/나중에 부른다."""
        now = self.clock()
        if self.phase in ("lobby", "finished"):
            for pid in [k for k, p in self.players.items() if now - p["seen"] > SEEN_TIMEOUT]:
                del self.players[pid]
        elif self.phase == "racing":
            for p in self.players.values():
                if p["rank"] is None and not p["dnf"] and now - p["seen"] > SEEN_TIMEOUT:
                    p["dnf"] = True
            if (self._active_count() == 0
                    or (self.first_finish_at and now - self.first_finish_at > GRACE)
                    or now - self.start_at > RACE_TIME_LIMIT):
                self._end_race(now)
        if not self.players and self.phase != "lobby":
            self._reset_room()

    def _end_race(self, now):
        finished = [self.players[pid] for pid in self.finish_order if pid in self.players]
        # 못 들어온 사람은 많이 간 순서대로 (같으면 참가 순서)
        unfinished = sorted((p for p in self.players.values() if p["rank"] is None),
                            key=lambda p: p["progress"], reverse=True)
        self.results = (
            [{"name": p["name"], "color": p["color"], "rank": p["rank"], "time_ms": p["time_ms"],
              "finished": True, "ai": p["ai"]} for p in finished] +
            [{"name": p["name"], "color": p["color"], "rank": None, "time_ms": None,
              "finished": False, "ai": p["ai"]} for p in unfinished])
        self.phase = "finished"
        try:
            self.race_id = self.store.save_race(self.results, self.start_at, now)
        except Exception as e:     # 기록 저장이 실패해도 게임은 계속
            print("DB 저장 실패:", e)

    def _require_member(self, pid, message):
        if pid not in self.players:
            raise ApiError(403, message)

    def _require_lobby(self, message):
        if self.phase != "lobby":
            raise ApiError(409, message)

    # ------------------------------------------------------------ API
    def _api_join(self, body):
        name = str(body.get("name", "")).strip()[:NAME_MAX] or DEFAULT_NAME
        pid = body.get("id")
        self._tick()
        if pid in self.players:          # 새로고침 등으로 다시 들어옴
            self._touch(pid)
            return self._state(pid)
        self._require_lobby("레이스가 진행 중이에요. 끝나면 다시 참가해 주세요!")

        used_slots = {p["slot"] for p in self.players.values()}
        free_slots = [s for s in range(MAX_PLAYERS) if s not in used_slots]
        if not free_slots:
            raise ApiError(409, "방이 가득 찼어요 (최대 %d명)" % MAX_PLAYERS)

        used_colors = [p["color"] for p in self.players.values()]
        free_colors = [c for c in COLORS if c not in used_colors]
        want = body.get("color")
        if want in free_colors:
            color = want
        else:
            color = free_colors[0] if free_colors else COLORS[0]

        pid = uuid.uuid4().hex[:12]
        player = {"name": name, "color": color, "slot": free_slots[0], "seen": self.clock(),
                  "ai": bool(body.get("ai"))}
        player.update(_fresh_car())
        self.players[pid] = player
        return self._state(pid)

    def _api_leave(self, body):
        pid = body.get("id")
        if pid in self.players:
            if self.phase == "racing":
                self.players[pid]["dnf"] = True
            else:
                del self.players[pid]
        self._tick()
        return {"ok": True}

    def _api_state(self, body):
        ids = body.get("ids")
        for pid in ids:
            self._touch(pid)
        self._tick()
        return self._state(ids[0] if ids else None)

    def _api_update(self, body):
        # 한 브라우저가 차 여러 대를 보낼 수 있다 (같은 PC 여럿이 / 컴퓨터 차)
        # 예전 클라이언트는 {id, x, y, ...} 한 대만 보낸다
        cars = body.get("cars")
        if not isinstance(cars, list):
            cars = [body]
        ids = [i for i in (body.get("ids") or []) if isinstance(i, str)][:MAX_PLAYERS]
        for pid in ids:
            self._touch(pid)
        for c in cars[:MAX_PLAYERS]:
            if not isinstance(c, dict):
                continue
            p = self.players.get(c.get("id"))
            if p is None:
                continue
            p["seen"] = self.clock()
            if self.phase == "racing" and p["rank"] is None and not p["dnf"]:
                try:
                    # 하나씩 순서대로: 중간에 이상한 값이 있으면 그 앞까지만 반영된다
                    p["x"] = float(c.get("x", 0))
                    p["y"] = float(c.get("y", 0))
                    p["a"] = float(c.get("a", 0))
                    p["v"] = float(c.get("v", 0))
                    p["progress"] = float(c.get("progress", 0))
                    p["lap"] = int(c.get("lap", 0))
                except BAD_NUMBER:
                    pass
        self._tick()
        return self._state(ids[0] if ids else body.get("id"))

    def _api_start(self, body):
        self._tick()
        self._require_lobby("이미 시작했어요")
        self._require_member(body.get("id"), "참가한 플레이어만 시작할 수 있어요")
        now = self.clock()
        self._reset_room()
        self.phase = "racing"
        self.start_at = now + COUNTDOWN
        for p in self.players.values():
            p["seen"] = now
        return self._state(body.get("id"))

    def _api_finish(self, body):
        pid = body.get("id")
        p = self.players.get(pid)
        if p is not None:
            p["seen"] = self.clock()
        now = self.clock()
        if p is None or self.phase != "racing":
            raise ApiError(409, "레이스 중이 아니에요")
        if p["rank"] is not None:
            return self._state(pid)
        elapsed = now - self.start_at
        laps = self.settings["laps"]
        if int(body.get("lap", 0)) < laps or elapsed < MIN_SEC_PER_LAP * laps:
            raise ApiError(400, "완주가 확인되지 않았어요")
        self.finish_order.append(pid)
        p["rank"] = len(self.finish_order)
        p["time_ms"] = int(elapsed * 1000)
        progress = float(body.get("progress", 0))
        if progress > p["progress"]:
            p["progress"] = progress
        if p["rank"] == 1:
            self.first_finish_at = now
        self._tick()
        return self._state(pid)

    def _api_reset(self, body):
        if self.phase == "finished" or not self.players:
            self._reset_room()
        self._touch(body.get("id"))
        return self._state(body.get("id"))

    def _api_settings(self, body):
        pid = body.get("id")
        self._require_member(pid, "참가한 플레이어만 바꿀 수 있어요")
        self._require_lobby("대기실에서만 바꿀 수 있어요")
        if "laps" in body:
            try:
                self.settings["laps"] = max(LAPS_MIN, min(LAPS_MAX, int(body["laps"])))
            except BAD_NUMBER:
                pass
        if body.get("difficulty") in DIFFICULTIES:
            self.settings["difficulty"] = body["difficulty"]
        self._touch(pid)
        return self._state(pid)

    def _api_leaderboard(self, body):
        return self.store.leaderboard()
