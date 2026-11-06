// 트랙 만들기 (페이지 열 때 1번). 모든 기기에서 똑같이 나와야 한다.
(function (TR) {
  "use strict";
  var C = TR.config;

  // 1) 제어점을 지나는 닫힌 캣멀-롬 스플라인
  function catmullRom(ctrl, steps) {
    var out = [], n = ctrl.length, i, s, t, t2, t3, p0, p1, p2, p3;
    function axis(k) {
      return 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    }
    for (i = 0; i < n; i++) {
      p0 = ctrl[(i - 1 + n) % n];
      p1 = ctrl[i];
      p2 = ctrl[(i + 1) % n];
      p3 = ctrl[(i + 2) % n];
      for (s = 0; s < steps; s++) {
        t = s / steps;
        t2 = t * t;
        t3 = t2 * t;
        out.push([axis(0), axis(1)]);
      }
    }
    return out;
  }

  // 2) 같은 간격으로 다시 찍기
  function resample(raw, gap) {
    var out = [[raw[0][0], raw[0][1]]], need = gap, i, a, b, len, pos, t;
    for (i = 0; i < raw.length; i++) {
      a = raw[i];
      b = raw[(i + 1) % raw.length];
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      pos = 0;
      while (len - pos >= need) {
        pos += need;
        t = pos / len;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        need = gap;
      }
      need -= len - pos;
    }
    var last = out[out.length - 1];
    if (Math.hypot(last[0] - out[0][0], last[1] - out[0][1]) < gap / 2) out.pop();
    return out;
  }

  // 3) 점마다 진행 방향(tx,ty)과 왼쪽 법선(nx,ny)
  function withDirections(pts) {
    var m = pts.length, i, a, b, len, tx, ty, out = [];
    for (i = 0; i < m; i++) {
      a = pts[(i - 1 + m) % m];
      b = pts[(i + 1) % m];
      len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      tx = (b[0] - a[0]) / len;
      ty = (b[1] - a[1]) / len;
      out.push({ x: pts[i][0], y: pts[i][1], tx: tx, ty: ty, nx: -ty, ny: tx });
    }
    return out;
  }

  // 4) 나무: 고정 seed 난수라서 모든 기기에서 같은 자리
  function plantTrees(points) {
    var T = C.TREES, seed = T.seed, trees = [], k, j, x, y, best, q;
    function next() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (k = 0; k < T.tries && trees.length < T.max; k++) {
      x = T.x0 + next() * T.w;
      y = T.y0 + next() * T.h;
      best = 1e9;
      for (j = 0; j < points.length; j++) {
        q = points[j];
        best = Math.min(best, Math.pow(q.x - x, 2) + Math.pow(q.y - y, 2));
      }
      if (Math.sqrt(best) > T.clearance) trees.push({ x: x, y: y, r: T.r0 + next() * T.rw });
    }
    return trees;
  }

  function boundsOf(points) {
    var b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
    points.forEach(function (p) {
      b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y);
      b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y);
    });
    return b;
  }

  function roadPathOf(points) {
    var path = new Path2D();
    points.forEach(function (p, i) {
      if (i) path.lineTo(p.x, p.y); else path.moveTo(p.x, p.y);
    });
    path.closePath();
    return path;
  }

  function build() {
    var points = withDirections(resample(catmullRom(C.TRACK_POINTS, C.SPLINE_STEPS), C.SAMPLE));
    var n = points.length;
    var boxes = [];
    C.BOX_ROWS_AT.forEach(function (at) {
      var q = points[Math.round(n * at)];
      C.BOX_LATS.forEach(function (lat) {
        boxes.push({ x: q.x + q.nx * lat, y: q.y + q.ny * lat, back: 0 });   // back: 다시 나타나는 시각
      });
    });
    return {
      points: points,
      n: n,
      pads: C.PADS_AT.map(function (at) { return Math.round(n * at); }),
      boxes: boxes,
      trees: plantTrees(points),
      bounds: boundsOf(points),
      roadPath: roadPathOf(points)
    };
  }

  var track = build();

  // 출발 칸: 결승선 뒤로 2줄씩
  track.gridPos = function (slot) {
    var G = C.GRID, row = Math.floor(slot / 2), col = slot % 2;
    var back = Math.round((G.firstBack + row * G.rowGap) / C.SAMPLE);
    var i = track.n - back;
    var q = track.points[i], lat = col ? G.lat : -G.lat;
    return { x: q.x + q.nx * lat, y: q.y + q.ny * lat, a: Math.atan2(q.ty, q.tx), i: i, back: back };
  };

  // 앞뒤 C.NEAREST_SEARCH 칸 안에서 가장 가까운 트랙 점
  track.nearest = function (guess, x, y) {
    var best = guess, bestD = 1e18, k, i, d, n = track.n;
    for (k = -C.NEAREST_SEARCH; k <= C.NEAREST_SEARCH; k++) {
      i = (((guess + k) % n) + n) % n;
      d = Math.pow(track.points[i].x - x, 2) + Math.pow(track.points[i].y - y, 2);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  TR.track = track;
})(window.TR = window.TR || {});
