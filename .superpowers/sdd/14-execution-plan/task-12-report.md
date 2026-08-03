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
