// api/[action].js (Vercel -> Supabase 중계) 동작 고정 테스트
//
//   node --test tests/
//
// 진짜 Supabase 에 안 붙는다. https 모듈을 가짜로 바꿔서 나가는 요청과 돌아오는 응답을 본다.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");

const ROOT = process.env.TR_APP_DIR || path.join(__dirname, "..", "..");
const FILE = path.join(ROOT, "api", "[action].js");
const URL_ = "https://abc.supabase.co";
const KEY = "sb_publishable_xyz";

/** 환경변수를 정해서 모듈을 새로 불러온다 */
function loadProxy(env) {
  const sent = [];
  const fakeHttps = {
    request(opts, cb) {
      const r = new EventEmitter();
      r.opts = opts; r.chunks = []; r.cb = cb;
      r.write = (d) => { r.chunks.push(String(d)); };
      r.end = () => { r.ended = true; };
      r.setTimeout = () => r;   // 리팩토링 후 타임아웃을 넣어도 테스트가 돌도록
      sent.push(r);
      return r;
    },
  };
  const mod = { exports: {} };
  const req = (name) => (name === "https" ? fakeHttps : require(name));
  const fn = vm.runInThisContext("(function (module, exports, require, process, Buffer) {" +
    fs.readFileSync(FILE, "utf8") + "\n})", { filename: FILE });
  fn(mod, mod.exports, req, { env: Object.assign({}, env) }, Buffer);
  return { handler: mod.exports, sent };
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: null, done: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; this.done = true; },
    json() { return JSON.parse(this.body); },
  };
}

/** 요청 하나 보내고, Supabase 가 sbStatus / sbText 로 답한 것처럼 */
function call(p, req, sbStatus, sbText) {
  const res = fakeRes();
  p.handler(req, res);
  const out = p.sent[p.sent.length - 1];
  if (out && sbStatus !== undefined) {
    const resp = new EventEmitter();
    resp.statusCode = sbStatus;
    out.cb(resp);
    resp.emit("data", Buffer.from(sbText));
    resp.emit("end");
  }
  return { res, out, payload: out ? JSON.parse(out.chunks.join("")) : null };
}

const env = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: KEY };
const ok = (status, body) => JSON.stringify({ status, body });

test("허용된 action 만 통과, 나머지 404", () => {
  const p = loadProxy(env);
  const allowed = [["GET", "state"], ["GET", "leaderboard"], ["POST", "join"], ["POST", "leave"], ["POST", "update"],
    ["POST", "start"], ["POST", "finish"], ["POST", "reset"], ["POST", "settings"]];
  for (const [method, action] of allowed) {
    const { res, out } = call(p, { method, query: { action }, body: {} });
    assert.ok(out, `${method} ${action} 은 중계`);
    assert.equal(res.done, false);
  }
  const before = p.sent.length;
  for (const [method, action] of [["POST", "state"], ["GET", "join"], ["GET", "nope"], ["PUT", "join"], ["DELETE", "leave"], ["GET", undefined]]) {
    const { res } = call(p, { method, query: { action }, body: {} });
    assert.equal(res.statusCode, 404, `${method} ${action}`);
    assert.deepEqual(res.json(), { error: "not found" });
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(res.headers["cache-control"], "no-store");
  }
  assert.equal(p.sent.length, before, "404 는 Supabase 로 안 보냄");
});

test("Supabase 로 보내는 요청 모양", () => {
  const p = loadProxy(env);
  const { out, payload } = call(p, { method: "POST", query: { action: "join" }, body: { name: "홍길동" } });
  assert.equal(out.opts.method, "POST");
  assert.equal(out.opts.hostname, "abc.supabase.co");
  assert.equal(String(out.opts.port), "443");
  assert.equal(out.opts.path, "/rest/v1/rpc/tr_api");
  assert.equal(out.opts.headers.apikey, KEY);
  assert.equal(out.opts.headers["Content-Type"], "application/json");
  assert.equal(Number(out.opts.headers["Content-Length"]), Buffer.byteLength(out.chunks.join("")));
  assert.equal(out.opts.headers.Authorization, undefined, "sb_ 키는 Authorization 안 붙임");
  assert.deepEqual(payload, { p_action: "join", p_body: { name: "홍길동" } });
  assert.equal(out.ended, true);
});

test("JWT 형식 키면 Authorization: Bearer 를 붙인다", () => {
  const p = loadProxy({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: "eyJhbGciOi.jwt" });
  const { out } = call(p, { method: "GET", query: { action: "leaderboard" } });
  assert.equal(out.opts.headers.Authorization, "Bearer eyJhbGciOi.jwt");
});

