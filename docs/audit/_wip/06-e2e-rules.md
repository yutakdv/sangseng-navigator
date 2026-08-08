# 06 — E2E 5대 플로우 · 절대 규칙 매트릭스 · 테스트 갭 (§11~§13)

Phase 3 체크포인트 · 2026-08-08. 정적 추적 기준(스택 미기동 — 05 참조).

---

## A. E2E 플로우 A~E (11 문서 데모 대본 대조)

### A. 진단 → 대시보드 — **끊긴 지점 없음**
```
/dashboard (서버 컴포넌트, dashboard/page.tsx:57-64)
 → api.dashboard/kpi/candidates/riskSignal/usageMonthly/usageDaily  (6 병렬)
 → GET /api/dashboard(routes/dashboard.py:9) · /api/kpi(kpi.py:50)
   · /api/candidates(dashboard.py:17) · /api/risk-signal(dashboard.py:34)
   [usageMonthly/usageDaily는 BE 없이 정적 import — api.ts:127,131, 05 §6:584 계약]
 → dataload.load → data/processed/*.json
 → DashboardOverview · QuarterDiagnostics · RegionStatusGrid · CategoryShareBars · charts/*
```
가드 없음 → DEMO_READ_ONLY 무관하게 동작. **규칙 1·2·6 화면 검증 통과**(§B).

### B. AI 카드 생성 (EXPANSION) — **코드상 완결, 배포 기본값에서 차단**
```
GenerateCardButton:47 → generateAction(actions.ts:118)
 → [isDemoReadOnly 가드 :121]
 → api.generate(api.ts:150) → POST /api/cards/generate
 → security.require_mutation_access ← ⚠ DEMO_READ_ONLY=true면 403
 → cardgen.generate_card → _available → target=available[0]
 → llm.generate_json(12s×2) ─실패→ _fallback_ai + explanation_source="rule_fallback"
 → _grounded_ai (정본 재생성) → db.next_card_id(원자 counter) → db.create_card
 → 201 신규 / 200 중복 → api.ts:159 created 판정 → revalidatePath("/", "layout")
```
규칙 5: `ai.original_ranking` 항상 저장(cardgen.py:451). 규칙 3: `_ensure_assumption`(:326).

### C. 담당자 승인 (INCENTIVE, rate 3|5|7) — **코드상 완결, 동일 차단**
```
DecisionActions:67 / proposals/DecisionBar:48 → decideAction(actions.ts:53)
 → [isDemoReadOnly :58] → POST /api/cards/{id}/decision (Bearer)
 → require_mutation_access → 404→400(decision)→409(status)→400(rate) 순 (cards.py:108-118)
 → db.decide_card 조건부 업데이트(#status = :pending) → ConcurrentUpdate시 409
 → 실패는 ActionResult{ok:false,detail}로 반환 → DecisionActions:70 setError
 → :111 role="alert" 인라인 안내 (에러 화면으로 떨어지지 않음) ✅
```

### D. 트래킹 + 진행 기록 — **코드상 완결, 쓰기는 동일 차단**
```
/tracking:89-91 → api.dashboard + api.cards({status:"approved"}) + api.kpi
        :67     → api.progressReport  [require_internal_access 🔒]
                  ├ 400 → 기본 90일 1회 재시도 (tracking:70-79)
                  └ 401 → report=null, 업무 목록은 유지 + 안내 배너 (tracking:80-84) ✅
        :129    → api.progressRecords(card.id)  [🔒]
ProgressRecordForm:262 → createProgressRecordAction → POST progress-records
 → progress_records.record_progress (멱등 지문 + 전이 검증)
 → progress_db.write_record_and_project_card = TransactWriteItems (원자적)
 → ProgressRecordTimeline · ProgressReportDashboard
```
데모 6단계(적격성 5항목 → 적격성 확인 → 가맹 심사 → 추진중 → 완료)는
`workflow.can_set_progress`(:83-125) 순차 전이 + `VERIFICATION_REQUIRED_PROGRESS`(:30) 게이트와 정합.

