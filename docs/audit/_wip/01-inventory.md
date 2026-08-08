# 01 — 기능 인벤토리 / 전수 목록 (Phase 1 체크포인트)

수집일: 2026-08-08 · 근거는 전부 `file:line` 인용. 판정은 최종 보고서에서.

---

## 0. 탐색 도구 상태 (중요)

- Codebase MCP `get_architecture` 결과: **983 노드 / 2106 엣지**
  (프롬프트 §0-2가 적은 "약 2,330 노드 / 4,721 엣지"와 불일치 → 인덱스가 낡았거나 부분 인덱싱).
- MCP `file_tree`에 **`pipeline/` 전체 없음**, `backend/app/routes/`는 `cards.py`만 있고
  `dashboard.py`·`progress.py`·`widget.py`·`kpi.py` 없음, `db.py`·`progress_db.py`·`dataload.py` 없음.
- → **MCP 그래프를 근거로 "없다"고 판정하지 않았다.** 이 문서의 모든 목록은 파일시스템
  (`find`/`grep`) + 직접 Read로 재확인한 것이다.

---

## 1. FE 라우트 (App Router) — 실측 8개, 프롬프트 §3 목록과 일치

`find frontend/src/app -type f` 결과:

| 라우트 | page | loading | error | not-found |
|---|---|---|---|---|
| `/` | `app/page.tsx` | `app/loading.tsx` | `app/error.tsx` | `app/not-found.tsx` |
| `/dashboard` | `app/dashboard/page.tsx` | `app/dashboard/loading.tsx` | (루트 상속) | (루트 상속) |
| `/cards/[id]` | `app/cards/[id]/page.tsx` | `app/cards/[id]/loading.tsx` | (루트 상속) | (루트 상속) |
| `/proposals/[id]` | `app/proposals/[id]/page.tsx` | **없음** | (루트 상속) | (루트 상속) |
| `/incentive` | `app/incentive/page.tsx` | `app/incentive/loading.tsx` | (루트 상속) | (루트 상속) |
| `/tracking` | `app/tracking/page.tsx` | `app/tracking/loading.tsx` | (루트 상속) | (루트 상속) |
| `/tracking/new` | `app/tracking/new/page.tsx` | **없음** | (루트 상속) | (루트 상속) |
| `/widget` | `app/widget/page.tsx` | `app/widget/loading.tsx` | (루트 상속) | (루트 상속) |

기타: `app/layout.tsx`, `app/actions.ts`, `app/globals.css`, `app/icon.svg`.
`error.tsx`/`not-found.tsx`는 **루트에만 1개씩** — 세그먼트별 error boundary 없음.

### 라우트 진입점(링크) — Dead Route 판정용
`grep -rn 'href=.*(/proposals/|/cards/)'`:
- `/proposals/[id]` ← `components/dashboard/DashboardDetailSections.tsx:105`,
  `components/dashboard/DashboardOverview.tsx:230`, `:355`
- `/cards/[id]` ← `app/tracking/page.tsx:409`, `:444`,
  `components/ProgressRecordForm.tsx:588`,
  `components/proposals/EvidenceSections.tsx:49`, `:106`

→ **두 상세 라우트 모두 진입점이 있다. Dead Route 아님.** 역할 분리:
`/proposals/[id]`는 승인 결정(하단 고정 DecisionBar), `/cards/[id]`는 지도·후보 정밀 검토
(`app/proposals/[id]/page.tsx:33-34` 주석이 이 분리를 명시).

---

## 2. FE 데이터 접근 — `lib/api.ts` 17개 함수 전수 사용처

`lib/api.ts:112-200`에 정의된 17개. **미사용 0개.**
(주의: `api.card(id)`는 `api\n  .card(id)`로 줄바꿈돼 있어 단순 `api.card(` grep에 안 잡힌다.)

