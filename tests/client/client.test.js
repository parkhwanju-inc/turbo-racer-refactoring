// game.js 동작 고정 테스트 (characterization test)
//
//   node --test tests/client/
//
// - 트랙/물리: golden.json (리팩토링 전 값) 과 숫자 비교
// - 나머지: 입력, AI, 부스터, 서버와 주고받는 요청, 화면 전환
// game.js 의 내부 이름은 harness.js 에서만 쓴다.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const h = require("./harness");
const { computeGolden } = require("./golden");

const N_SEC = 60; // 60fps 1초 = 60 프레임

// ------------------------------------------------------------ 숫자 비교 (오차 허용)
function assertClose(actual, expected, where) {
  if (typeof expected === "number") {
    const tol = 1e-6 * Math.max(1, Math.abs(expected));
    assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= tol,
      `${where}: ${actual} != ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${where}: 길이`);
    expected.forEach((v, i) => assertClose(actual[i], v, `${where}[${i}]`));
  } else if (expected && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: 키`);
    for (const k of Object.keys(expected)) assertClose(actual[k], expected[k], `${where}.${k}`);
  } else {
    assert.equal(actual, expected, where);
  }
}

// ====================================================================== golden
test("트랙과 물리 계산이 리팩토링 전과 같다 (golden.json)", () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "golden.json"), "utf8"));
  const now = computeGolden();
  assertClose(now.track, golden.track, "track");
  for (const diff of Object.keys(golden.physics)) {
    for (const sc of Object.keys(golden.physics[diff])) {
      assertClose(now.physics[diff][sc], golden.physics[diff][sc], `physics.${diff}.${sc}`);
    }
  }
});

test("트랙 기본 값", () => {
  const g = h.loadGame();
  const t = h.track(g);
  assert.equal(t.n, 616);
  assert.deepEqual(Array.from(t.pads), [105, 265, 431]);
  assert.equal(t.boxes.length, 12);
  assert.equal(t.trees.length, 170);
  // 다른 기기와 같은 트랙이어야 함: 두 번 불러도 같다
  const t2 = h.track(h.loadGame({ seed: 99 }));
  assert.equal(t2.n, t.n);
  assert.equal(t2.trees[50].x, t.trees[50].x);
});

// ====================================================================== 작은 함수
test("기록 시간 표시 (분:초.밀리초)", () => {
  const g = h.loadGame();
  assert.equal(h.fmtTime(g, null), "-");
  assert.equal(h.fmtTime(g, undefined), "-");
  assert.equal(h.fmtTime(g, 0), "0:00.000");
  assert.equal(h.fmtTime(g, 5432), "0:05.432");
  assert.equal(h.fmtTime(g, 61234), "1:01.234");
  assert.equal(h.fmtTime(g, 600000), "10:00.000");
});

test("HTML 이스케이프", () => {
  const g = h.loadGame();
  assert.equal(h.escHtml(g, `<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(h.escHtml(g, null), "");
  assert.equal(h.escHtml(g, 12), "12");
});

test("난이도 표 (출발 부스터 수, 충전 시간)", () => {
  const g = h.loadGame();
  assert.deepEqual([h.difficulty(g, "easy").start, h.difficulty(g, "normal").start, h.difficulty(g, "hard").start], [2, 1, 0]);
  assert.deepEqual([h.difficulty(g, "easy").charge, h.difficulty(g, "normal").charge, h.difficulty(g, "hard").charge], [6, 9, 12]);
});

// ====================================================================== 레이스
test("출발 전에는 가속을 눌러도 안 움직인다", () => {
  const g = h.loadGame();
  h.startRace(g, { startIn: 5, locals: [{ id: "p", slot: 0 }] });
  const c = h.car(g, "p");
  const x0 = c.x, y0 = c.y;
  h.keyDown(g, "ArrowUp");
  h.frames(g, 2 * N_SEC);
  assert.equal(c.x, x0);
  assert.equal(c.y, y0);
  assert.equal(c.fwd, 0);
});

test("출발 위치는 slot 에 따른 출발 칸", () => {
  const g = h.loadGame();
  h.startRace(g, { locals: [{ id: "p", slot: 3 }] });
  const c = h.car(g, "p"), gp = h.gridPos(g, 3);
  assert.equal(c.x, gp.x);
  assert.equal(c.y, gp.y);
  assert.equal(c.a, gp.a);
  assert.equal(c.dist, -gp.back);
  assert.equal(c.lap, 0);
});

