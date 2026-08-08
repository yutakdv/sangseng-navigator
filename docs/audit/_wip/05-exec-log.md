# 05 — 실행 검증 로그 (§14)

실행일 2026-08-08. **정적 분석과 구분되는 "실제로 돌린 것"만 기록.** 미실행은 미실행으로 남긴다.

## 실행한 명령 · 원문 출력

### 1. `docker compose config -q`
```
exit=0
```
→ compose 파일 문법·환경변수 보간 정상.

### 2. `docker compose ps`
```
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
```
→ **기동 중인 컨테이너 0개.** §14의 "없으면 생략, 새로 띄우지 말 것"에 따라 스택을 올리지 않았다.
따라서 `curl localhost:8000/api/health`는 **미실행**.

### 3. `python` 인터프리터
```
(eval):10: command not found: python
```
→ PATH에 `python` 없음. 프로젝트 venv로 재실행:
```
.venv/bin/python          -> Python 3.12.13
backend/.venv/bin/python  -> Python 3.12.13
pipeline/.venv/bin/python -> Python 3.12.13
```
(※ `docs/plan/20`·`CLAUDE.md`의 예시 명령이 `python`을 그대로 쓰는데 이 환경에선 실패한다.)

### 4. 백엔드 import 타임 검증
```
$ cd backend && ./.venv/bin/python -c "import app.main; print('import OK -> handler', type(app.main.handler).__name__)"
import OK -> handler Mangum
exit=0
```
→ 순환참조·import 시점 env 강제 없음. Mangum 핸들러 정상 생성.

### 5. `cd backend && pytest -q` (전체)
```
==================================== ERRORS ====================================
________________ ERROR collecting tests/test_progress_report.py ________________
progress integration tests require a local DYNAMO_ENDPOINT
_____________________ ERROR collecting tests/test_smoke.py _____________________
DYNAMO_ENDPOINT가 설정되지 않아 스모크를 실행할 수 없습니다 — `docker compose up -d dynamodb` 후
`cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q`
=========================== short test summary info ============================
ERROR tests/test_progress_report.py - Failed: progress integration tests requ...
ERROR tests/test_smoke.py - Failed: DYNAMO_ENDPOINT가 설정되지 않아 스모크를 ...
!!!!!!!!!!!!!!!!!!! Interrupted: 2 errors during collection !!!!!!!!!!!!!!!!!!!!
2 errors in 0.09s
```
→ **56개(test_smoke 50 + test_progress_report 6) 미실행.** 실패가 아니라 **수집 단계 fail-fast**이며,
메시지에 재현 명령이 들어 있다(좋은 설계). 실행하려면 DynamoDB Local 기동이 필요한데
§14가 "새로 띄우지 말 것"이라 **의도적으로 실행하지 않았다.**

### 6. `pytest tests/test_algorithms.py -q` (backend)
```
...                                                                      [100%]
3 passed in 0.01s
```

### 7. `cd pipeline && pytest tests -q` (루트 venv 사용)
```
....                                                                     [100%]
4 passed in 0.10s
```
※ `pipeline/.venv`에는 pytest가 없어(`pipeline/requirements.txt`에 미포함) 루트 `.venv`로 실행했다.

### 8. `cd frontend && npx tsc --noEmit`
```
exit=0
```
→ 타입 오류 0건.

### 9. `cd frontend && npm run lint`
```
> sangseng-navigator-frontend@0.1.0 lint
> eslint .
exit=0
```
→ 경고·오류 0건.

### 10. `cd frontend && npm run check:banned`
```
> sangseng-navigator-frontend@0.1.0 check:banned
> node scripts/check-banned-words.mjs
금칙어 검사 통과 (지니, Gini, GINI, HHI, 실행하겠습니다 + 패턴 4종)
exit=0
```
→ **절대 규칙 1 통과** (+ 규칙 4의 "실행하겠습니다" 부분 통과).

---

## 실행 요약

| 항목 | 결과 |
|---|---|
| compose 문법 | PASS |
| BE import | PASS |
| BE test_algorithms (3) | **3 passed** |
| pipeline tests (4) | **4 passed** |
| BE test_smoke (50) | **미실행** — DynamoDB Local 필요 |
| BE test_progress_report (6) | **미실행** — DynamoDB Local 필요 |
| FE `tsc --noEmit` | PASS (0 error) |
| FE `eslint` | PASS (0 error) |
| FE `check:banned` | PASS |
| FE `npm run build` | **미실행** (아래 사유) |
| `curl /api/health` | **미실행** — 스택 미기동 |

**63개 중 7개 실행·전부 통과, 56개 미실행.**

`npm run build` 미실행 사유: `next build --webpack` 수행 시 `.next` 산출물이 갱신되어
현재 워크스페이스 상태를 변경한다. 타입 검사(`tsc --noEmit`)와 lint가 모두 통과했고
Vercel 빌드 재현은 부수효과가 있어 보류했다. **빌드 성공 여부는 NOT VERIFIED.**

## 사용자가 직접 돌릴 수 있는 잔여 검증 명령

```bash
docker compose up -d dynamodb
cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q
cd frontend && npm run build
docker compose up -d && curl -s localhost:8000/api/health | python3 -m json.tool
```
⚠ `seed` 서비스가 `--reset`으로 돌아 데모 카드 상태가 초기화된다 — 데모 직전에는 실행하지 말 것.
