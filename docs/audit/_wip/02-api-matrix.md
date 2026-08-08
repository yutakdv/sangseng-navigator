# 02 — API 4자 대조 (BE 라우트 ↔ FE api.ts ↔ 05 계약 ↔ types/index.ts)

Phase 1 체크포인트 · 2026-08-08. 근거 인용만, 판정은 최종 보고서.

---

## A. 연결 매트릭스 (16 엔드포인트)

| # | Method / Path | BE 정의 | FE 호출부 | 가드 | 05 문서 | types |
|---|---|---|---|---|---|---|
| 1 | GET `/api/health` | `main.py:63` | **없음** (운영 진단용) | 없음 | §5 O | — |
| 2 | GET `/api/dashboard` | `routes/dashboard.py:9` | `api.dashboard` ← 8개 page | 없음 | §1 O | `Dashboard` |
| 3 | GET `/api/candidates` | `routes/dashboard.py:17` | `api.candidates` ← 4개 page | 없음 | §1 O | `CandidatesResponse` |
| 4 | GET `/api/risk-signal` | `routes/dashboard.py:34` | `api.riskSignal` ← dashboard | 없음 | §1 O | `RiskSignal[]` |
| 5 | GET `/api/cards` | `routes/cards.py:61` | `api.cards` ← 5개 page | 없음 | §2 O | `{cards: Card[]}` |
| 6 | POST `/api/cards/generate` | `routes/cards.py:74` | `api.generate` ← `generateAction` ← `GenerateCardButton` | mutation | §2 O | `{card, created}` |
| 7 | GET `/api/cards/{cid}` | `routes/cards.py:95` | `api.card` ← `cards/[id]:63`, `proposals/[id]:43` | 없음 | §2 O | `{card}` |
| 8 | POST `/api/cards/{cid}/decision` | `routes/cards.py:100` | `api.decide` ← `decideAction` ← `DecisionActions`,`DecisionBar` | mutation | §2 O | `{card}` |
| 9 | POST `/api/cards/{cid}/simulate` | `routes/cards.py:187` | `api.simulate` ← `simulateAction` ← `SimulateButton` | **mutation ⚠** | §2 O (가드 미기재) | `{simulation}` |
| 10 | POST `/api/cards/{cid}/progress` | `routes/cards.py:289` | `api.progress` ← `progressAction` ← `ProgressSelect` | mutation | §2 O | `{card}` |
| 11 | POST `/api/cards/{cid}/verification` | `routes/cards.py:324` | `api.verification` ← `verificationAction` ← `CandidateVerification` | mutation | §2 O | `{card}` |
| 12 | POST `/api/cards/{cid}/progress-records` | `routes/progress.py:104` | `api.createProgressRecord` ← `createProgressRecordAction` ← `ProgressRecordForm` | mutation | §2 O | `CreateProgressRecordResponse` |
| 13 | GET `/api/cards/{cid}/progress-records` | `routes/progress.py:131` | `api.progressRecords` ← `cards/[id]:70`, `tracking:129` | **internal 🔒** | §2 O (🔒 명시) | `ProgressRecordsResponse` |
| 14 | GET `/api/progress-report` | `routes/progress.py:150` | `api.progressReport` ← `tracking:67,76` | **internal 🔒** | §2 O (🔒 명시) | `ProgressReport` |
| 15 | GET `/api/widget/recommend` | `routes/widget.py:80` | `api.widget` ← `widget:63` | 없음 | §4 O | `WidgetResponse` |
| 16 | GET `/api/kpi` | `routes/kpi.py:50` | `api.kpi` ← 3개 page | 없음 | §3 O | `Kpi` |

**FE가 호출하지만 존재하지 않는 API: 0건.**
**BE에 있으나 FE가 호출하지 않는 것: `/api/health` 1건** (의도됨 — 배포 후 data 복사 진단용, 05 §5).
**BE 엔드포인트 없이 FE 정적 import: `usageMonthly`·`usageDaily` 2건** (05 §6:584-592가 명시적으로 계약).

---

## B. 4자 불일치 상세 (BE / FE / 05 / types)

### B-1. `Card.operations` 필드명 — 05 문서가 틀림

| 출처 | 필드명 |
|---|---|
| BE `services/cardgen.py:464-471` | `owner, target_date, **expected_cost**, contact_result, **ineligible_reason**, actual_outcome` |
| types `types/index.ts:177-184` (`CardOperations`) | `owner, target_date, **expected_cost**, contact_result, **ineligible_reason**, actual_outcome` |
| **05 문서 `05-api-contract.md:201-208`** | `owner, target_date, **estimated_cost**, contact_result, **ineligibility_reason**, actual_outcome` |

