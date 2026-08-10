# 20. 전체 코드베이스 종합 점검 프롬프트 (상생 나침반 전용)

> 이 문서는 **읽는 문서가 아니라 붙여넣는 프롬프트**다. 아래 `---` 사이 전체를 Claude Code 세션에
> 그대로 붙여넣으면, 이 레포의 실제 구조·계약·심사 규칙을 기준으로 전수 점검이 수행된다.
>
### 실행 가이드

**모델·effort**: **Opus 5 + `xhigh` + 1M 컨텍스트**를 기본으로 한다.
이 감사의 실패 모드는 "잘못 추론한다"가 아니라 **"누락한다 / 근거 없이 단정한다"** 이고,
핵심 작업이 FE 호출부 ↔ BE 라우트 ↔ 05 문서 ↔ `types/index.ts` **4자 대조**라 컨텍스트 용량이 곧 정확도다.
([README.md](README.md) 모델·effort 매핑표가 Fable xhigh에 배정한 것은 *구축* 작업 — 감사는 성격이 다르다.)

단, 아래 세 곳은 판정이 갈리면 **Fable 5 + xhigh 로 2차 패스**를 돌리는 편이 낫다 (매핑표와 겹치는 영역):
`pipeline/p5_metrics.py`·`p6_scoring.py` 단계 분리 · `backend/app/services/simulate.py` 통계 타당성 ·
`mocks/store.ts` ↔ BE 로직 **동치성** 판정.

**한 번에 실행해도 되는가 — 된다. 단 조건이 있다.**
회차를 나누느냐가 아니라 **증거가 컨텍스트 압축에서 살아남느냐**가 관건이다.
Claude Code는 컨텍스트가 차면 자동 요약하는데, 요약은 `file:line` 인용을 가장 먼저 버린다.
그래서 이 프롬프트는 **각 Phase 종료 시 `docs/audit/_wip/` 에 중간 산출을 파일로 떨구는 것을 의무화**한다(§0-8, §18).
이 규약만 지키면 단일 실행이든 3회 분할이든 최종 보고서의 근거 밀도는 같다.

| 방식 | 언제 | 방법 |
|---|---|---|
| **단일 실행** (권장 기본) | 여유 있게 한 번에 돌릴 때 | 이 프롬프트 전체를 붙여넣는다. Phase마다 자동 체크포인트. |
| **3회 분할** | 세션을 끊어야 하거나 회차별로 검토하며 갈 때 | 붙여넣은 뒤 마지막에 `이번 세션은 Phase 1만 수행한다` 를 덧붙인다. |

**중단 후 재개**: `docs/plan/20-codebase-audit-prompt.md 를 읽고 docs/audit/_wip/ 의 기존 체크포인트를
이어받아 Phase N부터 계속한다` — 새 세션에 이 한 줄이면 된다.

**산출물**: 중간 `docs/audit/_wip/*.md` → 최종 `docs/audit/AUDIT-<YYYYMMDD>.md`

---

## 상생 나침반 — Codebase MCP 기반 전체 기능·구조 종합 점검

당신은 이 레포에 대해 **Senior Software Architect + Backend/AI Engineer + Frontend Engineer + QA Engineer + DevOps Engineer + Security Reviewer + 경진대회 심사 대응 검토자**의 역할을 동시에 수행한다.

목표는 코드 품질 리뷰가 아니다.

> **"구현되어 있다고 주장되는 모든 기능이, 실제 코드상 끊김 없이 연결되어 동작 가능한가"** 를
> 파이프라인 → 정적 JSON → FastAPI → DynamoDB/LLM → Next.js 화면까지 **End-to-End로 검증**하는 것이다.

추측 금지. 모든 판단에는 파일 경로·심볼명·엔드포인트를 근거로 제시한다.

---

### §0. 핵심 원칙 (위반 금지)

1. 일부 파일만 보고 전체를 판단하지 않는다.
2. **Codebase MCP를 1순위 탐색 수단으로 쓴다.** 이 레포는 이미 인덱싱되어 있다 —
   프로젝트명: `Users-yutak-Desktop-sangseng-navigator` (약 2,330 노드 / 4,721 엣지).
   - 시작: `get_architecture(project, aspects)` → 클러스터로 실제 모듈 경계 파악
   - 심볼: `search_graph(project, query="generate card")`, `name_pattern=".*progress.*"`, `label="Route"`
   - 호출 사슬: `trace_path(project, function_name, mode=calls|data_flow|cross_service)`
   - 정확한 소스: `get_code_snippet(project, qualified_name)`
   - 텍스트: `search_code(project, pattern)`
   - 인덱스가 낡았으면 `detect_changes` → 필요 시 `index_repository(mode="moderate")`
   - MCP 결과가 비어 있어도 **없다고 결론내지 말고** Grep/Glob으로 교차 확인한다 (Python/TS 혼합 레포라 일부 심볼은 그래프에 안 잡힐 수 있다).
3. `README.md`·`docs/plan/*`에 적혀 있다는 이유만으로 구현되었다고 판단하지 않는다.
   **오히려 반대다 — 이 레포는 문서가 매우 상세해서 "문서에는 있는데 코드에 없는" 격차가 주된 리스크다.**
4. 함수·컴포넌트가 존재한다는 이유만으로 동작한다고 판단하지 않는다. 호출부를 찾아라.
5. 확인 불가한 항목은 "정상"이 아니라 **검증 불가(NOT VERIFIED)** 로 분류한다.
6. **먼저 전체 분석을 끝낸다. 코드 수정부터 시작하지 않는다.** (수정은 사용자 승인 후 별도 단계)
7. 위험 작업 금지: `infra/scripts/deploy.sh` 실행(AWS 배포), `npx vercel --prod`,
   실제 LLM 유료 호출 반복, `data/processed/` 덮어쓰기(`pipeline/run_all.py`),
   `seed_demo.py --reset` 을 사용자 데모 중에 실행하는 것.
8. **체크포인트 의무 (가장 중요한 절차 규칙).**
   각 Phase를 끝낼 때마다 결과를 **즉시 `docs/audit/_wip/` 아래 파일로 쓴다** (§18의 표 참조).
   컨텍스트가 자동 요약되면 `file:line` 인용이 가장 먼저 소실되므로, 근거는 **머릿속이 아니라 디스크에** 둔다.
   - 파일에는 **판정 결론이 아니라 근거 원문**(경로·라인·심볼·명령 출력 발췌)을 남긴다.
   - 이미 `docs/audit/_wip/` 에 파일이 있으면 **먼저 읽고 이어서** 작업한다. 같은 영역을 다시 훑지 않는다.
   - 최종 보고서(§16)는 이 체크포인트 파일들만 근거로 조립한다. 기억에 의존해 쓰지 않는다.

---

### §1. 프로젝트 컨텍스트 (사전 지식 — 이걸 전제로 점검한다)

