# Vercel 함수 (`api/`)

배포판 경로: `public/` → `api/[action].js` (중계만 함) → Supabase RPC `tr_api(p_action, p_body)`. 로컬 경로는 `server.py` → `room.py` + `race_store.py` 이고, 같은 `/api/*` 계약을 따로 구현한다.

- `[action].js` 는 게임 로직이 없다. 허용된 action만 걸러서 `{p_action, p_body}` 로 `tr_api` 에 넘기고, `tr_api` 가 돌려준 `{status, body}` 를 그대로 HTTP 상태와 응답 본문으로 쓴다.
- action 목록 (GET: `state`, `leaderboard` / POST: `join`, `leave`, `update`, `start`, `finish`, `reset`, `settings`)은 `server.py` 의 `GET_ACTIONS`/`POST_ACTIONS` 와 `tr_api` 에도 있다. 하나를 바꾸면 셋 다 바꾼다.
- 배포: GitHub에 push 하면 Vercel이 자동 배포 (함수 리전 `icn1`, `vercel.json`).
- 환경변수: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key). `NEXT_PUBLIC_*` / `*_PUBLISHABLE_KEY` 이름도 대신 받는다.
- `.vercelignore` 가 `*.py`, `*.db`, `supabase/`, `tests/`, `docs/` 를 빼므로 Vercel에는 `public/` 과 `api/` 만 올라간다.