→ 코드 2곳(BE·FE)이 일치, 문서 1곳만 다르다. **문서가 오류.**

### B-2. `candidate_verification.checks[].key` — 05 문서 예시가 낡음

| 출처 | key 값 |
|---|---|
| BE `services/workflow.py:56-59` `normalize_checks` | `{"key": label, "label": label, ...}` — label은 **한글**(`workflow.py:8-14`: 영업 상태·가맹 자격·사업자 참여 의향·관광객 이용 적합성·정산 연동 가능성) |
| BE `routes/cards.py:351` | `{"key": check.label, "label": check.label, "status": ...}` — 동일 |
| FE `lib/cardWorkflow.ts:41-45` `normalizeEligibility` | `{key: label, label, status}` — 동일하게 한글 |
| **05 문서 `:193-197`** | `{"key": "business_status", "label": "영업 상태", ...}` — **영문 key** |

→ 코드 3곳 일치(한글 key), 문서만 영문. **문서가 오류.**

### B-3. `POST /verification` 요청 body — 05 문서가 두 군데 틀림

- **05 문서 `:342`**: `{"checks": [{"key": "business_status", "status": "verified"}, ...], "note": "..."}`
- **BE `routes/cards.py:36-42`**:
  ```python
  class EligibilityCheckBody(BaseModel):
      label: str      # ← key가 아니라 label
      status: str
  class VerificationBody(BaseModel):
      checks: list[EligibilityCheckBody]      # ← note 필드 없음
  ```
  `routes/cards.py:344` `if check.label not in workflow.REQUIRED_ELIGIBILITY_CHECKS` — **label로 검증**.
- **FE `lib/api.ts:182-183`**: `post(..., { checks }, ...)` — `note` 미전송. checks 항목은 `{key,label,status}` 3필드.
- BE `EligibilityCheckBody`에 `model_config = ConfigDict(extra="forbid")` 없음 → FE가 보내는 여분의 `key`는 조용히 무시된다 → **실동작은 정상.**

→ 문서의 `key` 사용과 `note` 필드 둘 다 코드에 없다. **문서가 오류.**
(참고: `ProgressRecordBody`·`ProgressMetrics`는 `extra="forbid"` 있음 — `routes/progress.py:18,28`)

### B-4. `GET /api/kpi` — BE가 문서에 없는 필드 반환

- **05 문서 `:487-494`**: `adoption_rate, execution_rate, avg_approval_hours, regional_balance_index, counts{total,pending,approved,rejected,held,done}`
- **BE `routes/kpi.py:61-77`**: 위 + **`avg_decision_hours`** + counts에 **`decided`**
  ```python
  "avg_decision_hours": round(sum(hours) / len(hours), 1) if hours else None,
  "avg_approval_hours": round(sum(hours) / len(hours), 1) if hours else None,
  ```
  두 값은 **동일 계산식** — 같은 `hours` 리스트.
- **types `:399-415`**: 둘 다 있고 `avg_approval_hours`에 "구형 화면·응답 호환 별칭" 주석. `counts.decided` 있음.

→ 코드 2곳 일치, 문서만 누락. **문서가 불완전** (별칭 관계는 types 주석에만 존재).

### B-5. `POST /simulate` 응답 — BE가 문서에 없는 필드 2개 반환

- **05 문서 `:356-370`** 필드 11개.
- **BE `routes/cards.py:272-286`**: 위 + **`expected_monthly_range`** + **`uncertainty_method`**
- **types `:383-385`**: 둘 다 `?` optional로 존재.
- FE 실사용: `SimulateButton.tsx` — `expected_monthly_range`로 "관측 분위수 범위" 표시, `uncertainty_method`를 각주에 렌더.

→ **문서만 불완전.** 코드·타입·화면은 정합.

### B-6. `POST /progress` 응답 — 문서는 1키, 코드는 3키

- **05 문서 `:343`**: `{"card": Card}`
- **BE `routes/cards.py:321`**: `return {"card": updated, "record": record, "created": created}`
- **FE `lib/api.ts:170-171`**: `post<{card: Card}>` — 여분 키는 타입상 무시.

→ 동작 문제 없음. 문서 불완전.

---

## C. ⚠ 가드 불일치 — `POST /simulate` (동작에 영향)

이것만은 문서 오타가 아니라 **코드가 계약을 어긴다.**

1. **05 문서 §8 `:620`**: 
   > 공개 데모 mutation | `DEMO_READ_ONLY=true`이면 **generate/decision/verification/progress**를 `403`으로 차단한다

   → `simulate`는 차단 대상 목록에 **없다.**

