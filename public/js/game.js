// 게임 상태, 서버 상태 반영, 메인 루프, 시작 (마지막에 불러온다)
//
// 이 브라우저는 차를 여러 대 맡을 수 있다 (state.locals):
//   사람 최대 4명(키보드를 나눠 쓰고 화면 분할) + 컴퓨터.
// 물리는 여기서 계산하고 서버에는 위치만 보낸다. 등수와 기록은 서버가 정한다.
(function (TR) {
  "use strict";
  var C = TR.config, util = TR.util, net = TR.net, track = TR.track;
  var physics = TR.physics, controls = TR.controls, render = TR.render, ui = TR.ui;

  var state = {
    S: null,            // 마지막으로 받은 서버 상태
    screen: "join",     // join | lobby | game | results
    locals: [],         // 이 브라우저가 맡은 차들 {id, ai, skill, lane, car, cam, stuck, rev}
    remotes: {},        // 다른 기기 차들 (받은 위치로 보간) {x, y, a, tx, ty, ta, tv, t}
    myColor: null,
    opts: { rotate: true, autoGas: false },   // 이 기기만의 옵션
    busy: false,        // 위치 보내기 요청이 아직 안 끝남
    lastPoll: 0,
    lastT: 0,
    frameDt: 1 / 60
  };

  // ------------------------------------------------------------ 조회
  function newLocal(o) {
    return { id: o.id, ai: !!o.ai, skill: 0.8 + Math.random() * 0.13, lane: (Math.random() - 0.5) * 70,
             car: null, cam: { x: 0, y: 0, z: 1 }, stuck: 0, rev: 0 };
  }

  function difficulty() {
    var name = (state.S && state.S.settings && state.S.settings.difficulty) || C.DEFAULT_DIFFICULTY;
    return C.DIFFICULTY[name] || C.DIFFICULTY[C.DEFAULT_DIFFICULTY];
  }

  function humans() { return state.locals.filter(function (l) { return !l.ai; }); }

  function localOf(id) {
    for (var i = 0; i < state.locals.length; i++) if (state.locals[i].id == id) return state.locals[i];
    return undefined;
  }

  /** 서버가 아는 플레이어 정보 (없으면 {}) */
  function pinfo(id) {
    var players = (state.S && state.S.players) || [];
    for (var i = 0; i < players.length; i++) if (players[i].id == id) return players[i];
    return {};
  }

  /** 혼자면 키 전부, 화면 분할이면 사람 순서대로 wasd / arrows / ijkl / numpad */
  function schemeOf(l) {
    var hs = humans();
    if (hs.length <= 1) return "all";
    return C.SPLIT_ORDER[hs.indexOf(l)] || "wasd";
  }

  /** 순위: 들어온 사람은 등수순, 나머지는 많이 간 순. 내 차는 서버 값 대신 지금 위치 */
  function standings() {
    return state.S.players.map(function (p) {
      var l = localOf(p.id);
      return { id: p.id, name: p.name, color: p.color, rank: p.rank, dnf: p.dnf, ai: p.ai,
               prog: l && l.car ? l.car.dist / track.n : p.progress };
    }).sort(function (a, b) {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank) return -1;
      if (b.rank) return 1;
      return b.prog - a.prog;
    });
  }

  function saveLocals() {
    util.storageSet("sessionStorage", "tr_locals",
      JSON.stringify(state.locals.map(function (l) { return { id: l.id, ai: l.ai }; })));
  }

  function saveOpts() { util.storageSet("localStorage", "tr_opts", JSON.stringify(state.opts)); }

  function setScreen(name) {
    state.screen = name;
    ui.showScreen(name);
    if (name == "game") render.resize();
  }

  // ------------------------------------------------------------ 서버 상태 반영
  function updateRemotes(s, ids) {
    s.players.forEach(function (p) {
      if (localOf(p.id)) return;
      var grid = track.gridPos(p.slot);
      var started = p.progress > -1 || p.x !== 0;     // 아직 안 움직였으면 출발 칸에
      var tx = started ? p.x : grid.x, ty = started ? p.y : grid.y, ta = started ? p.a : grid.a;
      var r = state.remotes[p.id] || (state.remotes[p.id] = { x: tx, y: ty, a: ta });
      r.tx = tx; r.ty = ty; r.ta = ta; r.tv = p.v;
      r.t = performance.now();
    });
    Object.keys(state.remotes).forEach(function (id) {
      if (ids[id] !== true || localOf(id)) delete state.remotes[id];
    });
  }

  function onState(s) {
    state.S = s;
    if (state.screen == "join") return;
    var ids = {};
    s.players.forEach(function (p) { ids[p.id] = true; });

    // 서버에서 빠진 내 차는 지운다
    var before = state.locals.length;
    state.locals = state.locals.filter(function (l) { return ids[l.id] === true; });
    if (state.locals.length != before) saveLocals();

    if (!humans().length) {
      // 사람이 다 빠졌으면 컴퓨터도 다 빼고 처음 화면으로
      state.locals.forEach(function (l) { net.post("/api/leave", { id: l.id }); });
      state.locals = [];
      saveLocals();
      setScreen("join");
      ui.setJoinError("연결이 끊겨 대기실에서 나왔어요. 다시 참가해 주세요.");
      return;
    }
    updateRemotes(s, ids);

    if (s.phase == "lobby") {
      if (state.screen != "lobby") setScreen("lobby");
      ui.renderLobby();
    } else if (s.phase == "racing") {
      if (state.screen != "game") startRace();
    } else if (s.phase == "finished") {
      if (state.screen != "results") { setScreen("results"); ui.renderResults(); }
    }
  }

  // ------------------------------------------------------------ 참가 / 나가기 / 방 조작
  /** 사람이든 컴퓨터든 차 한 대 추가 */
  function addLocal(body, onErr, onFinally) {
    net.post("/api/join", body, function (res) {
      try {
        if (!localOf(res.me)) state.locals.push(newLocal({ id: res.me, ai: body.ai }));
        saveLocals();
        if (state.screen == "join") setScreen("lobby");
        onState(res);
      } catch (e) {
        onErr(e);
      }
      if (onFinally) onFinally();
    }, function (e) {
      onErr(e);
      if (onFinally) onFinally();
    });
  }

  function removeLocal(l) {
    function after() {     // 실패해도 그냥 뺀다
      state.locals = state.locals.filter(function (x) { return x !== l; });
      saveLocals();
      if (state.S) {
        state.S.players = state.S.players.filter(function (p) { return p.id !== l.id; });
        ui.renderLobby();
      }
    }
    net.post("/api/leave", { id: l.id }, after, after);
  }

  function leaveAll() {
    var todo = state.locals, done = 0;
    function finish() {
      state.locals = [];
      saveLocals();
      setScreen("join");
    }
    if (!todo.length) { finish(); return; }
    todo.forEach(function (l) {
      net.post("/api/leave", { id: l.id }, step, step);
    });
    function step() { if (++done == todo.length) finish(); }
  }

  /** 시작 / 다시 하기 / 설정: 첫 번째 사람 이름으로 보낸다 */
  function roomAction(url, extra) {
    var first = humans()[0];
    if (!first) { alert("참가한 사람이 없어요"); return; }
    var body = { id: first.id };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    net.post(url, body, function (s) {
      try { onState(s); } catch (e) { alert(e.message); }
    }, function (e) { alert(e.message); });
  }

  // ------------------------------------------------------------ 레이스
  function startRace() {
    var D = difficulty();
    state.locals.forEach(function (l) {
      var g = track.gridPos(pinfo(l.id).slot || 0);
      l.car = physics.newCar(g, D);
      l.cam = { x: g.x, y: g.y, z: 1, a: g.a };
      l.stuck = 0;
      l.rev = 0;
      l.skill = D.ai[0] + Math.random() * (D.ai[1] - D.ai[0]);
    });
    track.boxes.forEach(function (b) { b.back = 0; });
    setScreen("game");
  }

  /** 부딪힐 수 있는 다른 차: 다른 기기 차 + 내가 맡은 다른 차 */
  function othersOf(l) {
    var list = Object.keys(state.remotes).map(function (id) { return state.remotes[id]; });
    state.locals.forEach(function (o) { if (o !== l && o.car) list.push(o.car); });
    return list;
  }

  function stepLocal(l, inp, dt) {
    var justFinished = physics.step(l.car, inp, dt, {
      track: track, diff: difficulty(), started: net.serverNow() >= state.S.start_at,
      laps: state.S.laps, others: othersOf(l), nowMs: performance.now()
    });
    if (justFinished) sendFinish(l);
  }

  // 결승선 통과 -> 서버가 등수를 정한다
  function sendFinish(l) {
    var car = l.car;
    net.post("/api/finish", { id: l.id, lap: state.S.laps, progress: car.dist / track.n }, function (res) {
      try {
        var me = res.players.filter(function (p) { return p.id == l.id; })[0];
        if (me) car.rank = me.rank;
        onState(res);
      } catch (e) {
        car.err = e.message;
      }
    }, function (e) { car.err = e.message; });
  }

  // 레이스 중 60ms, 아니면 500ms 마다 위치 보내고 상태 받기
  function netTick() {
    if (state.busy || state.screen == "join" || !state.locals.length) return;
    var now = new Date().getTime();
    var racing = state.screen == "game" && state.S && state.S.phase == "racing";
    if (now - state.lastPoll < (racing ? C.POLL_RACING_MS : C.POLL_IDLE_MS)) return;
    state.lastPoll = now;
    state.busy = true;
    try {
      var cars = !racing ? [] : state.locals.filter(function (l) { return l.car && !l.car.finished; }).map(function (l) {
        var c = l.car;
        return { id: l.id, x: +c.x.toFixed(1), y: +c.y.toFixed(1), a: +c.a.toFixed(3),
                 v: +c.fwd.toFixed(1), progress: +(c.dist / track.n).toFixed(4), lap: c.lap };
      });
      var ids = state.locals.map(function (l) { return l.id; });
      net.post("/api/update", { ids: ids, cars: cars }, function (res) {
        try { onState(res); } catch (e) { console.warn(e); }
        state.busy = false;
      }, function (e) {
        console.warn(e);
        state.busy = false;
      });
    } catch (e) {
      console.warn(e);
      state.busy = false;
    }
  }

  // ------------------------------------------------------------ 메인 루프
  // 입력 -> 부스터/게이지 -> 물리(1/120초 단위) -> 다른 기기 차 보간 -> 그리기
  function readInputs(dt) {
    var D = difficulty(), first = humans()[0];
    return state.locals.map(function (l) {
      if (l.ai) return controls.aiInput(l, track, dt, net.serverNow(), state.S.start_at, D);
      return controls.humanInput(schemeOf(l), first == l, state.opts.autoGas);
    });
  }

  function interpolateRemotes(dt) {
    var now = performance.now(), k = Math.min(1, dt * 12);
    Object.keys(state.remotes).forEach(function (id) {
      var r = state.remotes[id], age, ex, ey;
      if (r.tx === undefined) return;
      age = Math.min(0.25, (now - r.t) / 1000);       // 받은 뒤 지난 시간만큼 앞으로 예측
      ex = r.tx + Math.cos(r.ta) * (r.tv || 0) * age;
      ey = r.ty + Math.sin(r.ta) * (r.tv || 0) * age;
      if (Math.hypot(ex - r.x, ey - r.y) > 300) { r.x = ex; r.y = ey; r.a = r.ta; }   // 너무 멀면 순간이동
      r.x += (ex - r.x) * k;
      r.y += (ey - r.y) * k;
      r.a += util.wrapAngle(r.ta - r.a) * k;
    });
  }

  function isRacingHere() {
    return state.screen == "game" && state.S && state.S.phase == "racing" && humans().length > 0 &&
      state.locals.every(function (l) { return !!l.car; });
  }

  function mainLoop(t) {
    var dt = Math.min(C.MAX_FRAME_SEC, (t - state.lastT) / 1000);
    state.lastT = t;
    state.frameDt = dt;

    if (isRacingHere()) {
      var inputs = readInputs(dt);
      var D = difficulty();
      state.locals.forEach(function (l, i) {
        var racing = net.serverNow() >= state.S.start_at && !l.car.finished;
        physics.updateCharges(l.car, inputs[i].nitro, racing, dt, D, performance.now());
      });
      var steps = Math.max(1, Math.ceil(dt * C.PHYSICS_HZ));
      for (var s = 0; s < steps; s++) {
        state.locals.forEach(function (l, i) { stepLocal(l, inputs[i], dt / steps); });
      }
      interpolateRemotes(dt);
      if (!render.hasSize()) render.resize();
      render.draw(TR.game, dt);
      ui.updateRaceOverlay();
    }
    requestAnimationFrame(mainLoop);
  }

  // ------------------------------------------------------------ 시작
  // 새로고침이면 저장해 둔 차들로 한 대씩 다시 참가
  function reconnect() {
    var list = state.locals, kept = [], last = null, idx = 0;
    if (!list.length) return;
    (function next() {
      if (idx >= list.length) {
        state.locals = kept;
        saveLocals();
        if (last && humans().length) { setScreen("lobby"); onState(last); }
        return;
      }
      var l = list[idx++];
      net.post("/api/join", { id: l.id }, function (res) {
        last = res;
        kept.push(l);
        next();
      }, next);
    })();
  }

  function boot() {
    var saved = util.storageGetJson("localStorage", "tr_opts", {});
    state.opts.rotate = saved.rotate !== false;
    state.opts.autoGas = !!saved.autoGas;
    try {
      var locals = util.storageGetJson("sessionStorage", "tr_locals", []);
      state.locals = Array.isArray(locals) ? locals.map(newLocal) : [];
    } catch (e) {
      state.locals = [];    // 저장된 값이 깨졌으면 새로 시작
    }
    state.myColor = util.storageGet("localStorage", "tr_color") || C.COLORS[Math.floor(Math.random() * C.COLORS.length)];

    setInterval(netTick, C.NET_CHECK_MS);
    ui.bind();
    render.init(util.$("cv"));
    window.addEventListener("resize", render.resize);
    state.lastT = performance.now();
    requestAnimationFrame(mainLoop);

    controls.bindKeyboard(function () { return state.screen == "game"; });
    if ((window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window) {
      document.body.classList.add("touch");
    }
    controls.bindTouchButtons(util.$("touch"));
    reconnect();
  }

  TR.game = {
    state: state, newLocal: newLocal, humans: humans, localOf: localOf, pinfo: pinfo, schemeOf: schemeOf,
    standings: standings, saveOpts: saveOpts, onState: onState, addLocal: addLocal, removeLocal: removeLocal,
    leaveAll: leaveAll, roomAction: roomAction, stepLocal: stepLocal, netTick: netTick, mainLoop: mainLoop
  };
  boot();
})(window.TR = window.TR || {});
