// game.js 를 브라우저 없이 Node 에서 띄우는 도구.
//
// 가짜 DOM / 캔버스 / 저장소 / XHR / 시계를 넣고 game.js 를 vm 컨텍스트에서 실행한다.
// game.js 의 전역 이름(fnPhysics, g_aTrack ...)은 **이 파일에서만** 쓴다.
// 리팩토링으로 이름이나 파일 구조가 바뀌면 테스트 파일은 그대로 두고 여기만 맞춘다.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// TR_APP_DIR: 다른 폴더의 코드로 돌리기 (API 테스트와 같은 변수)
const GAME_JS = path.join(process.env.TR_APP_DIR || path.join(__dirname, "..", ".."), "public", "game.js");

// ------------------------------------------------------------ 가짜 브라우저
function makeStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

function makeCtx2d() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function makeElement(id, ctx2d) {
  return {
    id, value: "", innerHTML: "", className: "", style: {}, disabled: false,
    attrs: {}, listeners: {}, children: [],
    clientWidth: 1280, clientHeight: 720, width: 0, height: 0,
    getElementsByTagName() { return this.children; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    focus() {},
    click() { if (this.onclick) this.onclick(); },
    getContext() { return ctx2d; },
  };
}

// 0~1 사이 고정 난수 (mulberry32)
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * game.js 를 새로 불러온다. 부를 때마다 완전히 새 전역 상태.
 * opts.local / opts.session : localStorage / sessionStorage 초기값
 * opts.seed : Math.random 고정 (기본 1)
 */
function loadGame(opts) {
  opts = opts || {};
  const ctx2d = makeCtx2d();
  const els = {};
  const winListeners = {};
  const xhrs = [];
  const clock = { now: 1000 };   // performance.now() (ms)
  const alerts = [];

  class FakeXHR {
    constructor() {
      this.readyState = 0; this.status = 0; this.responseText = ""; this.headers = {};
      xhrs.push(this);
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(b) { this.body = b == null ? null : JSON.parse(b); this.sent = true; }
    respond(status, obj) {
      this.readyState = 4; this.status = status; this.responseText = JSON.stringify(obj);
      if (this.onreadystatechange) this.onreadystatechange();
    }
  }

  const document = {
    getElementById(id) { return (els[id] = els[id] || makeElement(id, ctx2d)); },
    getElementsByTagName() { return []; },
    body: makeElement("body", ctx2d),
  };

  const sandbox = {
    document,
    localStorage: makeStorage(opts.local),
    sessionStorage: makeStorage(opts.session),
    performance: { now: () => clock.now },
    XMLHttpRequest: FakeXHR,
    Path2D: class { moveTo() {} lineTo() {} closePath() {} },
    requestAnimationFrame: () => 0,
    setInterval: () => 0,
    setTimeout: () => 0,
    alert: (m) => { alerts.push(String(m)); },
    console,
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    __rng: seededRandom(opts.seed == null ? 1 : opts.seed),
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext("Math.random = __rng;", ctx);
  vm.runInContext(fs.readFileSync(GAME_JS, "utf8"), ctx, { filename: GAME_JS });

  return { ctx, els, xhrs, clock, alerts, winListeners, document, sandbox };
}

// ------------------------------------------------------------ game.js 에 접근 (이름 의존은 여기만)
function track(g) {
  const c = g.ctx;
  return { n: c.g_nN, points: c.g_aTrack, pads: c.g_aPads, boxes: c.g_aBoxes, trees: c.g_aTrees, bounds: c.g_objBounds };
}
const fmtTime = (g, ms) => g.ctx.fnFmtTime(ms);
const escHtml = (g, v) => g.ctx.fnEscHtml(v);
const gridPos = (g, slot) => g.ctx.fnGridPos(slot);
const difficulty = (g, name) => g.ctx.g_objDiff[name];

function serverNowSec() { return Date.now() / 1000; }

/** 서버 상태 객체 하나 만들기 */
function makeState(over) {
  return Object.assign({
    now: serverNowSec(), phase: "lobby", start_at: 0, first_finish_at: 0, grace: 30, laps: 3,
    settings: { laps: 3, difficulty: "easy" }, me: null, players: [], results: [], race_id: null,
  }, over);
}

function makePlayer(p) {
  return Object.assign({ name: p.id, color: "#ff4d4d", x: 0, y: 0, a: 0, v: 0, progress: -1, lap: 0,
    rank: null, time_ms: null, dnf: false, ai: false }, p);
}

/** 이 브라우저가 맡은 차 목록을 정하고 (참가가 끝난 상태) */
function setLocals(g, locals) {
  g.ctx.g_aLocals = locals.map((o) => g.ctx.fnNewLocal({ id: o.id, ai: !!o.ai }));
  g.ctx.g_strScreen = "lobby";
}

/** 서버 응답이 온 것처럼 상태를 넘긴다 */
function receiveState(g, state) { g.ctx.fnOnState(state); }

function screen(g) { return g.ctx.g_strScreen; }
function locals(g) { return Array.from(g.ctx.g_aLocals); }   // vm 안 배열 -> 바깥 배열 (deepEqual 용)
function local(g, id) { return g.ctx.g_aLocals.find((l) => l.id === id); }
function car(g, id) { return local(g, id).car; }
function remotes(g) { return g.ctx.g_objRemotes; }
function serverOffset(g) { return g.ctx.g_nOffset; }

/**
 * 레이스 시작 상태로 만든다.
 * locals: [{id, ai, slot, name}], others: 다른 기기 플레이어 [{id, slot, ...}]
 * startIn: 지금부터 몇 초 뒤 출발 (음수면 이미 출발)
 */
function startRace(g, o) {
  const laps = o.laps || 3;
  const diff = o.difficulty || "easy";
  setLocals(g, o.locals);
  const players = o.locals.concat(o.others || []).map(makePlayer);
  receiveState(g, makeState({
    phase: "racing", start_at: serverNowSec() + (o.startIn == null ? -2 : o.startIn),
    laps, settings: { laps, difficulty: diff }, me: o.locals[0].id, players,
  }));
}

/** 물리 한 단계 (메인 루프 없이). dt 초 */
function physicsStep(g, id, input, dt) {
  g.clock.now += dt * 1000;
  g.ctx.fnPhysics(local(g, id), input, dt);
}

/** 메인 루프 n 프레임 (60fps) */
function frames(g, n, fps) {
  const step = 1000 / (fps || 60);
  for (let i = 0; i < n; i++) {
    g.clock.now += step;
    g.ctx.fnMainLoop(g.clock.now);
  }
}

function keyDown(g, code) { (g.winListeners.keydown || []).forEach((f) => f({ code, preventDefault() {} })); }
function keyUp(g, code) { (g.winListeners.keyup || []).forEach((f) => f({ code, preventDefault() {} })); }

/** 위치 보내기 폴링 1번 강제 */
function netTick(g) {
  g.ctx.g_nLastPoll = 0;
  g.ctx.g_bBusy = false;
  g.ctx.fnNetTick();
}

function requests(g, url) { return g.xhrs.filter((x) => x.sent && (!url || x.url === url)); }

/** 화면의 요소 (id 로) */
function el(g, id) { return g.document.getElementById(id); }
function click(g, id) { el(g, id).onclick(); }
function openBoard(g) { g.ctx.fnOpenBoard(); }

module.exports = {
  loadGame, track, fmtTime, escHtml, gridPos, difficulty, makeState, makePlayer, setLocals, receiveState,
  screen, locals, local, car, remotes, serverOffset, startRace, physicsStep, frames, keyDown, keyUp,
  netTick, requests, serverNowSec, el, click, openBoard,
};
