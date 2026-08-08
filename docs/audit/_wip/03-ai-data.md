# 03 — AI/LLM 경로 · 데이터 계층 · 파이프라인 (§6~§7)

Phase 2 체크포인트 · 2026-08-08.

---

## A. LLM 단일 경로 원칙 (§6) — 준수

`backend/app/llm.py:32` `generate_json(system, user, schema, schema_name, timeout, attempts)` 하나만 존재.
provider 분기는 `llm.py:39-45`(선택) + `:51-82`(호출) 안에만 있다.

전수 검사: `import openai` / `import anthropic` / `OpenAI(` / `anthropic.Anthropic(`
→ `backend/app/llm.py:52,53,70,71` **외 0건** (테스트 스텁 제외).
**provider 분기가 llm.py 밖으로 샌 곳 없음.**

호출부 2곳:
| 호출부 | 프롬프트 | schema | timeout |
|---|---|---|---|
| `services/cardgen.py:416` (EXPANSION) | `prompts.CARD_SYSTEM_PROMPT` | `CARD_AI_SCHEMA` | 12s |
| `services/cardgen.py:516` (INCENTIVE) | `prompts.INCENTIVE_PROMPT` | `CARD_AI_SCHEMA` | 12s |
| `routes/cards.py:237` (simulate narrative) | `prompts.SIMULATE_PROMPT` | `NARRATIVE_SCHEMA` | 8s |

`prompts.py` 정의 3개(`CARD_SYSTEM_PROMPT:4`, `SIMULATE_PROMPT:34`, `INCENTIVE_PROMPT:44`)가
**전부 사용된다. 미사용 프롬프트 0건.** A-4(위젯)는 `prompts.py:61-63`이 제거 사실을 명시하고
`routes/widget.py:70-77`이 결정론 문구로 대체 — 05 §4:535와 일치.

### Anthropic SDK 파라미터 검증 (claude-api 스킬로 대조)
`llm.py:57-65`:
```python
resp = client.messages.create(
    model=model, max_tokens=4096, system=system,
    messages=[{"role": "user", "content": user}],
    thinking={"type": "disabled"},
    output_config={"format": {"type": "json_schema", "schema": schema}}, **extra)
```
- `output_config.format` = 현행 구조화 출력 파라미터 (구 `output_format`은 deprecated) → **정상**
- `thinking={"type":"disabled"}` — Claude Sonnet 5에서 **허용됨** → 정상
- `ANTHROPIC_MODEL` 기본값 `claude-sonnet-5` — 현행 모델 ID → 정상
→ **anthropic 경로가 조용히 실패해 항상 폴백되는 구조가 아니다.**

### §6 필수 질문 답변

**1. 키 미설정 시?**
`OpenAI()`/`anthropic.Anthropic()` 생성자가 예외 → `llm.py:86-89` except → 재시도 →
`llm.py:93` `LLMError` → `cardgen.py:419-423` except → `_fallback_ai()` +
`explanation_source = "rule_fallback"`.
→ **500이 아니라 폴백 카드가 나온다. 데모 동선이 끊기지 않는다.**

**폴백을 "AI 생성"이라 말하는가? → 아니다. 3중으로 구분된다:**
| 층 | 값 |
|---|---|
| 데이터 | `grounding.explanation_source = "rule_fallback"`, `narrative_status = "rule_based"` (`cardgen.py:333-336`) |
| 카드 본문 | `ai.reasons[3]` = `NARRATIVE_NOTE["rule_fallback"]` = "대상은 서버의 정량 규칙이 선택했고, **AI 응답을 받지 못해** 리스크 문구까지 서버 규칙으로 작성했습니다" (`cardgen.py:29-30`, `:310`) |
| 화면 칩 | `lib/aiSource.ts:47-49` fold → `"rule_fallback"` → `NARRATIVE_SOURCE_TEXT.rule_fallback.label` = **"규칙 기반 설명(AI 응답 없음)"** (`aiSource.ts:23`) |

