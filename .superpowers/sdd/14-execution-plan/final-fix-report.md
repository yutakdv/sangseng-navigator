# 최종 리뷰 픽스 보고서 (day-1 마감) — Important 3 + Minor 4

브랜치 `feat/yutak-final-day1-fixes`, 커밋 5개, PR 생성(머지 안 함). 스모크 24건 전건 통과 유지.

## 수정 파일

| 파일 | 건 | 내용 |
|---|---|---|
| `pipeline/p3_merchants.py` | I1 | `DROP_FIELDS`·`strip_pii()` 신설, 캐시 저장 경로에 적용. 명세 docstring 의 실제 사업자번호·전화번호 예시값도 자리표시자로 교체 |
| `data/raw/api_cache/merchants_raw.json` | I1 | 두 필드 제거 후 재저장 (API 재호출 없음) |
| `docs/plan/05-api-contract.md` | I2·M5 | 머리말 원천 명시, §6 에 sync-mocks 사용법 1줄, §2 고정 문구 교정 |
| `scripts/sync-mocks.sh` | I2 | 신규 (실행 권한 포함) |
| `docs/plan/08-frontend-tasks.md` | I2 | FE 가 실제로 읽는 문서 — "05 예시를 mock 에 넣어라" 지시 2곳을 sync-mocks 로 교체 |
| `backend/app/db.py`·`backend/seed_demo.py`·`backend/local_init.py` | I3 | `CARDS_TABLE` 빈 문자열 방어 |
| `backend/app/llm.py`·`backend/app/routes/widget.py` | M4 | `attempts` 파라미터(기본 2), 위젯 blurb 만 1 |
| `backend/tests/test_smoke.py` | M4 | `FakeLLM` 이 `attempts` 를 받도록 + 호출부별 대조 3곳 |
| `backend/seed_demo.py` | M7 | `assert_ranking_matches_pipeline()` 가드 |
| `docs/plan/14-execution-plan.md`·`docs/plan/07-backend-ai-tasks.md`·`pipeline/run_all.py`·`.env.example` | M6 | stale 참조 정정 |

## Important 1 — 캐시 PII 제거 + 바이트 동일 증명

파이프라인이 읽는 필드는 `FRCS_NM`·`FRCS_ADDR` 뿐이므로 산출물 영향은 이론상 0 이지만,
게이트가 증명이라 **재실행 2회로 대조**했다. 지오코딩 캐시(`geocode.json`)는 커밋 대상이 아니라
워크트리에 없었으므로, **커밋된 `merchants.json` 의 `address → [lat, lng]` 로 캐시를 복원**해서
Kakao 재호출 없이 돌렸다(캐시에 담기는 값 = 산출물의 6자리 반올림 값이라 복원이 정확하다).
남은 3건(기존 지오코딩 실패분)만 Kakao 를 5회 호출했고, 두 실행 모두 같은 결과였다.

| 실행 | 입력 캐시 | 결과 |
|---|---|---|
| Run A | 원본(PII 포함) | `merchants.json` sha256 `06f4412d…cb0a` = **커밋본과 바이트 동일** (하네스 검증) |
| Run B | 정리본(PII 제거) | 같은 sha256 — **바이트 동일**, `geocode_failed.json` 도 동일 |

```
$ diff -s <baseline>/merchants.baseline.json data/processed/merchants.json
Files ... are identical
$ git status --short          # 산출물 변경 0
```

- 캐시 `grep -c "FRCS_TELNO\|FRCS_BRNO"` → **0건**
- 캐시 건수 **1,681 유지**, `total_count: 1681` 유지, 남은 행 키 = `FRCS_REG_NO / FRCS_NM / FRCS_ADDR / PNT_USABLE_AMT`
- 재저장은 `p3_merchants.strip_pii()` 와 `json.dumps(..., ensure_ascii=False, indent=1)`
  (= `load_raw()` 의 저장 경로와 같은 코드·같은 옵션)를 그대로 썼다. 재저장을 한 번 더 돌려도
  파일이 안 바뀌는 **멱등**을 확인했으므로 `--refresh` 산출물과 포맷이 어긋나지 않는다
  (`fetched_at` 은 원본 값을 유지 — 실제 수집 시각을 거짓말하지 않기 위해)
- 히스토리 rewrite 안 함 (지시대로 범위 밖)

## Important 2 — 원천 단일화

05 머리말을 "예시 = 스키마 기준 / 값 원천 = `data/processed/` 실산출 + `scripts/sync-mocks.sh`" 로
바꾸고, §6 표 아래에 사용법 1줄을 넣었다. 계약 변경 절차의 ②도 "mock 수정" → "스크립트 재실행" 으로 고쳤다.

`scripts/sync-mocks.sh`:
- `dashboard/eup_scores/merchants/usage_monthly/risk_signal/sensitivity` 6종 복사 (`mkdir -p`)
- `candidates.json` 만 `GET /api/candidates` 병합 형태로 생성
- 산출물 누락 시 `run_all.py` 안내와 함께 exit 1, `set -euo pipefail`

**검증:** `frontend/` 가 없는 상태에서 실행 → 디렉터리 생성 후 7개 파일 산출.
병합본을 실제 BE 응답과 대조해 **payload 완전 일치**(`get_candidates() == mock` → `True`, 키 순서까지 동일).

