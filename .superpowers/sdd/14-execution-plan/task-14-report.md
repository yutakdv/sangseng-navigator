# Task 14 (T14) 보고서 — B7 통합 스모크 테스트 (`backend/tests/test_smoke.py`)

## 생성·수정 파일

- `backend/tests/test_smoke.py` (신규) — TestClient 통합 스모크 21건. LLM은 전 테스트에서
  `app.llm.generate_json`을 monkeypatch(실호출 0회), DynamoDB는 DynamoDB Local 전용
- `backend/requirements-dev.txt` (수정) — `httpx` → `httpx2`. starlette 1.3.1의 TestClient는
  httpx2를 우선 import하고 httpx로 폴백하면 `StarletteDeprecationWarning`을 띄운다
  (경고 없는 출력 요구를 억제가 아니라 의존성 교체로 해결). requirements.txt는 손대지 않음
- `backend/pytest.ini` (신규) — `testpaths = tests` + 서드파티 경고 1건 억제
  (`mangum/adapter.py:65`의 `asyncio.get_event_loop()` DeprecationWarning — 우리 코드 밖).
  우리 코드에서 나는 경고는 그대로 보이게 두었다(`-W error`는 쓰지 않음 — 라이브러리 업데이트가
  이후 모든 PR을 막는 부작용이 더 크다)
- `docs/plan/15-plan-review.md` §5 — T7·T14 requirements-dev 항목 체크박스 닫음(근거 1줄 추가)

## 설계 결정

1. **LLM 목업은 프롬프트가 아니라 요청 스키마로 분기** — 호출부가 3곳(cardgen `CARD_AI_SCHEMA`,
   simulate `narrative`, widget `blurbs`)이고 기대 필드가 서로 달라, 단일 고정 JSON으로는
   호출부가 깨진다. `schema["properties"]`에 `narrative`/`blurbs`가 있는지로 식별해 응답을 맞춘다.
   blurb 개수는 user payload의 `가맹점` 길이에서 읽어 정확히 채워, 규칙 기반 fallback이 섞이지 않은
   "LLM 문구 채택" 경로임을 단언할 수 있게 했다. `FakeLLM.calls`로 호출 횟수도 검증.
2. **상태 의존 0 — 매 테스트 전 `seed_demo` 재사용 리셋** — autouse fixture가
   `seed_demo.clear_table()` + `demo_cards()` put으로 `--reset`과 동일 상태(카드 3장)를 만든다.
   21개 테스트를 개별 실행해도 전부 통과한다(아래 검증 3).
3. **실데이터 값 하드코딩 금지** — dashboard/candidates는 구조·타입·범위만 본다
   (`headline_rate` float>0, 각 index 0~100, `region_share` 합≈1, 후보 근거 필드 12종 존재,
   Score 내림차순). 하드코딩한 문자열은 05 문서가 고정한 계약 문구뿐 —
   `가정 기반 전망이며 실제와 다를 수 있음`, `확충 완료된 신규 가맹점을 우선 추천합니다`,
   `지금 여기서 쓰면 5% 페이백`, INCENTIVE `assumption_note`, `sources` 3종.
   이 문구들은 바뀌면 FE와 어긋나므로 **잡아야 하는** 값이다.
4. **실 AWS 보호 가드** — `DYNAMO_ENDPOINT`가 없으면 모듈 단위 skip. 시드/리셋이 테이블을
   비우기 때문에, 환경변수를 빠뜨린 실행이 실 `sangseng-cards` 테이블을 파괴하는 것을 막는다.
   반대로 엔드포인트는 있는데 컨테이너가 안 떠 있으면 fixture가 원인·조치를 적은 RuntimeError로 죽는다.
5. **`CARDS_TABLE` 선점** — `.env`/`.env.example`의 `CARDS_TABLE=`은 T17 배포 전까지 빈 값이라
   그대로 두면 테이블명이 `""`가 된다. app import 전에 `os.environ.setdefault("CARDS_TABLE",
   "sangseng-cards")`로 선점했다(python-dotenv는 기존 환경변수를 덮지 않는다).

## 테스트 목록 (21건)

