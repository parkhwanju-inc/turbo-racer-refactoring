# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

터보 레이서: 브라우저에서 여럿이 하는 자동차 경주 게임. 빌드 단계, 패키지 매니저(`package.json`), 린터가 없다. 바닐라 JS/HTML/CSS + Python 표준 라이브러리 + Postgres 함수로만 되어 있다. 테스트도 추가 설치 없이 Python `unittest`와 Node 내장 `node:test`만 쓴다.

## 명령어

```bash
py server.py                    # 로컬 서버 → http://localhost:5050 (PORT 환경변수로 변경). start.bat 도 같은 일
npx supabase db push --remote   # supabase/migrations/ 의 새 마이그레이션을 원격 DB에 적용

py -m unittest discover -s tests/api -v          # API 테스트 (~1분, 10초 시간초과 규칙을 실제로 기다림)
py -m unittest tests.api.test_api.TestJoin       # 클래스 하나 (저장소 루트에서)
node --test tests/                                # 클라이언트 + Vercel 중계(api/[action].js) 테스트 (~20초)
node --test --test-name-pattern="부스터" tests/          # 이름으로 골라서
```

테스트 환경변수: `TR_SLOW=1` (30초 유예시간 테스트 포함), `TR_APP_DIR=<폴더>` (다른 체크아웃의 코드로 돌려 비교), `TR_BASE_URL=<url>` (이미 떠 있는 서버에 대고 API 테스트. 그 DB에 레이스 기록이 남으니 운영 서버엔 쓰지 말 것).

## 테스트 (리팩토링 안전망)

`tests/`는 리팩토링 전(legacy) 동작을 그대로 고정한 characterization 테스트다. 리팩토링 전후에 같은 테스트가 통과해야 한다. 테스트가 실패하면 테스트를 고치기 전에 동작이 바뀐 이유부터 확인한다.

- `tests/api/test_api.py`: HTTP만 본다. 테스트마다 저장소를 임시 폴더에 복사해서 `server.py`를 새로 띄운다(새 방, 새 SQLite). 그래서 `race.db`는 건드리지 않는다. `server.py`는 import에만 ~2초가 걸려서, 서버 몇 개를 미리 띄워 두고(`POOL_SIZE`) 돌려 쓴다. 이 서버 실행 방식(`py server.py` + `PORT`)이 바뀌면 `LocalServer`만 고친다.
- `tests/client/harness.js`: `game.js`를 Node `vm`에서 가짜 DOM/캔버스/XHR/저장소/시계와 함께 실행한다. `game.js`의 전역 이름(`fnPhysics`, `g_aLocals` …)은 **harness.js에서만** 쓴다. 이름이나 파일 구조가 바뀌면 `client.test.js`가 아니라 harness만 고친다. `Math.random`은 seed로 고정된다.
- `tests/proxy/proxy.test.js`: `api/[action].js`를 가짜 `https` 모듈로 감싸서, Supabase로 나가는 요청과 응답 변환만 본다.
- `tests/client/golden.json`: 트랙 모양과 물리 시나리오 결과를 리팩토링 전 코드에서 뽑아 둔 값이다. `node tests/client/record-golden.js`로 다시 기록하는데, 트랙이나 물리를 **일부러** 바꿨을 때만 쓴다.
- `docs/smells.md`에 적힌 버그(재접속 시 유령 플레이어 등)는 테스트로 고정하지 않았다. 고쳐도 테스트는 깨지지 않는다.
- 로컬 전용(`@local_only`) 테스트를 빼면 API 테스트는 Supabase 백엔드에서도 같은 결과가 나와야 한다. 예외: `laps: null`을 보내면 Python은 값을 그대로 두고 SQL은 3으로 바꾼다. 테스트에는 넣지 않았다.

- 배포: GitHub에 push 하면 Vercel이 자동 배포 (함수 리전 `icn1`, `vercel.json`). Supabase 프로젝트 `turbo-racer` (`ap-northeast-2`).
- Vercel 환경변수: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key). `api/[action].js`는 `NEXT_PUBLIC_*` / `*_PUBLISHABLE_KEY` 이름도 대신 받는다.
- DB 변경은 기존 마이그레이션을 고치지 말고 `supabase/migrations/`에 새 파일을 추가한다.

## 구조 (백엔드가 두 개)

같은 `/api/*` 계약을 **두 백엔드가 각각 따로 구현**한다. 클라이언트(`public/`)는 어느 쪽에 붙든 똑같이 동작한다.