test("혼자 할 때: 방향키와 WASD 둘 다 된다", () => {
  for (const code of ["ArrowUp", "KeyW"]) {
    const g = h.loadGame();
    h.startRace(g, { locals: [{ id: "p", slot: 0 }] });
    h.keyDown(g, code);
    h.frames(g, N_SEC);
    assert.ok(h.car(g, "p").fwd > 100, code);
    assert.ok(h.car(g, "p").dist > 0, code);
  }
});

test("화면 분할: 1번은 WASD, 2번은 방향키만 쓴다", () => {
  const g = h.loadGame();
  h.startRace(g, { locals: [{ id: "a", slot: 0 }, { id: "b", slot: 1 }] });
  h.keyDown(g, "KeyW");
  h.frames(g, N_SEC);
  assert.ok(h.car(g, "a").fwd > 100);
  assert.equal(h.car(g, "b").fwd, 0);
  h.keyUp(g, "KeyW");
  h.keyDown(g, "ArrowUp");
  h.frames(g, N_SEC);
  assert.ok(h.car(g, "b").fwd > 100);
});

test("게임 화면이 아닐 때 누른 키는 무시", () => {
  const g = h.loadGame();
  h.keyDown(g, "ArrowUp");          // 참가 화면에서 누름
  h.startRace(g, { locals: [{ id: "p", slot: 0 }] });
  h.frames(g, N_SEC);
  assert.equal(h.car(g, "p").fwd, 0);
});

test("자동 가속 옵션: 키 없이 달리고, 브레이크는 된다", () => {
  const g = h.loadGame({ local: { tr_opts: JSON.stringify({ rotate: true, autoGas: true }) } });
  h.startRace(g, { locals: [{ id: "p", slot: 0 }] });
  h.frames(g, N_SEC);
  const c = h.car(g, "p");
  assert.ok(c.fwd > 100);
  const before = c.fwd;
  h.keyDown(g, "ArrowDown");
  h.frames(g, 10);
  assert.ok(c.fwd < before);
});

test("부스터: 누른 순간 1칸 쓰고, 계속 누르고 있어도 1칸만", () => {
  const g = h.loadGame();
  h.startRace(g, { difficulty: "easy", locals: [{ id: "p", slot: 0 }] });
  const c = h.car(g, "p");
  assert.equal(c.charges, 2);
  h.keyDown(g, "Space");
  h.frames(g, 1);
  assert.equal(c.charges, 1);
  assert.ok(c.boost > 0);
  h.frames(g, 30);
  assert.equal(c.charges, 1);
  h.keyUp(g, "Space");
  h.frames(g, 1);
  h.keyDown(g, "Space");
  h.frames(g, 1);
  assert.equal(c.charges, 0);
  h.keyUp(g, "Space");
  h.frames(g, 1);
  h.keyDown(g, "Space");            // 0칸이면 안 써짐
  h.frames(g, 1);
  assert.equal(c.charges, 0);
});

test("부스터 게이지: 쉬움 6초 / 어려움 12초마다 1칸, 최대 3칸", () => {
  const g = h.loadGame();
  h.startRace(g, { difficulty: "easy", locals: [{ id: "p", slot: 0 }] });
  h.frames(g, Math.round(6.3 * N_SEC));
  assert.equal(h.car(g, "p").charges, 3);
  h.frames(g, 7 * N_SEC);
  assert.equal(h.car(g, "p").charges, 3);

  const g2 = h.loadGame();
  h.startRace(g2, { difficulty: "hard", locals: [{ id: "p", slot: 0 }] });
  h.frames(g2, Math.round(11.5 * N_SEC));
  assert.equal(h.car(g2, "p").charges, 0);
  h.frames(g2, Math.round(1 * N_SEC));
  assert.equal(h.car(g2, "p").charges, 1);
});

