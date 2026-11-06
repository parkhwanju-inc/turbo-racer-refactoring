// 게임 클라이언트를 브라우저 없이 Node 에서 띄우는 도구.
//
// 가짜 DOM / 캔버스 / 저장소 / XHR / 시계를 넣고, index.html 이 부르는 스크립트를
// 같은 순서로 vm 컨텍스트 하나에서 실행한다.
// 게임 코드의 내부 이름(window.TR.*)은 **이 파일에서만** 쓴다.
// 리팩토링으로 이름이나 파일 구조가 바뀌면 테스트 파일은 그대로 두고 여기만 맞춘다.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// TR_APP_DIR: 다른 폴더의 코드로 돌리기 (API 테스트와 같은 변수)
const PUBLIC = path.join(process.env.TR_APP_DIR || path.join(__dirname, "..", ".."), "public");

function scriptFiles() {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)].map((m) => m[1]);
  if (!srcs.length) throw new Error("index.html 에서 스크립트를 못 찾았어요");
  return srcs.map((s) => path.join(PUBLIC, s));
}

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

const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 브라우저처럼: innerHTML 은 항상 문자열, textContent 는 이스케이프되어 innerHTML 에 보임
function makeElement(id, ctx2d) {
  let html = "";
  const el = {
    id, value: "", className: "", style: {}, disabled: false,
    attrs: {}, listeners: {}, children: [],
    clientWidth: 1280, clientHeight: 720, width: 0, height: 0,
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); },
    get textContent() { return html; },
    set textContent(v) { html = escapeText(v); },
    classList: {
      contains: (c) => el.className.split(/\s+/).indexOf(c) > -1,
      add: (c) => { if (!el.classList.contains(c)) el.className = (el.className + " " + c).trim(); },
      remove: (c) => { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
      toggle: (c, force) => {
        const on = force === undefined ? !el.classList.contains(c) : !!force;
        if (on) el.classList.add(c); else el.classList.remove(c);
        return on;
      },
    },
    dataset: {},
    getElementsByTagName() { return this.children; },
    querySelectorAll() { return this.children; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    focus() {},
    click() {
      if (this.onclick) this.onclick({ preventDefault() {} });
      (this.listeners.click || []).forEach((f) => f({ preventDefault() {} }));
    },
    getContext() { return ctx2d; },
  };
  return el;
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
 * 게임을 새로 불러온다. 부를 때마다 완전히 새 전역 상태.
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
    querySelectorAll() { return []; },
    querySelector() { return null; },
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
  for (const file of scriptFiles()) {
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }

  return { ctx, TR: sandbox.TR, els, xhrs, clock, alerts, winListeners, document, sandbox };
}

// ------------------------------------------------------------ 게임 코드에 접근 (이름 의존은 여기만)
function track(g) {
  const t = g.TR.track;
  return { n: t.n, points: t.points, pads: t.pads, boxes: t.boxes, trees: t.trees, bounds: t.bounds };
}
const fmtTime = (g, ms) => g.TR.util.fmtTime(ms);
const escHtml = (g, v) => g.TR.util.escHtml(v);
const gridPos = (g, slot) => g.TR.track.gridPos(slot);
const difficulty = (g, name) => g.TR.config.DIFFICULTY[name];
const gameState = (g) => g.TR.game.state;

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
  gameState(g).locals = locals.map((o) => g.TR.game.newLocal({ id: o.id, ai: !!o.ai }));
  gameState(g).screen = "lobby";
}

/** 서버 응답이 온 것처럼 상태를 넘긴다 */
function receiveState(g, state) { g.TR.game.onState(state); }

function screen(g) { return gameState(g).screen; }
function locals(g) { return Array.from(gameState(g).locals); }   // vm 안 배열 -> 바깥 배열 (deepEqual 용)
function local(g, id) { return gameState(g).locals.find((l) => l.id === id); }
function car(g, id) { return local(g, id).car; }
function remotes(g) { return gameState(g).remotes; }
function serverOffset(g) { return g.TR.net.clock.offset; }

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
  g.TR.game.stepLocal(local(g, id), input, dt);
}

/** 메인 루프 n 프레임 (60fps) */
function frames(g, n, fps) {
  const step = 1000 / (fps || 60);
  for (let i = 0; i < n; i++) {
    g.clock.now += step;
    g.TR.game.mainLoop(g.clock.now);
  }
}

function keyDown(g, code) { (g.winListeners.keydown || []).forEach((f) => f({ code, preventDefault() {} })); }
function keyUp(g, code) { (g.winListeners.keyup || []).forEach((f) => f({ code, preventDefault() {} })); }

/** 위치 보내기 폴링 1번 강제 */
function netTick(g) {
  gameState(g).lastPoll = 0;
  gameState(g).busy = false;
  g.TR.game.netTick();
}

function requests(g, url) { return g.xhrs.filter((x) => x.sent && (!url || x.url === url)); }

/** 화면의 요소 (id 로) */
function el(g, id) { return g.document.getElementById(id); }
function click(g, id) { el(g, id).click(); }
function openBoard(g) { g.TR.ui.openBoard(); }

module.exports = {
  loadGame, track, fmtTime, escHtml, gridPos, difficulty, makeState, makePlayer, setLocals, receiveState,
  screen, locals, local, car, remotes, serverOffset, startRace, physicsStep, frames, keyDown, keyUp,
  netTick, requests, serverNowSec, el, click, openBoard,
};