| api 함수 | 정의 | 호출부 (file:line) |
|---|---|---|
| `dashboard` | `api.ts:114` | `app/page.tsx:30`, `dashboard/page.tsx:58`, `cards/[id]/page.tsx:60`, `proposals/[id]/page.tsx:40`, `incentive/page.tsx:36`, `tracking/page.tsx:89`, `tracking/new/page.tsx:23`, `widget/page.tsx:64` (8곳) |
| `candidates` | `api.ts:116` | `app/page.tsx:32`, `dashboard/page.tsx:60`, `cards/[id]/page.tsx:61`, `proposals/[id]/page.tsx:41` |
| `riskSignal` | `api.ts:120` | `dashboard/page.tsx:61` |
| `usageMonthly` | `api.ts:127` | `dashboard/page.tsx:62` |
| `usageDaily` | `api.ts:131` | `dashboard/page.tsx:63`, `widget/page.tsx:71` |
| `cards` | `api.ts:135` | `app/page.tsx:31`, `tracking/page.tsx:90`, `tracking/new/page.tsx:24`, `incentive/page.tsx:37`, `widget/page.tsx:69` |
| `card` | `api.ts:138` | `cards/[id]/page.tsx:63`, `proposals/[id]/page.tsx:43` |
| `generate` | `api.ts:150` | `app/actions.ts:123` |
| `decide` | `api.ts:163` | `app/actions.ts:60` |
| `progress` | `api.ts:170` | `app/actions.ts:75` |
| `progressRecords` | `api.ts:173` | `cards/[id]/page.tsx:70`, `tracking/page.tsx:129` |
| `createProgressRecord` | `api.ts:176` | `app/actions.ts:90` |
| `verification` | `api.ts:182` | `app/actions.ts:105` |
| `simulate` | `api.ts:186` | `app/actions.ts:134` |
| `kpi` | `api.ts:190` | `app/page.tsx:33`, `dashboard/page.tsx:59`, `tracking/page.tsx:91` |
| `progressReport` | `api.ts:192` | `tracking/page.tsx:67`, `:76` |
| `widget` | `api.ts:196` | `widget/page.tsx:63` |

### `usageMonthly` / `usageDaily` — BE 엔드포인트 없음 (의도된 설계)
`api.ts:127-132`가 `Promise.resolve(mock)`으로 **실 API 모드에서도 정적 import**를 반환.
근거: `docs/plan/05-api-contract.md:584-592` — "BE 엔드포인트 없이 FE가 mock 사본을 정적
import" 라고 계약이 명시. → 계약 위반 아님. 드리프트 리스크는 03/04 체크포인트에서 평가.

### 클라이언트 번들 유출 검사 (§4-1)
`"use client"` 파일 중 `@/lib/api` 또는 `@/mocks` import 하는 것 전수 검사 →
매치 3건 전부 **주석 안의 문자열**이었다:
- `app/dashboard/page.tsx:41` (주석), `app/proposals/[id]/page.tsx:33` (주석),
  `lib/api.ts:12` (주석)
- 세 파일 모두 1행이 `import type { Metadata }` / 주석이며 `"use client"` 지시어 아님.

→ **클라이언트 컴포넌트가 데이터 계층을 import 하는 경로 0건.** merchants 330KB가
브라우저 번들에 실리지 않는다.

---

## 3. FE Server Actions (6개) — `app/actions.ts` + 호출부

| 액션 | 정의 | `isDemoReadOnly` 조기 반환 | 호출 클라이언트 컴포넌트 |
|---|---|---|---|
| `decideAction` | `actions.ts:53` | ✅ `:58` | `components/DecisionActions.tsx:67`, `components/proposals/DecisionBar.tsx:48` |
| `progressAction` | `actions.ts:69` | ✅ `:73` | `components/ProgressSelect.tsx:70` |
| `createProgressRecordAction` | `actions.ts:84` | ✅ `:88` | `components/ProgressRecordForm.tsx:262` |
| `verificationAction` | `actions.ts:99` | ✅ `:103` | `components/CandidateVerification.tsx:35` |
| `generateAction` | `actions.ts:118` | ✅ `:121` | `components/GenerateCardButton.tsx:47` |
| `simulateAction` | `actions.ts:132` | ❌ **없음** | `components/SimulateButton.tsx:35` |

