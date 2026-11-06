// 차 한 대 물리 한 단계 (보통 1/120초).
//
// 계산 순서와 식은 리팩토링 전과 똑같이 맞춰 두었다 (tests/client/golden.json 이 확인).
// 순서를 바꾸면 소수점 끝자리가 달라져서 golden 테스트가 깨질 수 있다.
(function (TR) {
  "use strict";
  var C = TR.config;
  var wrapAngle = TR.util.wrapAngle;

  /** 레이스 시작할 때 차 상태 */
  function newCar(grid, diff) {
    return {
      x: grid.x, y: grid.y, a: grid.a, vx: 0, vy: 0, fwd: 0,
      idx: grid.i, dist: -grid.back, lap: 0, lat: 0, steer: 0,
      boost: 0, boostMax: 1, grass: false,
      finished: false, rank: null, err: null,
      charges: diff.start, gauge: 0, nitroHeld: false,
      pops: []          // 차 위에 잠깐 떠오르는 글자
    };
  }

  function pop(car, text, nowMs) { car.pops.push({ text: text, t: nowMs }); }

  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : v; }

  // 속도: 가속/브레이크/관성, 부스터, 최고속도
  function updateSpeed(car, inp, dt, w, ctl, fwd) {
    var D = w.diff, boosting = car.boost > 0;
    car.boost = Math.max(0, car.boost - dt);
    var maxv = boosting ? C.MAX_SPEED * C.BOOST_SPEED : car.grass ? C.MAX_SPEED * D.grass : C.MAX_SPEED;
    if (ctl && inp.up) fwd += (boosting ? C.ACCEL * C.BOOST_ACCEL : C.ACCEL) * dt;
    else if (ctl && inp.down) fwd -= (fwd > 0 ? C.BRAKE : C.ACCEL * C.REVERSE_ACCEL_RATIO) * dt;
    else fwd -= fwd * Math.min(1, C.COAST_DRAG * dt);
    if (boosting && ctl) fwd = Math.max(fwd, C.MAX_SPEED * C.BOOST_MIN_SPEED);
    if (fwd > maxv) fwd -= (fwd - maxv) * Math.min(1, C.OVERSPEED_DRAG * dt);
    if (fwd < -C.REVERSE_MAX) fwd = -C.REVERSE_MAX;
    return fwd;
  }

  // 핸들: 부드럽게 꺾이고, 빠를수록 살짝 덜 꺾임 + (쉬운 난이도) 길 가장자리에서 자동 보정
  function updateHeading(car, inp, dt, w, ctl, fwd) {
    var D = w.diff;
    var want = ctl ? (inp.right ? 1 : 0) - (inp.left ? 1 : 0) : 0;
    car.steer += (want - car.steer) * Math.min(1, dt * C.STEER_RESPONSE);
    var k = Math.max(-1, Math.min(1, fwd / C.STEER_FULL_SPEED)) * (1 - C.STEER_HIGH_SPEED_CUT * Math.min(1, Math.abs(fwd) / C.MAX_SPEED));
    car.a += car.steer * D.turn * dt * k;

    if (ctl && D.assist && want == 0 && fwd > 60) {
      var q = w.track.points[car.idx];
      var along = Math.atan2(q.ty, q.tx);
      var edge = Math.max(0, Math.min(1, (Math.abs(car.lat) - C.ROAD_HALF * 0.45) / C.ROAD_HALF));
      var da = wrapAngle(along - sign(car.lat) * 0.5 * edge - car.a);
      if (Math.abs(da) < 1.3) car.a += da * Math.min(1, D.assist * dt) * (0.35 + edge);
    }
  }

  // 벽: 쉬움일수록 미끄러지듯 따라가고 속도를 덜 잃음
  function hitWall(car, q, lat, dt, D) {
    var over = Math.abs(lat) - C.WALL, sg = sign(lat), vn, keep, da;
    car.x -= q.nx * over * sg;
    car.y -= q.ny * over * sg;
    vn = car.vx * q.nx + car.vy * q.ny;
    if (vn * sg > 0) { car.vx -= q.nx * vn * C.WALL_BOUNCE; car.vy -= q.ny * vn * C.WALL_BOUNCE; }
    keep = Math.pow(D.wall, dt * 60);
    car.vx *= keep;
    car.vy *= keep;
    if (D.assist) {   // 벽에 박으면 길 방향으로 차를 돌려줌
      da = wrapAngle(Math.atan2(q.ty, q.tx) - car.a);
      if (Math.abs(da) < 1.4) car.a += da * Math.min(1, dt * 4);
    }
  }

  // ? 상자: 먹으면 부스터 +1, 가득이면 바로 짧은 부스터
  function pickBoxes(car, boxes, nowMs) {
    boxes.forEach(function (b) {
      if (b.back > nowMs) return;
      if (Math.pow(car.x - b.x, 2) + Math.pow(car.y - b.y, 2) < C.BOX_RADIUS * C.BOX_RADIUS) {
        b.back = nowMs + C.BOX_RESPAWN_MS;
        if (car.charges < C.MAX_CHARGES) {
          car.charges++;
          pop(car, "⚡ 부스터 +1", nowMs);
        } else {
          car.boost = car.boostMax = C.BOX_BOOST_SECONDS;
          pop(car, "가득! 바로 부스터", nowMs);
        }
      }
    });
  }

  function hitPads(car, track, i, lat, nowMs) {
    track.pads.forEach(function (pad) {
      var dd = Math.abs(i - pad);
      dd = Math.min(dd, track.n - dd);
      if (dd <= C.PAD_REACH && Math.abs(lat) < C.PAD_HALF_WIDTH) {
        if (car.boost < 0.5) pop(car, "부스트 패드!", nowMs);
        car.boost = Math.max(car.boost, C.PAD_BOOST_SECONDS);
        car.boostMax = Math.max(car.boost, C.PAD_BOOST_SECONDS);
      }
    });
  }

  // 다른 차와 겹치면 밀어냄. 다른 기기 차(vx 없음)는 안 밀리니 내가 다 밀려남
  function pushApart(car, others) {
    others.forEach(function (r) {
      var dx = car.x - r.x, dy = car.y - r.y, dl = Math.hypot(dx, dy), push, vn;
      if (dl > 0.01 && dl < C.CAR_HIT_RADIUS) {
        push = (C.CAR_HIT_RADIUS - dl) * (r.vx !== undefined ? 0.5 : 1);
        car.x += (dx / dl) * push;
        car.y += (dy / dl) * push;
        vn = car.vx * dx / dl + car.vy * dy / dl;
        if (vn < 0) { car.vx -= (dx / dl) * vn * C.CAR_BOUNCE; car.vy -= (dy / dl) * vn * C.CAR_BOUNCE; }
      }
    });
  }

  /**
   * w = { track, diff, started, laps, others: [{x, y, vx?}], nowMs }
   * 이번 단계에서 결승선을 넘었으면 true
   */
  function step(car, inp, dt, w) {
    var ctl = w.started && !car.finished;
    var ca = Math.cos(car.a), sa = Math.sin(car.a);
    var fwd = car.vx * ca + car.vy * sa;
    var side = -car.vx * sa + car.vy * ca;

    fwd = updateSpeed(car, inp, dt, w, ctl, fwd);
    side -= side * Math.min(1, w.diff.grip * dt);
    updateHeading(car, inp, dt, w, ctl, fwd);

    var c2 = Math.cos(car.a), s2 = Math.sin(car.a);
    car.vx = fwd * c2 - side * s2;
    car.vy = fwd * s2 + side * c2;
    car.x += car.vx * dt;
    car.y += car.vy * dt;

    var track = w.track;
    var i = track.nearest(car.idx, car.x, car.y);
    var q = track.points[i];
    var lat = (car.x - q.x) * q.nx + (car.y - q.y) * q.ny;
    if (Math.abs(lat) > C.WALL) hitWall(car, q, lat, dt, w.diff);
    car.lat = lat;
    car.grass = Math.abs(lat) > C.ROAD_HALF;

    if (ctl) pickBoxes(car, track.boxes, w.nowMs);

    // 진행도 (역주행하면 줄어듦)
    var d = i - car.idx;
    if (d > track.n / 2) d -= track.n;
    if (d < -track.n / 2) d += track.n;
    car.dist += d;
    car.idx = i;
    car.lap = Math.max(0, Math.floor(car.dist / track.n));

    if (ctl) hitPads(car, track, i, lat, w.nowMs);
    pushApart(car, w.others);
    car.fwd = car.vx * Math.cos(car.a) + car.vy * Math.sin(car.a);

    if (!car.finished && car.dist >= w.laps * track.n) {
      car.finished = true;
      return true;
    }
    return false;
  }

  /** 부스터 키 (누른 순간만) + 게이지 충전. 프레임마다 1번 */
  function updateCharges(car, nitroDown, racing, dt, diff, nowMs) {
    if (nitroDown && !car.nitroHeld && racing && car.charges > 0) {
      car.charges--;
      car.boost = car.boostMax = C.BOOST_SECONDS;
      pop(car, "부스터!", nowMs);
    }
    car.nitroHeld = !!nitroDown;
    if (racing && car.charges < C.MAX_CHARGES) {
      car.gauge += dt / diff.charge;
      if (car.gauge >= 1) {
        car.gauge = 0;
        car.charges++;
        pop(car, "⚡ +1", nowMs);
      }
    }
  }

  TR.physics = { newCar: newCar, step: step, updateCharges: updateCharges };
})(window.TR = window.TR || {});