**한 줄 요약**: 강원랜드 담당자의 분기별 지역상생 의사결정 지원 AI 플랫폼.
진단(소비 집중도·지역 전환율) → 2단계 스코어링 → AI 조정 제안 → 담당자 승인(Action Card) →
상태 트래킹 → 방문객 위젯 반영. 공급 측(가맹점 확충 카드=EXPANSION) + 수요 측(페이백 인센티브 카드=INCENTIVE).

**단일 진실 원천(SSOT)**: [docs/plan/05-api-contract.md](05-api-contract.md).
코드와 문서가 다르면 **둘 중 무엇이 틀렸는지 판정**해서 보고한다 (자동으로 코드를 정답 취급하지 않는다).
관련 문서: 02(아키텍처), 07(BE/AI 태스크), 08(FE 태스크), 09(배포), 11(데모·QA), 12(제출 요건), 13(디자인 가이드), 14(실행 런북 T0~T18), 19(FE 잔여 이슈 기록).

**실제 레포 구조 (이미 확인된 사실 — 재확인은 하되 탐색 시간은 아껴라)**

```
sangseng-navigator/
├── frontend/          Next.js 16.3.0 (App Router) + React 18.3.1 + TS 5.9 + Tailwind 3.4
│                      + Recharts 2.15.4 + maplibre-gl 4.7.1 + Kakao Maps JS(스크립트 로드)
│                      배포: Vercel (정적 export 아님, 서버 컴포넌트 + Server Actions)
├── backend/           FastAPI + uvicorn (ECS Fargate) / Python 3.12
│   ├── app/main.py            진입점 · CORS · GZip · no-store 미들웨어 · /api/health · handler
│   ├── app/routes/            dashboard.py · cards.py · progress.py · widget.py · kpi.py
│   ├── app/services/          cardgen.py · simulate.py · workflow.py · progress_records.py
│   │                          · progress_report.py · season.py
│   ├── app/db.py              Cards 테이블 CRUD(조건부 업데이트·ConcurrentUpdate)
│   ├── app/progress_db.py     ProgressRecords 테이블 + GSI 2개 + 카드 투영(TransactWrite)
│   ├── app/dataload.py        정적 JSON 로딩 단일 창구 (컨테이너: app/data/, 로컬: ../../data/processed/)
│   ├── app/llm.py             generate_json(system,user,schema) — provider 분기 유일 지점
│   ├── app/prompts.py · security.py · clock.py
│   ├── seed_demo.py · local_init.py · Dockerfile · pytest.ini
│   └── tests/                 test_smoke.py(50) · test_algorithms.py(3) · test_progress_report.py(6)
├── pipeline/          p1_usage → p2_visitors → p3_merchants → p4_stores → p5_metrics
│                      → p6_scoring → p7_risk → p8_sensitivity, run_all.py, tests/(4)
├── data/raw/          공공데이터 원본 CSV (하이원포인트 사용현황 · 국세청 100대 생활업종 · 존속연수)
├── data/processed/    dashboard · eup_scores · candidates · merchants · usage_daily
│                      · usage_monthly · risk_signal · sensitivity (8개 JSON, 커밋됨)
├── infra/             config.sh · cloudformation/{foundation,service}.yaml · scripts/*.sh
├── scripts/           sync-mocks.sh   (data/processed → frontend/src/mocks 동기화)
├── docker-compose.yml dynamodb(8001:8000) · seed(one-shot) · backend(8000:8000)
│                      · frontend(${FRONTEND_PORT:-3100}:3000)
└── docs/plan/         01~19 계획 문서 (SSOT)
```

**심사 대응 절대 규칙 6개 (CLAUDE.md — 위반은 무조건 CRITICAL/HIGH)**

| # | 규칙 | 코드상 검증 지점 |
|---|---|---|
| 1 | UI에 `Gini`/`HHI`/`지니` 용어 노출 금지 → "지역 소비 집중도"/"업종별 소비 분산도" | `frontend/scripts/check-banned-words.mjs`, `npm run check:banned` |
| 2 | "지역 전환율" 표시 화면에 **항상** `근사 지표` 배지 병기 | 전환율을 렌더하는 모든 컴포넌트 |
| 3 | 모든 시뮬레이션 출력에 "가정 기반 전망(실제와 다를 수 있음)" 문구 고정 | `services/simulate.py`, `cardgen._ensure_assumption`, FE 시뮬레이션/시나리오 UI |
| 4 | AI는 제안만 — 담당자 승인 버튼을 거쳐야 확정. "실행" 대신 "의사결정 근거 제공" | `actions.ts:decideAction`, `routes/cards.py` decision, 금칙어 `실행하겠습니다` |
| 5 | AI가 순위를 조정해도 **원 Score 순위 항상 병기** (감사 가능성) | `OriginalRankingTable.tsx`, `RankTrace.tsx`, 카드 스키마의 원순위 필드 |
| 6 | 국세청 데이터는 **진단 참고용** — 처방 대상은 항상 하이원포인트 가맹점 확충 | `routes/dashboard.py:get_risk_signal`, `p7_risk.py`, 위험/순위 라벨 사용 여부 |

---

### §2. 실행 구조 검증

다음 3가지 실행 모드가 **각각** 성립하는지 확인한다.

| 모드 | 기동 | FE→BE 주소 | 데이터 원천 |
|---|---|---|---|
| A. Docker 통합 (개발 표준) | `docker compose up -d` | `NEXT_PUBLIC_API_BASE=http://backend:8000` | DynamoDB Local + `data/processed` 마운트 |
| B. FE mock 단독 | `FRONTEND_API_BASE= docker compose up` 또는 `cd frontend && npm run dev` | 빈 값 | `frontend/src/mocks/*.json` + `mocks/store.ts` |
| C. 배포 | Vercel(FE) + ECS Fargate/내부 ALB/HTTP API(BE) | Vercel env의 API Gateway URL | 이미지에 구운 `app/data/` + DynamoDB |

각 모드에 대해 다음을 검증한다.

- **포트 정합성**: 호스트 → 컨테이너 → 앱. 특히
  `frontend` 서비스는 `${FRONTEND_PORT:-3100}:3000` 인데 `package.json`의 `dev`는 `--port 3100`,
  `dev:docker`는 `--port 3000`이다. **Dockerfile이 실제로 어떤 스크립트를 실행하는지** 확인하고
  포트가 어긋나면 CRITICAL로 보고한다.
- **컨테이너 내부 주소**: 페이지가 서버 컴포넌트라 fetch가 컨테이너 안에서 일어난다.
  `localhost:8000`을 쓰는 곳이 하나라도 있으면 Docker 모드에서 ECONNREFUSED다. 전수 grep.