칩 렌더 위치: `app/cards/[id]/page.tsx:172,342`, `app/incentive/page.tsx:217`,
`components/proposals/ProposalSummary.tsx:60`, `components/SimulateButton.tsx:77`.
`aiSource.ts:39-50` `fold()`는 **계약에 없는 값이면 `null`을 반환해 칩을 아예 그리지 않는다**
— "모르는 출처를 AI라고 부르지 않는다"(`:35-37` 주석).
→ **절대 규칙 4 관련 허위 표시 위험 없음.**

**2. 스키마 검증?**
- OpenAI: `response_format={"type":"json_schema", ..., "strict": True}` (`llm.py:79-80`) — API 강제.
- Anthropic: `output_config.format.json_schema` (`llm.py:63`) — API 강제.
- 파싱: `json.loads`(`llm.py:67,82`) 실패 → except → 재시도 → `LLMError` → 폴백.
- **응답 필드 누락 내성**: `_grounded_ai`(`cardgen.py:269-340`)가 comparison·reasons·expected_effect를
  **정본 데이터로 재생성**하고 LLM 출력 중 실제로 카드에 남는 것은 `risks`뿐(`:312`, isinstance 필터).
  INCENTIVE도 `:524,534,537-540`에서 타입/값 검증 후 사용.
→ 필수 필드 누락·타입 오류가 카드 스키마를 깨뜨리지 못한다.

**3. 타임아웃/재시도/상한 vs Lambda 30초**
`cardgen.LLM_TIMEOUT = 12`(`:52`), `llm.generate_json(attempts=2)` 기본, `RETRY_BACKOFF_SECONDS = 0.5`.
→ 최악 12+0.5+12 = **24.5초** < SAM `Timeout: 30`(`template.yaml:24`).
`llm.py:9-10` 주석이 이 계산을 명시. simulate는 timeout=8 → 최악 16.5초.
→ **Lambda가 먼저 끊길 여지가 낮다.** 30초 초과 시 Lambda가 먼저 종료(API Gateway HTTP API의
기본 통합 타임아웃 30초와 동일) → FE는 `api.ts:54-64` `fail()`로 502/504를 `ApiError`로 바꾸고
`actions.ts:33-36` `toFail`이 안내 문구로 표시.

**4. `llm.redact`는 무엇을 가리는가**
`llm.py:14` `_KEY_PATTERN = r"\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_\-*]{4,}"` → `llm.py:90`에서
최종 실패 메시지에만 적용. `raise LLMError(cause) from None`(`:93`)으로 원인 체인을 끊어
SDK 예외 트레이스백이 CloudWatch에 남지 않게 한다.
**프롬프트에 실린 데이터(AI 입력 ①~⑧)는 로그에 남지 않는다** — `llm.py:83,91`의 log는
provider/model/schema/attempt/elapsed/error만 기록.

**5. AI 조정 순위 ↔ 원 Score 순위 병기 (절대 규칙 5)**
- 생성: `cardgen.py:451-453` `ai.original_ranking` = 전 후보의 `{rank, candidate, score}` **항상 저장**
  (INCENTIVE만 `null` — `:553`, 05 §2와 일치).
- `score_rank`(정량 순위)와 `ai_rank`(제안 목록 내 순위, 항상 1) 분리 저장 (`:433-435`).
- `selection_reason` = `top_score` | `exclude_in_progress` (`:445`) — 05 §2:264-268 계약.
- 렌더: `OriginalRankingTable` ← `app/cards/[id]/page.tsx:402-411`,
  `RankTrace` ← `cards/[id]/page.tsx:210`, `tracking/page.tsx:392`, `ProposalSummary.tsx:134`,
  트래킹 목록에도 `tracking/page.tsx:479-485` "정량 순위 원본 N건".
→ **병기 구현됨.**