### E. 방문객 위젯 (루프 폐합) — **끊긴 지점 없음**
```
/widget:63 → api.widget(region,category,limit) → GET /api/widget/recommend  [가드 없음]
 → routes/widget.py:87 db.list_cards() → _new_targets (progress=완료 EXPANSION의 읍×업종)
 → merchants.json 병합 → badge="이번 분기 확충 업종" + payback(완료 INCENTIVE의 selected_rate)
 → KakaoMapView (키 없으면 status="fallback", KakaoMapView.tsx:52,160-165) ✅
```
시드 AC-003(삼척시 편의점 `완료`)이 있어 **D를 밟기 전에도 배지가 보인다**(11 문서 사전 상태 ④와 일치).

### 결론
**5개 플로우 모두 코드 경로가 끊기지 않는다.** 단 B·C·D의 쓰기 구간은
`DEMO_READ_ONLY=true`에서 403으로 막히며, 이는 SAM 기본값이다(§C-1).

---

## B. 절대 규칙 6개 준수 매트릭스

| # | 규칙 | 검증 방법 | 근거 | 판정 |
|---|---|---|---|---|
| 1 | Gini/HHI/지니 UI 비노출 | `npm run check:banned` **실행** | 통과 (05-exec-log §10). 스캔 대상 `frontend/src/**/*.{ts,tsx}`, 주석·import 제외 후 문자열/JSX만 | **준수** |
| 2 | 전환율 화면에 `근사 지표` 배지 병기 | ProxyBadge 렌더 지점 전수 | `dashboard/page.tsx:155,247`, `DashboardOverview:157`, `QuarterDiagnostics:43`, `cards/[id]:107`, `incentive:59`, `proposals/EvidenceSections:114`, `PaybackImpactPanel:53`, `ProgressReportDashboard:321,400`, `ProgressRecordForm:526`, `ProgressRecordTimeline:141` — **전환율 렌더 지점 11곳 전부** | **준수** |
| 3 | 시뮬레이션 출력에 가정 기반 전망 문구 | BE 삽입 + FE 배지 | BE: `cardgen._ensure_assumption:343-348`(EXPANSION), `cards.py:17,285`(simulate), `cardgen.py:557`(INCENTIVE). FE: `AssumptionBadge`/`AssumptionNote` 14곳(`SimulateButton:74,134`, `cards/[id]:390,396,554,569,617`, `incentive:160,189,198`, `ScenarioTable:152`, `ScenarioLadder:53`, `PaybackImpactPanel:120`, `ProposalSummary:160,173`, `EvidenceSections:125,129`, `DashboardOverview:220`) | **준수** |
| 4 | AI는 제안만 · "실행" 표현 금지 | 상태 기계 + 금칙어 | 생성 카드는 항상 `status="pending"`(cardgen.py:429,531); 확정은 `POST /decision`만. `실행하겠습니다` 금칙어 통과. 폴백 정직 표기 3중(§03-A) | **준수** |
| 5 | AI 조정 시 원 Score 순위 병기 | 저장 + 렌더 | 저장 `cardgen.py:451-453`(INCENTIVE만 null, 계약대로). 렌더 `OriginalRankingTable`←`cards/[id]:402-411`, `RankTrace`←`cards/[id]:210`·`tracking:392`·`ProposalSummary:134`, 목록 `tracking:479-485` | **준수** |
| 6 | 국세청 = 진단 참고용, 처방은 가맹점 확충 고정 | 화면 표기 + AI 입력 | 화면 `dashboard/page.tsx:650-676`: 제목 "운영 2년 미만 사업자 비중", desc "지역 간 비교나 순위 근거로는 쓰지 않는다", **막대·순위 없이 수치 나열**, 요약문 "사실상 같은 수준". `'위험'` 문자열은 주석에만 존재(전수 grep). AI 입력 ⑦은 `prompts.py:27-28`이 "이를 근거로 가맹점 확충 외의 실행을 제안하지 말 것" 명시 | **준수** |

**6개 전부 준수.** 규칙 1·4는 실행 검증(자동), 2·3·5·6은 정적 전수 추적.

---

## C. 발견된 결함 (근거 요약)

