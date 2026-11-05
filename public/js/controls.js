// 조작: 사람(키보드/터치)과 컴퓨터(AI)가 같은 모양의 입력 {up, down, left, right, nitro} 을 만든다
(function (TR) {
  "use strict";
  var C = TR.config;
  var wrapAngle = TR.util.wrapAngle;

  var pressed = {};                       // 눌려 있는 키 (e.code)
  var touch = { up: false, down: false, left: false, right: false, nitro: false };
  var gameCodes = {};                     // 게임이 쓰는 키 (브라우저 기본 동작 막을 것)
  Object.keys(C.KEY_SCHEMES).forEach(function (name) {
    var sc = C.KEY_SCHEMES[name];
    ["up", "down", "left", "right", "nitro"].forEach(function (k) {
      sc[k].forEach(function (code) { gameCodes[code] = true; });
    });
  });

  function anyPressed(codes) {
    return codes.some(function (code) { return pressed[code] === true; });
  }

  /** 사람: 화면 분할 첫 번째 사람만 터치 버튼도 받는다 */
  function humanInput(schemeName, isFirstHuman, autoGas) {
    var sc = C.KEY_SCHEMES[schemeName];
    function key(k) { return anyPressed(sc[k]) || (isFirstHuman && touch[k]); }
    var down = key("down");
    return { up: key("up") || (autoGas && !down), down: down, left: key("left"), right: key("right"), nitro: key("nitro") };
  }

  /** 컴퓨터: 앞쪽 트랙 점(자기 차선)을 보고 핸들, 급커브면 감속, 끼면 잠깐 후진 */
  function aiInput(l, track, dt, serverNow, startAt, diff) {
    var c = l.car;
    var look = 8 + Math.round(Math.max(0, c.fwd) / 55);
    var q = track.points[(c.idx + look) % track.n];
    var tx = q.x + q.nx * l.lane, ty = q.y + q.ny * l.lane;
    var d = wrapAngle(Math.atan2(ty - c.y, tx - c.x) - c.a);
    if (serverNow >= startAt + 1 && !c.finished) {
      l.stuck = Math.abs(c.fwd) < 25 ? l.stuck + dt : 0;
      if (l.stuck > 1.2) { l.rev = 0.7; l.stuck = 0; }
    }
    if (l.rev > 0) {
      l.rev -= dt;
      return { up: false, down: true, left: d > 0, right: d < 0 };
    }
    var sharp = Math.abs(d) > 0.7;
    return {
      up: c.fwd < C.MAX_SPEED * l.skill && !(sharp && c.fwd > 300),
      down: sharp && c.fwd > 380,
      left: d < -0.05, right: d > 0.05,
      nitro: c.charges > 0 && Math.abs(d) < 0.12 && c.fwd > 300 && Math.random() < dt * diff.aiNitro
    };
  }

  function preventDefault(e) { if (e.preventDefault) e.preventDefault(); }

  /** 키보드는 게임 화면에서만 받는다 */
  function bindKeyboard(isInGame) {
    window.addEventListener("keydown", function (e) {
      if (isInGame() && gameCodes[e.code] === true) {
        pressed[e.code] = true;
        preventDefault(e);
      }
    });
    window.addEventListener("keyup", function (e) { delete pressed[e.code]; });
    window.addEventListener("blur", function () { pressed = {}; });
  }

  function bindTouchButtons(container) {
    Array.prototype.forEach.call(container.querySelectorAll("button"), function (b) {
      var k = b.getAttribute("data-k");
      function set(on) {
        return function (e) {
          preventDefault(e);
          touch[k] = on;
          b.classList.toggle("on", on);
        };
      }
      b.addEventListener("pointerdown", set(true));
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (t) { b.addEventListener(t, set(false)); });
      b.addEventListener("contextmenu", preventDefault);
    });
  }

  TR.controls = {
    humanInput: humanInput, aiInput: aiInput, bindKeyboard: bindKeyboard, bindTouchButtons: bindTouchButtons
  };
})(window.TR = window.TR || {});