**7. simulate는 AI인가 결정론인가**
`services/simulate.py`는 **순수 계산**(math만 import, LLM 무관 — `:1` docstring).
`routes/cards.py:216-251`이 그 결과를 설명 문장으로 만들 때만 LLM을 부르고,
**방향이 `혼재`·`미미`인 구간은 아예 호출하지 않는다**(`:220`) — 없는 개선을 지어내지 못하게 구조적 차단.
LLM 문구는 `:244-249`에서 방향 역전(개선↔심화)·'예상'/'가정' 누락을 검사하고 통과 못 하면 폐기.
`narrative_source`(`:284`)가 `llm`/`rule_based`를 구분해 응답에 싣는다.
화면(`SimulateButton.tsx:74,77,134`)은 `AssumptionBadge` + `NarrativeSourceChip` + `AssumptionNote` 3종 표기.
→ **"AI 예측"으로 과장하지 않는다. 절대 규칙 3 문구 고정 삽입됨**
(`routes/cards.py:17` `ASSUMPTION_NOTE` → `:285` 응답, `cardgen.py:343-348` `_ensure_assumption`).

**8. INCENTIVE에 simulate 호출 시**
BE `routes/cards.py:198-199` → **400** "INCENTIVE 카드는 scenarios를 사용합니다" (05 §8과 일치).
FE는 `app/cards/[id]/page.tsx:549` `{card.type === "EXPANSION" ? ... <SimulateButton/> ...}`
→ **INCENTIVE 카드에서 버튼 자체를 렌더하지 않는다.** 도달 불가 경로.

---

## B. DynamoDB 계층 (§7)

### CardsTable — GSI 없음, Scan 기반
`template.yaml:69-72` `AWS::Serverless::SimpleTable`, PK `id`(S), 온디맨드.
`GET /api/cards?type=&status=`는 **Scan 후 앱 필터**:
`db.list_cards()`(`db.py:97-99`) → `_scan_all()`(`:83-94`)이 `LastEvaluatedKey`가 사라질 때까지
**전 페이지 순회** → `routes/cards.py:65-69`가 파이썬에서 필터.
→ **페이지 경계 누락 없음**(정확성 OK). 상한이 없어 카드 수에 비례해 비용·지연 증가(수십 장 규모 전제).
`__counter__#` 내부 레코드는 `db.py:99`가 목록에서 제외.

### ProgressRecordsTable — GSI 실사용 확인
| 조회 | 코드 | Scan 우회 여부 |
|---|---|---|
| 카드별 타임라인 | `progress_db.list_card_records:161-174` `IndexName=CARD_RECORDED_AT_INDEX` | **Query 사용** |
| 최신 1건 | `latest_record:223-235` 같은 GSI + `Limit=1` | **Query 사용** |
| 리포트 기간 | `list_report_records:187-220` `IndexName=REPORT_BUCKET_RECORDED_AT_INDEX` | **Query 사용** |
| 전체 삭제 | `clear_table:106-121` Scan | 시드/테스트 전용 |

**정렬키 사전순=시간순 보장**:
`recorded_at_key = f"{recorded_at}#{next_version:020d}#{card_id}#{record_id}"`(`progress_db.py:325-327`).
`recorded_at`은 초 정밀도 ISO8601 고정폭 → 사전순=시간순. 동초 충돌은 020d 제로패딩 version이 해결.
상한 커서는 `f"{through.isoformat(...)}~"`(`:227`) — `~`(0x7E)가 `#`(0x23)·숫자보다 커서 유효.

**report_bucket 핫 파티션**: `report_bucket = recorded_at[:7]`(`progress_db.py:324`) = "YYYY-MM"
→ 한 달 기록이 한 파티션. `_month_buckets`(`:177-185`)가 월별로 나눠 Query.
기간 상한 366일(`routes/progress.py:163`) → 최대 13개 파티션 순회. 소규모 데이터에서는 문제 없음.

