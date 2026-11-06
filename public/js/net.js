// 서버와 주고받기. XHR 은 전부 request() 하나로 (예전엔 5군데 복사되어 있었음)
(function (TR) {
  "use strict";

  var clock = { offset: 0, bestRtt: 1e9 };   // offset: 서버 시계 - 내 시계 (초)

  function serverNow() {
    return new Date().getTime() / 1000 + clock.offset;
  }

  // 응답의 now 로 서버 시계를 맞춘다. 왕복이 제일 빨랐던 응답(+여유) 만 믿는다
  function syncClock(serverTime, t0, t1) {
    var rtt = t1 - t0;
    if (rtt <= clock.bestRtt * 1.3 + 5) {
      clock.bestRtt = Math.min(clock.bestRtt, rtt);
      clock.offset = serverTime - (t0 + t1) / 2000;
    }
  }

  /**
   * body 가 undefined 면 GET, 아니면 JSON POST.
   * 응답이 오면 onOk(res) 또는 onErr(error) 를 (같은 틱에서 바로) 부른다.
   */
  function request(url, body, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    var t0 = new Date().getTime();
    var isGet = body === undefined;
    xhr.open(isGet ? "GET" : "POST", url, true);
    if (!isGet) xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState != 4) return;
      var res;
      try {
        if (xhr.status == 0) throw new TypeError("Failed to fetch");
        res = JSON.parse(xhr.responseText);
        if (res && typeof res.now == "number") syncClock(res.now, t0, new Date().getTime());
        if (xhr.status < 200 || xhr.status > 299) throw new Error(res.error || "오류");
      } catch (e) {
        if (onErr) onErr(e);
        return;
      }
      if (onOk) onOk(res);
    };
    xhr.send(isGet ? null : JSON.stringify(body));
  }

  function get(url, onOk, onErr) { request(url, undefined, onOk, onErr); }
  function post(url, body, onOk, onErr) { request(url, body, onOk, onErr); }

  TR.net = { clock: clock, serverNow: serverNow, get: get, post: post };
})(window.TR = window.TR || {});