### C-1. `POST /simulate`가 계약에 없는 DEMO_READ_ONLY 차단 대상
- 05 §8:620은 차단 대상을 **generate/decision/verification/progress** 4개로 한정. simulate 없음.
- `routes/cards.py:190`은 `require_mutation_access` → `security.py:45-49` 403.
- `actions.ts:132` `simulateAction`만 `isDemoReadOnly` 가드 **없음**(나머지 5개는 있음).
- `SimulateButton.tsx` 전체에 `isDemoReadOnly` 참조 없음 → 버튼 항상 활성.
- 결과: 읽기 전용 모드에서 "이 후보가 가맹 전환하면?" 클릭 →
  `SimulateButton.tsx:59-66` 빨간 alert에 **"공개 데모는 읽기 전용입니다. 상태 변경은…"** 노출.
  simulate는 상태를 바꾸지 않는 계산인데 "상태 변경" 문구가 뜬다.

### C-2. 배포 기본값이 데모 대본 전체를 막는다
- SAM `template.yaml:14-17` `DemoReadOnly Default: 'true'`.
- `deploy-backend.sh:17`은 `DEMO_READ_ONLY`가 **비어 있지 않을 때만** 파라미터 전달.
- 로컬 `.env`에 `DEMO_READ_ONLY` **키 자체가 없다** → 기본값 `true` 적용.
- 09 문서 :122-123은 이 fail-safe를 의도로 설명하나,
  09 문서 :144는 FE `NEXT_PUBLIC_DEMO_READ_ONLY = false`("심사위원이 직접 승인해 보게 하려면")를 지시.
- → 두 지시를 문자 그대로 따르면 **FE 버튼은 열리고 BE는 403**. 데모 2-b·5·6 전부 실패.
- 추가로 `.env`에 `MUTATION_API_TOKEN`도 없다 → `deploy-backend.sh:13` 미전달 →
  SAM Default `''` → `security.py:19-23` **503**. (403이 먼저라 503은 가려진다.)

### C-3. Docker에서 `NEXT_PUBLIC_DEMO_READ_ONLY`가 전달 불가
- `docker-compose.yml:61-77` frontend 서비스에 미설정, `env_file` 없음(의도 — `:75` OPENAI 키 차단).
- `next.config.mjs:19` `fromRootEnv`가 `new URL("../.env", import.meta.url)`를 읽는데,
  컨테이너에는 `./frontend`만 마운트(`:79`)되어 `/​.env`로 풀리고 없음 → `:20-22` catch → `{}`.
- → Docker 모드에서 `lib/runtime.ts:11` `isDemoReadOnly`는 **항상 false**.
  루트 `.env`에 `DEMO_READ_ONLY=true`를 넣으면 BE만 잠기고 FE 버튼은 전부 열린다.

### C-4. mock 모드 ↔ BE 로직 드리프트 (데모에서 다른 이야기)
가장 영향이 큰 5건 (전체 표는 서브에이전트 원본):

| # | 항목 | mock | BE | 데모 영향 |
|---|---|---|---|---|
| 1 | **순차 전이 규칙** | `can_set_progress` **전부 없음** — 목록에 있는 상태면 무조건 허용(store.ts:207-209) | workflow.py:83-125 순차·보류복귀·완료불가역 | mock에서는 `후보 접촉·검토 시작 → 완료` 건너뛰기가 **성공**. 데모 6단계의 "건너뛰기 불가" 설명과 정반대 |
| 2 | **generate 재클릭** | 가용 후보 없으면 무조건 409(store.ts:397) | pending EXPANSION 있으면 **200 + 기존 카드**(cardgen.py:400-411) | 2-b에서 두 번 누르면 mock은 에러, 실 API는 정상 |
| 3 | **카드 목록 정렬** | 정렬 없음(seed 순 + 신규는 앞에) | `created_at` 내림차순(cards.py:70) | 허브 카드 순서가 모드마다 다름 → 대본 "② 영월 소매점 카드" 위치 상이 |
| 4 | INCENTIVE 생성 출처 | 시드 복사 → `explanation_source="rule_seed"` | `mock_rule`이어야 함(05 §2:287) | 칩은 둘 다 "사전 검증 예시 문구"라 화면 영향은 없으나 계약 불일치 |
| 5 | 검증 누락 다수 | decision 값·selected_rate 범위·적격성 라벨/상태/중복·recorded_at 3종·완료 pct=100 **전부 미검증** | 전부 400/409 | mock 모드에서 계약 위반 입력이 저장됨 |

부수: Pydantic 검증 계열은 BE **422** vs mock **400** (상태코드 불일치, 다수).