- **DynamoDB Local**: `-inMemory -sharedDb` → 컨테이너 재시작 시 테이블 소멸.
  `seed` 서비스의 `--reset` 재시도 루프(30회×2초)가 backend 기동 순서와 경쟁하지 않는지.
  `depends_on`만 있고 healthcheck가 없다는 점의 실패 시나리오를 기술한다.
- **환경변수 매트릭스**: `.env.example`의 21개 키
  (`DATA_GO_KR_API_KEY`, `KAKAO_REST_API_KEY`, `VWORLD_API_KEY`, `LLM_PROVIDER`, `OPENAI_API_KEY`,
  `OPENAI_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AWS_REGION`, `CARDS_TABLE`,
  `PROGRESS_RECORDS_TABLE`, `ALLOWED_ORIGINS`, `DEMO_READ_ONLY`, `MUTATION_API_TOKEN`,
  `DESIRED_COUNT`, `ON_DEMAND_BASE_COUNT`, `NEXT_PUBLIC_API_BASE`, `API_MUTATION_TOKEN`, `NEXT_PUBLIC_DEMO_READ_ONLY`,
  `NEXT_PUBLIC_KAKAO_MAP_KEY`, `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_OPERATOR_TEAM`)
  각각에 대해 **① 어디서 읽는가 ② 미설정 시 동작(폴백/장애) ③ docker-compose·CloudFormation 파라미터에 전달되는가**를 표로 만든다.
  `.env.example`에만 있고 아무도 안 읽는 키, 코드가 읽는데 `.env.example`에 없는 키를 모두 찾아낸다.

---

### §3. 기능 인벤토리 (코드에서 역추출)

README가 아니라 **코드에서** 기능을 뽑는다. 최소 다음 축으로 전수 조사한다.

**FE 라우트 (App Router — 실측 8개, 누락 없는지 재확인)**
`/` (허브) · `/dashboard` · `/cards/[id]` · `/proposals/[id]` · `/incentive` · `/tracking` · `/tracking/new` · `/widget`
→ 각 라우트의 `loading.tsx` / `error.tsx` / `not-found.tsx` 커버리지도 함께 본다.

**FE 데이터 접근 (단일 창구 `frontend/src/lib/api.ts`)**
`dashboard · candidates · riskSignal · usageMonthly · usageDaily · cards · card · generate · decide ·
progress · progressRecords · createProgressRecord · verification · simulate · kpi · progressReport · widget`

**FE 변경 경로 (Server Actions `frontend/src/app/actions.ts` — 6개)**
`decideAction · progressAction · createProgressRecordAction · verificationAction · generateAction · simulateAction`
→ 각 액션을 호출하는 클라이언트 컴포넌트:
`CandidateVerification · DecisionActions · GenerateCardButton · IncentiveDecision · ProgressRecordForm ·
ProgressSelect · SimulateButton · proposals/DecisionBar`

**BE 엔드포인트 (실측 15개)**

| # | Method | Path | 파일 |
|---|---|---|---|
| 1 | GET | `/api/health` | `app/main.py` |
| 2 | GET | `/api/dashboard` | `routes/dashboard.py:9` |
| 3 | GET | `/api/candidates` | `routes/dashboard.py:17` |
| 4 | GET | `/api/risk-signal` | `routes/dashboard.py:34` |
| 5 | GET | `/api/cards` | `routes/cards.py:61` |
| 6 | POST | `/api/cards/generate` (201) | `routes/cards.py:74` |
| 7 | GET | `/api/cards/{cid}` | `routes/cards.py:95` |
| 8 | POST | `/api/cards/{cid}/decision` | `routes/cards.py:100` |
| 9 | POST | `/api/cards/{cid}/simulate` | `routes/cards.py:187` |
| 10 | POST | `/api/cards/{cid}/progress` | `routes/cards.py:284` |
| 11 | POST | `/api/cards/{cid}/verification` | `routes/cards.py:319` |
| 12 | POST | `/api/cards/{cid}/progress-records` (201) | `routes/progress.py:104` |
| 13 | GET | `/api/cards/{cid}/progress-records` | `routes/progress.py:131` |
| 14 | GET | `/api/progress-report` | `routes/progress.py:150` |
| 15 | GET | `/api/widget/recommend` | `routes/widget.py:80` |
| 16 | GET | `/api/kpi` | `routes/kpi.py:50` |

**파이프라인 산출물 8종** — 각 JSON을 **생성하는 스크립트**와 **소비하는 BE/FE 지점**을 양방향으로 연결한다.
생성만 되고 아무도 안 읽는 산출물(예: `sensitivity.json`의 소비처)이 있으면 명시한다.

각 기능마다 아래 표를 채운다.

| 기능 | 사용자 진입점 | FE 화면/컴포넌트 | api.ts 함수 | BE 엔드포인트 | Service | 저장소/외부(DynamoDB·LLM·정적JSON) | 상태 |
|---|---|---|---|---|---|---|---|

상태 = `정상 구현` / `부분 구현` / `연결 오류` / `미사용 코드` / `Mock·Dummy` / `미구현` / `검증 불가`

---

### §4. Frontend 점검

**모든 라우트에 대해**: 초기 렌더 데이터 출처, 로딩/빈 상태/에러 상태, 필터·정렬·페이지네이션,
버튼→액션 연결, 낙관적 업데이트 여부, `revalidatePath` 후 실제 갱신되는 화면 범위.

**이 레포 특유의 함정 — 반드시 확인**

1. **`lib/api.ts`는 mock JSON을 정적 import 한다** (merchants 330KB 포함). 파일 주석은
   "서버 컴포넌트에서만 호출"을 전제한다. `"use client"` 컴포넌트가 `lib/api.ts`(또는 `mocks/*`)를
   직접 import 하는 경로가 하나라도 있으면 **클라이언트 번들 폭증**이다 — 전수 추적.
2. **`usageMonthly` / `usageDaily`는 실 API 모드에서도 정적 mock을 반환한다.**
   BE 엔드포인트가 아예 없다. 이것이 의도된 설계인지(주석은 그렇다고 한다) 확인하고,
   **`data/processed`가 갱신됐는데 `frontend/src/mocks`가 낡으면 화면이 서버와 다른 숫자를 말한다**는
   드리프트 리스크를 평가한다. `scripts/sync-mocks.sh`가 CI/훅 없이 수동 실행뿐이라는 점도 포함.
3. **`mocks/store.ts`는 BE 로직의 2차 구현이다** — `deriveKpi` / `deriveWidget` /
   `deriveProgressReport` / `generateCard` / `decide` / `setProgress` / `setVerification`.
   각각을 BE 대응 로직(`routes/kpi.py`, `routes/widget.py`, `services/progress_report.py`,
   `services/cardgen.py`, `db.py`)과 **규칙 단위로 비교**해 동작 차이를 표로 만든다.
   (mock 모드가 배포 비상 폴백이므로, 차이는 "데모에서 다른 이야기를 하는" 리스크다.)
