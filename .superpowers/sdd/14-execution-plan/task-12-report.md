# Task 12 (T12) 보고서 — B5 정책 시뮬레이션 (`backend/app/services/simulate.py` + `POST /api/cards/{id}/simulate`)

## 생성·수정 파일

- `backend/app/services/simulate.py` (신규) — 반사실 재계산 순수 함수 3개 (LLM 무관):
  `concentration_index`(지니 기반 0~100, pipeline/common.py 산식 복제·사칙연산만·중간 반올림 없음),
  `expected_monthly_count`(분모 0 폴백 체인 — 15 §5 확정 3단계, docstring에 박제),
  `simulate_expansion`(최신 월 지역 분포 + 예상 건수 → projected/delta_pp)
- `backend/app/services/simulate.py`의 `HIGHONE_TO_DISPLAY` — pipeline/category_map.py 매핑 ①
  복제본(정본은 pipeline, 주석 명시). Lambda 번들에 pipeline이 없어 import 대신 상수 복제
- `backend/app/routes/cards.py` — `POST /api/cards/{cid}/simulate` 추가 (`_get_or_404` 재사용).
  LLM glue(`llm.generate_json(SIMULATE_PROMPT, ..., timeout=8)`)와 규칙 기반 fallback은 라우트에 둠
  (simulate.py는 순수 함수 유지). narrative에 "예상"·"가정"이 없으면 LLM 성공이어도 fallback으로 대체
- `docs/plan/15-plan-review.md` §5 T12 체크박스(분모 0 처리) 닫음
- `backend/requirements.txt`·`main.py` 수정 없음 (브리프 제약 준수)

## 검증 (Docker + 임시 픽스처 — 종료 후 삭제 완료)

픽스처 `data/processed/merchants.json` 11건: 사북읍 카페 0곳(공백 업종·폴백 2단계 기본 케이스),
사북읍 음식점 3곳, 전 지역 카페 2곳, 숙박업 0곳(폴백 3단계 케이스). `.env` 복사 후
`docker compose up -d --build` → `local_init.py`(created: sangseng-cards) → 카드 5장 put.

### 1. simulate 4종 — 전부 200, 5개 키, delta_pp 낮은 값 먼저, narrative에 "예상"·"가정", assumption_note 고정 문구 일치

| 카드 (target) | current | projected | delta_pp | 예상 월 건수(가정치) | 폴백 단계 |
|---|---|---|---|---|---|
| AC-901 사북읍×카페 | 43 | 43 | **[-0.7, -0.4]** | 423.8 | **2단계** (n₁=0 → 전 지역 카페 2곳) |
| AC-902 사북읍×음식점 | 43 | 46 | **[-3.9, -2.1]** | 2330.8 | **1단계** (n₁=3) |
| AC-903 사북읍×숙박업 | 43 | 47 | **[-6.1, -3.5]** | 3872.7 | **3단계** (n₂=0 → 전 지역 전 업종 ÷ 11) |
| AC-904 영월군×카페 | 43 | 41 | **[1.0, 1.8]** | 423.8 | 2단계 |

AC-901 실LLM(gpt-4o-mini) narrative 발췌: "…약 -0.7~ -0.4%p로 보이며, 이는 유사 신규 가맹점의
평균 초기 실적을 가정한 것이므로… 예상됩니다." ("예상"·"가정" 포함 확인, 3문장 이내 존댓말)

### 2. 에러 계약 (05 §8)

```
POST /api/cards/INC-901/simulate → 400 {"detail":"INCENTIVE 카드는 scenarios를 사용합니다"}
POST /api/cards/AC-999/simulate  → 404 {"detail":"card not found"}
merchants.json 삭제 후 재기동     → 503 {"detail":"merchants.json이 아직 생성되지 않았습니다"}
```

### 3. LLM 실패 경로

worktree의 `.env` 사본에서 `OPENAI_API_KEY=`(빈 값)로 컨테이너 재기동 → AC-901 재호출 →
규칙 기반 fallback 문구 그대로 반환 확인: "사북읍 카페 업종에 신규 가맹점이 1곳 추가되면 지역 소비
집중도가 43에서 43로, 약 -0.7~-0.4%p 개선될 것으로 예상됩니다. 이는 유사 가맹점의 평균 초기 실적을
가정한 전망이며…" (수치 포함, "예상"·"가정" 포함, 2문장)

