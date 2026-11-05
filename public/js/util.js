// 작은 공통 함수들
(function (TR) {
  "use strict";

  // innerHTML 에 사용자 값을 넣을 때는 꼭 거친다
  function escHtml(v) {
    if (v === null) return "";
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // 61234 -> "1:01.234"
  function fmtTime(ms) {
    if (ms == null) return "-";
    var m = Math.floor(ms / 60000), sec = ((ms % 60000) / 1000).toFixed(3);
    while (sec.length < 6) sec = "0" + sec;
    return m + ":" + sec;
  }

  // 각도 차이를 -PI ~ PI 로
  function wrapAngle(da) {
    return Math.atan2(Math.sin(da), Math.cos(da));
  }

  // 저장소가 막힌 브라우저(일부 사생활 보호 모드)에서도 게임은 돌아가게
  function storageGet(store, key) {
    try { return window[store].getItem(key); } catch (e) { return null; }
  }
  function storageSet(store, key, value) {
    try { window[store].setItem(key, value); } catch (e) { /* 저장 못 해도 계속 */ }
  }
  function storageGetJson(store, key, fallback) {
    try { return JSON.parse(storageGet(store, key)) || fallback; } catch (e) { return fallback; }
  }

  function $(id) { return document.getElementById(id); }

  TR.util = {
    escHtml: escHtml, fmtTime: fmtTime, wrapAngle: wrapAngle,
    storageGet: storageGet, storageSet: storageSet, storageGetJson: storageGetJson, $: $
  };
})(window.TR = window.TR || {});