- `revalidateAll()` = `revalidatePath("/", "layout")` (`actions.ts:42-44`) — 변경 계열 5개만 호출.
  `simulateAction`은 상태를 바꾸지 않아 의도적으로 미호출 (`actions.ts:131` 주석).
- `SimulateButton.tsx`에도 `isDemoReadOnly` 참조 없음(파일 전체 확인) —
  `CandidateVerification.tsx:60` `disabled={... || isDemoReadOnly}`와 대조적.

---

## 4. BE 엔드포인트 16개 — 전수 + 가드

| # | Method | Path | 정의 | 인증 가드 |
|---|---|---|---|---|
| 1 | GET | `/api/health` | `app/main.py:63` | 없음 |
| 2 | GET | `/api/dashboard` | `routes/dashboard.py:9` | 없음 |
| 3 | GET | `/api/candidates` | `routes/dashboard.py:17` | 없음 |
| 4 | GET | `/api/risk-signal` | `routes/dashboard.py:34` | 없음 |
| 5 | GET | `/api/cards` | `routes/cards.py:61` | 없음 |
| 6 | POST | `/api/cards/generate` (201) | `routes/cards.py:74` | `require_mutation_access` (`:78`) |
| 7 | GET | `/api/cards/{cid}` | `routes/cards.py:95` | 없음 |
| 8 | POST | `/api/cards/{cid}/decision` | `routes/cards.py:100` | `require_mutation_access` (`:104`) |
| 9 | POST | `/api/cards/{cid}/simulate` | `routes/cards.py:187` | `require_mutation_access` (`:190`) |
| 10 | POST | `/api/cards/{cid}/progress` | `routes/cards.py:289` | `require_mutation_access` (`:293`) |
| 11 | POST | `/api/cards/{cid}/verification` | `routes/cards.py:324` | `require_mutation_access` (`:328`) |
| 12 | POST | `/api/cards/{cid}/progress-records` (201) | `routes/progress.py:104` | `require_mutation_access` (`:109`) |
| 13 | GET | `/api/cards/{cid}/progress-records` | `routes/progress.py:131` | `require_internal_access` (`:136`) |
| 14 | GET | `/api/progress-report` | `routes/progress.py:150` | `require_internal_access` (`:154`) |
| 15 | GET | `/api/widget/recommend` | `routes/widget.py:80` | 없음 |
| 16 | GET | `/api/kpi` | `routes/kpi.py:50` | 없음 |

라우터 등록: `app/main.py:59-60` — `dashboard, cards, progress, widget, kpi` 전부 `/api` prefix.

### 가드 2종의 차이 (`app/security.py`)
- `require_mutation_access` (`security.py:44`) = `demo_read_only()` → **403** + `_require_bearer`
- `require_internal_access` (`security.py:53`) = `_require_bearer` **만** (읽기 전용 플래그 무관)
- `_require_bearer` (`security.py:17`): `MUTATION_API_TOKEN` 미설정 시 **503** (fail-closed, `:19-23`),
  헤더 없음/형식 오류 401 (`:27-32`), 불일치 401 (`secrets.compare_digest`, `:33`)

---

## 5. BE 파일 전수 (`wc -l`)

```
backend/app/main.py                    85
backend/app/routes/__init__.py          0
backend/app/routes/cards.py           366
backend/app/routes/dashboard.py        47
backend/app/routes/kpi.py              77
backend/app/routes/progress.py        181
backend/app/routes/widget.py          126
backend/app/services/__init__.py        0
backend/app/services/cardgen.py       563
backend/app/services/progress_records.py 218
backend/app/services/progress_report.py  229
backend/app/services/season.py         21
backend/app/services/simulate.py      204
backend/app/services/workflow.py      125
backend/app/db.py                     264
backend/app/progress_db.py            362
backend/app/dataload.py                32
backend/app/llm.py                     93
backend/app/prompts.py                 63
backend/app/security.py                55
backend/app/clock.py                   12
```