### C-5. `explanation_source: "mock_rule"` 칩 매핑이 계약과 불일치
- 05 §2:287 표: `mock_rule` → 화면 칩 **"규칙 기반 설명(AI 응답 없음)"**
- `lib/aiSource.ts:46`: `if (source === "rule_seed" || source === "mock_rule") return "rule_reference"`
  → 칩 **"사전 검증 예시 문구"**
- 둘 다 "AI 아님"을 밝히므로 정직성 위반은 아니나, 문서와 코드가 다른 칩을 지정한다.

### C-6. 타입 non-nullable ↔ 파이프라인 null 가능
- `types/index.ts:42` `growth: {mom_pct: number; qoq_pp: number}` vs `p5_metrics.py:123,130`이 `None` 가능.
- `types/index.ts:113-117` `Candidate.source_category` non-nullable vs `p6_scoring.py:251,366` `None` 가능.
- 현재 데이터는 둘 다 non-null이라 **잠재 결함**.

### C-7. `usage_monthly`가 health 판정에서 빠져 있다
`main.py:33` REQUIRED = dashboard·eup_scores·candidates·merchants.
그러나 `routes/cards.py:201`(simulate)이 `usage_monthly`를 읽는다.
→ `/api/health`가 `ok:true`인데 `POST /simulate`만 503이 되는 구멍(라우트가 잡아 503으로 변환하므로 500은 아님).

### C-8. 05 계약 문서의 코드 미반영 6건 (문서가 오류)
`operations` 필드명 2개 / `checks[].key` 영문 예시 / verification body의 `key`·`note` /
KPI `avg_decision_hours`·`counts.decided` 누락 / simulate `expected_monthly_range`·`uncertainty_method` 누락 /
`sensitivity.json` 예시값(`combos:25, top3_stable_ratio:0.88` ↔ 실제 `95, 0.1579`).

---

## D. 테스트 커버리지 갭 (§11)

### 엔드포인트 × 테스트 (총 63개 중 56개는 DynamoDB Local 필요)
| 파일 | 개수 | 대상 | 실행됨? |
|---|---|---|---|
| `backend/tests/test_smoke.py` | 50 | 엔드포인트 대부분 + LLM 스텁(`FakeLLM`, `_FakeOpenAI`) + 키 마스킹 회귀(:1020-1044) | ❌ 미실행 |
| `backend/tests/test_progress_report.py` | 6 | `progress_report` + TransactWrite | ❌ 미실행 |
| `backend/tests/test_algorithms.py` | 3 | `simulate` 계산식 | ✅ 3 passed |
| `pipeline/tests/test_algorithms.py` | 4 | 파이프라인 계산식 | ✅ 4 passed |

- **FE 테스트 0개** — 8개 라우트·6개 Server Action·68개 컴포넌트 전부 무테스트. 확인됨.
- LLM은 실제로 호출하지 않는다(`FakeLLM` monkeypatch, test_smoke.py:104-131) → 비용·불안정 없음. ✅
- `pipeline/tests/`는 **어떤 pytest 설정에도 잡히지 않는다** — `backend/pytest.ini`가 유일한 설정이고
  `testpaths = tests`(backend 기준). `pipeline/requirements.txt`에 pytest 없음.
- `.github/` 없음 → **lint·타입체크·테스트·금칙어 전부 수동.**

### 절대 규칙 회귀 방지 3축
| 규칙 | 자동 회귀 검사 |
|---|---|
| 1 (용어) | ✅ `check-banned-words.mjs` |
| 4 (실행 표현 일부) | ✅ 같은 스크립트의 `실행하겠습니다` |
| **2 (근사 지표 배지)** | ❌ 없음 |
| **3 (가정 기반 전망)** | △ BE만 — test_smoke가 계약 문구를 하드코딩 검증(:13-14 주석). FE 렌더 검사 없음 |
| **5 (원 순위 병기)** | ❌ 없음 |
| **6 (국세청 참고용)** | ❌ 없음 |

또한 `check-banned-words.mjs:30`은 **`frontend/src`만** 스캔한다 —
BE가 생성한 카드 문구(LLM narrative)가 화면에 렌더되는 경로는 검사 범위 밖이다.
LLM이 "지니계수" 같은 말을 쓰면 이 가드가 잡지 못한다(프롬프트에 금지 지시는 없음).