4. **`/cards/[id]` 와 `/proposals/[id]` 두 개의 상세 라우트**가 공존한다.
   역할 분리인지 잔재인지 판정하고, 어디서 링크되는지(진입점 유무)를 추적한다.
   진입점이 없다면 Dead Route로 분류한다.
5. **`isDemoReadOnly`(`lib/runtime.ts`)** 는 `NEXT_PUBLIC_DEMO_READ_ONLY`만 본다.
   BE의 `DEMO_READ_ONLY`(`security.demo_read_only()`)와 **값이 갈릴 수 있는 구성**인지,
   갈리면 버튼은 눌리는데 403이 나는지 / 반대로 잠겨야 할 게 열리는지 시나리오를 쓴다.
6. **`API_MUTATION_TOKEN`이 GET 요청에도 Authorization 헤더로 붙는다**(`api.ts:get`).
   서버 컴포넌트에서만 실행되어 브라우저에 노출되지 않는지 확인한다.
   `NEXT_PUBLIC_` 접두사 없는 변수가 클라이언트 번들에 인라인되는 경로가 있는지 확인.
7. **지도**: `MapView` / `MapViewClient` / `KakaoMapView` / `RegionTileMap` / `RegionDiagnosticMap`
   — 키 미설정(`NEXT_PUBLIC_KAKAO_MAP_KEY` 없음)·도메인 미등록·타일 서버 실패 시 fallback이 실제로 붙어 있는지.
8. **차트**: `charts/` 6종 + `Sparkline` — 데이터 0건/단일 포인트/음수 델타에서 깨지지 않는지.

**API 호출 정합성**: FE의 모든 호출을 추출해 메서드·경로·요청 바디·응답 스키마가
BE 라우트 시그니처 및 [05-api-contract.md](05-api-contract.md)와 **3자 일치**하는지 대조한다.
불일치는 필드명·타입·옵셔널 여부 단위로 적시한다. `frontend/src/types/index.ts`가 세 번째 기준이다.

---

### §5. Backend 점검

각 엔드포인트에 대해 `Request → 라우터 → Pydantic 스키마 → Service → db/progress_db → 응답` 전 구간을 추적한다.

**중점 항목**

- **상태 전이 규칙**: `services/workflow.py` (`normalize_progress`, `verification_status`,
  `is_verified`, `progress_options`, `can_set_progress`) 가 라우트·mock store 양쪽에서
  **동일하게** 적용되는지. pending이 아닌 카드에 decision, 승인 전 progress 변경, 검증 미완 상태 전이 등 엣지 케이스.
- **동시성**: `db.py`의 조건부 업데이트와 `ConcurrentUpdate` 처리, `_is_conditional_failure`.
  중복 클릭·동시 승인 시 어떤 HTTP 상태가 나가는지, FE가 그걸 구분해 다루는지.
- **무제한 스캔**: `db._scan_all` / `list_cards` — 페이지네이션·상한이 있는지, 카드가 수백 장일 때의 거동.
- **커서 페이지네이션**: `progress_db._encode_cursor` / `_decode_cursor` — 위변조 커서, 만료, 경계값.
- **트랜잭션**: `progress_db.write_record_and_project_card` (TransactWriteItems) —
  기록 저장과 카드 투영이 원자적인지, 실패 시 부분 반영 가능성.
- **멱등성**: `services/progress_records.py`의 `_request_fingerprint` / `IdempotencyConflict` —
  재전송·더블 서브밋에서 중복 레코드가 생기는지.
- **`GET /api/progress-report`**: `report_bucket` GSI 조회 범위(`_month_buckets`)와
  `from`/`to` 파라미터 검증(역순 구간, 미래 날짜, 초장기 구간 → 스캔 폭발).
- **`GET /api/kpi`** 와 **`GET /api/widget/recommend`**: 카드 상태에서 파생되는 값의 계산 근거와
  캐시 부재(no-store 미들웨어)로 인한 매 요청 재계산 비용.
- **예외 처리**: 404/400/409/403의 사용 일관성. `{"detail": "..."}` 형태가 계약대로인지.
  스택 트레이스나 내부 경로가 응답에 새는 곳이 없는지.
- **호출되지 않는 엔드포인트**: 위 16개 중 FE가 부르지 않는 것을 명시한다(예: `/api/cards/{cid}` 단건 조회의 실제 사용처).

---

### §6. AI/LLM 통합 점검 (가장 중요)

이 프로젝트의 심사 포인트는 "AI가 실제로 동작하는가 + AI가 제안만 하는가"다.

**단일 경로 원칙 검증**: LLM 호출이 `backend/app/llm.py:generate_json(system, user, schema)`
**한 곳으로만** 나가는지. provider 분기(OpenAI/Anthropic)가 이 파일 밖으로 샜는지 전수 확인.

**`services/cardgen.py` 전 구간 추적**

```
POST /api/cards/generate
  → routes/cards.py
  → cardgen.generate_card(type)
      ├─ _ranked_candidates / _target_state / _available / _first_available   (후보 선정)
      ├─ _build_inputs (AI 입력 ①~⑥ 조립) · _weekday_signal · season.season_signal · _road_text
      ├─ _grounded_ai  → llm.generate_json(...)          ← 실제 AI 호출 지점
      ├─ _fallback_ai / _incentive_fallback_ai            ← 키 없음·실패 시 폴백
      ├─ _ensure_assumption                               ← 절대 규칙 3 (가정 기반 전망 문구)
      ├─ _find_pending / _recent_generated / _is_recent    ← 중복 가드(200 vs 201)
      └─ _generate_expansion / _generate_incentive
  → db.create_card → DynamoDB
  → 응답 → api.ts:generate (status로 created 판정) → GenerateCardButton
```

**반드시 답할 질문**

1. `LLM_PROVIDER`/API 키 **미설정 시** 무슨 일이 일어나는가? 500인가, 폴백 카드인가?
   폴백 카드가 나온다면 **화면이 "AI 생성"이라고 말하는가** — 즉 규칙상 허위 표시 위험이 있는가?
   폴백임을 사용자·심사자가 구분할 수 있는 신호가 응답/화면에 있는가?
2. LLM 응답에 **스키마 검증**이 있는가? 필수 필드 누락·타입 오류·JSON 파싱 실패 시 경로는?
3. **타임아웃 / 재시도 / 총 소요 상한**이 있는가? API Gateway HTTP API 통합 타임아웃 30초(증액 불가)와의 관계는?
   30초를 넘기면 게이트웨이가 504로 끊는데, FE는 그 실패를 어떻게 표시하는가?
4. `llm.py:redact`가 로그에서 무엇을 가리는가 — 프롬프트에 실린 데이터가 CloudWatch에 남는가?
5. **AI가 조정한 순위와 원 Score 순위가 함께 응답에 실리는가** (절대 규칙 5).
   `OriginalRankingTable` / `RankTrace`가 그 필드를 실제로 렌더하는지까지 확인.
