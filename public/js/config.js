// 터보 레이서 - 설정값 (숫자는 전부 여기)
//
// 트랙/물리 숫자를 바꾸면 다른 버전 클라이언트와 진행도가 어긋나고,
// tests/client/golden.json 도 다시 기록해야 한다 (public/CLAUDE.md, tests/CLAUDE.md 참고).
// 서버 쪽 규칙(인원, 색, 시간)은 room.py 와 Supabase tr_api 에도 있다.
(function (TR) {
  "use strict";

  var ROAD_HALF = 95;
  var GRASS_WIDTH = 75;

  TR.config = {
    COLORS: ["#ff4d4d", "#3d8bff", "#ffd23d", "#3ddc84", "#b26bff", "#ff8c2e", "#2ee6e6", "#ff6fcf"],
    MAX_PLAYERS: 8,
    MAX_LOCAL_HUMANS: 4,
    NAME_MAX: 12,

    // ---- 트랙
    TRACK_POINTS: [
      [400, 1350], [400, 700], [520, 380], [800, 280], [1150, 330], [1350, 620],
      [1650, 850], [1950, 700], [2150, 420], [2550, 380], [2820, 620], [2800, 1100],
      [2550, 1450], [2150, 1560], [1800, 1400], [1450, 1520], [1100, 1760], [700, 1780], [460, 1620]
    ],
    SPLINE_STEPS: 24,         // 제어점 사이를 몇 조각으로
    SAMPLE: 12,               // 트랙 점 간격 (px). progress = dist / 점 개수
    ROAD_HALF: ROAD_HALF,     // 도로 반폭
    GRASS_WIDTH: GRASS_WIDTH, // 도로 밖 잔디 폭
    WALL: ROAD_HALF + GRASS_WIDTH,   // 중심선에서 벽까지
    NEAREST_SEARCH: 30,       // 가장 가까운 트랙 점을 앞뒤 몇 칸에서 찾을지
    PADS_AT: [0.17, 0.43, 0.7],            // 부스트 패드 위치 (트랙 비율)
    PAD_REACH: 3,             // 패드 앞뒤 몇 칸까지
    PAD_HALF_WIDTH: 45,
    BOX_ROWS_AT: [0.09, 0.32, 0.56, 0.84], // ? 상자 줄 위치
    BOX_LATS: [-55, 0, 55],
    BOX_RADIUS: 36,
    BOX_RESPAWN_MS: 3000,
    TREES: { seed: 7, tries: 900, max: 170, clearance: 220, x0: -300, w: 3500, y0: -200, h: 2300, r0: 22, rw: 22 },
    GRID: { firstBack: 60, rowGap: 75, lat: 40 },  // 출발 칸

    // ---- 차
    MAX_SPEED: 540,
    ACCEL: 430,
    BRAKE: 800,
    REVERSE_ACCEL_RATIO: 0.6,
    REVERSE_MAX: 160,
    COAST_DRAG: 0.9,
    OVERSPEED_DRAG: 3,
    STEER_RESPONSE: 9,
    STEER_FULL_SPEED: 160,    // 이 속도부터 핸들이 100% 먹음
    STEER_HIGH_SPEED_CUT: 0.25,
    BOOST_SPEED: 1.45,        // 부스터 중 최고속도 배율
    BOOST_ACCEL: 2,
    BOOST_MIN_SPEED: 1.2,
    BOOST_SECONDS: 1.6,       // 부스터 키
    BOX_BOOST_SECONDS: 0.8,   // 가득 찼을 때 상자 먹으면
    PAD_BOOST_SECONDS: 1.1,
    MAX_CHARGES: 3,
    WALL_BOUNCE: 1.15,
    CAR_HIT_RADIUS: 36,
    CAR_BOUNCE: 1.3,

    // 난이도
    //   grip: 미끄러짐(클수록 착 붙음)  turn: 핸들  grass: 잔디 속도  wall: 벽에 닿아도 유지되는 속도
    //   assist: 자동 핸들 보조  charge: 부스터 1칸 차는 시간(초)  start: 출발 부스터 수
    //   ai: 컴퓨터 실력(최고속도 비율 범위)  aiNitro: 컴퓨터가 부스터 쓰는 빈도
    DIFFICULTY: {
      easy:   { grip: 14, turn: 2.5, grass: 0.8, wall: 0.97, assist: 2.4, charge: 6,  start: 2, ai: [0.58, 0.68], aiNitro: 0.15 },
      normal: { grip: 10, turn: 2.7, grass: 0.6, wall: 0.9,  assist: 0.9, charge: 9,  start: 1, ai: [0.75, 0.87], aiNitro: 0.5 },
      hard:   { grip: 7,  turn: 2.9, grass: 0.4, wall: 0.8,  assist: 0,   charge: 12, start: 0, ai: [0.92, 1.00], aiNitro: 1 }
    },
    DEFAULT_DIFFICULTY: "easy",

    // ---- 조작키 (혼자면 all, 화면 분할이면 SPLIT_ORDER 순서대로)
    KEY_SCHEMES: {
      all:    { label: "방향키 / WASD", nlabel: "Space", up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"], left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], nitro: ["Space", "ShiftLeft", "ShiftRight"] },
      wasd:   { label: "W A S D",       nlabel: "Shift", up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"], nitro: ["ShiftLeft", "KeyQ", "Space"] },
      arrows: { label: "방향키",         nlabel: "Enter", up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], nitro: ["Enter", "ShiftRight", "Slash"] },
      ijkl:   { label: "I J K L",       nlabel: "U",     up: ["KeyI"], down: ["KeyK"], left: ["KeyJ"], right: ["KeyL"], nitro: ["KeyU", "KeyO"] },
      numpad: { label: "숫자패드 8 4 5 6", nlabel: "0",  up: ["Numpad8"], down: ["Numpad5", "Numpad2"], left: ["Numpad4"], right: ["Numpad6"], nitro: ["Numpad0", "NumpadEnter"] }
    },
    SPLIT_ORDER: ["wasd", "arrows", "ijkl", "numpad"],

    // ---- 네트워크 / 루프
    NET_CHECK_MS: 30,
    POLL_RACING_MS: 60,
    POLL_IDLE_MS: 500,
    PHYSICS_HZ: 120,
    MAX_FRAME_SEC: 0.1
  };
})(window.TR = window.TR || {});