2. **BE `routes/cards.py:187-191`**:
   ```python
   @router.post("/cards/{cid}/simulate")
   def simulate_card(cid: str, _authorized: None = Depends(security.require_mutation_access)):
   ```
   `security.py:44-50` `require_mutation_access` → `if demo_read_only(): raise HTTPException(403, ...)`

3. **SAM 기본값 `infra/template.yaml:14-17`**: `DemoReadOnly: Default: 'true'`
   → **배포 기본 상태에서 simulate는 항상 403.**

4. **FE `app/actions.ts:132-139` `simulateAction`**: `isDemoReadOnly` 조기 반환 **없음**
   (나머지 5개 액션은 전부 있음 — `:58,:73,:88,:103,:121`)

5. **FE `components/SimulateButton.tsx`**: `isDemoReadOnly` 참조 없음 →
   버튼이 항상 활성. 실패 시 `:59-66`의 `role="alert"` 빨간 박스에
   BE 문구 "공개 데모는 읽기 전용입니다. 상태 변경은 운영 인증이 연결된 환경에서만 허용됩니다" 노출.

**재현 경로**: 배포(SAM 기본) 또는 `DEMO_READ_ONLY=true` → `/cards/{id}` → "이 후보가 가맹 전환하면?" 클릭 → 에러 박스.
simulate는 상태를 바꾸지 않는 계산인데 "상태 변경" 문구가 뜬다.

---

## D. `NEXT_PUBLIC_DEMO_READ_ONLY` vs `DEMO_READ_ONLY` 분기 (§4-5)

서브에이전트 실측 (`docker-compose.yml`, `frontend/next.config.mjs`):

| 값 | BE 전달 경로 | FE 전달 경로 |
|---|---|---|
| `DEMO_READ_ONLY` | `backend` 서비스 `env_file: .env` (compose `:43`) → `security.py:14` | — |
| `NEXT_PUBLIC_DEMO_READ_ONLY` | — | **없음.** `frontend` 서비스에 미설정(compose `:61-77`), `env_file`도 없음 |

`frontend/next.config.mjs:45`가 3개 키를 root `.env`에서 승계하도록 허용하지만
(`NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_KAKAO_MAP_KEY`, `NEXT_PUBLIC_DEMO_READ_ONLY`),
`next.config.mjs:19`의 `fromRootEnv`는 `new URL("../.env", import.meta.url)`로 읽는다.
Docker에서는 `./frontend`만 마운트되므로(compose `:79`) 그 경로가 `/.env`로 풀려 존재하지 않고
`:20-22` catch가 `{}`를 반환한다.

→ **Docker 모드에서 `NEXT_PUBLIC_DEMO_READ_ONLY`는 어떤 경로로도 값이 들어가지 않는다**
(`lib/runtime.ts:11`은 항상 `false`).
루트 `.env`에 `DEMO_READ_ONLY=true`를 넣으면 **BE만 잠기고 FE 버튼은 전부 열린 채**
클릭 시 403이 뜬다 — §4-5가 묻는 "버튼은 눌리는데 403" 시나리오가 Docker 모드에서 성립.

배포(Vercel+SAM)에서는 두 값을 각각 수동 설정하므로 갈릴 수 있고, 갈림을 막는 장치는 없다.

---

## E. 그 외 환경변수 전달 갭 (서브에이전트 실측 요약)

| 키 | 읽는 곳 | SAM 전달 | 결과 |
|---|---|---|---|
| `OPENAI_MODEL` | `llm.py:45` (기본 `gpt-4o-mini`) | **없음** | 배포 Lambda는 항상 기본 모델 |
| `ANTHROPIC_MODEL` | `llm.py:44` (기본 `claude-sonnet-5`) | **없음** | 배포 Lambda는 항상 기본 모델 |
| `NEXT_PUBLIC_OPERATOR_NAME` | `lib/operator.ts:19` | — | `next.config.mjs:45` 허용목록에 없고 compose도 미설정 → root `.env` 값이 절대 도달 못 함 |
| `NEXT_PUBLIC_OPERATOR_TEAM` | `lib/operator.ts:23` | — | 동일 |
| `LOG_LEVEL` | `main.py:26` | 없음 | `.env.example`에도 없음 (문서 갭) |
| `DYNAMO_ENDPOINT` | `db.py:13`, `progress_db.py:29`, seed/tests | compose가 설정 | `.env.example`에 **없음** (문서 갭) |

SAM Lambda 환경변수는 8개뿐 (`template.yaml:47-55`):
`CARDS_TABLE, PROGRESS_RECORDS_TABLE, LLM_PROVIDER, OPENAI_API_KEY, ANTHROPIC_API_KEY,
MUTATION_API_TOKEN, ALLOWED_ORIGINS, DEMO_READ_ONLY`