for (const diff of ["easy", "normal", "hard"]) {
  test(`컴퓨터 차가 ${diff} 에서 1바퀴를 돌고 완주를 보낸다`, () => {
    const g = h.loadGame({ seed: 3 });
    h.startRace(g, {
      difficulty: diff, laps: 1,
      locals: [{ id: "me", slot: 7 }, { id: "b1", ai: true, slot: 0 }, { id: "b2", ai: true, slot: 1 }, { id: "b3", ai: true, slot: 2 }],
    });
    let sec = 0;
    while (sec < 90 && h.requests(g, "/api/finish").length < 3) { h.frames(g, N_SEC); sec++; }
    const fin = h.requests(g, "/api/finish");
    assert.equal(fin.length, 3, `${sec}초 안에 3대 모두 완주`);
    assert.deepEqual(fin.map((x) => x.body.id).sort(), ["b1", "b2", "b3"]);
    for (const x of fin) {
      assert.equal(x.method, "POST");
      assert.equal(x.body.lap, 1);
      assert.ok(x.body.progress >= 1);
      assert.equal(x.headers["Content-Type"], "application/json");
    }
    assert.ok(sec < 40, `너무 느림: ${sec}초`);
    assert.equal(h.car(g, "me").finished, false);
  });
}

test("완주 응답: 등수를 받고, 실패하면 오류를 화면에 남긴다", () => {
  const g = h.loadGame({ seed: 3 });
  h.startRace(g, { laps: 1, locals: [{ id: "me", slot: 7 }, { id: "b1", ai: true, slot: 0 }, { id: "b2", ai: true, slot: 1 }] });
  let sec = 0;
  while (sec < 90 && h.requests(g, "/api/finish").length < 2) { h.frames(g, N_SEC); sec++; }
  const [ok, bad] = h.requests(g, "/api/finish");
  const st = h.makeState({ phase: "racing", start_at: h.serverNowSec() - 20, laps: 1, settings: { laps: 1, difficulty: "easy" },
    players: ["me", "b1", "b2"].map((id, i) => h.makePlayer({ id, slot: i, ai: id !== "me", rank: id === ok.body.id ? 1 : null })) });
  ok.respond(200, st);
  assert.equal(h.car(g, ok.body.id).rank, 1);
  bad.respond(400, { error: "완주가 확인되지 않았어요" });
  assert.equal(h.car(g, bad.body.id).err, "완주가 확인되지 않았어요");
});

// ====================================================================== 서버와 주고받기
test("레이스 중 위치 보내기: /api/update 에 ids 와 cars", () => {
  const g = h.loadGame();
  h.startRace(g, { locals: [{ id: "p", slot: 0 }, { id: "b", ai: true, slot: 1 }] });
  h.keyDown(g, "ArrowUp");
  h.frames(g, N_SEC);
  h.netTick(g);
  const req = h.requests(g, "/api/update").pop();
  assert.equal(req.method, "POST");
  assert.deepEqual(req.body.ids, ["p", "b"]);
  assert.equal(req.body.cars.length, 2);
  const c = h.car(g, "p"), sent = req.body.cars[0];
  assert.deepEqual(Object.keys(sent).sort(), ["a", "id", "lap", "progress", "v", "x", "y"]);
  assert.equal(sent.id, "p");
  assert.equal(sent.x, +c.x.toFixed(1));
  assert.equal(sent.y, +c.y.toFixed(1));
  assert.equal(sent.a, +c.a.toFixed(3));
  assert.equal(sent.v, +c.fwd.toFixed(1));
  assert.equal(sent.progress, +(c.dist / h.track(g).n).toFixed(4));
  assert.equal(sent.lap, c.lap);
});

test("대기실에서는 위치 없이 ids 만 보낸다, 참가 화면에서는 안 보낸다", () => {
  const g = h.loadGame();
  h.netTick(g);
  assert.equal(h.requests(g).length, 0);
  h.setLocals(g, [{ id: "p" }]);
  h.receiveState(g, h.makeState({ players: [h.makePlayer({ id: "p", slot: 0 })] }));
  h.netTick(g);
  const req = h.requests(g, "/api/update").pop();
  assert.deepEqual(req.body, { ids: ["p"], cars: [] });
});

