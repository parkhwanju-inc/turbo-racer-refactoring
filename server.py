# -*- coding: utf-8 -*-
"""
터보 레이서 로컬 서버 (같은 와이파이에서 할 때).

    py server.py          -> http://localhost:5050  (PORT 환경변수로 변경)

HTTP 만 여기서 처리한다. 게임 규칙은 room.py, 기록 저장은 race_store.py.
"""
import json
import os
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from race_store import RaceStore
from room import MAX_PLAYERS, Room

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "5050"))
DB_PATH = os.path.join(HERE, "race.db")
STATIC_DIR = os.path.join(HERE, "public")
MAX_BODY = 10000
LOG_REQUESTS = False

GET_ACTIONS = ("state", "leaderboard")
POST_ACTIONS = ("join", "leave", "update", "start", "finish", "reset", "settings")
NOT_FOUND = (404, {"error": "not found"})


def parse_state_ids(query):
    """?ids=a,b&id=c -> ['a', 'b', 'c'] (빈 값 빼고 최대 8개)"""
    q = parse_qs(query)
    raw = ",".join(q.get("ids", []) + q.get("id", []))
    return [i for i in raw.split(",") if i][:MAX_PLAYERS]


class Handler(SimpleHTTPRequestHandler):
    room = None   # main() 에서 넣어 준다

    def __init__(self, *args, **kwargs):
        SimpleHTTPRequestHandler.__init__(self, *args, directory=STATIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        if LOG_REQUESTS:
            SimpleHTTPRequestHandler.log_message(self, fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        SimpleHTTPRequestHandler.end_headers(self)

    def send_json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json_body(self):
        """JSON 객체가 아니거나 너무 크면 {}"""
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= MAX_BODY:
            return {}
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, RecursionError):   # JSON 오류, UTF-8 오류, 너무 깊게 중첩된 JSON
            return {}
        return body if isinstance(body, dict) else {}

    def do_GET(self):
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            return SimpleHTTPRequestHandler.do_GET(self)
        action = url.path[len("/api/"):]
        if action == "state":
            self.send_json(*self.room.handle("state", {"ids": parse_state_ids(url.query)}))
        elif action in GET_ACTIONS:
            self.send_json(*self.room.handle(action, {}))
        else:
            self.send_json(*NOT_FOUND)

    def do_POST(self):
        path = urlparse(self.path).path
        body = self.read_json_body()
        action = path[len("/api/"):] if path.startswith("/api/") else None
        if action in POST_ACTIONS:
            self.send_json(*self.room.handle(action, body))
        else:
            self.send_json(*NOT_FOUND)


def lan_ip():
    """같은 와이파이의 다른 기기가 접속할 주소 (실제로 패킷은 안 보냄)"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    Handler.room = Room(RaceStore(DB_PATH))
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print("=" * 52)
    print("  터보 레이서 서버 실행 중!")
    print("  이 PC에서:        http://localhost:%d" % PORT)
    print("  같은 와이파이 기기: http://%s:%d" % (lan_ip(), PORT))
    print("  DB 파일: %s" % DB_PATH)
    print("  종료: Ctrl+C")
    print("=" * 52)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n서버 종료")


if __name__ == "__main__":
    main()
