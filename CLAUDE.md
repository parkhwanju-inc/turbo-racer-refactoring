# CLAUDE.md

```bash
py server.py                                   # 실행: http://localhost:5050 (PORT 로 변경, start.bat 도 같음)
py -m unittest discover -s tests/api -v        # API 테스트 (~1분)
py -m unittest tests.api.test_api.TestJoin     # API 테스트 클래스 하나
node --test tests/                             # 클라이언트 + Vercel 중계 테스트 (~20초)
node --test --test-name-pattern="부스터" tests/  # 이름으로 골라서
```
