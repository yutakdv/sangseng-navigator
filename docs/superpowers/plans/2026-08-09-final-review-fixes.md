# 최종 심사 대비 수정 Implementation Plan

> ✅ **상태 (2026-08-09)**: Task 0~18 **전부 완료·머지** (PR #38 감사 P0 · PR #39 수정 16건 스쿼시 `dc393d7`).
> 2차 재검토(보고서 §0)로 라이브 실측 검증 — 신규 회귀 0건, 4인 평균 80.5→82.25.
> 재검토 잔여 4건(보고서 §0-3)은 `fix/review-leftovers` 브랜치에서 처리 완료. D2의
> `RESERVED_CONCURRENCY=20`도 `.env`에 추가 완료. **남은 것은 Phase D(D1·D3~D10 배포·제출 게이트)와 Phase E뿐.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/review/FINAL-REVIEW-20260809.md`의 발견을 반영해 심사 점수를 +5~8점 올리고(코드·문서 수정 Task 1~16), 배포·제출 게이트를 통과시킨다(Phase D 체크리스트).

**Architecture:** 코드 수정은 전부 표시 계층(문구·조건부 렌더·폴백)과 문서에 한정 — 산식·API 계약·시드 서사는 건드리지 않는다. 절대 규칙 3(가정 기반 전망)은 BE가 데이터 계약으로 보장하므로(`cardgen.py:19` `_ensure_assumption`), 중복 문구 제거는 시드가 아니라 **FE 조건부 렌더**로 푼다.

**Tech Stack:** Next.js 16 (App Router, TS) / FastAPI / Docker 통합 환경(FE :3100 · BE :8000 — 현재 기동 중)

**사용자 확정 결정 (2026-08-09):** ① 심사 기간 **쓰기 열림 + 수동 시드 리셋** 운영 ② `nts_biz_100.csv`는 **실활용 추가하지 않고 표현 정정** (활용 시 기대 점수 +0~1 미만 vs 규칙 6 보호 구역 회귀 리스크 — 판정 근거는 아래 Task 5) ③ 범위 **필수 + 차순위 전부**.

## Global Constraints

- **절대 규칙 6개 (CLAUDE.md — 위반 시 즉시 롤백):** ① Gini·HHI 용어 UI 노출 금지("지역 소비 집중도"/"업종별 소비 분산도"로만) ② "지역 전환율" 표시 화면마다 `근사 지표` 배지 병기 ③ 모든 시뮬레이션 출력에 "가정 기반 전망이며 실제와 다를 수 있음" 고정 삽입 ④ AI는 제안만·"실행" 표현 금지 ⑤ AI 조정 시 원 Score 순위 병기 ⑥ 국세청 데이터는 진단 참고용(순위·경고색·지역 비교 금지)
- 커밋: `feat|fix|docs: 요약`(한국어 OK). **main 직접 커밋 금지** — 작업 브랜치는 `fix/final-review` (현재 브랜치 `fix/audit-p0`에서 분기 — 미머지 커밋 `ba3c222`를 포함해 PR 하나로 머지한다).
- **Claude 저자 표기 금지** — `Co-Authored-By: Claude` 트레일러·"Generated with Claude Code" 푸터 금지.
- FE 검증 3종(모든 FE 태스크 공통): `cd frontend && npx tsc --noEmit && npm run lint && npm run check:banned`
- 파이썬은 `python3` (이 환경에 `python` 없음). BE 테스트: `cd backend && DYNAMO_ENDPOINT=http://localhost:8001 python3 -m pytest -q`
- 화면 확인: Docker 통합 환경이 떠 있다. FE는 dev 모드 핫리로드이므로 수정 후 `curl -s http://localhost:3100/<route>`로 즉시 검증 가능. 보이는 텍스트 추출:
  `curl -s <URL> | python3 -c "import sys,re,html; t=sys.stdin.read(); t=re.sub(r'<(script|style).*?</\1>','',t,flags=re.S); t=re.sub(r'<[^>]+>',' ',t); print(html.unescape(re.sub(r'[ \t]+',' ',t)))"`
- 시드 리셋(BE 데이터 원복): `docker compose run --rm seed`
- **배포는 Phase D에서 최종 1회만** (docs/plan/09 §4). Task 1~16 중 배포 명령 실행 금지.

---

## Stage 0 — 브랜치 준비

### Task 0: 작업 브랜치 생성

**Files:** 없음 (git만)

- [ ] **Step 1: 현재 상태 확인 후 브랜치 생성**

```bash
cd /Users/yutak/Desktop/sangseng-navigator
git status --short   # 추적 외 파일(docs/plan/21, docs/review/, docs/superpowers/plans/)만 있어야 함
git checkout -b fix/final-review
```

- [ ] **Step 2: 검토 산출물 먼저 커밋** (보고서·프롬프트·이 계획서)

```bash
git add docs/plan/21-final-judging-review-prompt.md docs/review/ docs/superpowers/plans/2026-08-09-final-review-fixes.md
git commit -m "docs: 최종 심사 대비 검토 보고서·프롬프트·수정 계획 추가"
```

---

## Stage 1 — 점수 방어 핵심 (P0)

### Task 1: 추천 순위 안정도에 층위 추가 (최대 단일 점수 회수)

**Files:**
- Modify: `frontend/src/lib/constants.ts:75-76`

**Interfaces:** `STABILITY_NOTE` 상수 하나 — `/dashboard`(page.tsx:692 desc), `ProposalSummary.tsx:127`(허브·제안 상세) 3개 라우트가 공유하므로 이 한 곳만 고치면 전부 반영된다.

- [ ] **Step 1: 상수 교체.** 현재:

```ts
export const STABILITY_NOTE =
  "가중치 조합에서 상위 3개 후보가 유지된 비율입니다. 후보 요인이 동률로 고정된 경우에는 선발 기준의 다양성이나 강건성을 의미하지 않습니다.";
```

교체:

```ts
export const STABILITY_NOTE =
  "가중치 95개 조합 전수 재계산에서 상위 3개 후보 순위가 그대로 유지된 비율입니다. 같은 조합에서 제안 대상 지역(영월군·삼척시) 선정은 60%, 영월군 포함은 100% 유지됩니다 — 흔들리는 것은 후보 순번이지 대상 지역이 아닙니다. 후보 요인이 동률로 고정된 경우에는 선발 기준의 다양성이나 강건성을 의미하지 않습니다.";
```

(수치 근거: `data/processed/sensitivity.json` 직접 집계 — 영월·삼척 조합 유지 57/95=60.0%, 영월군 포함 95/95=100%, Top3 집합 유지 15/95=15.8%. 검토 보고서 §5-3에서 재검증 완료.)

- [ ] **Step 2: 3개 라우트에서 렌더 확인**

```bash
for r in dashboard proposals/AC-002 ""; do curl -s http://localhost:3100/$r | grep -o "영월군 포함은 100%" | head -1; done
```

Expected: 세 줄 모두 `영월군 포함은 100%` 출력.

- [ ] **Step 3: FE 검증 3종 실행** — Expected: 오류 0 (문구에 Gini·HHI 없음 → check:banned 통과)

- [ ] **Step 4: Commit** — `git commit -am "fix: 추천 순위 안정도에 지역 선정 60%·영월군 100% 층위 병기 (검토 §5-3)"`

### Task 2: 허브 히어로에 서비스 맥락 + 사행성 방어 한 줄

**Files:**
- Modify: `frontend/src/components/dashboard/DashboardOverview.tsx:126-128`

- [ ] **Step 1: 히어로 부제 교체.** 현재:

```tsx
<p className="mt-2.5 max-w-2xl break-keep text-sm leading-7 text-admin-text-soft sm:text-[15px]">
  AI 제안은 결론이 아닙니다. 근거와 예상 효과를 상세에서 확인한 뒤 결정하고 실행으로 넘깁니다.
</p>
```

교체 (문단 2개 — 첫 줄이 맥락, 둘째 줄이 기존 문구+사행성 방어):

```tsx
<p className="mt-2.5 max-w-2xl break-keep text-sm leading-7 text-admin-text-soft sm:text-[15px]">
  강원랜드 하이원포인트(방문객이 적립해 지역 가맹점에서 쓰는 포인트)의 소비가 폐광지역
  4개 시군 어디에 쏠렸는지 진단하고, 이번 분기 가맹점 확충과 인센티브를 결정합니다.
</p>
<p className="mt-1.5 max-w-2xl break-keep text-[13px] leading-6 text-admin-text-muted">
  AI 제안은 결론이 아닙니다 — 근거와 예상 효과를 상세에서 확인한 뒤 담당자가 결정합니다.
  포인트 적립률·발행액은 그대로 두고, 이미 적립된 포인트의 지역 사용만 다룹니다.
</p>
```

- [ ] **Step 2: 렌더 확인**

```bash
curl -s http://localhost:3100/ | grep -c "폐광지역"
```

Expected: `1` 이상 (기존 실측 0회 → 해소).

- [ ] **Step 3: FE 검증 3종** — Expected: 통과 ("실행"이라는 단어를 새 문구에 쓰지 않았는지 육안 재확인 — 위 문구에는 없음)

- [ ] **Step 4: Commit** — `git commit -am "fix: 허브 히어로에 하이원포인트 정의·폐광지역 맥락·사용 단계 한정 문구 추가 (검토 §3-1)"`

### Task 3: 고정 시드 카드의 상태 라벨 정합

**Files:**
- Modify: `frontend/src/lib/cardWorkflow.ts:102`
- Modify: `frontend/src/components/dashboard/WorkQueue.tsx:124`

- [ ] **Step 1: pending 워크플로 라벨 교체.** `cardWorkflow.ts:102` 현재 `if (card.status === "pending") return "AI 제안 생성";` → `if (card.status === "pending") return "담당자 결정 대기";`
  (사유: "AI 호출 없이 작성" 고지 칩과 정면 상충 — 고정 시드·실시간 생성 양쪽에 참인 서술로 교체. 검토 §6.)

- [ ] **Step 2: 조정 칩 문구 교체.** `WorkQueue.tsx:124` 현재 `AI가 순위 반영` → `순위 조정 · 원 순위 병기`
  (AC-002의 조정 주체는 결정론적 서버 규칙이므로 더 정확하고, 절대 규칙 5의 병기 사실을 라벨이 직접 말한다.)

- [ ] **Step 3: 참조 확인 + 렌더 확인**

```bash
grep -rn "AI 제안 생성\|AI가 순위 반영" frontend/src   # 잔여 참조 0이어야 함 (테스트 참조 없음 확인됨)
curl -s http://localhost:3100/ | grep -c "담당자 결정 대기"
```

Expected: grep 0건 · curl 1 이상.

- [ ] **Step 4: FE 검증 3종 → Commit** — `git commit -am "fix: pending 라벨·조정 칩을 출처 고지와 상충하지 않는 서술로 교체 (검토 §6)"`

### Task 4: "가정 기반 전망" 동일 문장 연속 2회 인쇄 제거 (FE 조건부 렌더)

**Files:**
- Modify: `frontend/src/components/Badge.tsx:47` (AssumptionNote)
- Modify: `frontend/src/app/cards/[id]/page.tsx:396` · `frontend/src/components/proposals/EvidenceSections.tsx:129` · `frontend/src/app/incentive/page.tsx:198` (호출부 3곳)
- Modify: `frontend/src/components/PaybackImpactPanel.tsx:120` (같은 섹션 내 중복 1건 삭제)

**Interfaces:** `AssumptionNote({ className?, dedupeWith? })` — `dedupeWith` 문자열이 `ASSUMPTION_NOTE`를 이미 포함하면 렌더 생략. **절대 규칙 3 판정**: 문구는 본문(`expected_effect`) 안에 그대로 남으므로 블록당 1회 이상 가시 노출이 항상 유지된다. BE 계약(`cardgen._ensure_assumption`)은 건드리지 않는다 — 시드·mock 수정 불필요, 재시드 불필요.

- [ ] **Step 1: AssumptionNote에 dedupeWith 추가.** `Badge.tsx:47` 현재 시그니처 `export function AssumptionNote({ className = "" }: { className?: string })` → 교체:

```tsx
/** 배지만으로 막지 못하는 오인을 본문으로 차단 — 블록 하단 고정 문구 (절대 규칙 3).
 *  본문(dedupeWith)이 이미 같은 문장을 담고 있으면 같은 문장을 연달아 두 번 찍지 않는다 —
 *  규칙 3은 본문 쪽 문구가 계속 충족한다 (BE cardgen._ensure_assumption이 데이터 계약으로 보장). */
export function AssumptionNote({
  className = "",
  dedupeWith,
}: {
  className?: string;
  dedupeWith?: string;
}) {
  if (dedupeWith?.includes(ASSUMPTION_NOTE)) return null;
  return (
```

(함수 본문의 나머지 return JSX는 그대로 유지.)

- [ ] **Step 2: 호출부 3곳에 dedupeWith 전달.**
  - `cards/[id]/page.tsx:396`: `<AssumptionNote className="mt-2" />` → `<AssumptionNote className="mt-2" dedupeWith={card.ai.expected_effect} />`
  - `EvidenceSections.tsx:129`: `<AssumptionNote className="mt-4 border-t border-admin-border pt-3" />` → `<AssumptionNote className="mt-4 border-t border-admin-border pt-3" dedupeWith={card.ai.expected_effect} />`
  - `incentive/page.tsx:198`: `<AssumptionNote className="mt-2" />` → `<AssumptionNote className="mt-2" dedupeWith={card.ai.expected_effect} />`

- [ ] **Step 3: /incentive 시나리오 섹션의 15줄 간격 중복 1건 삭제.** `PaybackImpactPanel.tsx:120`의 `<AssumptionNote className="mt-1.5" />` 줄 삭제. (같은 섹션 하단 `ScenarioTable.tsx:152`의 AssumptionNote와 섹션 헤더 `AssumptionBadge`(incentive/page.tsx:160)가 남으므로 규칙 3 충족 유지 — 검토 §5-2 처방.)

- [ ] **Step 4: 렌더 확인 — 연속 2회 인쇄 소멸**

```bash
curl -s http://localhost:3100/cards/AC-002 | python3 -c "import sys,re,html; t=sys.stdin.read(); t=re.sub(r'<(script|style).*?</\1>','',t,flags=re.S); t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(re.sub(r'\s+',' ',t)); print(t.count('가정 기반 전망이며 실제와 다를 수 있음'))"
```

Expected: `1` (본문 괄호 1회만 — 기존 2). `/proposals/AC-002`·`/incentive`도 동일 명령으로 각 블록 내 연속 중복이 사라졌는지 확인 (인센티브 페이지 전체 카운트는 ScenarioTable 잔존분 때문에 2 — 연속 아님이 정상).

- [ ] **Step 5: FE 검증 3종 → Commit** — `git commit -am "fix: 가정 기반 전망 문구 동일 문장 연속 2회 인쇄 제거 — AssumptionNote 조건부 렌더 (검토 §5-2)"`

### Task 5: README·제출 문안 정정 (국세청 표현 + 표 깨짐)

**Files:**
- Modify: `README.md:44-46`
- Modify: `docs/plan/12-submission-compliance.md:38`

**판정 근거 (사용자 요청 체크 완료):** `nts_biz_100.csv`(24,434행)는 참조가 `docs/plan/04`(수령 절차)뿐 — 파이프라인·BE·FE 미사용. 실활용 추가는 기대 +0~1 미만 vs 절대 규칙 6 보호 구역 수정 리스크 60~90분이라 **표현 정정 채택**. 데이터는 삭제하지 않는다("검토했다" 증거 보존).

- [ ] **Step 1: README:44 국세청 행 정정 + :45 빈 줄 삭제.** 현재 44~46행:

```markdown
| 국세청_사업자현황 (100대 생활업종·존속연수별) | 국세청 | 파일데이터(CSV) | 지역경제 위험 신호 (진단 참고용 파생지표) |

| 기상청_단기예보 조회서비스 (초단기실황) | 기상청 · 공공데이터포털 | 오픈 API | 방문객 위젯 "오늘의 추천"의 현재 기온·강수 |
```

교체 (빈 줄 제거로 표 복구 + 존속연수별로 한정):

```markdown
| 국세청_사업자현황 (사업존속연수별) | 국세청 | 파일데이터(CSV) | 지역경제 위험 신호 (진단 참고용 파생지표) |
| 기상청_단기예보 조회서비스 (초단기실황) | 기상청 · 공공데이터포털 | 오픈 API | 방문객 위젯 "오늘의 추천"의 현재 기온·강수 |
```

- [ ] **Step 2: 제출 문안 정정.** `docs/plan/12-submission-compliance.md:38` 현재 `... 국세청_사업자현황(100대 생활업종·존속연수별)` → `... 국세청_사업자현황(사업존속연수별)`

- [ ] **Step 3: 잔여 "2종" 표현 전수 확인**

```bash
grep -rn "100대 생활업종" README.md docs/plan/11-demo-and-qa.md docs/plan/12-submission-compliance.md
```

Expected: 0건 (docs/plan/04는 수령 절차 기록이므로 그대로 둔다).

- [ ] **Step 4: Commit** — `git commit -m "docs: 국세청 활용 표현을 실사용(존속연수별)으로 정정 + README 데이터 표 렌더 복구 (검토 §1 경고)"` (README·12 문서만 add)

---

## Stage 2 — 완성도·안정성

### Task 6: /tracking 503 전면 추락 함정 제거

**Files:**
- Modify: `frontend/src/app/tracking/page.tsx:79-84`

- [ ] **Step 1: catch 조건에 503 추가.** 현재:

```tsx
      // 401 = 내부 토큰 미설정(배포 시 `API_MUTATION_TOKEN` 누락). 이때 페이지 전체를 에러
      // 바운더리로 떨어뜨리면 심사 동선(11 대본 6단계)이 통째로 막힌다 — 리포트만 접고
      // 업무 목록은 살린다. 왜 비었는지는 아래 안내 배너가 밝힌다.
      if (error instanceof ApiError && error.status === 401) {
        return { report: null as ProgressReport | null, fellBack: false };
      }
```

교체:

```tsx
      // 401 = 내부 토큰 미설정(배포 시 `API_MUTATION_TOKEN` 누락), 503 = BE 쪽 토큰 미설정
      // (DEMO_READ_ONLY=true + MUTATION_API_TOKEN 공란 조합 — deploy 가드를 조용히 통과한다).
      // 어느 쪽이든 페이지 전체를 에러 바운더리로 떨어뜨리면 심사 동선(11 대본 6단계)이 통째로
      // 막힌다 — 리포트만 접고 업무 목록은 살린다. 왜 비었는지는 아래 안내 배너가 밝힌다.
      if (error instanceof ApiError && (error.status === 401 || error.status === 503)) {
        return { report: null as ProgressReport | null, fellBack: false };
      }
```

- [ ] **Step 2: FE 검증 3종 + 정상 화면 회귀 확인** — `curl -s http://localhost:3100/tracking | grep -c "추진 경과 리포트"` Expected: 1 이상 (정상 경로 영향 없음).

- [ ] **Step 3: Commit** — `git commit -am "fix: /tracking 리포트 503도 부분 격리 — 읽기 전용 급선회 시 전면 추락 방지 (검토 §7 신규-1)"`

### Task 7: /widget 전면 장애 단일점 제거

**Files:**
- Modify: `frontend/src/app/widget/page.tsx:64,306`

- [ ] **Step 1: dashboard 호출에 catch.** `:64` `api.dashboard(),` → 교체:

```tsx
      // 푸터 "데이터 기준" 한 줄 전용 — 이 엔드포인트만 죽어도 방문객 위젯 전체가 에러 화면이
      // 되면 안 된다 (아래 candidates와 같은 방어 관용구).
      api.dashboard().catch(() => null),
```

- [ ] **Step 2: 푸터 조건부 렌더.** `:306` `<p>데이터 기준: {dashboard.period_note}</p>` → `{dashboard ? <p>데이터 기준: {dashboard.period_note}</p> : null}`

- [ ] **Step 3: FE 검증 3종** — `tsc`가 `dashboard` nullable 파생 사용처를 잡으면 해당 사용처에도 `?.` 적용 (구조분해 시점에 `Dashboard | null`이 된다 — `:306` 외 사용처는 grep으로 확인: `grep -n "dashboard\." frontend/src/app/widget/page.tsx`).

- [ ] **Step 4: 렌더 확인 → Commit** — `curl -s http://localhost:3100/widget | grep -c "데이터 기준"` Expected: 1 (정상 경로 유지). `git commit -am "fix: /widget이 dashboard 엔드포인트 장애에 전면 추락하지 않게 격리 (검토 §7 신규-5)"`

### Task 8: api.ts fetch 타임아웃 (무한 스켈레톤 봉쇄)

**Files:**
- Modify: `frontend/src/lib/api.ts:69-72,93-100`

- [ ] **Step 1: get()에 10초 타임아웃.** `:69-72` fetch 옵션에 한 줄 추가:

```tsx
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: internalToken ? { Authorization: `Bearer ${internalToken}` } : undefined,
    // BE가 거부가 아니라 무응답으로 매달리면 스켈레톤이 무한 지속된다 — 콜드스타트(1~3초)의
    // 여유를 두고 끊어 error.tsx의 "다시 시도" 화면으로 회복시킨다.
    signal: AbortSignal.timeout(10_000),
  });
```

- [ ] **Step 2: postWithStatus()에 30초 타임아웃.** `:93-100` fetch 옵션에 `signal: AbortSignal.timeout(30_000),` 추가.
  **주의: 10초로 잡지 말 것** — generate는 LLM 재시도 포함 최대 24.5초(감사 §1), simulate도 LLM 8초를 품는다. 30초는 BE 자체 타임아웃(24.5s)보다 길어 정상 경로를 절대 자르지 않는다.

- [ ] **Step 3: FE 검증 3종 + 정상 렌더 확인** — 8라우트 중 2곳 curl 200 확인. Expected: 통과.

- [ ] **Step 4: Commit** — `git commit -am "fix: api.ts fetch 타임아웃(GET 10s·POST 30s) — BE 무응답 시 무한 스켈레톤 방지 (검토 §4-③)"`

### Task 9: 전용 loading.tsx 2개 신설

**Files:**
- Create: `frontend/src/app/proposals/[id]/loading.tsx`
- Create: `frontend/src/app/tracking/new/loading.tsx`

- [ ] **Step 1: 두 파일 생성 — 내용은 기존 `cards/[id]/loading.tsx`와 동일 패턴:**

```tsx
import { PageSkeleton } from "@/components/PageSkeleton";

/** 목록·표 중심 담당자 화면의 로딩 스켈레톤 — 본문 폭 max-w-6xl 기준 (허브만 1600px) */
export default function Loading() {
  return <PageSkeleton variant="page" />;
}
```

(현재는 루트 `app/loading.tsx`의 허브형(1600px) 스켈레톤이 상속돼 실화면(max-w-5xl/6xl)과 골격이 달라 전환 점프가 생긴다 — 검토 §3-2.)

- [ ] **Step 2: 스트림 확인** — `curl -s http://localhost:3100/proposals/AC-002 | head -c 3000 | grep -c "불러오는 중"` Expected: 1 이상 (스켈레톤이 첫 조각으로 스트리밍).

- [ ] **Step 3: FE 검증 3종 → Commit** — `git commit -m "fix: proposals/[id]·tracking/new 전용 로딩 스켈레톤 — 허브형 골격 점프 제거 (감사 L7·검토 §7)" frontend/src/app/proposals frontend/src/app/tracking`

---

## Stage 3 — 차순위 강화

### Task 10: 데이터 원천 패널을 공공데이터 6종으로 확장

**Files:**
- Modify: `frontend/src/components/dashboard/DashboardOverview.tsx:325-344`

- [ ] **Step 1: 원천 URL 확인** — `docs/plan/04-env-and-data.md` §1-2에서 카지노 입장객·소진공·기상청의 data.go.kr 상세 페이지 URL을 찾는다 (없는 항목은 `href` 생략 — SourceRow의 href는 옵션).

- [ ] **Step 2: 제목·행 확장.** `:328` `데이터 원천` → `데이터 원천 · 공공데이터 6종`. `:341` `<SourceRow label="상권 후보 원천" value="기준월 · 2026.06" />` 아래에 3행 추가:

```tsx
  <SourceRow label="카지노 입장객 (전환율 분모)" value="교대 합산 연인원" />
  <SourceRow label="국세청 사업자현황 (존속연수별)" value="진단 참고용" />
  <SourceRow label="기상청 초단기실황" value="방문객 위젯 전용" />
```

(Step 1에서 URL을 찾았으면 각 행에 `href` 병기. 국세청 행에 순위·경고 뉘앙스 금지 — 절대 규칙 6.)

- [ ] **Step 3: 렌더 확인 → FE 검증 3종 → Commit** — `curl -s http://localhost:3100/ | grep -c "공공데이터 6종"` Expected: 1. `git commit -am "feat: 허브 데이터 원천 패널을 공공데이터 6종 전체로 확장 (검토 §4-②)"`

### Task 11: /dashboard 맥락·출처 보강 3건

**Files:**
- Modify: `frontend/src/app/dashboard/page.tsx:127,141,653,672-674`

- [ ] **Step 1: lede에 폐광지역·용어 정의.** `:127` 현재 lede를 교체:

```
lede="폐광지역 4개 시군(정선·태백·영월·삼척 도계읍)에서 하이원포인트(강원랜드 방문객이 적립해 지역 가맹점에서 쓰는 포인트) 소비가 어디에 얼마나 몰려 있는지 본다. 이 화면의 값이 확충 제안의 정량 출발점이다."
```

(기존 "Action Card 제안의" → "확충 제안의" — 내부 용어 노출 완화, 검토 §3-2 blockers.)

- [ ] **Step 2: 지역 필터 힌트에 예시.** `:141` 문장 끝 `좁혀 볼 수 있습니다.` → `좁혀 볼 수 있습니다. (예: 진단 1위 영월군)`

- [ ] **Step 3: 국세청 카드 출처 명시 + 중복 각주 삭제.** `:653` desc 앞에 출처 접두 — `desc="국세청 사업자등록 데이터 기준 — 지역 상권의 배경 정보다. 4개 시군 편차가 0.5%p 수준이라 지역 간 비교나 순위 근거로는 쓰지 않는다."` / `:672-674`의 u-note(`차이가 없는 값이라 막대·순위 없이 수치만 적는다 — 진단 참고용 배경 정보다.`) 문단 삭제 (desc와 내용 중복 — 검토 §5-2 dense_spots).

- [ ] **Step 4: 렌더·검증·커밋** — `curl -s "http://localhost:3100/dashboard" | grep -c "폐광지역"` Expected: 1 이상. FE 검증 3종. `git commit -am "fix: 대시보드 lede 폐광지역 맥락·국세청 출처 명시·중복 각주 정리 (검토 §4-⑤·§5-2)"`

### Task 12: /tracking 시연 기록 고지 + 지역 사용액 의도 표기

**Files:**
- Modify: `frontend/src/app/tracking/page.tsx:157`
- Modify: `frontend/src/components/ProgressReportDashboard.tsx:439-444`

- [ ] **Step 1: lede에 시연 고지.** `:157` lede 끝에 한 문장 추가:

```
lede="담당자가 남긴 실제 경과 기록으로 상태 분포, 정체 항목, 목표일 준수와 관측 성과 변화를 확인합니다. 예상값은 실제 성과에 섞지 않습니다. 현재 기록은 데모용 시연 표본입니다."
```

(경과 기록 날짜(2026.06~08)가 데이터 기준(2025-12)보다 미래인 모순 지적을 선제 차단 — 검토 §3-2·질문 3.)

- [ ] **Step 2: 지역 사용액 빈 타일 의도 표기.** `ProgressReportDashboard.tsx:439-444`의 빈 상태(`비교 전`) 블록에서, 해당 지표가 지역 사용액일 때 전용 문구를 보이게 한다. 먼저 지표 키 확인: `grep -n "spend\|사용액" frontend/src/lib/progressMetrics.ts frontend/src/components/ProgressReportDashboard.tsx` — 키 이름(예상: `spend_krw` 계열)과 이 블록에서 접근 가능한 메타 변수명을 확인한 뒤, `:441-443`의 안내 문단을 조건 분기로 교체:

```tsx
<p className="mt-1 break-keep text-[11px] leading-4 text-admin-text-muted">
  {/* 원천 공개 데이터에 금액 필드가 없어 시드가 지어내지 않는다 (13 §2-13) — 의도된 공백임을 밝힌다 */}
  {meta.key === "spend_krw"
    ? "원천 공개 데이터에 금액 필드가 없어, 담당자 실측 입력 전까지 비워 둡니다."
    : "같은 카드의 실측값을 두 번 이상 입력해야 합니다."}
</p>
```

(실제 키·변수명은 Step 2 grep 결과에 맞춘다 — 키가 다르면 그 키로.)

- [ ] **Step 3: 렌더·검증·커밋** — `curl -s http://localhost:3100/tracking | grep -c "비워 둡니다"` Expected: 1. FE 검증 3종. `git commit -am "fix: 트래킹 시연 기록 고지 + 지역 사용액 공백의 의도 표기 (검토 §4-④)"`

### Task 13: /widget 헤더에 담당자 화면 링크 (폐루프 발견율)

**Files:**
- Modify: `frontend/src/app/widget/page.tsx:134-139`

- [ ] **Step 1: 헤더 우측에 미니 링크.** `:134-139`의 헤더 첫 줄 flex 컨테이너를 교체:

```tsx
          <div className="relative flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/90">
              강원랜드 지역상생
            </p>
            <span className="flex items-center gap-2">
              {live ? <WidgetLiveRefresh /> : null}
              {/* 두 얼굴(담당자↔방문객) 연결 고리가 최하단에만 있으면 모바일 심사에서 폐루프
                  서사를 놓친다 (검토 §3-2) — 하단 줄은 유지하고 헤더에도 짧게 건다 */}
              <Link href="/" className="text-[11px] font-semibold text-white/85 underline underline-offset-2">
                담당자 화면 →
              </Link>
            </span>
          </div>
```

(`Link`는 이 파일이 이미 import — `:316` 사용 확인.)

- [ ] **Step 2: 렌더·검증·커밋** — `curl -s http://localhost:3100/widget | grep -c "담당자 화면 →"` Expected: 1. FE 검증 3종. `git commit -am "feat: 위젯 헤더에 담당자 화면 링크 — 폐루프 발견율 개선 (검토 §4-①)"`

### Task 14: 소소한 문구 정합 3건

**Files:**
- Modify: `frontend/src/components/DecisionActions.tsx:101`
- Modify: `frontend/src/app/incentive/page.tsx:136-140`
- Modify: `frontend/src/components/ProgressRecordForm.tsx:511`

- [ ] **Step 1:** `DecisionActions.tsx:101` `확정 rate는 담당자가 고른 값만 저장됩니다.` → `확정 페이백률은 담당자가 고른 값만 저장됩니다.`
- [ ] **Step 2:** `incentive/page.tsx:138-139` `적립률을 건드리지 않으므로 콤프 발행액은 늘지 않습니다.` → `적립률을 건드리지 않으므로 콤프(게임 참여시간·베팅액에 비례해 적립되는 보상 포인트) 발행액은 늘지 않습니다.` (하단 PaybackCycle 각주의 정의를 첫 등장 지점으로 당김 — 검토 §3-2.)
- [ ] **Step 3:** `ProgressRecordForm.tsx:511` 문장 중 `같은 산식으로` → `같은 계산 기준으로` (앞뒤 문구는 그대로).
- [ ] **Step 4: FE 검증 3종 → Commit** — `git commit -am "fix: 용어 정합 3건 — rate→페이백률·콤프 첫 정의·산식 순화 (검토 §3-2)"`

### Task 15: prompts.py 금칙어 보험 1줄

**Files:**
- Modify: `backend/app/prompts.py` (CARD_SYSTEM_PROMPT의 `규칙:` 목록 끝)

- [ ] **Step 1: 규칙 한 줄 추가.** `- 입력 8(요일 패턴)은 참고용 — …` 다음 줄에:

```
- 지니·Gini·HHI·허핀달 같은 지수 명칭을 출력에 쓰지 말 것 — 화면 용어는 "지역 소비 집중도"·"업종별 소비 분산도"뿐이다
```

- [ ] **Step 2: BE 테스트 실행** — `cd backend && DYNAMO_ENDPOINT=http://localhost:8001 python3 -m pytest -q` Expected: 65 passed (프롬프트 문자열 검사 테스트가 있으면 그에 맞게 조정 — 실패 시 실패 테스트만 읽고 판단).
  (참고: BE 컨테이너는 코드 마운트가 아니면 재빌드 필요하나, 이 변경은 실 LLM 호출 시에만 효력 — 로컬 검증은 테스트로 충분.)

- [ ] **Step 3: Commit** — `git commit -am "fix: LLM 프롬프트에 지수 명칭 금지 1줄 — 절대 규칙 1 회귀 보험 (감사 M5)"`

### Task 16: 근사 지표 정의 모바일 노출 (인센티브 화면)

**Files:**
- Modify: `frontend/src/app/incentive/page.tsx` (시나리오 비교 Section의 desc — `:164` 부근)

- [ ] **Step 1: 시나리오 섹션 desc에 정의 병기.** 현재 desc `개선폭은 단정하지 않고 범위로 적으며, 재원 부담은 정성 표기입니다(원천 데이터에 금액 필드가 없어 예산·ROI는 산출하지 않습니다).` 끝에 한 문장 추가:

```
 지역 전환율은 분자(지역 사용 건수)와 분모(입장 연인원)의 단위가 달라 비율이 아닌 근사 지표입니다.
```

(ProxyBadge는 그대로 유지 — 절대 규칙 2는 배지+본문 병기로 강화된다. title 툴팁이 터치에서 안 열리는 문제의 보완 — 검토 §3-2.)

- [ ] **Step 2: 렌더·검증·커밋** — `curl -s http://localhost:3100/incentive | grep -c "단위가 달라 비율이 아닌"` Expected: 1 이상. FE 검증 3종. `git commit -am "fix: 인센티브 화면에 근사 지표 정의 본문 노출 — 터치 기기 보완 (검토 §4-②)"`

---

## Stage 4 — 종합 검증·머지

### Task 17: 종합 검증 배치

**Files:** 없음 (검증만)

- [ ] **Step 1: FE 전체** — `cd frontend && npx tsc --noEmit && npm run lint && npm run check:banned && npm run build` Expected: 전부 통과 (build까지 — Vercel 배포 전 사전 검증).
- [ ] **Step 2: BE + 파이프라인 테스트** — `cd backend && DYNAMO_ENDPOINT=http://localhost:8001 python3 -m pytest -q` → 65 passed / `cd pipeline && python3 -m pytest tests -q` → 4 passed.
- [ ] **Step 3: 시드 리셋 후 8라우트 스모크** — `docker compose run --rm seed` 후:

```bash
for r in "" dashboard "dashboard?region=영월군" cards/AC-002 proposals/AC-002 incentive tracking tracking/new widget; do
  echo "== /$r $(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3100/$r")"; done
```

Expected: 전부 200.
- [ ] **Step 4: 핵심 assertion 재확인** — Task 1~16의 curl 검증 명령을 한 번씩 재실행 (특히 `영월군 포함은 100%`·`폐광지역`·`담당자 결정 대기`·중복 카운트 1·`공공데이터 6종`).
- [ ] **Step 5: 검토 보고서와 대조** — `docs/review/FINAL-REVIEW-20260809.md` §11 TOP 10 표의 코드 항목이 전부 반영됐는지 체크리스트로 확인.

### Task 18: PR 생성 → main 머지

- [ ] **Step 1: push + PR.**

```bash
git push -u origin fix/final-review
gh pr create --base main --title "fix: 최종 심사 대비 수정 — 점수 방어 16건 (검토 보고서 반영)" --body "## 요약
docs/review/FINAL-REVIEW-20260809.md의 발견 반영. fix/audit-p0(감사 P0 3건, ba3c222)를 포함한다.

- 안정도 층위(60%/100%)·허브 맥락·라벨 정합·중복 문구 제거·국세청 표현 정정
- 503/타임아웃/widget 격리·loading 2개
- 데이터 원천 6종·폐광지역 명시·시연 고지·위젯 링크·용어 3건·프롬프트 보험

## 검증
- FE: tsc·lint·check:banned·build 통과 / BE: 65 passed / pipeline: 4 passed
- 8라우트 curl 200 + 핵심 문구 assertion 통과 (계획서 Task 17)"
```

(PR 본문에 Claude 관련 푸터 넣지 않는다.)
- [ ] **Step 2: 머지.** 리뷰(팀원 또는 셀프 확인) 후 `gh pr merge --squash` — 이 머지로 **Vercel 자동 배포가 시작된다는 점을 인지하고 Phase D와 순서를 맞춘다** (Vercel 프로젝트가 아직 없으면 무해).

---

## Phase D — 배포·제출 게이트 (🧑 = 사람 수동 / 🤖 = Claude 실행 가능, 순서대로)

> 전제: Task 18 머지 완료. 상세 근거는 검토 보고서 §2. **D4(BE 배포)는 "최종 1회" 규칙의 그 1회다 — 실행 전 사용자 확인.**

- [ ] **D1 🧑 Vercel 프로젝트 연동** — vercel.com에서 GitHub 레포 import, **Root Directory=`frontend`** 지정 → 첫 Production 배포로 `https://<project>.vercel.app` 확보. Settings→Deployment Protection **전부 OFF** 확인.
- [ ] **D2 🤖 `.env` 보강** — `ALLOWED_ORIGINS=https://<확보한 도메인>` 추가, ~~`RESERVED_CONCURRENCY=20` 추가~~ ✅ 완료(2026-08-09, `deploy-backend.sh:18` 지원 확인). `ALLOWED_ORIGINS`만 D1에서 도메인 확보 후 추가.
- [ ] **D3 🤖 배포 전 점검** — `cd infra && sam validate --lint` 통과 재확인, `git log main -1`이 머지 커밋인지 확인.
- [ ] **D4 🧑승인 후 🤖 BE 최종 배포** — `cd infra && ./deploy-backend.sh` → 출력의 `ApiUrl`·`CardsTable`·`ProgressRecordsTable` 기록.
- [ ] **D5 🧑 Vercel Production env 등록 후 Redeploy** — ① `NEXT_PUBLIC_API_BASE`=ApiUrl ② `API_MUTATION_TOKEN`=.env의 `MUTATION_API_TOKEN`과 **동일 값** (NEXT_PUBLIC_ 접두 금지) ③ `NEXT_PUBLIC_DEMO_READ_ONLY=false` (쓰기 열림 결정) ④ `NEXT_PUBLIC_KAKAO_MAP_KEY` ⑤ `DATA_GO_KR_API_KEY`. NEXT_PUBLIC_* 는 빌드타임 인라인 — **등록 후 반드시 Redeploy**.
- [ ] **D6 🧑 Kakao 개발자 콘솔** — Web 플랫폼에 Vercel 프로덕션 도메인 등록 (미등록 시 /widget 지도가 정적 폴백 — 검토 §7 신규-2).
- [ ] **D7 🤖 원격 시드 리셋 + 명령 기록** — `CARDS_TABLE=<D4 출력> PROGRESS_RECORDS_TABLE=<D4 출력> python3 backend/seed_demo.py --reset` 실행 → 성공한 명령 한 줄을 `docs/plan/11-demo-and-qa.md` §4 점검 목록에 추가 커밋. **심사 기간 오염 복구는 이 명령 수동 재실행** (매일 아침 + 발표 직전 — 쓰기 열림 운영 결정).
- [ ] **D8 🤖 URL 기입 커밋** — `README.md:8` 실 URL(플레이스홀더·괄호 문구 제거), `docs/plan/12-submission-compliance.md:40` 동일 갱신 → main에 커밋(핫픽스 성격 — 팀 규칙상 브랜치 경유 권장).
- [ ] **D9 🧑 스모크 3종** — ① 시크릿 창: 홈→카드 상세→시뮬레이션→승인→트래킹→위젯 한 바퀴 (완주 후 D7 리셋 재실행) ② 휴대폰 LTE(사내망 아님): 홈·위젯·카드 상세 + 배지 툴팁 한계 확인 ③ 콜드스타트: 15분 방치 후 첫 접속 체감.
- [ ] **D10 🧑 제출물 마감** — 허브 화면 1920×1080 캡처 → README `:32` 이미지 교체·`:34` "디자인 목업" 캡션 삭제 → 제출 양식(12 문서 §3 문안) 전 필드 기재 → AWS Billing $1 알림 확인 → `git tag submission-final && git push origin submission-final` → main 동결. **심사 종료 전 `sam delete` 금지.**

## Phase E — 발표 대비 (코드 아님 — 발표 자료·리허설)

- [ ] E1. 민감도 슬라이드를 층위본으로: "95개 조합 전수 — Top3 순위 유지 16% / **대상 지역 선정 60% / 영월군 포함 100%**" (05 문서의 88% 예시 사용 금지 — 감사 M6).
- [ ] E2. 데이터 실사 표에 `100대 생활업종` 행 추가: "수령·컬럼 검토 후 **화면 미채택** — 업종별 사업장 수는 소진공 상가정보(좌표 단위)와 역할이 겹쳐 중복 지표를 피함" (실제 미채택 사유는 팀이 최종 확인).
- [ ] E3. 발표 금지 표현 9개 숙지 — 검토 보고서 §6 목록 ("신규 가맹점" 과장, 시드 값의 실적화, ASOS ±4% 인용, "국세청 2종" 등).
- [ ] E4. 신규 질문 20개(보고서 §9) 중 위험도 상 4개(시의성·용어 정의·관측 성과 출처·상태 오염)를 리허설 Q&A에 편입.
- [ ] E5. 심사위원 B의 예상 공격("예산·결재 부재") 방어 — "내부 금액 데이터 연동 시 바뀌는 화면" 로드맵 슬라이드 1장 (16 문서 P1 항목 재사용).

---

## Self-Review 결과 (계획 작성자 점검)

- 검토 보고서 §11 TOP 10 → Task 1(=row 2), 2(=row 10), 3(=row 3), 4(=row 8 — FE 방식으로 변경), 5(=row 1), 6(=row 4), 7(=row 9), 9(=row 6), 10(차순위), 11(=row 5+차순위), 12·13·14·16(차순위) — **누락 없음**. row 5 원안(원순위 표 래퍼)은 오탐 정정으로 제외.
- 중복 제거를 시드 수정(보고서 원안)에서 FE 조건부 렌더로 바꾼 사유: BE `_ensure_assumption` 계약·테스트 보존 (본 계획 Architecture 절).
- 타입 일관성: `AssumptionNote`의 새 prop `dedupeWith?: string`은 Task 4에서 정의하고 호출부 3곳 모두 같은 이름으로 사용.
