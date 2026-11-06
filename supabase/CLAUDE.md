# Supabase (배포판 게임 로직)

Supabase 프로젝트 `turbo-racer` (`ap-northeast-2`). `migrations/*.sql` 의 `tr_api(p_action, p_body)` 가 배포판의 게임 로직 전부다.

```bash
npx supabase db push --remote   # 새 마이그레이션을 원격 DB에 적용
```

- DB 변경은 기존 마이그레이션을 고치지 말고 `migrations/` 에 새 파일을 추가한다.
- `tr_api` 는 `security definer` 이고 anon에는 이 함수만 공개된다. 모든 테이블은 RLS로 막혀 있고 정책은 없다.

## 게임 규칙을 바꿀 때: 두 곳을 같이 고친다

저장소 루트의 `room.py` (`Room`, 로컬 서버용)와 여기 SQL의 `tr_api`/`tr_tick`/`tr_end_race`/`tr_reset_room` 은 같은 규칙을 따로 구현한 것이다. 한쪽만 고치면 로컬과 배포의 동작이 달라진다. `room.py` 맨 위의 상수(`SEEN_TIMEOUT`, `GRACE`, `COUNTDOWN` …)가 SQL에는 숫자로 들어 있다. 두 곳에 똑같이 들어 있는 값과 규칙:

- action 목록 (`api/CLAUDE.md` 참고)
- 방 하나, 최대 8명(slot 0–7), 색 8개 (`public/js/config.js` 의 `COLORS` 에도 있음), 이름 12자
- 응답 없는 플레이어 처리: 10초. 대기실·결과 화면에서는 삭제, 레이스 중에는 `dnf`
- 레이스 종료 조건: 남은 사람이 0명, 또는 첫 완주 후 30초(`grace`), 또는 시작 후 600초
- 시작 카운트다운 3.5초, 완주 확인 (`lap >= laps` 이고 `elapsed >= 4*laps`)
- 설정: `laps` 1–9, `difficulty` 는 `easy|normal|hard`
- 상태 응답 형태 (`Room._state` ↔ `tr_public_state`): `now, phase, start_at, first_finish_at, grace, laps, settings, me, players[], results[], race_id`
