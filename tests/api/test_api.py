# -*- coding: utf-8 -*-
"""
/api/* 동작 고정 테스트 (characterization test)

리팩토링 전 server.py 의 HTTP 동작을 그대로 기록한다. 서버 내부 구조는 보지 않고
HTTP 요청/응답만 보므로, server.py 를 쪼개거나 다시 짜도 그대로 돌릴 수 있다.

    py -m unittest discover -s tests/api -v

- 기본: 테스트마다 프로젝트를 임시 폴더에 복사해 server.py 를 새로 띄운다 (race.db 안 건드림).
- TR_SLOW=1   : 30초 짜리 테스트(첫 완주 후 유예시간)도 돌린다.
- TR_BASE_URL : 이미 떠 있는 서버(예: vercel dev)에 대고 돌린다. 방이 비어 있어야 하고,
                레이스 기록이 그 DB 에 남는다. 운영 서버에는 쓰지 말 것.
- TR_APP_DIR  : 이 저장소 대신 다른 폴더의 server.py 를 띄운다 (예: 리팩토링 전 코드를 따로 체크아웃해 비교).
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = os.environ.get("TR_APP_DIR") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE_URL = os.environ.get("TR_BASE_URL", "").rstrip("/")
SLOW = os.environ.get("TR_SLOW") == "1"

COLORS = ["#ff4d4d", "#3d8bff", "#ffd23d", "#3ddc84", "#b26bff", "#ff8c2e", "#2ee6e6", "#ff6fcf"]
STATE_KEYS = {"now", "phase", "start_at", "first_finish_at", "grace", "laps", "settings",
              "me", "players", "results", "race_id"}
PLAYER_KEYS = {"id", "name", "color", "slot", "x", "y", "a", "v", "progress", "lap", "rank",
               "time_ms", "dnf", "ai"}

local_only = unittest.skipIf(BASE_URL != "", "로컬 server.py 전용 동작")
slow = unittest.skipUnless(SLOW, "TR_SLOW=1 일 때만 (30초 이상 걸림)")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class LocalServer(object):
    """프로젝트를 임시 폴더에 복사해서 server.py 를 띄운다 (테스트마다 새 방, 새 DB)."""

    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="tr-test-")
        self.dir = os.path.join(self.tmp, "app")
        shutil.copytree(ROOT, self.dir, ignore=shutil.ignore_patterns(
            ".git", "*.db", "node_modules", ".vercel", "tests", "__pycache__", ".claude"))
        self.port = free_port()
        env = dict(os.environ, PORT=str(self.port), PYTHONIOENCODING="utf-8")
        self.proc = subprocess.Popen([sys.executable, "server.py"], cwd=self.dir, env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.base = "http://127.0.0.1:%d" % self.port

    def wait_ready(self):
        # 윈도우는 닫힌 포트에 connect 하면 재시도하느라 ~1초씩 걸려서, 짧은 타임아웃으로 포트만 먼저 본다
        deadline = time.time() + 15
        while True:
            s = socket.socket()
            s.settimeout(0.1)
            try:
                s.connect(("127.0.0.1", self.port))
                s.close()
                urllib.request.urlopen(self.base + "/api/leaderboard", timeout=5).read()
                return
            except Exception:
                s.close()
                if self.proc.poll() is not None or time.time() > deadline:
                    self.stop()
                    raise RuntimeError("server.py 가 안 떴어요")
                time.sleep(0.02)

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.tmp, ignore_errors=True)


# server.py 는 import 만 ~2초 걸려서, 다음 테스트들이 쓸 서버를 미리 몇 개 띄워 둔다
POOL_SIZE = 6
_pool = []


def take_server():
    srv = _pool.pop(0) if _pool else LocalServer()
    while len(_pool) < POOL_SIZE:
        _pool.append(LocalServer())
    srv.wait_ready()
    return srv


def tearDownModule():
    while _pool:
        _pool.pop().stop()


class ApiTestCase(unittest.TestCase):

    def setUp(self):
        self.server = None
        if BASE_URL:
            self.base = BASE_URL
        else:
            self.server = take_server()
            self.base = self.server.base
        self.created = []
        st = self.state()
        self.assertEqual(st["players"], [], "테스트 시작할 때 방이 비어 있어야 해요")

    def tearDown(self):
        if self.server:
            self.server.stop()
            return
        # 원격 서버: 레이스 중이면 1번째 leave 로 dnf -> 레이스 끝, 2번째 leave 로 삭제
        for _ in range(2):
            for pid in self.created:
                self.raw("POST", "/api/leave", {"id": pid})

    # ------------------------------------------------------------ HTTP
    def raw(self, method, path, body=None, data=None, headers=None):
        if data is None and body is not None:
            data = json.dumps(body).encode("utf-8")
        hdr = {"Content-Type": "application/json"} if data is not None else {}
        hdr.update(headers or {})
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=hdr)
        try:
            resp = urllib.request.urlopen(req, timeout=15)
            status, raw, h = resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as e:
            status, raw, h = e.code, e.read(), e.headers
        ctype = h.get("Content-Type", "")
        obj = json.loads(raw.decode("utf-8")) if "json" in ctype else raw.decode("utf-8", "replace")
        return status, obj, h

    def post(self, path, body, expect=200):
        status, obj, _ = self.raw("POST", path, body)
        self.assertEqual(status, expect, "%s %r -> %r" % (path, body, obj))
        return obj

    def state(self, *ids):
        q = "?ids=" + ",".join(ids) if ids else ""
        status, obj, _ = self.raw("GET", "/api/state" + q)
        self.assertEqual(status, 200)
        return obj

    def join(self, name="tester", expect=200, **extra):
        body = dict(extra)
        body["name"] = name
        st = self.post("/api/join", body, expect)
        if expect == 200:
            self.created.append(st["me"])
        return st

    def player(self, st, pid):
        for p in st["players"]:
            if p["id"] == pid:
                return p
        return None

    def wait_until_finish_allowed(self, st):
        """서버 완주 조건(시작 후 4*laps 초)까지 기다린다."""
        wait = st["start_at"] + 4 * st["laps"] + 0.15 - st["now"]
        if wait > 0:
            time.sleep(wait)

    def start_race(self, pid, laps=1):
        self.post("/api/settings", {"id": pid, "laps": laps})
        return self.post("/api/start", {"id": pid})


# ====================================================================== 기본
class TestBasics(ApiTestCase):

    def test_initial_state_shape(self):
        st = self.state()
        self.assertEqual(set(st.keys()), STATE_KEYS)
        self.assertEqual(st["phase"], "lobby")
        self.assertEqual(st["laps"], 3)
        self.assertEqual(st["settings"], {"laps": 3, "difficulty": "easy"})
        self.assertEqual(st["grace"], 30)
        self.assertIsNone(st["me"])
        self.assertIsNone(st["race_id"])
        self.assertEqual(st["results"], [])
        self.assertAlmostEqual(st["now"], time.time(), delta=5)

    def test_json_headers(self):
        status, _, h = self.raw("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(h.get("Content-Type"), "application/json; charset=utf-8")
        self.assertEqual(h.get("Cache-Control"), "no-store")

    def test_unknown_routes_are_404(self):
        for method, path in [("GET", "/api/nope"), ("POST", "/api/nope"), ("GET", "/api/join"),
                             ("POST", "/api/state"), ("POST", "/api/leaderboard")]:
            status, obj, _ = self.raw(method, path, {} if method == "POST" else None)
            self.assertEqual(status, 404, "%s %s" % (method, path))
            self.assertEqual(obj, {"error": "not found"})

    def test_static_files_served(self):
        status, html, _ = self.raw("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("터보 레이서", html)
        status, _, _ = self.raw("GET", "/game.js")
        self.assertEqual(status, 200)

    @local_only
    def test_invalid_json_body_is_treated_as_empty(self):
        status, st, _ = self.raw("POST", "/api/join", data=b"{not json")
        self.assertEqual(status, 200)
        self.created.append(st["me"])
        self.assertEqual(self.player(st, st["me"])["name"], "플레이어")
        status, st, _ = self.raw("POST", "/api/join", data=b"[1,2]")
        self.assertEqual(status, 200)
        self.assertEqual(self.player(st, st["me"])["name"], "플레이어")


# ====================================================================== 참가 / 나가기
class TestJoin(ApiTestCase):

    def test_join_creates_player(self):
        st = self.join("홍길동", color="#3d8bff")
        self.assertEqual(st["phase"], "lobby")
        self.assertRegex(st["me"], r"^[0-9a-f]{12}$")
        p = self.player(st, st["me"])
        self.assertEqual(set(p.keys()), PLAYER_KEYS)
        self.assertEqual(p["name"], "홍길동")
        self.assertEqual(p["color"], "#3d8bff")
        self.assertEqual(p["slot"], 0)
        self.assertEqual((p["x"], p["y"], p["a"], p["v"]), (0, 0, 0, 0))
        self.assertEqual(p["progress"], -1)
        self.assertEqual(p["lap"], 0)
        self.assertIsNone(p["rank"])
        self.assertIsNone(p["time_ms"])
        self.assertFalse(p["dnf"])
        self.assertFalse(p["ai"])

    def test_name_is_trimmed_cut_and_defaulted(self):
        st = self.join("   abcdefghijklmnop  ")
        self.assertEqual(self.player(st, st["me"])["name"], "abcdefghijkl")
        st = self.join("가나다라마바사아자차카타파하")
        self.assertEqual(self.player(st, st["me"])["name"], "가나다라마바사아자차카타")
        st = self.join("   ")
        self.assertEqual(self.player(st, st["me"])["name"], "플레이어")

    def test_color_choice(self):
        a = self.join("a", color="#3d8bff")
        self.assertEqual(self.player(a, a["me"])["color"], "#3d8bff")
        b = self.join("b", color="#3d8bff")          # 이미 사용 중 -> 남은 색 중 첫 번째
        self.assertEqual(self.player(b, b["me"])["color"], "#ff4d4d")
        c = self.join("c", color="red")              # 목록에 없는 색
        self.assertEqual(self.player(c, c["me"])["color"], "#ffd23d")
        d = self.join("d")                            # 색 안 줌
        self.assertEqual(self.player(d, d["me"])["color"], "#3ddc84")

    def test_room_holds_eight_and_reuses_free_slot(self):
        ids = []
        for i in range(8):
            st = self.join("p%d" % i)
            ids.append(st["me"])
        slots = [self.player(st, pid)["slot"] for pid in ids]
        colors = [self.player(st, pid)["color"] for pid in ids]
        self.assertEqual(slots, list(range(8)))
        self.assertEqual(colors, COLORS)
        full = self.join("ninth", expect=409)
        self.assertEqual(full, {"error": "방이 가득 찼어요 (최대 8명)"})

        self.post("/api/leave", {"id": ids[3]})
        st = self.join("again")
        p = self.player(st, st["me"])
        self.assertEqual(p["slot"], 3)
        self.assertEqual(p["color"], COLORS[3])

    def test_players_listed_in_join_order(self):
        names = ["c", "a", "b"]
        for n in names:
            st = self.join(n)
        self.assertEqual([p["name"] for p in st["players"]], names)

    def test_rejoin_with_known_id_keeps_player(self):
        st = self.join("me")
        pid = st["me"]
        again = self.post("/api/join", {"id": pid, "name": "ignored"})
        self.assertEqual(again["me"], pid)
        self.assertEqual(len(again["players"]), 1)
        self.assertEqual(self.player(again, pid)["name"], "me")

    def test_ai_flag_is_truthy(self):
        for val, want in [(True, True), (1, True), ("x", True), (False, False), (0, False), ("", False)]:
            st = self.join("bot", ai=val)
            self.assertIs(self.player(st, st["me"])["ai"], want, repr(val))
            self.post("/api/leave", {"id": st["me"]})

    def test_leave_in_lobby_removes_player(self):
        a = self.join("a")["me"]
        b = self.join("b")["me"]
        self.assertEqual(self.post("/api/leave", {"id": a}), {"ok": True})
        st = self.state()
        self.assertEqual([p["id"] for p in st["players"]], [b])
        self.assertEqual(self.post("/api/leave", {"id": "nobody"}), {"ok": True})
        self.assertEqual(self.post("/api/leave", {}), {"ok": True})


# ====================================================================== 상태 조회
class TestState(ApiTestCase):

    def test_me_is_first_id_if_present(self):
        a = self.join("a")["me"]
        b = self.join("b")["me"]
        self.assertEqual(self.state(a, b)["me"], a)
        self.assertEqual(self.state(b, a)["me"], b)
        self.assertIsNone(self.state("nobody", a)["me"])

    def test_query_parsing(self):
        a = self.join("a")["me"]
        for q in ["?id=" + a, "?ids=," + a, "?ids=&id=" + a, "?ids=" + a + "&id=zzz"]:
            status, st, _ = self.raw("GET", "/api/state" + q)
            self.assertEqual(status, 200)
            self.assertEqual(st["me"], a, q)
        status, st, _ = self.raw("GET", "/api/state?ids=zzz")
        self.assertIsNone(st["me"])


# ====================================================================== 설정
class TestSettings(ApiTestCase):

    def test_only_members_can_change(self):
        res = self.post("/api/settings", {"id": "nobody", "laps": 5}, 403)
        self.assertEqual(res, {"error": "참가한 플레이어만 바꿀 수 있어요"})
        self.post("/api/settings", {"laps": 5}, 403)

    def test_laps_are_clamped(self):
        pid = self.join("a")["me"]
        for given, want in [(5, 5), (0, 1), (-3, 1), (20, 9), ("2", 2), (2.7, 2), ("abc", 2), (None, 2)]:
            st = self.post("/api/settings", {"id": pid, "laps": given})
            self.assertEqual(st["settings"]["laps"], want, repr(given))
            self.assertEqual(st["laps"], want, repr(given))

    def test_difficulty_values(self):
        pid = self.join("a")["me"]
        for given, want in [("hard", "hard"), ("normal", "normal"), ("crazy", "normal"),
                            ("", "normal"), ("easy", "easy")]:
            st = self.post("/api/settings", {"id": pid, "difficulty": given})
            self.assertEqual(st["settings"]["difficulty"], want, repr(given))

    def test_settings_locked_outside_lobby(self):
        pid = self.join("a")["me"]
        self.post("/api/start", {"id": pid})
        res = self.post("/api/settings", {"id": pid, "laps": 5}, 409)
        self.assertEqual(res, {"error": "대기실에서만 바꿀 수 있어요"})


# ====================================================================== 시작 / 위치 보내기
class TestStartAndUpdate(ApiTestCase):

    def test_start_requires_member(self):
        self.join("a")
        res = self.post("/api/start", {"id": "nobody"}, 403)
        self.assertEqual(res, {"error": "참가한 플레이어만 시작할 수 있어요"})

    def test_start_race(self):
        a = self.join("a")["me"]
        self.join("b")
        st = self.post("/api/start", {"id": a})
        self.assertEqual(st["phase"], "racing")
        self.assertAlmostEqual(st["start_at"] - st["now"], 3.5, delta=0.3)
        self.assertEqual(st["first_finish_at"], 0)
        for p in st["players"]:
            self.assertEqual(p["progress"], -1)
            self.assertFalse(p["dnf"])
        res = self.post("/api/start", {"id": a}, 409)
        self.assertEqual(res, {"error": "이미 시작했어요"})
        res = self.join("late", expect=409)
        self.assertEqual(res, {"error": "레이스가 진행 중이에요. 끝나면 다시 참가해 주세요!"})

    def test_update_moves_cars_only_while_racing(self):
        a = self.join("a")["me"]
        b = self.join("b")["me"]
        car = {"id": a, "x": 10.5, "y": -3, "a": 1.25, "v": 300, "progress": 0.5, "lap": 2.9}
        st = self.post("/api/update", {"ids": [a], "cars": [car]})
        self.assertEqual(self.player(st, a)["x"], 0, "대기실에선 무시")

        self.post("/api/start", {"id": a})
        st = self.post("/api/update", {"ids": [a, b], "cars": [car]})
        self.assertEqual(st["me"], a)
        p = self.player(st, a)
        self.assertEqual((p["x"], p["y"], p["a"], p["v"], p["progress"], p["lap"]),
                         (10.5, -3, 1.25, 300, 0.5, 2))
        self.assertEqual(self.player(st, b)["progress"], -1)

    def test_update_accepts_legacy_single_car_body(self):
        a = self.join("a")["me"]
        self.post("/api/start", {"id": a})
        st = self.post("/api/update", {"id": a, "x": 7, "y": 8, "progress": 0.1})
        self.assertEqual(st["me"], a)
        p = self.player(st, a)
        self.assertEqual((p["x"], p["y"], p["progress"]), (7, 8, 0.1))

    def test_update_ignores_bad_values(self):
        a = self.join("a")["me"]
        self.post("/api/start", {"id": a})
        st = self.post("/api/update", {"ids": [a], "cars": [{"id": a, "x": "abc", "y": 5}, "junk", 3]})
        p = self.player(st, a)
        self.assertEqual((p["x"], p["y"]), (0, 0))

    def test_update_with_no_cars_still_returns_state(self):
        st = self.post("/api/update", {})
        self.assertEqual(set(st.keys()), STATE_KEYS)


# ====================================================================== 완주 / 결과 / 기록
class TestFinish(ApiTestCase):

    def test_finish_rejected_when_not_racing(self):
        a = self.join("a")["me"]
        res = self.post("/api/finish", {"id": a, "lap": 3}, 409)
        self.assertEqual(res, {"error": "레이스 중이 아니에요"})
        self.post("/api/start", {"id": a})
        self.post("/api/finish", {"id": "nobody", "lap": 3}, 409)

    def test_finish_rejected_when_too_early_or_short(self):
        a = self.join("a")["me"]
        self.start_race(a, laps=1)
        res = self.post("/api/finish", {"id": a, "lap": 1}, 400)
        self.assertEqual(res, {"error": "완주가 확인되지 않았어요"})
        self.post("/api/finish", {"id": a, "lap": 0}, 400)

    def test_full_race(self):
        board0 = self.post_board()
        a = self.join("A-human")["me"]
        b = self.join("B-bot", ai=True)["me"]
        c = self.join("C-human")["me"]
        d = self.join("D-human")["me"]
        st = self.start_race(a, laps=1)
        self.post("/api/update", {"ids": [a, b, c, d], "cars": [
            {"id": c, "progress": 0.2}, {"id": d, "progress": 0.6}]})
        self.wait_until_finish_allowed(st)

        st = self.post("/api/finish", {"id": a, "lap": 1, "progress": 1.0})
        pa = self.player(st, a)
        self.assertEqual(pa["rank"], 1)
        self.assertAlmostEqual(pa["time_ms"], (st["now"] - st["start_at"]) * 1000, delta=300)
        self.assertAlmostEqual(st["first_finish_at"], st["now"], delta=1)
        self.assertEqual(pa["progress"], 1.0)

        again = self.post("/api/finish", {"id": a, "lap": 1})
        self.assertEqual(self.player(again, a)["rank"], 1)
        self.assertEqual(self.player(again, a)["time_ms"], pa["time_ms"])

        st = self.post("/api/finish", {"id": b, "lap": 1})
        self.assertEqual(self.player(st, b)["rank"], 2)
        self.assertEqual(st["phase"], "racing")

        self.post("/api/leave", {"id": c})          # 레이스 중 나가면 dnf
        st = self.state(a)
        self.assertTrue(self.player(st, c)["dnf"])
        self.assertEqual(st["phase"], "racing")

        self.post("/api/leave", {"id": d})          # 남은 사람 0명 -> 끝
        st = self.state(a)
        self.assertEqual(st["phase"], "finished")
        self.assertIsInstance(st["race_id"], int)
        res = st["results"]
        self.assertEqual([r["name"] for r in res], ["A-human", "B-bot", "D-human", "C-human"])
        self.assertEqual([r["rank"] for r in res], [1, 2, None, None])
        self.assertEqual([r["finished"] for r in res], [True, True, False, False])
        self.assertEqual([r["ai"] for r in res], [False, True, False, False])
        self.assertEqual(res[0]["time_ms"], pa["time_ms"])
        self.assertIsNone(res[2]["time_ms"])
        self.assertEqual(set(res[0].keys()), {"name", "color", "rank", "time_ms", "finished", "ai"})
        self.assertEqual(res[0]["color"], pa["color"])

        res = self.join("late", expect=409)          # 결과 화면에서도 참가 불가
        self.assertIn("error", res)

        board = self.post_board()
        self.assertEqual(board["total_races"], board0["total_races"] + 1)
        if not BASE_URL:
            self.assertEqual(len(board["best"]), 1)
            best = board["best"][0]
            self.assertEqual(best["player_name"], "A-human")
            self.assertEqual(best["time_ms"], pa["time_ms"])
            self.assertEqual(best["color"], pa["color"])
            self.assertRegex(best["date"], r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$")
            wins = {w["player_name"]: w for w in board["wins"]}
            self.assertNotIn("B-bot", wins, "컴퓨터는 메달 순위에서 빠짐")
            self.assertEqual(wins["A-human"], {"player_name": "A-human", "gold": 1, "silver": 0,
                                               "bronze": 0, "races": 1})
            self.assertEqual(wins["D-human"]["races"], 1)
            self.assertEqual(wins["D-human"]["gold"], 0)

        # 다시 하기: 결과 화면 -> 대기실, 남은 사람은 그대로 + 값 초기화
        st = self.post("/api/reset", {"id": a})
        self.assertEqual(st["phase"], "lobby")
        self.assertEqual(st["results"], [])
        self.assertEqual(st["first_finish_at"], 0)
        self.assertEqual(len(st["players"]), 4)
        for p in st["players"]:
            self.assertIsNone(p["rank"])
            self.assertIsNone(p["time_ms"])
            self.assertFalse(p["dnf"])
            self.assertEqual(p["progress"], -1)

    def test_everyone_leaving_ends_race_then_room_resets(self):
        board0 = self.post_board()
        a = self.join("a")["me"]
        self.post("/api/start", {"id": a})
        self.post("/api/leave", {"id": a})
        st = self.state()
        self.assertEqual(st["phase"], "finished")
        self.assertEqual(st["results"][0]["finished"], False)
        self.assertEqual(self.post_board()["total_races"], board0["total_races"] + 1)
        self.post("/api/leave", {"id": a})
        st = self.state()
        self.assertEqual(st["phase"], "lobby")
        self.assertEqual(st["players"], [])

    def test_reset_ignored_while_racing(self):
        a = self.join("a")["me"]
        self.post("/api/start", {"id": a})
        st = self.post("/api/reset", {"id": a})
        self.assertEqual(st["phase"], "racing")

    def post_board(self):
        status, obj, _ = self.raw("GET", "/api/leaderboard")
        self.assertEqual(status, 200)
        self.assertEqual(set(obj.keys()), {"best", "wins", "total_races"})
        return obj


class TestEmptyLeaderboard(ApiTestCase):

    @local_only
    def test_empty_leaderboard(self):
        status, obj, _ = self.raw("GET", "/api/leaderboard")
        self.assertEqual(obj, {"best": [], "wins": [], "total_races": 0})


# ====================================================================== 시간 초과 (느림)
class TestTimeouts(ApiTestCase):

    def keep_alive(self, pid, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self.state(pid)
            time.sleep(1.5)

    def test_silent_player_removed_from_lobby_after_10s(self):
        a = self.join("alive")["me"]
        b = self.join("silent")["me"]
        self.keep_alive(a, 11)
        st = self.state(a)
        self.assertEqual([p["id"] for p in st["players"]], [a])
        self.assertNotIn(b, [p["id"] for p in st["players"]])

    def test_silent_player_becomes_dnf_during_race(self):
        a = self.join("alive")["me"]
        b = self.join("silent")["me"]
        self.post("/api/start", {"id": a})
        self.keep_alive(a, 11)
        st = self.state(a)
        self.assertEqual(st["phase"], "racing")
        self.assertTrue(self.player(st, b)["dnf"])
        self.assertFalse(self.player(st, a)["dnf"])

    @slow
    def test_race_ends_30s_after_first_finish(self):
        a = self.join("fast")["me"]
        b = self.join("slow")["me"]
        st = self.start_race(a, laps=1)
        self.wait_until_finish_allowed(st)
        self.post("/api/finish", {"id": a, "lap": 1})
        end = time.time() + 31
        while time.time() < end:
            st = self.state(a, b)
            if st["phase"] == "finished":
                break
            time.sleep(1.5)
        self.assertEqual(st["phase"], "finished")
        self.assertGreaterEqual(time.time() - st["first_finish_at"], 29)
        self.assertEqual([r["finished"] for r in st["results"]], [True, False])


if __name__ == "__main__":
    unittest.main()