**트랜잭션 원자성**: `write_record_and_project_card:238-362`가
카드 Update + 레코드 Put을 **하나의 `transact_write_items`**(`:330-351`)로 커밋.
실패 시 `TransactionCanceledException`/`ConditionalCheckFailedException` → `db.ConcurrentUpdate`(`:352-356`).
→ **부분 반영 불가.** "카드 상태는 바뀌었는데 근거 기록이 없다"가 구조적으로 발생하지 않는다.

**멱등성**: `progress_records._record_id:55-59`가 `sha256(card_id:idempotency_key)`로 결정론 record_id 생성,
`_request_fingerprint:72-97`가 의미 필드(키 자체 제외)를 정규화 해시.
재전송 시 `:121-126` 기존 레코드 반환 + `created=False`(HTTP 200),
같은 키에 다른 내용이면 `IdempotencyConflict` → **409**(`routes/progress.py:95`).
동시 재전송 경합도 `:206-216`에서 한 번 더 처리.
→ **중복 레코드 생성 방지됨.**

**`ensure_table`/`clear_table`의 Lambda 권한 문제 — 해당 없음**
호출부: `seed_demo.py:444,449`, `local_init.py:20` — 둘 다 `app/` 밖이며
SAM 번들(`infra/.aws-sam/build/ApiFunction/`)에 미포함(실측). Lambda 런타임 도달 경로 없음.

### 정적 JSON 계층
`dataload.load()`(`dataload.py:25-32`)가 유일 창구. 다른 곳의 `open()`/`json.load` 전수 검사 →
`app/` 안에는 없음(seed_demo·tests 제외).
`CANDIDATE_DIRS`(`:12-15`) 순서는 **`data/processed` 먼저, `app/data` 나중** —
CLAUDE.md의 "(Lambda: app/data/, 로컬: ../../data/processed/ 폴백)" 서술과 **순서가 반대**다.
`dataload.py:6-11` 주석이 그 이유를 설명(로컬에 낡은 `app/data` 사본이 최신 산출을 가리는 문제).
3개 모드 모두 성립:
| 모드 | 해석 경로 |
|---|---|
| 로컬 | `<repo>/data/processed` (첫 경로 적중) |
| Docker | 첫 경로 `/data/processed` 없음 → `app/data`(마운트된 `data/processed`) |
| Lambda | 첫 경로 `/var/data/processed` 없음 → `app/data`(deploy 스크립트 사본) |

캐시: `_load_versioned`(`:18-22`) `lru_cache(maxsize=32)`, 키 = (path, mtime_ns, size)
→ 파일 갱신 시 자동 무효화, 서버 재시작 불필요. 콜드스타트에 merchants 330KB 파싱 1회.

**`REQUIRED_DATASETS` vs 실제 라우트 소비**
`main.py:33` = dashboard·eup_scores·candidates·merchants, `:34` OPTIONAL = risk_signal.
라우트가 읽는 것: 위 5개 + **`usage_monthly`**(`routes/cards.py:201` simulate) +
**`usage_daily`**(`cardgen.py:135`, 실패 내성).
→ **`usage_monthly`가 health 판정에 빠져 있다.** health가 `ok`인데 `usage_monthly.json`만 없으면
`POST /simulate`만 503이 된다(`routes/cards.py:203-204`가 잡아 503으로 변환하므로 500은 아님).
`usage_daily`는 없어도 AI 입력 ⑧만 생략되므로 판정 제외가 타당.

---

## C. 파이프라인 (§7 후반)

### Global Constraint (1단계 읍 ↔ 2단계 500m 미혼합) — **준수**
- `stage1_eup_ranking(usage: dict, weights)`(`p6_scoring.py:101`) — 입력은 `usage_monthly` 뿐,
  좌표 인자 없음. 점수 = `weights["v1"]*low[r] + weights["v2"]*decline[r]`(`:137`),
  `EUP_WEIGHTS={"v1":0.5,"v2":0.5}`(`common.py:18`). 전부 읍 단위 집계.
