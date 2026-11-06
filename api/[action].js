/*
 * Vercel 서버리스 함수: /api/<action> 를 Supabase RPC tr_api(p_action, p_body) 로 넘긴다.
 * 게임 로직은 없다. tr_api 가 {status, body} 를 주면 그대로 HTTP 상태/본문으로 돌려준다.
 */
var https = require("https");

var GET_ACTIONS = ["state", "leaderboard"];
var POST_ACTIONS = ["join", "leave", "update", "start", "finish", "reset", "settings"];
var MAX_IDS = 8;
var MAX_BODY = 10000;

// 첫 번째로 값이 있는 환경변수. 앞뒤 공백과 BOM(윈도우에서 붙여 넣으면 생김)은 지운다
function env(names) {
  for (var i = 0; i < names.length; i++) {
    var v = process.env[names[i]];
    if (v) return v.trim();     // String.prototype.trim 은 BOM(U+FEFF)도 지운다
  }
  return "";
}

var SB_URL = env(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/+$/, "");
var SB_KEY = env(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
                  "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isAllowed(method, action) {
  if (method == "GET") return GET_ACTIONS.indexOf(action) > -1;
  if (method == "POST") return POST_ACTIONS.indexOf(action) > -1;
  return false;
}

// ?ids=a,b&id=c -> ['a', 'b', 'c'] (빈 값 빼고 최대 8개). 같은 이름이 여러 번 오면 배열로 온다
function stateIds(query) {
  var parts = [].concat(query.ids || [], query.id || []);
  return parts.join(",").split(",").filter(function (s) { return s != ""; }).slice(0, MAX_IDS);
}

// Vercel 이 JSON 을 미리 풀어 주기도 하고 문자열로 주기도 한다. JSON 객체가 아니면 {}
function postBody(raw) {
  var body = raw;
  if (typeof body == "string") {
    if (body.length > MAX_BODY) return {};
    try { body = JSON.parse(body); } catch (e) { return {}; }
  }
  if (body == null || typeof body != "object" || Array.isArray(body)) return {};
  return body;
}

function connectFailed(res, e) {
  console.error(e);
  sendJson(res, 502, { error: "데이터베이스에 연결하지 못했어요" });
}

function callSupabase(action, body, res) {
  var url;
  try { url = new URL(SB_URL + "/rest/v1/rpc/tr_api"); } catch (e) { return connectFailed(res, e); }   // 주소 설정이 잘못됨
  var payload = JSON.stringify({ p_action: action, p_body: body });
  var headers = {
    apikey: SB_KEY,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload)
  };
  // sb_publishable_ 키는 JWT 가 아니라서 Authorization 에 넣으면 Supabase 가 거부한다
  if (SB_KEY.substring(0, 3) != "sb_") headers.Authorization = "Bearer " + SB_KEY;

  var out = https.request({
    hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method: "POST", headers: headers
  }, function (resp) {
    var chunks = [];
    resp.on("data", function (c) { chunks.push(c); });
    resp.on("end", function () {
      var data = null;
      try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { /* 아래에서 오류 처리 */ }
      if (resp.statusCode < 200 || resp.statusCode > 299 || data == null || typeof data.status != "number") {
        console.error("supabase error", resp.statusCode, data);
        sendJson(res, 502, { error: "데이터베이스 오류" });
        return;
      }
      sendJson(res, data.status, data.body);
    });
  });
  out.on("error", function (e) { connectFailed(res, e); });
  out.write(payload);
  out.end();
}

module.exports = function (req, res) {
  var action = "" + (req.query.action || "");
  res.setHeader("Cache-Control", "no-store");

  if (!isAllowed(req.method, action)) return sendJson(res, 404, { error: "not found" });
  if (!SB_URL || !SB_KEY) {
    return sendJson(res, 500, { error: "서버 설정(SUPABASE_URL / SUPABASE_ANON_KEY)이 없어요" });
  }

  var body;
  if (action == "state") body = { ids: stateIds(req.query) };
  else if (req.method == "POST") body = postBody(req.body);
  else body = {};
  callSupabase(action, body, res);
};