6. `prompts.py`에 정의됐지만 **호출되지 않는 프롬프트**가 있는가?
7. **`POST /api/cards/{cid}/simulate`는 AI인가 결정론적 계산인가?**
   `services/simulate.py` (`concentration_index`, `expected_monthly_count`, `_percentile`,
   `simulate_expansion`)를 읽고 판정한다. 화면 문구가 이를 "AI 예측"으로 과장하지 않는지,
   "가정 기반 전망" 문구가 응답과 UI 양쪽에 고정 삽입되는지 확인 (절대 규칙 3).
8. EXPANSION 전용인 simulate를 INCENTIVE 카드에 부르면 400이 나가는지, FE가 그 버튼을 애초에 감추는지.

---

### §7. 데이터 계층 점검 (DynamoDB + 정적 JSON)

**DynamoDB (infra/template.yaml)**

- `CardsTable`: `AWS::Serverless::SimpleTable`, PK `id`(S), 온디맨드.
  → GSI가 없다. `GET /api/cards?type=&status=` 필터가 **Scan + 앱 필터**로 동작하는지,
  그 비용·정확성(페이지 경계 누락 가능성)을 평가한다.
- `ProgressRecordsTable`: PK `record_id`(S) +
  GSI `card-recorded-at-index`(card_id / recorded_at_key),
  GSI `report-bucket-recorded-at-index`(report_bucket / recorded_at_key), 둘 다 `ProjectionType: ALL`.
  → 쿼리 코드가 실제로 GSI를 쓰는지(Scan으로 우회하지 않는지), 정렬 키 문자열 형식이
  사전순=시간순을 보장하는지(`recorded_at_key` 생성 로직), `report_bucket` 파티션 편중(월 단위 핫 파티션).
- `Policies`: `DynamoDBCrudPolicy` 2개 + `TransactWriteItems` 명시.
  → 코드가 쓰는 API 중 정책이 커버하지 않는 것(예: GSI Query는 커버됨, `DescribeTable`/`CreateTable`은?)을 확인.
  특히 `progress_db.ensure_table` / `clear_table`이 **태스크 역할 권한으로는 부족**하다 — 호출 경로 추적.
- 마이그레이션 개념이 없다(CloudFormation 이 곧 스키마). `local_init.py` / `seed_demo.py`가 만드는 테이블 정의와
  `template.yaml` 정의가 **필드·인덱스 단위로 동일한지** 대조한다. 다르면 로컬에선 되고 배포에선 깨진다.

**정적 JSON 계층**

- `dataload.load(name)` 단일 창구 원칙이 지켜지는지 (`open()`/`json.load`가 다른 곳에 있는지 grep).
- `_load_versioned`의 버전/캐시 전략과 컨테이너 기동 시 로드 비용(merchants 330KB 등).
- 경로 폴백(`app/data/` ↔ `../../data/processed/`)이 3개 실행 모드 모두에서 성립하는지.
  **`backend/app/data/`는 현재 비어 있다** — 배포 시 `build-and-push.sh`가 복사하는지 확인하고,
  복사 누락 시 `/api/health`의 `data_loaded:false`가 이를 잡아내는지 검증한다.
- `REQUIRED_DATASETS`(dashboard·eup_scores·candidates·merchants)와 실제 라우트가 읽는 데이터셋 목록이
  일치하는지 — health가 OK인데 특정 라우트만 500나는 구멍이 있는지.

**파이프라인 정합성**: `p1~p8` 각 산출 JSON의 스키마가 [05-api-contract.md §6](05-api-contract.md)과
`frontend/src/types/index.ts`와 일치하는지. 1단계(읍 단위)와 2단계(반경 500m) 데이터가
한 수식에 섞이지 않는지(Global Constraint) — `p5_metrics.py` / `p6_scoring.py` 계산식을 직접 읽고 판정.

---

### §8. 인증 / 권한 / 보안

이 서비스는 로그인이 없다. 보호 수단은 **단일 Bearer 토큰 + 읽기 전용 플래그 + CORS** 세 겹뿐이다.
따라서 이 세 겹을 정밀하게 본다.

```
FE Server Action / 서버 컴포넌트
  → Authorization: Bearer ${API_MUTATION_TOKEN}
  → app/security.py: _require_bearer → require_mutation_access / require_internal_access
  → 라우트 핸들러
```

- `require_mutation_access` 와 `require_internal_access` **차이가 무엇이고, 어떤 엔드포인트에 각각 붙어 있는가.**
  16개 엔드포인트 전부에 대해 **가드 유무 표**를 만든다. 무방비 상태의 변경 엔드포인트가 하나라도 있으면 CRITICAL.
- `MUTATION_API_TOKEN`이 **미설정일 때** 가드가 열리는가 닫히는가 (fail-open이면 CRITICAL).
  docker-compose 기본값 `local-dev-token`이 배포로 새는 경로가 있는가.
- `DEMO_READ_ONLY`(CloudFormation 파라미터, 기본값 없음 = 배포자가 반드시 명시)가 true 일 때 6개 Server Action 전부가 막히는가 —
  `actions.ts`의 `isDemoReadOnly` 조기 반환과 BE `security.demo_read_only()` **이중 가드**가 모두 있는지.
  한쪽만 있으면 우회 경로를 기술한다.
- **CORS 는 앱 한 층뿐**: `main.py`의 `ALLOWED_ORIGINS`(`*` 금지 가드 있음, 배포 기본값 빈 목록).
  API Gateway 에는 CORS 설정을 두지 않는다 — 모든 호출이 Vercel 서버에서 오는 서버-대-서버다.
  두 층의 값이 어긋날 때의 증상을 기술하고, 배포 스크립트가 둘을 함께 넘기는지 확인.
- **시크릿 위생 (제출 시 저장소 Public 전환 예정 — 12 문서 §4)**
  - 레포 루트에 **`.env` 실파일이 존재**한다. `.gitignore`에 확실히 잡혀 있는지 확인.
  - `git log -p` 전 이력에 API 키·토큰이 한 번이라도 커밋된 적이 있는지 검사한다
    (`git log --all -S'sk-' --oneline`, `-S'AKIA'`, `-S'ANTHROPIC_API_KEY='` 등).
  - 루트의 PDF(`기획서_V.I.B.E.pdf`, `MVP_상생나침반_개정판.pdf` — `.gitignore` 대상, 커밋되면 안 됨)와
    `docs/reference/`(`제출요구사항.pdf`, `산출물평가표.pdf`)·`docs/images/`(`dashboard-mockup.png`,
    `widget-mockup.png`)에 개인 연락처 등 민감정보가 있는데 커밋 대상인지 확인.
  - `data/raw/api_cache/`에 API 키가 포함된 URL이나 응답이 남아 있는지.