- `stage2_candidates(eups_by_rank: list[str], ...)`(`p6_scoring.py:209-210`) — 입력이 **읍 이름 문자열 리스트**.
  점수 = `w1*gap + w2*proximity - w3*saturation`(`:297-298`),
  `CAND_WEIGHTS={"w1":1/3,"w2":1/3,"w3":1/3}`(`common.py:19`). 전부 500m 반경/좌표 값.
- 두 단계를 잇는 유일한 통로: `p6_scoring.py:397-398` `stage2_candidates([r["eup"] for r in ranking])`
  — **이름만 넘어간다.**
→ **한 수식에 두 층위가 섞인 표현식 0건.** 11 문서 Q&A "500m 수요를 어떻게 계산했나" 답변과 일치.

### 집중도 산식 이중 구현 — 수학적으로 동일
`pipeline/common.py:30-41` `gini()` + `gini_to_index()` vs
`backend/app/services/simulate.py:37-48` `concentration_index()`:
분자·분모 표현식이 문자 단위로 동일, 정규화 `/(1-1/n)*100` 동일, mean==0 단축 동일.
차이 2가지: (1) 파이프라인은 `round()` 적용(정수), BE는 float 유지 — `simulate.py:41-42`가 의도 명시.
(2) 파이프라인 `gini_to_index(g, n=6)`은 n이 **기본 인자 6 고정**, BE는 `len(counts)`.
모든 호출부가 6원소 REGIONS를 넘기므로 실제 차이 없음.
서브에이전트가 난수 6-벡터 20,000회 대조 → **불일치 0건**.

### 표시 6분류·REGIONS·ANCHOR 3중 복제 — 드리프트 없음
`HIGHONE_TO_DISPLAY` 18키를 `pipeline/category_map.py:63-82` ↔ `backend/.../simulate.py:15-34` ↔
`frontend/src/lib/regionAnalysis.ts:15-34` 키·값·순서 전수 대조 → **완전 일치**
(`이ㆍ미용업` U+318D, `주유소·LPG충전소` U+00B7, 원본 오타 `자동자 세차업`까지 동일).
`REGIONS` 6개 순서 동일(`common.py:8` / `simulate.py:9` / `constants.ts:4` / `types/index.ts:6`),
`ANCHOR` 좌표 동일(`common.py:16` / `widget.py:11` / `constants.ts:53-57`).

### 산출물 8종 ↔ 소비처
| 파일 | 생성 | BE 소비 | FE 소비 | 파이프라인 소비 |
|---|---|---|---|---|
| `usage_monthly.json` | `p1_usage.py:133` + `p2_visitors.py:170` | `routes/cards.py:201` | `api.ts:38` (정적) | p5, p6, p8, category_map |
| `usage_daily.json` | `p1_usage.py:137` | `cardgen.py:135` | `api.ts:37` (정적) | — |
| `merchants.json` | `p3_merchants.py:411` | `dashboard.py:22`, `widget.py:84`, `cards.py:202` | (mocks/candidates.json에 내장) | p6 |
| `eup_scores.json` | `p6_scoring.py:413` | `dashboard.py:20` | (병합본에 내장) | — |
| `candidates.json` | `p6_scoring.py:414` | `dashboard.py:21`, `cardgen.py:96`, `seed_demo.py:101` | `api.ts:39` | p8 |
| `risk_signal.json` | `p7_risk.py:43` | `dashboard.py:45`, `cardgen.py:177` | `api.ts:40` | — |
| `dashboard.json` | `p5_metrics.py:169` | `dashboard.py:12`, `cardgen.py:508` | `api.ts:36` | — |
| **`sensitivity.json`** | `p8_sensitivity.py:116` | **없음** | **없음** | `p5_metrics.py:135` |

