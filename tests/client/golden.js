// 트랙 모양과 물리 계산 결과를 숫자로 뽑는다.
// golden.json 은 리팩토링 전 코드에서 뽑아 둔 값이고, client.test.js 가 지금 값과 비교한다.
//
//   node tests/client/record-golden.js   <- 물리/트랙을 "일부러" 바꿨을 때만 다시 기록
"use strict";
const h = require("./harness");

const round = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);

function trackGolden() {
  const g = h.loadGame();
  const t = h.track(g);
  const sum = (arr, k) => round(arr.reduce((s, p) => s + p[k], 0));
  const pick = (p) => ({ x: round(p.x), y: round(p.y), tx: round(p.tx), ty: round(p.ty) });
  return {
    n: t.n,
    sumX: sum(t.points, "x"), sumY: sum(t.points, "y"),
    sumTx: sum(t.points, "tx"), sumTy: sum(t.points, "ty"),
    first: t.points.slice(0, 3).map(pick),
    last: pick(t.points[t.n - 1]),
    pads: Array.from(t.pads),
    boxes: t.boxes.map((b) => ({ x: round(b.x), y: round(b.y) })),
    trees: { count: t.trees.length, sumX: sum(t.trees, "x"), sumY: sum(t.trees, "y"), sumR: sum(t.trees, "r") },
    bounds: { x0: round(t.bounds.x0), y0: round(t.bounds.y0), x1: round(t.bounds.x1), y1: round(t.bounds.y1) },
    grid: [0, 1, 2, 3, 4, 5, 6, 7].map((s) => {
      const p = h.gridPos(g, s);
      return { x: round(p.x), y: round(p.y), a: round(p.a), i: p.i, back: p.back };
    }),
  };
}

// 입력 시나리오 (t = 경과 초). 각 4초, 1/120초 단위, 0.5초마다 기록
const SCENARIOS = {
  gas: (t) => ({ up: true }),
  gas_right: (t) => ({ up: true, right: t > 1 }),
  gas_left_into_wall: (t) => ({ up: true, left: t > 0.5 }),
  brake_reverse: (t) => ({ up: t < 1.5, down: t >= 1.5 }),
  boost: (t) => ({ up: true }),
  wiggle: (t) => ({ up: true, left: Math.floor(t * 2) % 2 === 0, right: Math.floor(t * 2) % 2 === 1 }),
};

function snapCar(c) {
  return {
    x: round(c.x), y: round(c.y), a: round(c.a), vx: round(c.vx), vy: round(c.vy), fwd: round(c.fwd),
    dist: c.dist, idx: c.idx, lap: c.lap, lat: round(c.lat), grass: c.grass, steer: round(c.steer),
    boost: round(c.boost), charges: c.charges,
  };
}

function runScenario(diff, name) {
  const g = h.loadGame({ seed: 7 });
  h.startRace(g, { difficulty: diff, laps: 3, locals: [{ id: "p", slot: 0 }] });
  const c = h.car(g, "p");
  if (name === "boost") { c.boost = 1.6; c.boostMax = 1.6; }
  const dt = 1 / 120, out = [];
  for (let s = 1; s <= 480; s++) {
    h.physicsStep(g, "p", Object.assign({ up: false, down: false, left: false, right: false }, SCENARIOS[name](s * dt)), dt);
    if (s % 60 === 0) out.push(snapCar(c));
  }
  return out;
}

// 차 두 대가 부딪히는 경우
function runTwoCars(diff) {
  const g = h.loadGame({ seed: 7 });
  h.startRace(g, { difficulty: diff, laps: 3, locals: [{ id: "p", slot: 0 }, { id: "q", slot: 1 }] });
  const dt = 1 / 120, out = [];
  for (let s = 1; s <= 360; s++) {
    const t = s * dt;
    h.physicsStep(g, "p", { up: true, right: t > 0.3 && t < 0.9 }, dt);
    g.clock.now -= dt * 1000;   // 같은 순간에 두 대 계산
    h.physicsStep(g, "q", { up: true }, dt);
    if (s % 60 === 0) out.push({ p: snapCar(h.car(g, "p")), q: snapCar(h.car(g, "q")) });
  }
  return out;
}

function computeGolden() {
  const physics = {};
  for (const diff of ["easy", "normal", "hard"]) {
    physics[diff] = {};
    for (const name of Object.keys(SCENARIOS)) physics[diff][name] = runScenario(diff, name);
    physics[diff].two_cars = runTwoCars(diff);
  }
  return { track: trackGolden(), physics };
}

module.exports = { computeGolden };