test("state: ids / id 쿼리를 합쳐서 최대 8개", () => {
  const p = loadProxy(env);
  const cases = [
    [{ ids: "a,b" }, ["a", "b"]],
    [{ id: "c" }, ["c"]],
    [{ ids: "a,,b", id: "c" }, ["a", "b", "c"]],
    [{ ids: ["a", "b,c"], id: ["d"] }, ["a", "b", "c", "d"]],
    [{ ids: "1,2,3,4,5,6,7,8,9,10" }, ["1", "2", "3", "4", "5", "6", "7", "8"]],
    [{}, []],
  ];
  for (const [q, want] of cases) {
    const { payload } = call(p, { method: "GET", query: Object.assign({ action: "state" }, q) });
    assert.deepEqual(payload, { p_action: "state", p_body: { ids: want } }, JSON.stringify(q));
  }
  const { payload } = call(p, { method: "GET", query: { action: "leaderboard", ids: "a" } });
  assert.deepEqual(payload, { p_action: "leaderboard", p_body: {} });
});

test("POST 본문: 문자열이면 JSON 해석, 이상하면 {}", () => {
  const p = loadProxy(env);
  const cases = [
    ['{"id":"x"}', { id: "x" }],
    ["{bad", {}],
    ["x".repeat(10001), {}],
    ["[1,2]", {}],
    ["null", {}],
    [null, {}],
    [undefined, {}],
    [[1, 2], {}],
    [{ id: "y" }, { id: "y" }],
  ];
  for (const [body, want] of cases) {
    const { payload } = call(p, { method: "POST", query: { action: "leave" }, body });
    assert.deepEqual(payload.p_body, want, String(body).slice(0, 20));
  }
});

test("Supabase 응답: status/body 를 그대로 HTTP 로", () => {
  const p = loadProxy(env);
  const { res } = call(p, { method: "POST", query: { action: "join" }, body: {} }, 200,
    ok(409, { error: "방이 가득 찼어요 (최대 8명)" }));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: "방이 가득 찼어요 (최대 8명)" });
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-store");

  const r2 = call(p, { method: "GET", query: { action: "state" } }, 200, ok(200, { phase: "lobby", 한글: "됨" })).res;
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(r2.json(), { phase: "lobby", 한글: "됨" });
});

test("Supabase 오류는 502", () => {
  const p = loadProxy(env);
  for (const [st, text] of [[500, ok(200, {})], [404, "{}"], [200, "not json"], [200, '{"body":{}}'], [200, "null"]]) {
    const { res } = call(p, { method: "GET", query: { action: "state" } }, st, text);
    assert.equal(res.statusCode, 502, `${st} ${text}`);
    assert.deepEqual(res.json(), { error: "데이터베이스 오류" });
  }
  const p2 = loadProxy(env);
  const res = fakeRes();
  p2.handler({ method: "GET", query: { action: "state" } }, res);
  p2.sent[0].emit("error", new Error("ECONNRESET"));
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: "데이터베이스에 연결하지 못했어요" });

  // 주소에 https:// 가 빠진 잘못된 설정: 함수가 죽지 않고 502
  const p3 = loadProxy({ SUPABASE_URL: "abc.supabase.co", SUPABASE_ANON_KEY: KEY });
  const res3 = fakeRes();
  p3.handler({ method: "GET", query: { action: "state" } }, res3);
  if (p3.sent.length) p3.sent[0].emit("error", new Error("ENOTFOUND"));
  assert.equal(res3.statusCode, 502);
  assert.deepEqual(res3.json(), { error: "데이터베이스에 연결하지 못했어요" });
});

test("환경변수 없으면 500, 다른 이름도 받고 BOM/공백/끝 / 는 지운다", () => {
  const { res } = call(loadProxy({}), { method: "GET", query: { action: "state" } });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: "서버 설정(SUPABASE_URL / SUPABASE_ANON_KEY)이 없어요" });

  assert.equal(call(loadProxy({ SUPABASE_URL: URL_ }), { method: "GET", query: { action: "state" } }).res.statusCode, 500);

  const p = loadProxy({ NEXT_PUBLIC_SUPABASE_URL: "﻿  " + URL_ + "/ \r\n", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "﻿" + KEY + "\t\n" });
  const { out } = call(p, { method: "GET", query: { action: "state" } });
  assert.equal(out.opts.hostname, "abc.supabase.co");
  assert.equal(out.opts.path, "/rest/v1/rpc/tr_api");
  assert.equal(out.opts.headers.apikey, KEY);

  for (const name of ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
    const e = { SUPABASE_URL: URL_ };
    e[name] = KEY;
    assert.equal(call(loadProxy(e), { method: "GET", query: { action: "state" } }).out.opts.headers.apikey, KEY, name);
  }
  // 앞 순서 이름이 이긴다
  const both = loadProxy({ SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_URL: "https://other.co", SUPABASE_ANON_KEY: "sb_a", SUPABASE_PUBLISHABLE_KEY: "sb_b" });
  const o = call(both, { method: "GET", query: { action: "state" } }).out;
  assert.equal(o.opts.hostname, "abc.supabase.co");
  assert.equal(o.opts.headers.apikey, "sb_a");
});
