# Task 11 (T11) 보고서 — B4 Action Card 생성 + 데모 시드 + 11 §1 대본 개정

## 생성·수정 파일

- `backend/app/services/cardgen.py` (신규) — AI 입력 ①~⑥ 조립 → `CARD_AI_SCHEMA`(07 부록 원문) 강제
  → Card 생성. EXPANSION/INCENTIVE 분리, LLM 최종 실패 시 규칙 기반 fallback(07 B3), 중복 가드
- `backend/app/services/season.py` (신규) — 07 B4 계절성 캘린더 규칙 표 고정 dict (입력 ③)
- `backend/app/routes/cards.py` — `POST /api/cards/generate` 추가 (신규 201 / 중복 200 / 잘못된 type 400 /
  candidates.json 부재 503). generate·simulate 외 기존 코드 미수정
- `backend/seed_demo.py` (신규) — `--init`(테이블 생성, T7 local_init 겸용) / `--reset`(전체 비우고 3장 시드).
  reset은 테이블이 없으면 만들고 시드하는 자가 복구형 (11 §4 리허설·심사 리셋)
- `docs/plan/11-demo-and-qa.md` §1 — 영월군 서사·실카드명·실수치로 개정(구조·9단계 유지), §3에
  "왜 사북·고한이 아니라 영월인가" Q&A 1행 추가
- `docs/plan/15-plan-review.md` §5 — T11 항목 2건 체크박스 닫음 (avg_approval_hours 시드 과거 시각,
  카드 B 고정 JSON)
- `backend/requirements.txt`·`main.py` 미수정 (브리프 제약 준수)

## 구현 요점

### cardgen — AI 입력 6종 (07 B4 표 그대로)

| 입력 | 구현 |
|---|---|
| ① 후보 Score·순위 | `candidates.json` Score 내림차순 순위 부여 — 근거 필드(gap·proximity·saturation·nearby_*) 전부 직렬화 |
| ② 추진 상태 | DDB — 같은 (읍×업종) EXPANSION 카드의 progress (approved면 progress, pending이면 "승인 대기", 없으면 "없음") |
| ③ 계절성 | `season.season_signal()` — 현재 월(KST) → 신호·근거 (8월 = "여름 성수기 — 휴가철·워터월드") |
| ④ 채택 이력 | approved EXPANSION 카드의 target.eup 분포 |
| ⑤ 정책 이력 | rejected 카드의 타깃·결정 시각 |
| ⑥ 위험 신호 | `risk_signal.json` 그대로 (없으면 컷) |

- 시스템 프롬프트는 `prompts.CARD_SYSTEM_PROMPT`(A-1 원문) 그대로. user 메시지에 ①~⑥ JSON +
  `작성_지침`(ai_rank_target 형식·추진중/완료 1순위 금지·제외 시 추진 상태 명시·수치 외 사실 금지) —
  T13과 동일한 "프롬프트 원문 유지 + user payload 지침" 패턴
- `original_ranking`(정량 5순위 전부)은 LLM 출력이 아니라 candidates.json에서 **코드로 조립** — 항상 병기
- `ai.adjusted`는 표시 일관성 위해 `score_rank != 1`로 정규화 (LLM boolean과 어긋나면 순위가 정본)
- `expected_effect`에 "가정" 미포함 시 고정 문구 자동 부착. risks 0개면 기본 리스크 보충
- INCENTIVE: 3/5/7% `scenarios` 고정 골격 + A-3 프롬프트로 비교문 생성, 필수 리스크 3종(예산·약관·미구현)
  키워드 검사로 보장, `selected_rate: null`, `assumption_note` 고정 문구
- LLM 타임아웃 12초 — 1회 재시도 포함 최악 24s < Lambda 30s

### 중복 가드 — 브리프와 계약 정본의 불일치 1건 (계약을 따름)

브리프는 "같은 타깃 pending 존재 시 **409**"라고 썼으나, 브리프가 정본으로 지정한 05 §2·§8과 07 B4는
모두 "**기존 카드를 200으로 반환**"(데모 중 버튼 연타 대비)이다. 09 §5.5 무안내 심사 시나리오에서도
409보다 200이 안전해 **계약(200)을 따랐다**. 검증에서 같은 타깃 재생성 시 200 + 기존 카드 반환 확인.

## 시드 3장 (실측 candidates.json 기준 — 사용자 확정 영월군 서사)

| 카드 | 내용 | 상태 | 타임스탬프 |
|---|---|---|---|
| AC-001 | EXPANSION 영월군×**카페** (문갤러리, Score 5위 0.47 → AI 1위) | approved + **추진중** | created 48h 전, decided 36h 전 (**승인 소요 12.0h**), 추진중 전환 24h 전 |
| AC-002 | EXPANSION 영월군×**소매점** (강원선바위협동조합, **Score 2위 0.65 → AI 1위** 조정 사례, LLM 없는 고정 JSON) | pending | created 3h 전 |
| INC-001 | INCENTIVE 페이백 3/5/7% (05 §2 INC-001 예시 구조 재사용 — 수치는 실데이터와 정합 확인됨: 월별 전환율 17.6~23.4%, 사북+태백 비중 0.58) | pending | created 5h 전 |

- 카드 B 조정 사유: **추진중인 카드 A와의 관계** 명시 — "업종이 겹치지 않아 중복 착수 위험이 없고
  같은 상동 방면 관광동선이라 동반 홍보 시너지" + 1위 숙박업은 "가맹 협상·시설 확인에 시간이 걸릴
  가능성"(추측 표기 규칙 준수). 수치 전부 실측(0.65·0.67·격차 0.02·업종공백도 1.0·카페 2곳·
  카페 최근 3개월 사용 0건 — usage_monthly.json로 검증)
