# -*- coding: utf-8 -*-
"""레이스 기록 저장소 (SQLite). 로컬 서버 전용, 배포판은 Supabase 테이블을 쓴다."""
import sqlite3
import time
from contextlib import closing

SCHEMA = (
    """CREATE TABLE IF NOT EXISTS races(
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         started_at TEXT NOT NULL,
         finished_at TEXT NOT NULL,
         player_count INTEGER NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS results(
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         race_id INTEGER NOT NULL REFERENCES races(id),
         player_name TEXT NOT NULL,
         color TEXT NOT NULL,
         rank INTEGER,
         time_ms INTEGER,
         finished INTEGER NOT NULL,
         is_bot INTEGER NOT NULL DEFAULT 0)""",
)

BEST_TIMES_SQL = """
    SELECT player_name, color, time_ms, r.started_at AS date
    FROM results JOIN races r ON r.id = results.race_id
    WHERE finished = 1 AND is_bot = 0
    ORDER BY time_ms ASC
    LIMIT 10"""

MEDALS_SQL = """
    SELECT player_name,
           SUM(CASE WHEN rank = 1 THEN 1 ELSE 0 END) AS gold,
           SUM(CASE WHEN rank = 2 THEN 1 ELSE 0 END) AS silver,
           SUM(CASE WHEN rank = 3 THEN 1 ELSE 0 END) AS bronze,
           COUNT(*) AS races
    FROM results
    WHERE is_bot = 0
    GROUP BY player_name
    ORDER BY gold DESC, silver DESC, bronze DESC, races DESC
    LIMIT 10"""


def _local_time(epoch):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(epoch))


class RaceStore(object):

    def __init__(self, path):
        self.path = path
        self._create_schema()

    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _create_schema(self):
        with closing(self._connect()) as conn:
            for sql in SCHEMA:
                conn.execute(sql)
            # 예전 DB 에는 is_bot 컬럼이 없다
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(results)")]
            if "is_bot" not in cols:
                conn.execute("ALTER TABLE results ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0")
            conn.commit()

    def save_race(self, results, started_at, finished_at):
        """레이스 1판 저장. results 는 Room 의 결과 목록. 새 race id 를 돌려준다."""
        with closing(self._connect()) as conn:
            cur = conn.execute(
                "INSERT INTO races(started_at, finished_at, player_count) VALUES (?, ?, ?)",
                (_local_time(started_at), _local_time(finished_at), len(results)))
            race_id = cur.lastrowid
            conn.executemany(
                "INSERT INTO results(race_id, player_name, color, rank, time_ms, finished, is_bot)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                [(race_id, r["name"], r["color"], r["rank"], r["time_ms"],
                  1 if r["finished"] else 0, 1 if r["ai"] else 0) for r in results])
            conn.commit()
            return race_id

    def leaderboard(self):
        with closing(self._connect()) as conn:
            best = [dict(r) for r in conn.execute(BEST_TIMES_SQL)]
            wins = [dict(r) for r in conn.execute(MEDALS_SQL)]
            total = conn.execute("SELECT COUNT(*) FROM races").fetchone()[0]
        return {"best": best, "wins": wins, "total_races": total}