### 4. 뒷정리

픽스처·`.env` 사본 삭제 → `git status` 결과 구현 파일 3건 + 문서 1건만 남음 → `docker compose down` 완료.

## delta_pp가 상식 범위 [0.5, 10] 밖인 건에 대한 분석 (브리프 지시 — 클램핑하지 않음)

음수의 원인은 **버그가 아니라 데이터 방향**: 최신 월(2025-12) 지역 분포가
사북읍 13,861 > 태백시 10,991 > 고한읍 7,555 > … > 영월군 1,552로, **사북읍이 이미 최대 소비
지역**이다. 반사실은 타깃 읍에 건수를 더하므로 최대 지역에 더하면 집중도가 올라가고
(개선폭 = current − projected < 0), 저조 지역(영월군)에 더하면 내려간다(+1.0~+1.8, 범위 안 —
AC-904로 산식 방향 정상 확인). 실제 서비스에서는 1단계 스코어링이 소비저조도 상위 읍만 타깃으로
고르므로 양수 쪽이 정상 경로다. 다만 **05 §1 예시가 가정하는 "사북읍=저조 지역" 서사는 실데이터와
반대**라서, 데모 카드 타깃을 실스코어링 결과(저조 읍)로 잡지 않으면 시연에서 음수 개선폭이 나온다
— T11(시드)·P6(스코어링) 담당자 확인 필요.

절대값이 큰 것(−6.1 등)은 **픽스처 분모가 11곳뿐**이라 가맹점당 월평균 건수가 수백~수천 건으로
과대한 탓. 실물 merchants.json(수백 곳 규모)이 들어오면 예상 건수가 1/10~1/50로 줄어 delta_pp도
1%p 미만~수%p 대로 내려올 전망.

**추가 우려 — merchants.json category 계약 전제 (리뷰 반영):** 폴백 1·2단계의 분모는
`m["category"] == target.category`(표시 6분류 리터럴) 일치 카운트다. T2/P3가 category를
표시 6분류가 아닌 값(예: 원시 "한식")으로 산출하거나 필드를 누락하면 분모가 항상 0이 되어
**전 카드가 3단계(업종 무차별 평균)로 추락**한다. T2/P3는 merchants.json의 category를
표시 6분류로 산출해야 한다 (T2 브리프에는 컨트롤러가 반영).

## 픽스 라운드 1 (리뷰 Important 3건)

1. **롤업 정본 재동기화** — `simulate.py`의 `HIGHONE_TO_DISPLAY`에서 `식품판매업: 편의점 → 소매점`
   (정본 pipeline/category_map.py가 커밋 4분 뒤 5f63fc6에서 정정됨 — 편의점 = 소진공 "종합 소매"만).
   영향 실측(픽스처 11곳, 사북읍 타깃·폴백 2단계): 편의점 expected 5157.5 → **2625.8**,
   소매점 2603.5 → **5135.2** — 지적대로 약 2배 오차였음. 라이브 엔드포인트로도 확인:
   사북읍×편의점 delta_pp [-4.3, -2.4], ×소매점 [-7.9, -4.5] (음수·과대 사유는 위 분석과 동일).
2. **음수 delta 문구 분기** — fallback: 부호로 동사 분기(양수 "개선될" / 음수 절대값 반전
   "상승(집중 심화)할"), 반올림 동률(current==projected)이면 "X에서 Y로" 생략.
   LLM 경로: 원시 음수 범위를 주면 gpt-4o-mini가 "약 -0.7~-0.4%p 개선"으로 서술하는 것을
   실호출로 확인 → 부호를 말로 푼 "예상 변화(부호 해석 완료)" 필드로 교체 + 음수인데
   narrative에 "개선"이 들어오면 fallback으로 대체하는 가드 추가. 검증(실LLM):
   사북읍×카페(음수) "…약 0.4~0.7%p **상승**할 것으로 예상합니다…", 영월군×카페(양수)
   "…약 1.0~1.8%p **개선**될 것으로 예상됩니다…" — 두 경로 모두 "예상"·"가정" 포함.
   fallback 경로(키 빈 값 재기동)도 두 케이스 문구 그대로 확인. 픽스처·.env 삭제,
   git 클린, compose down 완료.
3. 위 "추가 우려" 단락 — merchants.json category 표시 6분류 계약 전제 명시.