- 카드 A의 `expected_effect`는 수치 없는 정성 문구 — 영월군 카페 최근 3개월 사용 실적이 0건이라
  %p 수치를 쓰면 시뮬레이션([0.0, 0.0])과 모순되기 때문
- 시드 3장 모두 05 §2 Card 스키마 전 필드(sources, assumption_note, events 포함) 준수

### 위젯 배지 계산 (T13 인계 — 카드 A 타깃 선정 근거)

merchants.json의 영월군×업종 가맹점 수: **카페 2** / 편의점 4 / 기타 15 / 음식점 27 / 소매점 31 /
숙박업 0. **1~3곳 조건을 만족하는 업종은 카페(2곳)뿐** → 카드 A 타깃 = 영월군×카페.
(숙박업 0곳 = 배지 안 뜸 → 데모 실패, 편의점 4곳부터는 조건 초과.)
실검증: 카드 A를 완료로 바꾸자 위젯(`?region=영월군&category=카페`)이 **느리게·별빛마루 2곳**에
`badge:"신규"` 부여 — 데모 대본 7단계에 실가맹점명으로 반영.

## 검증 (Docker, 브리프 5단계 전부)

1. **시드**: `.env` 복사 → `compose up -d --build` → `--init`(`created: sangseng-cards`) →
   `--reset`(3장 시드). `GET /api/cards`로 상태·타임스탬프 확인 — AC-001 approved/추진중
   (created `2026-08-01T20:12`, decided `2026-08-02T08:12` = 12h), AC-002 pending(3h 전),
   INC-001 pending(5h 전). 재`--reset` 시 비순차 ID 포함 전체 삭제 후 재시드 확인 (T9 인계 해소)
2. **generate 실LLM (gpt-4o-mini)**:
   - 시드 상태에서 EXPANSION 생성 → **LLM이 소매점(2위)을 1위로 지목** → pending AC-002와 동일 타깃
     → **중복 가드 200 + 기존 카드 반환** (시드 서사와 실LLM 판단이 일치하는 것도 확인)
   - AC-002를 승인·추진중으로 바꾼 뒤 생성 → **201 신규 AC-003**(영월군 숙박업, score_rank 1,
     adjusted false). reasons: "영월군 소매점은 기존에 **추진중**인 상태여서 중복 제안하지 못함" —
     **추진중 카드 맥락 반영 확인** (14 T11 검증 핵심)
   - 같은 타깃 재생성 → **200 + 기존 AC-003** (중복 가드)
   - INCENTIVE: pending INC-001 존재 시 200(LLM 호출 전 가드) / INC-001 승인 후 생성 →
     **201 신규 INC-002** — scenarios 골격·필수 리스크 3종·assumption_note·가정 문구 전부 충족
   - 잘못된 type(PAYBACK) → 400. LLM 강제 실패(monkeypatch) → 규칙 기반 fallback 카드 생성
     (가정 문구·규칙 기반 명시 포함) — EXPANSION 확인
3. **KPI**: 시드 직후 `{"adoption_rate":0.33,"execution_rate":1.0,"avg_approval_hours":12.0,
   "regional_balance_index":0,...}` — **12.0h 유의미 값**(0.0h 방지 — 15 §5 닫음), 균형지수 0은
   승인 EXPANSION이 영월군 1곳뿐인 상태의 정의상 정확값(05 §3 "승인 1장 = 0"). 생성·승인이 쌓인
   중간 상태에서도 손계산 일치(3/5=0.6, 2/3=0.67, (12.0+3.0+5.1)/3=6.7h)
4. **simulate 카드 B**: `current_index 43 → projected 42, delta_pp [0.0, 0.1]` — **양수(개선)**,
   narrative에 예상·가정 포함, assumption_note 고정 문구. 시드 문구("약 0.1%p 내외")와 정합
5. **정리**: 최종 `--reset`으로 데모 상태 복원 → 컨테이너 로그 error/traceback 0건 →
   `compose down`(컨테이너·네트워크 제거) → `.env` 사본 삭제 → 포트 8000/8001 반납 →
   `git status` 구현·문서 파일 6건만

## 우려사항·인계

1. **gpt-4o-mini 생성문 품질** — 실LLM 카드(AC-003)의 사유 문장이 다소 어색할 때가 있다
   ("소매점은 이미 케이스가…" 등). 데모 핵심 서사는 고정 JSON 카드 B가 담당하므로 리허설 리스크는
   없지만, 라이브 generate 시연을 넣을 거면 리허설에서 출력 품질을 한 번 확인할 것
   (필요 시 `.env`의 `OPENAI_MODEL` 상향 또는 `LLM_PROVIDER=anthropic` 전환만으로 해결).
2. **generate 중복 가드는 pending만 본다** (05 §8 그대로) — approved+검토중 타깃은 가드에 안 걸리고,
   프롬프트 금지도 추진중/완료뿐이라 검토중 타깃에 두 번째 카드가 생길 수 있다. 데모 동선(승인 즉시
   추진중 전환 또는 완료)에서는 발생하지 않음.
3. **브리프의 "중복 시 409" 문구는 계약(200)과 달라 계약을 따랐다** — 위 "중복 가드" 절 참조.
   FE가 409를 기대하고 구현하지 않도록 PR 본문에 명시.
4. **INC-001 승인 후 재generate 시 새 pending INCENTIVE가 생긴다** — 05 §8("pending INCENTIVE는
   동시에 1장만")의 정의상 정상이나, 데모 8단계(INC 카드 열기) 전에 generate를 눌러 INC-002가
   생겨 있으면 화면에 2장이 보인다. 리허설은 `--reset` 후 시작하므로 영향 없음.