test("참가하기: /api/join 보내고, 서버 시계를 맞추고, 대기실로", () => {
  const g = h.loadGame({ local: { tr_color: "#3ddc84" } });
  h.el(g, "nameInput").value = "  홍길동 ";
  h.click(g, "joinBtn");
  const req = h.requests(g, "/api/join").pop();
  assert.deepEqual(req.body, { name: "홍길동", color: "#3ddc84" });
  assert.equal(g.sandbox.localStorage.getItem("tr_name"), "홍길동");
  assert.equal(h.el(g, "joinBtn").disabled, true);

  const serverNow = h.serverNowSec() + 500;
  req.respond(200, h.makeState({ now: serverNow, me: "abc", players: [h.makePlayer({ id: "abc", name: "홍길동", slot: 0 })] }));
  assert.equal(h.screen(g), "lobby");
  assert.equal(h.locals(g).length, 1);
  assert.equal(h.locals(g)[0].id, "abc");
  assert.equal(h.locals(g)[0].ai, false);
  assert.deepEqual(JSON.parse(g.sandbox.sessionStorage.getItem("tr_locals")), [{ id: "abc", ai: false }]);
  assert.ok(Math.abs(h.serverOffset(g) - 500) < 1, "서버 시계 차이");
  assert.equal(h.el(g, "joinBtn").disabled, false);
  assert.equal(h.el(g, "lobbyCount").innerHTML, "1");
});

test("참가하기: 닉네임이 비면 요청 안 함, 서버 오류는 화면에 표시", () => {
  const g = h.loadGame();
  h.el(g, "nameInput").value = "   ";
  h.click(g, "joinBtn");
  assert.equal(h.requests(g).length, 0);
  assert.equal(h.el(g, "joinErr").innerHTML, "닉네임을 입력해 주세요");

  h.el(g, "nameInput").value = "a";
  h.click(g, "joinBtn");
  h.requests(g, "/api/join").pop().respond(409, { error: "방이 <가득> 찼어요" });
  assert.equal(h.el(g, "joinErr").innerHTML, "방이 &lt;가득&gt; 찼어요");
  assert.equal(h.screen(g), "join");
  assert.equal(h.el(g, "joinBtn").disabled, false);
});

test("새로고침: 저장된 차 id 로 다시 참가 요청", () => {
  const g = h.loadGame({ session: { tr_locals: JSON.stringify([{ id: "abc", ai: false }]) } });
  const req = h.requests(g, "/api/join")[0];
  assert.equal(req.body.id, "abc");
  req.respond(200, h.makeState({ me: "abc", players: [h.makePlayer({ id: "abc", slot: 0 })] }));
  assert.equal(h.screen(g), "lobby");
  assert.equal(h.locals(g)[0].id, "abc");
});

