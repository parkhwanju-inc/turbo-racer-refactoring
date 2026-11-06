# 클라이언트 (`public/`)

바닐라 JS/HTML/CSS. 빌드 단계, 패키지 매니저, 린터 없음.

`js/` 의 일반 `<script>` 9개가 각자 `window.TR` 에 모듈을 올리고, 뒤 파일이 앞 파일을 쓴다. **순서는 `index.html` 에 적힌 대로이고 중요하다.** `game.js` 가 마지막에 `boot()` 로 시작시킨다.

| 파일 | 하는 일 |
|---|---|
| `config.js` | 숫자는 전부 여기 (트랙, 차, 난이도, 키 배정, 폴링 간격) |
| `track.js` | 트랙 점, 패드, `?` 상자, 나무, 출발 칸 `gridPos`, 가장 가까운 점 `nearest` |
| `physics.js` | 차 한 대 한 단계 `step()`, 부스터/게이지 `updateCharges()`. DOM과 네트워크를 모른다 |
| `controls.js` | 키보드/터치 → 입력, 컴퓨터 AI → 같은 모양의 입력 |
| `net.js` | XHR 전부 (`get`/`post`) + 서버 시계 맞추기 |
| `render.js` | 캔버스: 화면 분할, 카메라, 트랙, 차, HUD, 미니맵 |
| `ui.js` | HTML 화면: 참가/대기실/결과/명예의 전당, 버튼 연결 |
| `game.js` | 상태(`TR.game.state`), 서버 상태 반영 `onState`, 메인 루프, 폴링, 재접속 |

- 한 브라우저가 여러 차(`state.locals`)를 맡는다: 사람 최대 4명(키보드를 나눠 쓰고 화면 분할) + AI. 로컬 차 목록은 `sessionStorage` 의 `tr_locals` 에 저장되고, 새로고침하면 `/api/join` 에 `{id}` 를 보내 다시 접속한다.
- 물리 계산은 각 클라이언트가 한다. 서버는 위치와 `progress` 를 받아 다른 기기에 전달만 한다(`update`, 레이스 중 60ms 폴링, 아니면 500ms). 등수와 기록은 서버가 정한다: `/api/finish` 요청이 도착한 순서와 그때의 서버 시각을 쓴다.
- 트랙은 고정된 제어점과 seed로 모든 기기에서 똑같이 만든다. `progress = dist / track.n` 이 트랙 점 개수에 달려 있으므로 `config.js` 의 트랙 값(제어점, `SAMPLE`)을 바꾸면 버전이 다른 클라이언트끼리 진행도와 바퀴 수가 맞지 않는다.
- `physics.js` 의 계산 순서는 리팩토링 전 코드와 식 단위로 같게 맞춰 두었다. 순서를 바꾸면 소수점 끝자리가 달라져서 `tests/client/golden.json` 비교가 깨질 수 있다.
- `config.js` 의 `COLORS`, 최대 8명, 이름 12자는 서버(`room.py`, Supabase `tr_api`)에도 있다.
- `innerHTML` 에 넣는 사용자 값은 `TR.util.escHtml` 로 감싸거나 `textContent` 를 쓴다.