**지적 범위 밖이지만 함께 고침 —** `docs/plan/08-frontend-tasks.md` 가 머리말(:3)과 F1 체크리스트(:53)에서
"05 문서의 예시 JSON을 `src/mocks/`에 넣어라" 라고 **두 번** 지시하고 있었다. FE 가 내일 읽는 문서는 08 이라
여기를 안 고치면 05만 고쳐도 이 픽스가 실제로는 안 먹는다. 둘 다 `sync-mocks.sh` 로 바꾸고, 스크립트가
못 만드는 mock(`cards`·`kpi`·`widget`·`simulate` — DDB/파생값)은 05 예시의 **구조**만 보라고 구분해 적었다.

> **판단 1개:** 생성된 mock 자체는 **커밋하지 않았다.** 커밋하면 `data/processed/` 와 사본이 두 벌이
> 되어 이번에 없애려던 드리프트가 그대로 재발한다(브리프의 커밋 예시에도 mock data 커밋이 없다).
> FE 는 clone 후 `./scripts/sync-mocks.sh` 한 번을 실행해야 한다 — 05 문서 두 곳에 적어 두었다.

## Important 3 — `CARDS_TABLE` 빈 값 방어

```
$ CARDS_TABLE="" python -c "... from app import db; import seed_demo"
CARDS_TABLE env repr: ''
db._table.name -> sangseng-cards
seed_demo.TABLE_NAME -> sangseng-cards
```

지적된 2곳 외에 **`backend/local_init.py:8` 이 같은 결함의 세 번째 사본**이라 함께 고쳤다(T7 로컬 경로).
또 `docs/plan/07 B2`·`14 T7/T9` 의 코드 스니펫이 옛 `os.environ.get("CARDS_TABLE", ...)` 형태로 남아
있어, 스니펫을 그대로 옮기면 방금 고친 결함이 되살아난다 — 셋 다 `or` 형태로 갱신했다.
`.env.example` 에도 "비워 두면 `sangseng-cards` 로 폴백" 한 줄을 달았다.

## Minor

4. **위젯 LLM 지연** — `generate_json(..., attempts: int = 2)` 추가, `for _ in range(attempts)`.
   위젯 blurb 호출만 `attempts=1` → 최악 `timeout 5s × 1` = **5초**(기존 10초).
   **다른 호출부 동작 불변 확인 (코드):** `attempts=1` 은 `widget.py:71` 한 곳뿐이고,
   `cardgen.py:181`·`cardgen.py:260`·`cards.py:151` 은 인자를 넘기지 않아 기본값 2 를 쓴다.
   스모크에도 대조를 박았다 — 카드 생성 `attempts == [2]`, 시뮬레이션 `[2]`, 위젯 `[1, 1]`.
   blurb 은 실패해도 규칙 기반 fallback 이 있는 부가 정보라 재시도보다 지연 상한이 낫다는 판단.
5. **고정 문구** — 05:115 `(가정 기반 전망, 실제와 다를 수 있음)` → `(가정 기반 전망이며 실제와 다를 수 있음)`.
   레포 전체를 `가정 기반 전망` 으로 grep 해, **출력 문자열로 박히는 자리**에서는 이 1건이
   유일한 변형이었음을 확인했다(나머지 히트는 "배지"·"문구 고정" 같은 규칙 서술문).
6. **stale 3건** — 14:246 시드 서사(고한 편의점/사북 카페 → 영월군 카페/영월군 소매점),
   14:270 `httpx` → `httpx2`(+ 이유 1줄), `run_all.py:3`("스크립트가 생기는 대로" → P1~P8 등록 완료·
   api_cache 재사용 설명).
7. **시드 순위 가드** — `assert_ranking_matches_pipeline()` 이 `demo_cards()` 첫 줄에서 돈다.
   하드코딩 `ORIGINAL_RANKING` 을 `candidates.json` 의 (순위, `eup category`, score) 와 대조하고,
   **상호명도 함께 본다** — 카드 A·B 비교문에 `문갤러리`·`강원선바위협동조합`·`동빈네민박&캠핑장` 이
   직접 박혀 있어 점수가 같아도 대표 상가만 바뀌면 문구가 조용히 거짓이 되기 때문이다
   (05 §2 계약 형태를 지키려고 상호명은 `ORIGINAL_CANDIDATE_NAMES` 별도 상수로 뺐다).
   동적 조립은 하지 않았다. 스모크가 매 테스트 시드마다 이 가드를 지나간다.
   **검증:** 현행 통과 + `ORIGINAL_RANKING[0]["score"]` 를 흔들면 `SystemExit`(하드코딩·실산출 양쪽 출력).

## 전체 검증

```
$ docker compose up -d dynamodb
$ cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q
........................                                                 [100%]
24 passed in 0.54s
```

- 스모크 **24건 전건 통과** (경고 0건), 테스트 수 불변 — 기존 테스트에 단언만 3줄 추가
- `merchants.json` **바이트 동일** 증명 완료 (위 표)
- `.env` 는 복사해 쓰고 삭제, 복원한 `geocode.json`(커밋 금지 대상)도 삭제, `git status` 클린

## 컨트롤러가 알아야 할 것

1. **FE 인계 한 줄** — mock 은 레포에 없다. `./scripts/sync-mocks.sh` 실행이 F1 선행 작업이다.
2. **Public 전환 전 최종 확인** — 이번엔 지적된 `merchants_raw.json` 만 처리했다. 커밋된 다른 원본
   (`stores_*.json`, `visitors.json`, `data/raw/` CSV)은 검토 범위 밖이었으므로, 제출 직전 12 문서
   §4 기준으로 한 번 더 훑는 것을 권한다.
3. **히스토리에는 남아 있다** — 지시대로 rewrite 하지 않았으므로 이전 커밋에는 전화번호·사업자번호가
   그대로 있다. Public 전환 시 "현재 트리는 깨끗하나 히스토리에는 있음" 이 사실이다.