test("대기실: 이름은 이스케이프되고, 서버 목록에 없는 내 차는 빠진다", () => {
  const g = h.loadGame();
  h.setLocals(g, [{ id: "me" }, { id: "gone", ai: true }]);
  h.receiveState(g, h.makeState({ players: [
    h.makePlayer({ id: "me", name: "<img src=x>", slot: 0 }),
    h.makePlayer({ id: "other", name: "다른사람", slot: 1 }),
  ] }));
  assert.equal(h.screen(g), "lobby");
  assert.deepEqual(h.locals(g).map((l) => l.id), ["me"]);
  assert.deepEqual(JSON.parse(g.sandbox.sessionStorage.getItem("tr_locals")), [{ id: "me", ai: false }]);
  const html = h.el(g, "lobbyList").innerHTML;
  assert.ok(html.includes("&lt;img src=x&gt;"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("다른 기기"));
  assert.equal(h.el(g, "lobbyCount").innerHTML, "2");
});

test("사람 차가 모두 빠지면 컴퓨터도 내보내고 참가 화면으로", () => {
  const g = h.loadGame();
  h.setLocals(g, [{ id: "me" }, { id: "bot", ai: true }]);
  h.receiveState(g, h.makeState({ players: [h.makePlayer({ id: "bot", slot: 1, ai: true })] }));
  assert.equal(h.screen(g), "join");
  assert.deepEqual(h.requests(g, "/api/leave").map((x) => x.body), [{ id: "bot" }]);
  assert.equal(h.locals(g).length, 0);
  assert.ok(h.el(g, "joinErr").innerHTML.includes("연결이 끊겨"));
});

test("컴퓨터 추가: 이름이 겹치지 않게 컴퓨터N", () => {
  const g = h.loadGame();
  h.setLocals(g, [{ id: "me" }]);
  h.receiveState(g, h.makeState({ players: [h.makePlayer({ id: "me", slot: 0 }), h.makePlayer({ id: "x", name: "컴퓨터1", slot: 1 })] }));
  h.click(g, "addBotBtn");
  assert.deepEqual(h.requests(g, "/api/join").pop().body, { name: "컴퓨터2", ai: true });
});

test("시작 / 다시 하기 버튼은 첫 번째 사람 id 로 보낸다", () => {
  const g = h.loadGame();
  h.setLocals(g, [{ id: "bot", ai: true }, { id: "me" }]);
  h.receiveState(g, h.makeState({ players: [h.makePlayer({ id: "bot", slot: 0, ai: true }), h.makePlayer({ id: "me", slot: 1 })] }));
  h.click(g, "startBtn");
  assert.deepEqual(h.requests(g, "/api/start").pop().body, { id: "me" });
  h.click(g, "againBtn");
  assert.deepEqual(h.requests(g, "/api/reset").pop().body, { id: "me" });
});

test("서버 phase 에 따라 화면이 바뀐다", () => {
  const g = h.loadGame();
  h.setLocals(g, [{ id: "me" }]);
  const players = [h.makePlayer({ id: "me", slot: 0 })];
  h.receiveState(g, h.makeState({ phase: "lobby", players }));
  assert.equal(h.screen(g), "lobby");
  h.receiveState(g, h.makeState({ phase: "racing", start_at: h.serverNowSec() + 3, players }));
  assert.equal(h.screen(g), "game");
  assert.ok(h.car(g, "me"), "레이스 시작하면 차가 생김");
  h.receiveState(g, h.makeState({ phase: "finished", players, results: [
    { name: "me", color: "#ff4d4d", rank: 1, time_ms: 61234, finished: true, ai: false },
    { name: "<b>", color: "#3d8bff", rank: null, time_ms: null, finished: false, ai: true },
  ] }));
  assert.equal(h.screen(g), "results");
  const rows = h.el(g, "resultRows").innerHTML;
  assert.ok(rows.includes("1등"));
  assert.ok(rows.includes("1:01.234"));
  assert.ok(rows.includes("리타이어"));
  assert.ok(rows.includes("🤖 &lt;b&gt;"));
  h.receiveState(g, h.makeState({ phase: "lobby", players }));
  assert.equal(h.screen(g), "lobby");
});

test("다른 기기 차: 받은 위치로 부드럽게 따라간다", () => {
  const g = h.loadGame();
  h.startRace(g, { locals: [{ id: "me", slot: 0 }], others: [{ id: "far", slot: 1 }] });
  const r = h.remotes(g).far;
  const gp = h.gridPos(g, 1);
  assert.equal(r.x, gp.x, "아직 안 움직였으면 출발 칸");
  const st = h.makeState({ phase: "racing", start_at: h.serverNowSec() - 2, players: [
    h.makePlayer({ id: "me", slot: 0 }), h.makePlayer({ id: "far", slot: 1, x: gp.x + 100, y: gp.y, a: 0, v: 0, progress: 0.01 })] });
  h.receiveState(g, st);
  h.frames(g, 1);
  assert.ok(r.x > gp.x && r.x < gp.x + 100, "한 프레임엔 일부만");
  h.frames(g, N_SEC);
  assert.ok(Math.abs(r.x - (gp.x + 100)) < 0.5, "곧 따라잡음");
  h.receiveState(g, h.makeState({ phase: "racing", start_at: st.start_at, players: [h.makePlayer({ id: "me", slot: 0 })] }));
  assert.equal(h.remotes(g).far, undefined, "나간 차는 지움");
});

test("명예의 전당: 이름 이스케이프, 기록 표시", () => {
  const g = h.loadGame();
  h.openBoard(g);
  const req = h.requests(g, "/api/leaderboard").pop();
  assert.equal(req.method, "GET");
  assert.equal(req.body, null);
  req.respond(200, {
    best: [{ player_name: "<i>빠름</i>", color: "#ff4d4d", time_ms: 45678, date: "2026-11-05 12:00:00" }],
    wins: [{ player_name: "왕", gold: 3, silver: 1, bronze: 0, races: 5 }],
    total_races: 7,
  });
  assert.ok(h.el(g, "boardTotal").innerHTML.includes("7번의 레이스"));
  const best = h.el(g, "bestRows").innerHTML;
  assert.ok(best.includes("&lt;i&gt;빠름&lt;/i&gt;"));
  assert.ok(best.includes("0:45.678"));
  assert.ok(h.el(g, "winRows").innerHTML.includes("<td>왕</td><td>3</td>"));
  assert.ok(h.el(g, "board").className.includes("active"));
});