| 실행 방식 | 경로 |
|---|---|
| 로컬 (같은 와이파이) | `public/game.js` → `server.py` (메모리 전역 변수에 방 상태 + `race.db` SQLite에 기록) |
| 배포 (Vercel) | `public/game.js` → `api/[action].js` (중계만 함) → Supabase RPC `tr_api(p_action, p_body)` (`supabase/migrations/*.sql`) |

- `api/[action].js`는 게임 로직이 없다. 허용된 action만 걸러서 `{p_action, p_body}`로 `tr_api`에 넘긴다. `tr_api`는 `{status, body}`를 돌려주고, 중계 함수가 그 값을 그대로 HTTP 상태와 응답 본문으로 쓴다.
- `tr_api`는 `security definer`이고 anon에는 이 함수만 공개된다. 모든 테이블은 RLS로 막혀 있고 정책은 없다.
- `.vercelignore`가 `*.py`, `*.db`, `supabase/`를 빼므로 Vercel에는 `public/`과 `api/`만 올라간다.

### 게임 로직을 바꿀 때: 두 곳을 같이 고친다

`server.py`의 `handleAPI`/`checkAll`과 SQL의 `tr_api`/`tr_tick`/`tr_end_race`/`tr_reset_room`은 같은 규칙을 따로 구현한 것이다. 한쪽만 고치면 로컬과 배포의 동작이 달라진다. 두 곳에 똑같이 들어 있는 값과 규칙:

- action 목록 (GET: `state`, `leaderboard` / POST: `join`, `leave`, `update`, `start`, `finish`, `reset`, `settings`). `server.py`의 `do_GET`/`do_POST`, `api/[action].js`, `tr_api`에 다 들어 있다
- 방 하나, 최대 8명(slot 0–7), 색 8개 (`game.js`의 `g_aColors`에도 있음), 이름 12자
- 응답 없는 플레이어 처리: 10초. 대기실·결과 화면에서는 삭제, 레이스 중에는 `dnf`
- 레이스 종료 조건: 남은 사람이 0명, 또는 첫 완주 후 30초(`grace`), 또는 시작 후 600초
- 시작 카운트다운 3.5초, 완주 확인 (`lap >= laps`이고 `elapsed >= 4*laps`)
- 설정: `laps` 1–9, `difficulty`는 `easy|normal|hard`
- 상태 응답 형태 (`makeState` ↔ `tr_public_state`): `now, phase, start_at, first_finish_at, grace, laps, settings, me, players[], results[], race_id`

방 초기화 코드는 `server.py` 안에서만도 `checkAll`, `/api/reset`, `/api/start`에 복사되어 있다.

### 클라이언트 (`public/game.js`)

- 한 브라우저가 여러 차(`g_aLocals`)를 맡는다: 사람 최대 4명(키보드를 나눠 쓰고 화면 분할) + AI. 로컬 차 목록은 `sessionStorage`의 `tr_locals`에 저장되고, 새로고침하면 `/api/join`에 `{id}`를 보내 다시 접속한다.
- 물리 계산은 각 클라이언트가 한다. 서버는 위치와 `progress`를 받아 다른 기기에 전달만 한다(`update`, 레이스 중 60ms 폴링, 아니면 500ms). 등수와 기록은 서버가 정한다: `/api/finish` 요청이 도착한 순서와 그때의 서버 시각을 쓴다.
- 서버 시각 맞추기: 모든 응답의 `now`로 `g_nOffset`을 계산한다. 이 XHR + 시각 맞추기 코드가 `fnAjaxApi`, `fnNetTick`, `fnAddLocal`, `fnPhysics`(finish), 재접속 IIFE에 복사되어 있다. 바꿀 때는 다 같이 바꾼다.
- 트랙(`fnInitTrack`)은 클라이언트에서 고정된 제어점과 seed로 똑같이 만든다. 진행도 `progress = dist / g_nN`이 트랙 점 개수에 달려 있으므로 제어점이나 샘플 간격(12px)을 바꾸면 버전이 다른 클라이언트끼리 진행도와 바퀴 수가 맞지 않는다.
- 도로 폭 같은 상수는 이름 없는 숫자로 박혀 있다 (95 = 도로 반폭, 170 = 벽까지 거리, 540/430/800/160 = 최고속도/가속/브레이크/후진). `fnPhysics`와 그리기 코드에 같은 숫자가 흩어져 있다.
- 순위 정렬은 `fnDrawAll`과 `fnUpdateGlobalUi`에 복사되어 있다.
- IE 호환 코드(`ActiveXObject`, `attachEvent`, CSS `_height`/`*zoom`)는 남아 있지만 실제로는 최신 브라우저 API(Path2D, pointer 이벤트, `e.code`)를 쓰므로 동작하지 않는다.
- `innerHTML`에 넣는 사용자 값은 `fnEscHtml`로 감싼다.
