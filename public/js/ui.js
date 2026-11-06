// HTML 화면: 참가 / 대기실 / 결과 / 명예의 전당 / 게임 위 순위표·카운트다운
// 사용자 값은 innerHTML 에 넣기 전에 반드시 escHtml (또는 textContent)
(function (TR) {
  "use strict";
  var C = TR.config, util = TR.util, esc = util.escHtml, $ = util.$;

  function game() { return TR.game; }

  function showScreen(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".screen"), function (el) {
      el.classList.toggle("active", el.id == name);
    });
  }

  function onClick(id, fn) { $(id).addEventListener("click", fn); }

  function onEnter(id, fn) {
    $(id).addEventListener("keydown", function (e) {
      if (e.key == "Enter" && !e.isComposing) fn();
    });
  }

  // ------------------------------------------------------------ 참가 화면
  function renderColors() {
    var box = $("colorPick"), st = game().state;
    box.innerHTML = C.COLORS.map(function (c) {
      return '<button class="' + (c == st.myColor ? "sel" : "") + '" style="background:' + c + '" title="' + c + '" data-color="' + c + '"></button>';
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        st.myColor = b.getAttribute("data-color");
        util.storageSet("localStorage", "tr_color", st.myColor);
        renderColors();
      });
    });
  }

  function setJoinError(msg) { $("joinErr").textContent = msg; }

  function join() {
    var name = $("nameInput").value.trim();
    if (!name) { setJoinError("닉네임을 입력해 주세요"); return; }
    util.storageSet("localStorage", "tr_name", name);
    setJoinError("");
    $("joinBtn").disabled = true;
    game().addLocal({ name: name, color: game().state.myColor },
      function (e) { setJoinError(e.message); },
      function () { $("joinBtn").disabled = false; });
  }

  // ------------------------------------------------------------ 대기실
  function renderLobby() {
    var g = game(), S = g.state.S, humans = g.humans();
    var players = S.players.slice().sort(function (a, b) { return a.slot - b.slot; });
    var removable = [];
    $("lobbyList").innerHTML = players.map(function (p) {
      var l = g.localOf(p.id), humanIdx = l ? humans.indexOf(l) : -1, tag, html;
      if (p.ai) tag = "🤖 컴퓨터";
      else if (l) tag = humans.length > 1 ? "⌨ " + C.KEY_SCHEMES[g.schemeOf(l)].label : "";
      else tag = "📶 다른 기기";
      html = '<li><span class="dot" style="background:' + esc(p.color) + '"></span>' +
             '<span>' + esc(p.name) + '</span><span class="tag">' + esc(tag) + '</span>';
      if (l && !l.ai && humanIdx == 0) html += '<span class="me">나</span>';
      if (l && (l.ai || humanIdx > 0)) {     // 내가 추가한 사람/컴퓨터만 뺄 수 있음 (나 자신은 '나가기')
        html += '<button class="x" title="빼기" data-rm="' + removable.length + '">✕</button>';
        removable.push(l);
      }
      return html + "</li>";
    }).join("");
    Array.prototype.forEach.call($("lobbyList").querySelectorAll("button[data-rm]"), function (b) {
      b.addEventListener("click", function () { g.removeLocal(removable[+b.getAttribute("data-rm")]); });
    });
    $("lobbyCount").textContent = players.length;
    $("addLocalBtn").disabled = humans.length >= C.MAX_LOCAL_HUMANS || players.length >= C.MAX_PLAYERS;
    $("addBotBtn").disabled = players.length >= C.MAX_PLAYERS;
    $("lobbyHint").textContent = humans.length > 1
      ? "한 PC 화면 분할 · 키보드를 나눠 써요 (키 배정은 목록 오른쪽)"
      : "혼자서도 OK! 방향키/WASD · 휴대폰은 화면 버튼 · 컴퓨터를 추가해 보세요";
    renderOptions();
  }

  function markSelected(segId, value) {
    Array.prototype.forEach.call($(segId).querySelectorAll("button"), function (b) {
      b.classList.toggle("sel", b.getAttribute("data-v") == String(value));
    });
  }

  function renderOptions() {
    var st = game().state, settings = (st.S && st.S.settings) || { laps: 3, difficulty: "easy" };
    markSelected("optDiff", settings.difficulty);
    markSelected("optLaps", settings.laps);
    markSelected("optCam", st.opts.rotate ? "rotate" : "fixed");
    markSelected("optAuto", st.opts.autoGas ? "on" : "off");
    $("lobbyLaps").textContent = settings.laps;
  }

  function onSegment(segId, fn) {
    Array.prototype.forEach.call($(segId).querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () { fn(b.getAttribute("data-v")); });
    });
  }

  function addBot() {
    var names = {}, k = 1;
    game().state.S.players.forEach(function (p) { names[p.name] = true; });
    while (names["컴퓨터" + k] === true) k++;
    game().addLocal({ name: "컴퓨터" + k, ai: true }, function (e) { alert(e.message); });
  }

  function addLocalHuman() {
    var name = $("localName").value.trim() || "플레이어" + (game().humans().length + 1);
    $("addLocalForm").classList.remove("open");
    game().addLocal({ name: name }, function (e) { alert(e.message); });
  }

  // ------------------------------------------------------------ 결과
  function displayName(r) { return (r.ai ? "🤖 " : "") + r.name; }

  function renderResults() {
    var rs = game().state.S.results || [];
    $("podium").innerHTML = [2, 1, 3].map(function (rank) {     // 가운데가 1등
      var r = rs.filter(function (x) { return x.rank === rank; })[0];
      if (!r) return '<div class="pod"></div>';
      return '<div class="pod p' + rank + '"><div class="name">' + esc(displayName(r)) + '</div>' +
             '<div class="car" style="background:' + esc(r.color) + '"></div>' +
             '<div class="block">' + rank + '<div class="t">' + esc(util.fmtTime(r.time_ms)) + '</div></div></div>';
    }).join("");
    $("resultRows").innerHTML = rs.map(function (r) {
      return '<tr><td>' + esc(r.finished ? r.rank + "등" : "리타이어") + '</td>' +
             '<td><span class="sw" style="background:' + esc(r.color) + '"></span>' + esc(displayName(r)) + '</td>' +
             '<td>' + esc(util.fmtTime(r.time_ms)) + '</td></tr>';
    }).join("");
  }

  // ------------------------------------------------------------ 명예의 전당
  function openBoard() {
    $("board").classList.add("active");
    TR.net.get("/api/leaderboard", function (d) {
      $("boardTotal").textContent = "지금까지 " + d.total_races + "번의 레이스 (컴퓨터 기록은 제외)";
      $("bestRows").innerHTML = d.best.length ? d.best.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td>' +
               '<td><span class="sw" style="background:' + esc(r.color) + '"></span>' + esc(r.player_name) + '</td>' +
               '<td>' + esc(util.fmtTime(r.time_ms)) + '</td></tr>';
      }).join("") : '<tr><td colspan="3">아직 기록이 없어요</td></tr>';
      $("winRows").innerHTML = d.wins.map(function (r) {
        return '<tr><td>' + esc(r.player_name) + '</td><td>' + esc(r.gold) + '</td>' +
               '<td>' + esc(r.silver) + '</td><td>' + esc(r.bronze) + '</td><td>' + esc(r.races) + '</td></tr>';
      }).join("");
    }, function () { /* 실패하면 그냥 둔다 (예전과 같음) */ });
  }

  // ------------------------------------------------------------ 게임 화면 위 HTML
  function setIfChanged(el, attr, value, apply) {
    if (el.getAttribute(attr) === value) return;
    el.setAttribute(attr, value);
    apply();
  }

  function updateRaceOverlay() {
    var g = game(), standings = g.standings(), lr = $("liveRank");
    var sig = standings.map(function (s) { return s.id + s.rank + s.dnf; }).join(",");
    setIfChanged(lr, "data-sig", sig, function () {
      lr.innerHTML = standings.map(function (p) {
        var text = (p.ai ? "🤖" : "") + p.name + (p.rank ? " 🏁" : p.dnf ? " (나감)" : "");
        if (g.localOf(p.id) && !p.ai) return '<li class="me">' + esc(text) + '</li>';
        return '<li class="" style="color:' + esc(p.color) + '">' + esc(text) + '</li>';
      }).join("");
    });
    var left = g.state.S.start_at - TR.net.serverNow(), text = "";
    if (left > 3) text = "준비!";
    else if (left > 0) text = String(Math.ceil(left));
    else if (left > -1) text = "GO!";
    var center = $("center");
    setIfChanged(center, "data-h", text, function () { center.textContent = text; });
  }

  // ------------------------------------------------------------ 연결
  function bind() {
    var g = game();
    $("nameInput").value = util.storageGet("localStorage", "tr_name") || "";
    renderColors();
    onClick("joinBtn", join);
    onEnter("nameInput", function () { $("joinBtn").click(); });

    onSegment("optDiff", function (v) { g.roomAction("/api/settings", { difficulty: v }); });
    onSegment("optLaps", function (v) { g.roomAction("/api/settings", { laps: +v }); });
    onSegment("optCam", function (v) { g.state.opts.rotate = v == "rotate"; g.saveOpts(); renderOptions(); });
    onSegment("optAuto", function (v) { g.state.opts.autoGas = v == "on"; g.saveOpts(); renderOptions(); });

    onClick("addLocalBtn", function () {
      $("addLocalForm").classList.toggle("open");
      $("localName").value = "";
      $("localName").focus();
    });
    onClick("localOk", addLocalHuman);
    onEnter("localName", function () { $("localOk").click(); });
    onClick("addBotBtn", addBot);
    onClick("startBtn", function () { g.roomAction("/api/start"); });
    onClick("againBtn", function () { g.roomAction("/api/reset"); });
    onClick("leaveBtn", function () { g.leaveAll(); });

    Array.prototype.forEach.call(document.querySelectorAll("[data-show-board]"), function (b) {
      b.addEventListener("click", openBoard);
    });
    onClick("boardClose", function () { $("board").classList.remove("active"); });
  }

  TR.ui = {
    bind: bind, showScreen: showScreen, setJoinError: setJoinError, renderLobby: renderLobby,
    renderResults: renderResults, openBoard: openBoard, updateRaceOverlay: updateRaceOverlay
  };
})(window.TR = window.TR || {});
