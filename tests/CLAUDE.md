# 테스트 (리팩토링 안전망)

리팩토링 전(legacy) 동작을 그대로 고정한 characterization 테스트다. 추가 설치 없이 Python `unittest` 와 Node 내장 `node:test` 만 쓴다. 테스트가 실패하면 테스트를 고치기 전에 동작이 바뀐 이유부터 확인한다.

환경변수: `TR_SLOW=1` (30초 유예시간 테스트 포함), `TR_APP_DIR=<폴더>` (다른 체크아웃의 코드로 돌려 비교), `TR_BASE_URL=<url>` (이미 떠 있는 서버에 대고 API 테스트. 그 DB에 레이스 기록이 남으니 운영 서버엔 쓰지 말 것).

- `api/test_api.py`: HTTP만 본다. 테스트마다 저장소를 임시 폴더에 복사해서 `server.py` 를 새로 띄운다(새 방, 새 SQLite). 그래서 `race.db` 는 건드리지 않는다. `server.py` 는 import에만 ~2초가 걸려서, 서버 몇 개를 미리 띄워 두고(`POOL_SIZE`) 돌려 쓴다. 서버 실행 방식(`py server.py` + `PORT`)이 바뀌면 `LocalServer` 만 고친다.
- `client/harness.js`: `public/index.html` 이 부르는 스크립트를 같은 순서로 Node `vm` 에서 가짜 DOM/캔버스/XHR/저장소/시계와 함께 실행한다. 게임 내부 이름(`TR.game.state`, `TR.physics` …)은 **harness.js 에서만** 쓴다. 이름이나 파일 구조가 바뀌면 `client.test.js` 가 아니라 harness만 고친다. `Math.random` 은 seed로 고정된다.
- `client/golden.json`: 트랙 모양과 물리 시나리오 결과를 리팩토링 전 코드에서 뽑아 둔 값이다. `node tests/client/record-golden.js` 로 다시 기록하는데, 트랙이나 물리를 **일부러** 바꿨을 때만 쓴다.
- `proxy/proxy.test.js`: `api/[action].js` 를 가짜 `https` 모듈로 감싸서, Supabase로 나가는 요청과 응답 변환만 본다.
- `docs/smells.md` 에 적힌 버그(재접속 시 유령 플레이어 등)는 테스트로 고정하지 않았다. 고쳐도 테스트는 깨지지 않는다.
- 로컬 전용(`@local_only`) 테스트를 빼면 API 테스트는 Supabase 백엔드에서도 같은 결과가 나와야 한다. 예외: `laps: null` 을 보내면 Python은 값을 그대로 두고 SQL은 3으로 바꾼다. 테스트에는 넣지 않았다.
