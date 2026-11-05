// 캔버스 그리기: 화면 나누기 -> 사람마다 시점(카메라, 트랙, 차, HUD) -> 분할선, 미니맵
(function (TR) {
  "use strict";
  var C = TR.config;
  var track = TR.track;
  var util = TR.util;

  var canvas = null, ctx = null;
  var W = 0, H = 0, dpr = 1;
  var viewRot = 0;   // 지금 그리는 시점의 회전 (글자는 이만큼 되돌려서 똑바로 그림)

  function init(cv) {
    canvas = cv;
    ctx = cv.getContext("2d");
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }

  function hasSize() { return !!canvas.width; }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dot(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }

  // 화면 분할: 1명 전체, 2명 좌우(세로 화면이면 위아래), 3~4명 2x2
  function layout(humans) {
    var n = humans.length;
    if (n <= 1) return [{ x: 0, y: 0, w: W, h: H, l: humans[0] }];
    if (n == 2) {
      if (W >= H) return [{ x: 0, y: 0, w: W / 2, h: H, l: humans[0] }, { x: W / 2, y: 0, w: W / 2, h: H, l: humans[1] }];
      return [{ x: 0, y: 0, w: W, h: H / 2, l: humans[0] }, { x: 0, y: H / 2, w: W, h: H / 2, l: humans[1] }];
    }
    return humans.map(function (l, i) {
      return { x: (i % 2) * (W / 2), y: Math.floor(i / 2) * (H / 2), w: W / 2, h: H / 2, l: l };
    });
  }

  // ------------------------------------------------------------ 월드 (카메라 좌표계 안에서)
  function moveCamera(vp, car, cam, dt, rotate) {
    var base = Math.max(0.36, Math.min(1.2, Math.min(vp.w, vp.h) / 720));
    var spd = Math.hypot(car.vx, car.vy);
    var tz = base * (1 - Math.min(0.22, spd / 3000)) * (car.boost > 0 ? 0.92 : 1);
    cam.z += (tz - cam.z) * (1 - Math.exp(-3 * dt));
    if (rotate) {
      cam.a += util.wrapAngle(car.a - cam.a) * (1 - Math.exp(-5 * dt));
      cam.x += (car.x + car.vx * 0.12 - cam.x) * (1 - Math.exp(-14 * dt));
      cam.y += (car.y + car.vy * 0.12 - cam.y) * (1 - Math.exp(-14 * dt));
      viewRot = -cam.a - Math.PI / 2;
      ctx.translate(vp.x + vp.w / 2, vp.y + vp.h * 0.64);
    } else {
      cam.x += (car.x + car.vx * 0.35 - cam.x) * (1 - Math.exp(-8 * dt));
      cam.y += (car.y + car.vy * 0.35 - cam.y) * (1 - Math.exp(-8 * dt));
      viewRot = 0;
      ctx.translate(vp.x + vp.w / 2, vp.y + vp.h / 2);
    }
    ctx.scale(cam.z, cam.z);
    ctx.rotate(viewRot);
    ctx.translate(-cam.x, -cam.y);
  }

  function drawTrees(vp, cam) {
    var range = Math.hypot(vp.w, vp.h) / cam.z + 60;
    track.trees.forEach(function (t) {
      if (Math.abs(t.x - cam.x) > range || Math.abs(t.y - cam.y) > range) return;
      dot(t.x + 6, t.y + 8, t.r, "#1d5c2c");
      dot(t.x, t.y, t.r, "#3a9a4a");
      dot(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.45, "#58b862");
    });
  }

  // 바깥부터: 벽 띠 -> 잔디 -> 연석 -> 아스팔트 -> 가운데 점선
  function drawRoad() {
    var path = track.roadPath, wall = C.WALL * 2, road = C.ROAD_HALF * 2;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.lineWidth = wall + 24; ctx.strokeStyle = "#d8dde6"; ctx.stroke(path);
    ctx.strokeStyle = "#ff5a5a"; ctx.setLineDash([40, 40]); ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineWidth = wall; ctx.strokeStyle = "#5cbf5f"; ctx.stroke(path);
    ctx.lineWidth = road + 16; ctx.strokeStyle = "#ffffff"; ctx.stroke(path);
    ctx.strokeStyle = "#e33"; ctx.setLineDash([24, 24]); ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineWidth = road; ctx.strokeStyle = "#4a4f5c"; ctx.stroke(path);
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.setLineDash([30, 40]); ctx.stroke(path);
    ctx.setLineDash([]);
  }

  function drawGridAndFinishLine() {
    var j, m, g, f = track.points[0], cell = C.ROAD_HALF * 2 / 10;
    for (j = 0; j < C.MAX_PLAYERS; j++) {
      g = track.gridPos(j);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
      ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 3;
      ctx.strokeRect(-26, -18, 52, 36);
      ctx.restore();
    }
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(Math.atan2(f.ty, f.tx));
    for (j = 0; j < 2; j++) {
      for (m = 0; m < 10; m++) {
        ctx.fillStyle = (j + m) % 2 ? "#111" : "#fff";
        ctx.fillRect(-cell + j * cell, -C.ROAD_HALF + m * cell, cell, cell);
      }
    }
    ctx.restore();
  }

  function drawPads(tnow) {
    var blink = (tnow / 300) % 1;
    track.pads.forEach(function (i) {
      var q = track.points[i], m, ox;
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.atan2(q.ty, q.tx));
      ctx.fillStyle = "#1f2a8a"; ctx.fillRect(-36, -42, 72, 84);
      for (m = 0; m < 3; m++) {
        ctx.fillStyle = (m / 3 + blink) % 1 < 0.5 ? "#ffd23d" : "#ff9f1a";
        ctx.beginPath();
        ox = -24 + m * 18;
        ctx.moveTo(ox, -28); ctx.lineTo(ox + 18, 0); ctx.lineTo(ox, 28); ctx.lineTo(ox + 8, 0);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawBoxes(tnow) {
    track.boxes.forEach(function (b) {
      if (b.back > tnow) return;
      ctx.save(); ctx.translate(b.x, b.y + Math.sin(tnow / 250 + b.x) * 3); ctx.rotate(tnow / 600);
      ctx.fillStyle = "rgba(0,0,0,.25)"; roundRect(-14, -10, 30, 30, 6); ctx.fill();
      ctx.fillStyle = "hsl(" + ((tnow / 8 + b.x) % 360) + ",90%,60%)"; roundRect(-16, -16, 32, 32, 7); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.rotate(-tnow / 600 - viewRot);
      ctx.fillStyle = "#fff"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", 0, 1);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    });
  }

  /** o = { x, y, a, color, name, mine, ghost, boost } */
  function drawCar(o, zoom) {
    var len;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.globalAlpha = o.ghost ? 0.35 : 1;
    ctx.save();
    ctx.rotate(o.a);
    if (o.boost) {
      len = 30 + Math.random() * 22;
      ctx.fillStyle = "rgba(255,120,30,.9)";
      ctx.beginPath(); ctx.moveTo(-22, -10); ctx.lineTo(-22 - len, 0); ctx.lineTo(-22, 10); ctx.fill();
      ctx.fillStyle = "rgba(255,240,120,.95)";
      ctx.beginPath(); ctx.moveTo(-22, -5); ctx.lineTo(-22 - len * 0.55, 0); ctx.lineTo(-22, 5); ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,.3)"; roundRect(-22, -11, 48, 28, 8); ctx.fill();
    ctx.fillStyle = "#111";
    [[-15, -15], [9, -15], [-15, 10], [9, 10]].forEach(function (w) { ctx.fillRect(w[0], w[1], 11, 5); });   // 바퀴
    ctx.fillStyle = o.color || "#ccc"; roundRect(-24, -12, 48, 24, 8); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "rgba(20,30,60,.85)"; roundRect(2, -9, 11, 18, 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(-18, -2, 16, 4);
    ctx.fillStyle = "#fff8b0"; ctx.fillRect(21, -10, 3, 5); ctx.fillRect(21, 5, 3, 5);
    ctx.restore();
    ctx.rotate(-viewRot);
    ctx.font = "bold " + (14 / Math.max(0.6, zoom)) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.7)";
    ctx.strokeText(o.name, 0, -30);
    ctx.fillStyle = o.mine ? "#ffd23d" : "#fff";
    ctx.fillText(o.name, 0, -30);
    ctx.restore();
  }

  // 이 시점의 주인 차를 맨 위에
  function drawCars(game, owner, zoom) {
    var st = game.state, single = game.humans().length == 1;
    Object.keys(st.remotes).forEach(function (id) {
      var r = st.remotes[id], p = game.pinfo(id);
      drawCar({ x: r.x, y: r.y, a: r.a, color: p.color, name: (p.ai ? "🤖" : "") + (p.name || ""), ghost: p.dnf }, zoom);
    });
    st.locals.forEach(function (o) {
      if (o == owner || !o.car) return;
      var p = game.pinfo(o.id);
      drawCar({ x: o.car.x, y: o.car.y, a: o.car.a, color: p.color, name: (o.ai ? "🤖" : "") + (p.name || ""),
                mine: !o.ai, boost: o.car.boost > 0 }, zoom);
    });
    var me = game.pinfo(owner.id), car = owner.car;
    drawCar({ x: car.x, y: car.y, a: car.a, color: me.color || st.myColor, name: single ? "나" : me.name || "",
              mine: true, boost: car.boost > 0 }, zoom);
  }

  // 차 위로 떠오르는 글자 (부스터 +1 등)
  function drawPops(car, zoom, tnow) {
    car.pops = car.pops.filter(function (p) { return tnow - p.t < 1100; });
    car.pops.forEach(function (p) {
      var age = (tnow - p.t) / 1100;
      ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(-viewRot);
      ctx.globalAlpha = 1 - age;
      ctx.font = "bold " + (20 / Math.max(0.6, zoom)) + "px sans-serif"; ctx.textAlign = "center";
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.strokeText(p.text, 0, -55 - age * 50);
      ctx.fillStyle = "#ffe14d"; ctx.fillText(p.text, 0, -55 - age * 50);
      ctx.restore();
    });
  }

  // ------------------------------------------------------------ 화면 좌표계
  function drawSpeedLines(vp, car) {
    var j, ang, r0, r1, cx = vp.x + vp.w / 2, cy = vp.y + vp.h / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255," + (0.25 * Math.min(1, car.boost * 2)) + ")";
    ctx.lineWidth = 2;
    for (j = 0; j < 26; j++) {
      ang = Math.random() * Math.PI * 2;
      r0 = Math.min(vp.w, vp.h) * (0.35 + Math.random() * 0.2);
      r1 = r0 + 40 + Math.random() * 80;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 아래쪽 계기판: 순위 / 바퀴 / 시간 / 속도 / 부스터
  function drawHud(game, vp, l, now) {
    var S = game.state.S, car = l.car, me = game.pinfo(l.id);
    var standings = game.standings();
    var pos = standings.findIndex(function (s) { return s.id == l.id; }) + 1;
    var tms = me.time_ms != null ? me.time_ms : Math.max(0, (now - S.start_at) * 1000);
    var multi = game.humans().length > 1;
    var scheme = C.KEY_SCHEMES[game.schemeOf(l)];
    var items = [
      ["순위", pos + "/" + standings.length],
      ["바퀴", Math.min(S.laps, car.lap + 1) + "/" + S.laps],
      ["시간", util.fmtTime(Math.floor(tms)).slice(0, -2)],
      ["km/h", String(Math.max(0, Math.round(car.fwd * 0.4)))],
      ["⚡ " + scheme.nlabel, null]          // null = 부스터 칸
    ];
    var bw = Math.min(78, (vp.w - 30) / 5), bh = 46, gap = 6;
    var total = items.length * bw + (items.length - 1) * gap;
    var touchUi = document.body.classList.contains("touch") && !multi;
    var x = vp.x + vp.w / 2 - total / 2;
    var y = touchUi ? vp.y + 12 : vp.y + vp.h - bh - 14;
    ctx.textAlign = "center";
    if (multi) {
      ctx.font = "bold 14px sans-serif";
      var label = me.name + " · " + scheme.label;
      var tw = ctx.measureText(label).width + 20;
      ctx.fillStyle = "rgba(0,0,0,.6)"; roundRect(vp.x + vp.w / 2 - tw / 2, y - 26, tw, 22, 8); ctx.fill();
      ctx.fillStyle = me.color || "#fff"; ctx.fillText(label, vp.x + vp.w / 2, y - 10);
    }
    items.forEach(function (it) {
      var k = it[0], v = it[1], m, sw, sx;
      ctx.fillStyle = v === null && car.charges > 0 ? "rgba(30,60,140,.8)" : "rgba(0,0,0,.6)";
      roundRect(x, y, bw, bh, 10); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "11px sans-serif"; ctx.fillText(k, x + bw / 2, y + 15);
      if (v === null) {
        // 충전된 칸 + 다음 칸 게이지
        sw = (bw - 16) / C.MAX_CHARGES;
        for (m = 0; m < C.MAX_CHARGES; m++) {
          sx = x + 8 + m * sw;
          ctx.fillStyle = "rgba(255,255,255,.15)"; ctx.fillRect(sx + 1, y + 22, sw - 2, 16);
          if (m < car.charges) {
            ctx.fillStyle = "#ffd23d"; ctx.fillRect(sx + 1, y + 22, sw - 2, 16);
          } else if (m == car.charges) {
            ctx.fillStyle = "rgba(255,210,61,.5)"; ctx.fillRect(sx + 1, y + 22 + 16 * (1 - car.gauge), sw - 2, 16 * car.gauge);
          }
        }
      } else {
        ctx.fillStyle = k == "순위" ? "#ffd23d" : "#fff"; ctx.font = "bold 17px sans-serif"; ctx.fillText(v, x + bw / 2, y + 37);
      }
      x += bw + gap;
    });
  }

  // 시점 가운데 큰 글자: "1등!", "마지막 바퀴!", "N초 안에 골인!"
  function drawCenterMessage(game, vp, l, now) {
    var S = game.state.S, car = l.car, me = game.pinfo(l.id), n = TR.track.n;
    var cx = vp.x + vp.w / 2, cy = vp.y + vp.h * 0.4;
    var big = Math.max(40, Math.min(90, vp.w / 7));
    var main = "", sub = "", rank, remain;
    if (car.finished) {
      rank = car.rank || me.rank;
      main = rank ? rank + "등!" : "골인!";
      remain = S.first_finish_at ? Math.max(0, Math.ceil(S.first_finish_at + S.grace - now)) : 0;
      sub = "다른 플레이어를 기다리는 중… " + (remain ? remain + "초" : "");
      if (car.err) { main = ""; sub = car.err; }
    } else if (now > S.start_at + 1) {
      if (car.lap == S.laps - 1 && car.dist % n < n * 0.04 && car.dist > n) sub = "마지막 바퀴!";
      else if (S.first_finish_at) sub = Math.max(0, Math.ceil(S.first_finish_at + S.grace - now)) + "초 안에 골인!";
    }
    if (main) {
      ctx.font = "italic 900 " + big + "px sans-serif";
      ctx.lineWidth = 8; ctx.strokeStyle = "#ff4d4d"; ctx.strokeText(main, cx + 3, cy + 3);
      ctx.fillStyle = "#fff"; ctx.fillText(main, cx, cy);
    }
    if (sub) {
      ctx.font = "bold " + (main ? 20 : 30) + "px sans-serif";
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.strokeText(sub, cx, cy + (main ? 40 : 0));
      ctx.fillStyle = "#fff"; ctx.fillText(sub, cx, cy + (main ? 40 : 0));
    }
  }

  function drawMinimap(game, x, y, w, h) {
    var st = game.state, b = track.bounds;
    var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    var s = Math.min(w / bw, h / bh);
    var ox = x + (w - bw * s) / 2, oy = y + (h - bh * s) / 2;
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(ox - 10, oy - 10, bw * s + 20, bh * s + 20);
    ctx.save();
    ctx.translate(ox - b.x0 * s, oy - b.y0 * s);
    ctx.scale(s, s);
    ctx.lineWidth = Math.max(6, 120 * s) / s; ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineJoin = "round"; ctx.stroke(track.roadPath);
    var r0 = Math.max(4, 40 * s) / s;
    dot(track.points[0].x, track.points[0].y, r0, "#000");      // 출발선
    Object.keys(st.remotes).forEach(function (id) {
      dot(st.remotes[id].x, st.remotes[id].y, r0, game.pinfo(id).color || "#ccc");
    });
    st.locals.forEach(function (l) {
      if (!l.car) return;
      if (!l.ai) dot(l.car.x, l.car.y, r0 * 1.6, "#fff");     // 사람 차는 흰 테두리
      dot(l.car.x, l.car.y, r0 * 1.1, game.pinfo(l.id).color || "#ccc");
    });
    ctx.restore();
  }

  function drawSplitLinesAndMinimap(game, n) {
    var b = track.bounds, size, mh;
    ctx.fillStyle = "#111";
    if (n == 2) {
      if (W >= H) ctx.fillRect(W / 2 - 2, 0, 4, H);
      else ctx.fillRect(0, H / 2 - 2, W, 4);
    }
    if (n >= 3) { ctx.fillRect(W / 2 - 2, 0, 4, H); ctx.fillRect(0, H / 2 - 2, W, 4); }
    if (n == 3) {   // 3명이면 빈 4번째 칸이 미니맵
      ctx.fillStyle = "#16233f"; ctx.fillRect(W / 2 + 2, H / 2 + 2, W / 2 - 2, H / 2 - 2);
      drawMinimap(game, W / 2 + 20, H / 2 + 20, W / 2 - 40, H / 2 - 40);
      return;
    }
    size = n == 1 ? Math.min(170, W * 0.32) : Math.min(150, W * 0.22);
    mh = size * (b.y1 - b.y0) / (b.x1 - b.x0);
    if (n == 1) drawMinimap(game, W - size - 16, 16, size, mh);
    else if (n == 2 && W >= H) drawMinimap(game, W / 2 - size / 2, 16, size, mh);
    else drawMinimap(game, W / 2 - size / 2, H / 2 - mh / 2, size, mh);
  }

  function drawView(game, vp, dt) {
    var l = vp.l, car = l.car, cam = l.cam, tnow = performance.now();
    ctx.save();
    ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();
    ctx.fillStyle = "#2c7a3f";
    ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    moveCamera(vp, car, cam, dt, game.state.opts.rotate);
    drawTrees(vp, cam);
    drawRoad();
    drawGridAndFinishLine();
    drawPads(tnow);
    drawBoxes(tnow);
    drawCars(game, l, cam.z);
    drawPops(car, cam.z, tnow);
    ctx.restore();

    if (car.boost > 0) drawSpeedLines(vp, car);
    var now = TR.net.serverNow();
    drawHud(game, vp, l, now);
    drawCenterMessage(game, vp, l, now);
  }

  function draw(game, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var views = layout(game.humans());
    views.forEach(function (vp) { drawView(game, vp, dt); });
    drawSplitLinesAndMinimap(game, views.length);
  }

  TR.render = { init: init, resize: resize, hasSize: hasSize, draw: draw };
})(window.TR = window.TR || {});