| # | 테스트 | 검증 대상 |
|---|---|---|
| 1 | `test_health_reports_data_loaded` | `/api/health` = `{"ok":true,"data_loaded":true}` (05 §5) |
| 2 | `test_dashboard_returns_real_data` | 05 §1 구조·범위, `is_proxy:true`(절대 규칙 2), region_share = REGIONS 6개·합≈1 |
| 3 | `test_candidates_merges_scores_and_merchants` | eup_ranking 순번 연속, 후보 근거 필드 12종, Score 내림차순, merchants 필드 |
| 4 | `test_cards_list_reflects_demo_seed` | seed --reset 상태 3장·created_at 내림차순, type/status 필터, 단건 조회, 404 |
| 5 | `test_generate_expansion_creates_pending_card` | 201·`status=pending`(절대 규칙 4), LLM 출력 반영, `original_ranking` 병기(절대 규칙 5), 고정 문구 자동 삽입(절대 규칙 3), sources·events |
| 6 | `test_generate_expansion_is_idempotent_for_same_target` | 05 §8 중복 가드 — 2회차 200 + 동일 id, 카드 수 불변 |
| 7 | `test_generate_skips_target_already_in_progress` | 추진중 타깃(AC-001 영월군×카페) 제안 시 타깃+사유 텍스트 통째 교체 (A-1 중복 제안 금지) |
| 8 | `test_generate_incentive_builds_scenarios` | pending 중복 200 → 반려 후 201, 3/5/7 시나리오, `selected_rate:null`, `original_ranking:null`, A-3 필수 리스크 3종 보충 |
| 9 | `test_generate_rejects_unknown_type` | 알 수 없는 type 400 |
| 10 | `test_decision_approves_expansion_card` | approved → `progress=검토중`·`decided_at`·events, 재결정 409 |
| 11 | `test_decision_error_paths` | 404 / 잘못된 decision 400 / pending 아닌 카드 409 |
| 12 | `test_incentive_approval_requires_selected_rate` | 누락·범위 밖 400, 5% 저장, EXPANSION에 온 rate는 무시 (05 §8) |
| 13 | `test_progress_transitions_require_approved_card` | 추진중→완료 전이·events, pending 409, 허용 밖 값 400, 404 |
| 14 | `test_simulate_expansion_card` | 지수 0~100, delta_pp 오름차순 2값, LLM narrative 채택, `assumption_note` 고정 문구 |
| 15 | `test_simulate_falls_back_when_llm_fails` | LLM 예외에도 200 + 규칙 기반 문구에 "예상"·"가정" |
| 16 | `test_simulate_error_paths` | INCENTIVE 400 (EXPANSION 전용), 404 |
| 17 | `test_kpi_matches_card_state` | 4지표 + counts를 카드 목록에서 **독립 재계산해 대조** (05 §3) |
| 18 | `test_kpi_survives_empty_table` | 카드 0건 → 4지표 전부 null, division-by-zero 없음 (05 §8) |
| 19 | `test_widget_promotes_completed_targets_and_payback` | 완료 카드 전/후 추천 **순서 변화**, `badge:"신규"`, payback rate 5, LLM blurb 채택 |
| 20 | `test_widget_blurb_falls_back_when_llm_fails` | LLM 실패 시 05 §8 규칙 문구 |
| 21 | `test_widget_returns_empty_for_unknown_region` | 0건 → `{"recommendations":[],"policy_note":...}` + LLM 호출 0회 |

## 검증

### 1. 표준 명령 (14 문서 T14 — 이후 모든 PR의 스모크 기준)

```
$ docker compose up -d dynamodb
$ cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q
.....................                                                    [100%]
21 passed in 0.52s
```

경고 0건 (`httpx2` 교체 전 2건 → 0건). `-v` 실행:

```
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.6.0
rootdir: .../backend
configfile: pytest.ini
plugins: anyio-4.14.2
collected 21 items

tests/test_smoke.py::test_health_reports_data_loaded PASSED              [  4%]
tests/test_smoke.py::test_dashboard_returns_real_data PASSED             [  9%]
tests/test_smoke.py::test_candidates_merges_scores_and_merchants PASSED  [ 14%]
tests/test_smoke.py::test_cards_list_reflects_demo_seed PASSED           [ 19%]
tests/test_smoke.py::test_generate_expansion_creates_pending_card PASSED [ 23%]
tests/test_smoke.py::test_generate_expansion_is_idempotent_for_same_target PASSED [ 28%]
tests/test_smoke.py::test_generate_skips_target_already_in_progress PASSED [ 33%]
tests/test_smoke.py::test_generate_incentive_builds_scenarios PASSED     [ 38%]
tests/test_smoke.py::test_generate_rejects_unknown_type PASSED           [ 42%]
tests/test_smoke.py::test_decision_approves_expansion_card PASSED        [ 47%]
tests/test_smoke.py::test_decision_error_paths PASSED                    [ 52%]
tests/test_smoke.py::test_incentive_approval_requires_selected_rate PASSED [ 57%]
tests/test_smoke.py::test_progress_transitions_require_approved_card PASSED [ 61%]
tests/test_smoke.py::test_simulate_expansion_card PASSED                 [ 66%]
tests/test_smoke.py::test_simulate_falls_back_when_llm_fails PASSED      [ 71%]
tests/test_smoke.py::test_simulate_error_paths PASSED                    [ 76%]
tests/test_smoke.py::test_kpi_matches_card_state PASSED                  [ 80%]
tests/test_smoke.py::test_kpi_survives_empty_table PASSED                [ 85%]
tests/test_smoke.py::test_widget_promotes_completed_targets_and_payback PASSED [ 90%]
tests/test_smoke.py::test_widget_blurb_falls_back_when_llm_fails PASSED  [ 95%]
tests/test_smoke.py::test_widget_returns_empty_for_unknown_region PASSED [100%]

============================== 21 passed in 0.55s ==============================
```