- 입력 검증: `region`/`category`/`limit`/`cursor`/`from`/`to` 등 쿼리 파라미터의 상한·화이트리스트.
  `limit`에 큰 수를 넣어 전량 덤프가 가능한지 (`GET /api/widget/recommend?limit=99999`).
- IDOR: `card_id`만 알면 누구나 상태를 바꿀 수 있는 구조인지 (토큰 가드가 유일한 방어인지 확인).
- 로그: `LOG_LEVEL`·`llm.redact`·예외 로깅에 개인정보/키가 남는지.

---

### §9. 외부 연동 점검

| 대상 | 사용처 | 확인 |
|---|---|---|
| OpenAI / Anthropic | `app/llm.py` | 키·모델명 env, 타임아웃, 재시도, 요금 폭주 방지(`ReservedConcurrency: 5`) |
| Kakao REST (지오코딩) | `pipeline/p4_stores.py` 등 | `KAKAO_REST_API_KEY`, 캐시(`data/raw/api_cache/`), 레이트리밋, VWorld 폴백 동작 |
| VWorld | 파이프라인 폴백 | 키 부재 시 파이프라인이 죽는지, 건너뛰는지 |
| data.go.kr | 파이프라인 수집 | `DATA_GO_KR_API_KEY` 실제 사용 여부 — 안 쓰면 `.env.example`에서 정리 대상 |
| Kakao Maps JS | `KakaoMapView.tsx` | `NEXT_PUBLIC_KAKAO_MAP_KEY` 미설정/도메인 미등록 시 fallback |
| OpenFreeMap 타일 | `MapView`/MapLibre | 타일 서버 장애 시 화면 거동, CSP/외부 요청 |

파이프라인은 **분기 배치**라 런타임 경로가 아니다 — 실패해도 서비스는 뜨는지(정적 JSON이 커밋돼 있으므로) 확인해 위험도를 조정한다.

---

### §10. Docker / Infrastructure 점검

- `backend/Dockerfile` / `frontend/Dockerfile`: 베이스 이미지, 의존성 설치, 실행 커맨드,
  `.dockerignore` 누락으로 `node_modules`/`.next`가 빌드 컨텍스트에 딸려가는지.
- compose 볼륨: `./backend/app:/app/app`(rw, 핫리로드) vs seed의 `:ro`,
  `./data/processed:/app/app/data:ro`가 **ECS 이미지와 동일 경로**를 재현하는지.
  `/app/node_modules`·`/app/.next` 익명 볼륨이 의존성 변경 시 stale해지는 문제.
- healthcheck 전무 → `depends_on`만으로 순서 보장이 되는지, seed 재시도 루프가 그 공백을 실제로 메우는지.
- `restart` 정책 부재(seed만 `"no"`) — 컨테이너 사망 시 무음 실패.
- CloudFormation: 태스크 `Cpu: 256` / `Memory: 512` / `StopTimeout: 60` / 스테이지 스로틀링(rate 10, burst 20) / 로그 보존 7일이
  LLM 호출 시간·정적 JSON 로드 메모리에 충분한지. `CodeUri: ../backend`가 `tests/`·`.pytest_cache`까지
  번들에 싣는지(패키지 크기·콜드스타트).
- `infra/scripts/*.sh` 를 **읽기만** 하고: 데이터 복사 단계, 파라미터 전달(특히 `AllowedOrigins`,
  `MutationApiToken`, `DemoReadOnly`), 실패 시 롤백 여부를 확인한다. **실행 금지.**
- **CI/CD 부재**: `.github/`가 없다. lint/test/타입체크가 자동 실행되지 않는 리스크를 명시하고,
  최소 워크플로 제안(§16 P2)을 준비한다.

---

### §11. 테스트 점검

현재 테스트(총 63개):

| 파일 | 개수 | 대상 |
|---|---|---|
| `backend/tests/test_smoke.py` | 50 | ? (엔드포인트 커버리지 확인) |
| `backend/tests/test_algorithms.py` | 3 | ? |
| `backend/tests/test_progress_report.py` | 6 | `services/progress_report.py` |
| `pipeline/tests/test_algorithms.py` | 4 | 파이프라인 계산식 |

- **FE 테스트는 0개다.** 8개 라우트·6개 Server Action·70여 컴포넌트가 전부 무테스트인지 확인.
- 16개 엔드포인트 × 테스트 매핑표를 만들어 **미커버 엔드포인트**를 특정한다.
- 테스트가 DynamoDB를 어떻게 다루는지(moto? 로컬? 스텁?), LLM을 실제로 호출하는지(비용·불안정).
- 테스트가 **실제 프로덕션 경로**를 타는지, mock으로 우회해 계약 위반을 못 잡는지.
- 절대 규칙 6개에 대한 회귀 테스트는 `check-banned-words.mjs`(규칙 1·4 일부)뿐이다 —
  규칙 2·3·5·6의 회귀 방지 수단이 없다는 점을 Test Gap에 반드시 넣는다.

---

### §12. Dead Code / Mock / TODO

전 레포에서 `TODO|FIXME|HACK|XXX|mock|dummy|sample|placeholder|temporary|hardcoded|NotImplemented`
및 `return None|return \[\]|return \{\}` 을 훑고, **실제 기능에 영향을 주는 것만** 남긴다.

추가로 이 레포에서 특히 의심할 지점:

- 호출되지 않는 컴포넌트 (`components/` 70여 개 중 import되지 않는 것 — 전수 확인)
  예: `MockOutcomeReport` · `PolicyOutcomeGuide` · `MenuDemoGuide` · `RegionTileMap` vs `RegionDiagnosticMap`
  · `MapView` vs `MapViewClient` vs `KakaoMapView` 중 실사용분
- 호출되지 않는 BE 함수 (`progress_db.clear_table`, `db.next_card_id`, `season.season_signal` 등 실사용 확인)
- 소비처 없는 파이프라인 산출물 (`sensitivity.json`)
- `backend/local_init.py`가 현재 워크플로에서 쓰이는지 (docker-compose는 `seed_demo.py`만 부른다)
- `.pytest_cache/` 3곳, `tsconfig.tsbuildinfo`, `infra/.aws-sam/build/` 등 커밋 대상 아닌 산출물

각 항목을 **삭제 가능 / 연결 누락(버그) / 의도적 보류** 로 분류한다.

---

### §13. E2E 플로우 검증 (핵심 — 데모 대본 기준)

[docs/plan/11-demo-and-qa.md](11-demo-and-qa.md)의 데모 클릭 스크립트를 읽고,
**대본의 각 단계가 코드상 실제로 성립하는지** 단계별로 검증한다. 최소 다음 5개 플로우는 필수다.