---

## 6. FE 컴포넌트 전수 (68개) — `find frontend/src/components -type f`

```
AdminShell, Badge, CandidateVerification, CategoryIcon, CategoryShareBars, CountUp,
DecisionActions, DeltaValue, ExecutionStatus, Footer, GenerateCardButton, Icon,
IncentiveDecision, KakaoMapView, KpiCard, MapView, MapViewClient, MenuDemoGuide,
MockOutcomeReport, OriginalRankingTable, PageHeader, PageSkeleton, Panel, PaybackCycle,
PaybackImpactPanel, PeriodFilter, PolicyFlow, PolicyOutcomeGuide, ProgressRecordForm,
ProgressRecordTimeline, ProgressReportDashboard, ProgressSelect, RankTrace,
RegionDiagnosticMap, RegionFilter, RegionScoreTable, RegionStatusGrid, RegionTileMap,
ScenarioLadder, ScenarioTable, Section, SideNav, SimulateButton, Sparkline, StatusChip,
TodayPick, WidgetLiveRefresh
charts/: BarRank, CategoryDonut, DailyTrend, LineTrend, RegionTrend, ScaleCompare
dashboard/: DashboardDetailSections, DashboardOverview, QuarterDiagnostics, SelectRow,
            StatusBar, WorkQueue
proposals/: DecisionBar, EvidenceSections, ProposalSummary
```

→ 개별 import 사용처 전수 조사는 **서브에이전트 위임분**. 결과는 최종 보고서 §9에 병합.

## 7. FE lib 모듈 (16개)

```
aiSource, api, cardEvents, cardWorkflow, constants, dashboardView, dataFreshness,
errors, format, operator, progressMetrics, progressReportView, regionAnalysis,
runtime, todayPick, weather
```

## 8. mock 파일 (frontend/src/mocks/)

```
candidates.json 348KB · cards.json 23KB · dashboard.json 7KB · eup_scores.json 1KB
merchants.json 330KB · progress_records.json 7KB · risk_signal.json 260B
sensitivity.json 43KB · simulate.json 1.4KB · store.ts 38KB
usage_daily.json 136KB · usage_monthly.json 47KB
```

`api.ts`가 정적 import 하는 것은 6개: dashboard, usage_daily, usage_monthly, candidates,
risk_signal, simulate (`api.ts:36-41`) + `store.ts` (`:42`).
**`eup_scores.json`·`sensitivity.json`은 mocks에 있으나 `api.ts`가 import 하지 않는다**
(sync-mocks.sh가 복사하기 때문에 존재).

---

## 9. data/processed ↔ mocks 동기화 실측 (2026-08-08 기준)

`diff -q` 결과:

| 파일 | 결과 |
|---|---|
| dashboard.json | IDENTICAL |
| eup_scores.json | IDENTICAL |
| merchants.json | IDENTICAL |
| risk_signal.json | IDENTICAL |
| usage_monthly.json | IDENTICAL |
| usage_daily.json | IDENTICAL |
| sensitivity.json | IDENTICAL |
| **candidates.json** | **DIFFERS (의도됨)** |

`candidates.json` 차이는 드리프트가 아니라 설계다:
- `data/processed/candidates.json` = `list` (len=5, 키: id/eup/category/name/lat/lng/score/gap…)
- `frontend/src/mocks/candidates.json` = `dict` (키: eup_ranking/selected_eups/candidates/merchants)
- 근거: `scripts/sync-mocks.sh` 하단 python 블록이 `GET /api/candidates` 병합 응답 형태로 생성.
  주석에 "병합 정본은 backend/app/routes/dashboard.py 의 get_candidates()" 명시.
  실제 `routes/dashboard.py:26-31`과 키 4개가 정확히 일치.

→ **현재 시점 mock↔processed 드리프트 없음.** 단 `sync-mocks.sh`는 수동 실행뿐
(CI/훅 부재 — `.github/` 없음). 드리프트 리스크 평가는 03 체크포인트.