레포 루트에서 실행하는 07 B7 형태(`pytest backend/tests -q`)도 동일하게 `21 passed`
(테스트 파일이 `backend/`를 sys.path에 넣어 실행 위치를 타지 않는다).

### 2. requirements.txt 단독 import 독립성

`backend/requirements.txt`만 설치한 새 venv(pytest·httpx2 미설치)에서:

```
$ prodvenv/bin/python -c "import app.main; print('import ok:', app.main.app.title)"
import ok: 상생 나침반 API
$ prodvenv/bin/python -c "...find_spec..."
pytest present: False
httpx2 present: False
```

설치 목록에 pytest·httpx2 없음(httpx 0.28.1은 openai/anthropic SDK의 런타임 의존성) —
Lambda 번들 오염 없음.

### 3. 테스트 독립성

21개 테스트를 각각 단독 실행 → 전부 `1 passed`. 전체 재실행도 `21 passed`.

### 4. 실 AWS 보호 가드

`DYNAMO_ENDPOINT` 없이 실행:

```
SKIPPED [1] tests/test_smoke.py:28: DYNAMO_ENDPOINT 미설정 — `docker compose up -d dynamodb` 후
DYNAMO_ENDPOINT=http://localhost:8001 로 실행하세요 (실 AWS 테이블 보호)
1 skipped in 0.00s
```

### 5. 뒷정리

`docker compose down`(컨테이너·네트워크 제거) → `.env` 사본 삭제 → `git status` 클린.

## 우려사항·인계 사항

1. **`CARDS_TABLE`이 비어 있으면 `cd backend && uvicorn app.main:app`은 카드 API에서 죽는다** —
   `.env.example`은 이 값을 "T17 1차 배포 후 CloudFormation Outputs를 붙여넣는 칸"으로 비워 두었고,
   `db.py`는 `os.environ.get("CARDS_TABLE", "sangseng-cards")`라 **키가 존재하되 빈 문자열**이면
   기본값이 안 먹는다(테이블명 `""`). docker compose는 `environment:`로 값을 주므로 영향 없고,
   테스트는 import 전에 선점해 우회했다. T16 로컬 풀루프는 docker compose 경로라 문제 없지만,
   CLAUDE.md의 "백엔드 단독 로컬 실행" 명령을 쓰려면 `.env`에 `CARDS_TABLE=sangseng-cards`를
   채우거나 `db.py`를 `os.environ.get("CARDS_TABLE") or "sangseng-cards"`로 바꿔야 한다.
   **T14 범위 밖이라 코드는 건드리지 않았다** — 결정 필요.
2. **테스트가 실데이터의 "영월군" 서사에 묶여 있다** — 목업 LLM이 지목하는 타깃(영월군 음식점),
   추진중 타깃(영월군 카페), 위젯 지역(영월군)은 현재 `candidates.json`·`merchants.json`과
   `seed_demo.py`를 전제한다. 파이프라인을 다시 돌려 후보 지역이 바뀌면 5·7·19번 테스트가 깨진다
   (수치가 아니라 **서사**에 대한 의존이므로, 그때는 시드와 함께 갱신하는 게 맞다).
3. **`httpx` → `httpx2` 교체** — 14 문서 T14는 "httpx dev 의존성 추가"라고 적었지만, 현재 설치된
   starlette 1.3.1은 httpx2를 우선 import하고 httpx 사용 시 deprecation 경고를 낸다.
   경고 억제 대신 권장 패키지로 갈아탔다. 팀원이 이미 `pip install -r requirements-dev.txt`를
   돌렸다면 한 번 더 실행해야 한다.
4. **회귀 기준선으로서의 한계** — 스모크는 계약·상태 전이·에러 코드를 박제하지만 LLM 출력 품질
   (프롬프트 준수, 문구 자연스러움)은 검증하지 않는다. LLM 실호출 검증은 T11·T13 보고서의 수동
   기록이 유일한 근거이므로, 프롬프트를 고칠 때는 스모크 통과만으로 안심하면 안 된다.