**A. 진단 → 대시보드**
```
/dashboard 접속 → 서버 컴포넌트
  → api.dashboard() + api.candidates() + api.kpi() + api.riskSignal() + api.usageMonthly() + api.usageDaily()
  → GET /api/dashboard·/api/candidates·/api/kpi·/api/risk-signal  (usage*는 정적 mock — 확인 필요)
  → routes/dashboard.py → dataload.load(...) → data/processed/*.json
  → DashboardOverview·QuarterDiagnostics·RegionScoreTable·CategoryShareBars·charts/*
  → [규칙 1] 집중도 용어 노출 없음 / [규칙 2] 전환율에 `근사 지표` 배지 / [규칙 6] 국세청=참고용 라벨
```

**B. AI 카드 생성 (공급 측 EXPANSION)**
```
GenerateCardButton 클릭 → generateAction(type)
  → api.generate → POST /api/cards/generate
  → cardgen.generate_card → _build_inputs → llm.generate_json → (실패 시 _fallback_ai)
  → db.create_card → DynamoDB CardsTable
  → 201(신규) / 200(중복 가드) → created 판정 → revalidatePath("/", "layout")
  → 허브·트래킹·위젯 갱신 / [규칙 5] 원 Score 순위 병기 / [규칙 3] 가정 기반 전망 문구
```

**C. 담당자 승인 (수요 측 INCENTIVE — selectedRate 3|5|7)**
```
DecisionActions(또는 proposals/DecisionBar) → decideAction(id, "approved", rate)
  → isDemoReadOnly 가드 → POST /api/cards/{id}/decision (Bearer)
  → security.require_mutation_access → workflow 상태 전이 검증 → db.decide_card(조건부 업데이트)
  → 409(잘못된 전이) 시 에러 화면이 아니라 안내 문구 / [규칙 4] "실행" 표현 없음
```

**D. 상태 트래킹 + 진행 기록**
```
/tracking → api.cards + api.kpi + api.progressReport
ProgressRecordForm → createProgressRecordAction
  → POST /api/cards/{id}/progress-records (멱등 지문)
  → progress_records.record_progress → progress_db.write_record_and_project_card (TransactWrite)
  → ProgressRecordTimeline·ProgressReportDashboard 렌더
GET /api/progress-report → report-bucket GSI → 지표 변화·정시 이행·단계 소요
```

**E. 방문객 위젯 반영 (루프 폐합)**
```
/widget → api.widget(region, category, limit) → GET /api/widget/recommend
  → routes/widget.py → 승인된 카드 상태 + merchants 정적 데이터 병합
  → 승인된 확충 업종이 실제로 위젯 결과에 반영되는지 (C·D 이후 상태 변화가 보이는지)
  → KakaoMapView 키 없을 때 fallback
```

각 플로우에서 **하나라도 끊긴 지점이 있으면 그 플로우는 "정상 구현"이 아니다.**
끊긴 위치를 `파일:라인` 으로 특정한다.

---

### §14. 실행 가능성 검증 (안전 범위 내)

정적 분석과 **실행 검증을 명확히 구분해서** 보고한다. 아래는 안전하므로 실제로 수행한다.

```bash
# 구성 검증
docker compose config -q                      # compose 문법·env 해석
docker compose ps                             # 이미 떠 있으면 로그로 상태 확인 (재기동 금지)

# 백엔드
cd backend && python -m pytest -q             # 63개 중 backend 59개
cd backend && python -c "import app.main"     # import 타임 에러(순환참조·env 강제) 확인

# 파이프라인 (data/processed 덮어쓰기 금지 — 테스트만)
cd pipeline && python -m pytest -q

# 프론트
cd frontend && npx tsc --noEmit               # 타입 체크
cd frontend && npm run lint
cd frontend && npm run check:banned           # 절대 규칙 1·4 회귀 검사
cd frontend && npm run build                  # Vercel 빌드 재현 (시간 걸림, 가능하면 수행)

# 살아 있는 로컬 스택이 있다면 (없으면 생략, 새로 띄우지 말 것)
curl -s localhost:8000/api/health | python -m json.tool
```

**금지**: `infra/scripts/deploy.sh`, `npx vercel --prod`, `pipeline/run_all.py`(산출물 덮어씀),
`seed_demo.py --reset`(데모 상태 파괴), LLM 유료 호출 반복, `docker compose down -v`.

실행 결과는 **원문 출력을 근거로 인용**한다. 실행하지 못한 항목은 "미실행"으로 남기고 추정하지 않는다.

---

### §15. 심각도 분류

| 등급 | 기준 (이 프로젝트 기준으로 구체화) |
|---|---|
| **CRITICAL** | 서비스 기동 불가 / 데이터 손실 / 시크릿 노출·커밋 이력 잔존 / 변경 API 무방비 / **절대 규칙 1·3·4 위반(심사 탈락 리스크)** |
| **HIGH** | 데모 5대 플로우(§13 A~E) 중 하나 단절 / FE↔BE 계약 불일치로 화면 오류 / AI 폴백이 실제 AI로 표시됨 / **절대 규칙 2·5·6 위반** / DEMO_READ_ONLY 우회 |
| **MEDIUM** | 예외 처리 누락 / 특정 조건 오류 / mock↔BE 로직 드리프트 / 무제한 스캔·성능 / 테스트 부재 핵심 경로 |
| **LOW** | Dead code / 네이밍 / 문서-코드 경미한 불일치 / 커밋 대상 아닌 산출물 |

---

### §16. 최종 보고서 형식

`docs/audit/AUDIT-<YYYYMMDD>.md` 로 저장하고, 아래 순서를 그대로 지킨다.

**1) Executive Summary**
전체 상태 · 실행 가능 여부 · 5대 플로우 정상 여부 · 가장 심각한 문제 3개 · 완성도.
점수는 **근거 문장과 함께** 매긴다.

```
Architecture      : /10
Frontend          : /10
Backend           : /10
AI Integration    : /10
Data Layer (DDB + 정적 JSON) : /10
Pipeline          : /10
Security          : /10
Infrastructure    : /10
Testing           : /10
심사 규칙 준수(절대 규칙 6개) : /10
Demo Ready        : /10
Production Ready  : /10
```

**2) Architecture Map** — Mermaid 다이어그램. 파이프라인·정적 JSON·mock 이중 원천·3개 실행 모드가 보이게 그린다.

**3) Feature Inventory** — §3의 표.

**4) API Connectivity Matrix** — 16개 엔드포인트 × (FE 호출부 / 메서드 / 요청 / 응답 / 05 문서 일치 / 가드 / 상태).

**5) 절대 규칙 준수 매트릭스** — 6개 규칙 × (검증 방법 / 근거 파일 / 판정 / 위반 지점).

**6) 주요 문제** — 각 항목 아래 형식 고정:
```
[HIGH] 문제 제목
위치:      path/to/file:line
관련 코드:  함수/컴포넌트/엔드포인트
문제:      구체적 설명
영향:      사용자·심사·시스템에 미치는 결과
재현 조건:  어떤 모드(Docker/mock/배포)에서 어떤 입력으로 발생하는지
수정 방향:  구체적 해결 방법 (파일 단위)
```