→ **8종 모두 소비된다.** 단 `sensitivity.json`은 **파이프라인 내부에서만** 소비되며
(`ranking_stability` 파생용), BE/FE 어느 쪽도 직접 읽지 않는다.
`scripts/sync-mocks.sh:25`가 이를 `frontend/src/mocks/sensitivity.json`(43KB)로 복사하지만
**import 하는 코드가 없다.** 같은 이유로 `mocks/eup_scores.json`(1KB)·`mocks/merchants.json`(330KB)도 미사용
(FE는 병합된 `mocks/candidates.json` 하나로 도달) — **합계 약 375KB의 미사용 커밋 파일.**

### 스키마 대조 결과
- `eup_ranking[].raw_decline_rate`(`p6_scoring.py:406`) — `types/index.ts:82-88` `EupScore`에 **없음**
  (BE `/api/candidates`가 그대로 통과시키므로 런타임 여분 필드).
- `eup_scores.base_month`(`p6_scoring.py:402`) — BE `dashboard.py:26-31`이 응답에서 **탈락**시킴. 타입에도 없음.
- **`Dashboard.growth`가 `{mom_pct: number; qoq_pp: number}`로 non-nullable 선언**(`types/index.ts:42`)인데
  `p5_metrics.py:123,130`은 조건에 따라 `None`을 쓴다. 현재 데이터는 `{-1.8, 1.1}`로 non-null.
  → **잠재 타입 거짓말**(데이터가 바뀌면 FE에서 null 역참조 가능).
- `Candidate.source_category`도 non-nullable인데 `p6_scoring.py:251,366`이 `None`을 넣을 수 있다. 현재 null 없음.
- **`sensitivity.json` 계약 예시가 실제와 크게 다름**:
  05 §6:576 `{"combos": 25, "top3_stable_ratio": 0.88, ...}` vs
  실제 `combos=95`, `top3_stable_ratio=0.1579`.
  95는 P8 격자(5×19, `p8_sensitivity.py:26-38`, `:64` assert)가 내는 값이라 **25는 도달 불가능한 수**.

### `ranking_stability` = 16 의 의미 (심사 대응)
`p5_metrics.py:135-140` → `round(0.1579*100)` = **16** → `dashboard.json.ranking_stability = 16`.
화면: `app/dashboard/page.tsx:688-701` "추천 순위 안정도 · 해석 주의" + `STABILITY_NOTE`
("가중치 조합에서 상위 3개 후보가 유지된 비율입니다. 후보 요인이 동률로 고정된 경우에는
선발 기준의 다양성이나 강건성을 의미하지 않습니다.") → **표기 자체는 정직하다.**
단 95개 조합 중 Top3 순위 유지 15개(15.8%), 순서까지 유지 9개.
읍 선정(`selected_eups`)은 57/95(60%)가 `('영월군','삼척시')` 유지 — **지역 선택은 상대적으로 안정적**.
11 문서 Q&A "가중치는 왜 그렇게 정했나 → Top3 유지율 X% 슬라이드"에 **X=16%**가 들어가면
방어 논거가 약해진다. 05 문서의 88% 예시를 슬라이드에 그대로 옮기면 **사실과 다르다.**

### `run_all.py` 덮어쓰기 (실행 금지 확인)
`run_all.py` 자체는 쓰기 없음(`:43-46` 목록 출력만). 그러나 `:36` `subprocess.run`으로
p1~p8을 실행하며 각 스크립트가 `write_text`로 **8개 산출물을 무조건 truncate-replace**한다
(`p1:134,138`, `p2:171`, `p3:411`, `p6:413,414`, `p8:117`, `p5:170`, `p7:44`).
추가로 `p6_scoring.py:43,167,204`가 OSRM 공개 라우팅 API에 **네트워크 호출**을 한다.
→ 감사 중 실행하지 않았다.