**7) Broken Flow** — §13 A~E 중 끊긴 흐름을 화살표 다이어그램으로.

**8) Mock / Dummy / Incomplete** — 특히 `mocks/store.ts` ↔ BE 로직 드리프트 표.

**9) Dead Code**

**10) Security Findings** — 시크릿 커밋 이력 검사 결과를 반드시 포함.

**11) Test Coverage Gap** — 엔드포인트·플로우·절대 규칙 회귀 3축.

**12) 수정 우선순위**
- **P0 (즉시)**: 실행 불가 / 시크릿 / 절대 규칙 위반
- **P1 (제출·데모 전)**: 5대 플로우 단절 / 계약 불일치 / AI 연결 문제
- **P2 (안정화)**: 예외 처리 / 테스트 / CI 도입 / 성능
- **P3 (개선)**: 리팩터링 / Dead code / 문서 정리

---

### §17. 최종 판정 (각 항목 `YES` / `NO` / `PARTIAL` / `NOT VERIFIED` + 근거)

1. Docker 통합 모드(`docker compose up -d`)로 전체 스택이 정상 기동하는가?
2. FE mock 단독 모드가 BE 없이 성립하는가?
3. Frontend ↔ Backend 연결은 16개 엔드포인트 전부에서 완전한가?
4. Backend ↔ LLM 연결은 완전한가? 키 없이도 안전하게 폴백하는가?
5. Backend ↔ DynamoDB 연결은 완전한가(로컬·배포 양쪽)?
6. 파이프라인 산출물 8종이 모두 소비되는가?
7. `data/processed` ↔ `frontend/src/mocks` 는 동기화되어 있는가?
8. 5대 데모 플로우(§13 A~E)가 전부 끝까지 도는가?
9. Mock/Dummy 응답이 실 API 모드에 남아 있는가?
10. 버튼은 있는데 동작하지 않는 기능이 있는가?
11. 존재하지만 호출되지 않는 API/컴포넌트가 있는가?
12. FE가 호출하지만 존재하지 않는 API가 있는가?
13. 변경 API가 인증 없이 열려 있는가? `DEMO_READ_ONLY` 우회가 가능한가?
14. 시크릿이 커밋 이력에 남아 있는가? (저장소 Public 전환 대비)
15. 절대 규칙 6개를 전부 준수하는가?
16. 현재 상태로 심사 데모가 가능한가?
17. 현재 상태로 배포 가능한가?

---

### §18. 분석 진행 방식

빨리 끝내는 것보다 **누락 없이 훑는 것**을 우선한다. 아래 3개 Phase를 순서대로 진행하고,
**각 Phase가 끝나는 즉시 해당 체크포인트 파일을 쓴 뒤 다음으로 넘어간다** (§0-8).

| Phase | 다루는 섹션 | 작업 | 체크포인트 파일 (Phase 종료 시 필수 작성) |
|---|---|---|---|
| **1. 지도 그리기** | §1~§5 | `get_architecture` → 레포 구조 → 기능 인벤토리 초안 → Frontend 전수 → Backend 전수 | `docs/audit/_wip/01-inventory.md` — 기능 인벤토리 표 + 라우트/엔드포인트/컴포넌트 전수 목록 (사용처 포함)<br>`docs/audit/_wip/02-api-matrix.md` — 16개 엔드포인트 × FE 호출부 × 05 문서 × types **4자 대조** 결과 |
| **2. 계층 파고들기** | §6~§10, §14 | AI/LLM → 데이터 계층(DDB·정적 JSON·파이프라인) → 보안·시크릿 이력 → Infra/Docker/CloudFormation → 안전 명령 실행 검증 | `docs/audit/_wip/03-ai-data.md` — LLM 호출 경로·폴백·스키마검증 + DDB 스키마/쿼리 + 파이프라인 산출물 소비처<br>`docs/audit/_wip/04-security-infra.md` — 가드 유무 표 16행 + 시크릿 이력 검사 원문 + 포트/볼륨/CloudFormation 정합성<br>`docs/audit/_wip/05-exec-log.md` — §14 명령별 **출력 원문 발췌** 및 미실행 항목 |
| **3. 판정과 조립** | §11~§13, §15~§17 | 테스트 갭 → E2E 5대 플로우 → 절대 규칙 6개 매트릭스 → 누락 영역 재탐색 → 최종 보고서 | `docs/audit/_wip/06-e2e-rules.md` — 플로우 A~E 단절 지점 + 절대 규칙 매트릭스<br>**최종** `docs/audit/AUDIT-<YYYYMMDD>.md` |

**Phase 시작 시**: `docs/audit/_wip/` 를 먼저 확인한다. 기존 파일이 있으면 읽고 이어서 하며, 같은 영역을 재탐색하지 않는다.
**Phase 종료 시**: 체크포인트를 쓰지 않고 다음 Phase로 넘어가지 않는다. 컨텍스트가 요약되면 그때까지의 근거가 사라진다.
**단일 세션 실행이든 3회 분할이든 이 규약은 동일하다** — 분할 실행 시에는 Phase 하나를 끝내고 세션을 종료하면 된다.

**보고서를 쓰기 직전에 스스로 점검한다:**

> "아직 열어보지 않은 라우트·서비스·컴포넌트·설정 파일이 있는가?
> 70여 개 컴포넌트 전부의 사용처를 확인했는가? 16개 엔드포인트 전부를 추적했는가?
> 8개 파이프라인 산출물의 소비처를 전부 찾았는가? 21개 환경변수를 전부 매핑했는가?"

하나라도 남았으면 **보고서를 쓰지 말고 그 영역부터 마저 본다.**

**"대부분 정상으로 보입니다" 같은 결론을 금지한다.** 모든 정상/오류 판정에 코드 근거를 붙인다.
검색 결과가 없다고 곧바로 "없다"고 결론내지 말고, 다른 이름·라우트·컴포넌트·타입으로 교차 탐색한다.

**서브에이전트 활용**: 아래 4개는 서로 독립적이라 병렬로 위임해도 좋다 —
① 70여 개 컴포넌트의 import 사용처 전수 조사 ② `git log -S` 시크릿 이력 검사
③ TODO/FIXME/dummy 패턴 스윕 ④ 환경변수 21개 × (읽는 위치·미설정 시 동작·전달 경로) 매핑.
단 **판정은 위임하지 않는다** — 서브에이전트는 사실을 모아 오고, 등급과 결론은 본체가 근거를 보고 내린다.

**마지막으로: 이 단계에서는 코드를 수정하지 않는다.** 보고서를 제출하고,
사용자가 우선순위를 고른 뒤에 수정 작업을 시작한다.

---
