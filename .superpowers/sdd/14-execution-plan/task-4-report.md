# T4 보고서 — 05 계약 확장 + P5 진단 지표

- 브랜치 `feat/yutak-p5-metrics` (base `main` = 13ad315) · PR https://github.com/yutakdv/sangseng-navigator/pull/12 (머지 안 함)
- 커밋 3개: `f46dc4b docs: 05 dashboard 3필드·INCENTIVE 예시·KPI 정의 확장` →
  `9fe53f4 feat: P5 진단 지표` → `df29f9d data: dashboard.json`

## 1. 계약 선수정 (docs 커밋 — 코드보다 먼저)

**05 §1** dashboard 예시 JSON에 3필드 추가 + 정의 3줄
- `category_share: [{"category","count","share"}]` — 13 §5 표시 6분류 고정 순서, 롤업 정본은
  `category_map.py` 매핑 ①(`HIGHONE_TO_DISPLAY`), share 합 = 1.0
- `growth.qoq_pp` — 지역 전환율의 전분기 대비 %p. 분기는 데이터 최신 월(2025-12) 기준
  최근 3개월(10~12) vs 직전 3개월(7~9), **분기 전환율 = 3개월 건수 합 ÷ 3개월 입장객 합 × 100**으로 명시
- `ai_stability` — `sensitivity.json`의 `top3_stable_ratio × 100`(정수), P8 전이면 `null`(FE는 `—`)

**05 §2** INCENTIVE 카드 완성 예시(`INC-001`) 추가 — 브리프 골격 그대로. `ai`는 EXPANSION 스키마
재사용(`comparison`=3/5/7% 비교문, `reasons`, `risks`=A-3 필수 리스크 3종, `expected_effect`),
`original_ranking: null`. 예시 아래 "순위 필드만 null" 1줄 명시.

**05 §3** KPI 정의 2줄
- `regional_balance_index` 분모 = REGIONS 6지역 고정(승인 카드 없는 지역도 0건 포함), 반올림 정수,
  "승인 카드가 여러 지역에 쌓일수록 상승(데모 초반 낮은 값은 정상)" 명시
- `avg_approval_hours` = `decided_at`이 있는 모든 카드(approved+rejected+held)의
  `decided_at − created_at` 평균, 소수 1자리

**15 문서** §4-3 체크박스 종료, §5 균형지수 항목 종료. §5 `avg_approval_hours` 항목은
T11(시드 `created_at` 과거 시각) 몫이 남아 **열어 둠**.

## 2. 구현 (`pipeline/p5_metrics.py`)

입력 `usage_monthly.json`(P1 집계 + T1 `visitors_monthly`) → 출력 `data/processed/dashboard.json`
(05 §1 스키마 그대로). `common.py`의 `gini`/`gini_to_index`/`grade`/`hhi_dispersion_index`와
`category_map.py` 매핑 ①만 사용. 기준월은 하드코딩 없이 `base_month`(2025-12)에서 유도(06 공통 원칙 3),
전환율은 분자·분모가 겹치는 월만 사용(06 공통 원칙 4). `visitors_monthly`가 없으면 P2 먼저 실행하라는
메시지로 즉시 중단. `share`는 소수 2자리 반올림 후 잔차를 최대 항목에 몰아 합을 정확히 1.0으로 보정.

## 3. 주요 수치 (기준월 2025-12, 전 기간 2025-01~12 총 507,628건)

| 지표 | 값 |
|---|---|
| `conversion.headline_rate` | **20.5%** (`is_proxy: true`, 월별 17.6~23.4%) |
| `concentration.index` / `grade` | **43 / 보통** (월별 41~43) |
| `category_dispersion.index` | **78** (월별 77~78) |
| `growth.mom_pct` / `qoq_pp` | **+1.5% / +1.1%p** (최근분기 20.68% vs 직전분기 19.57%) |
| `ai_stability` | **null** (P8 미실행 — T6에서 P5 재실행 시 채워짐) |
| `category_share` 상위 3 | **음식점 43%**(214,440) · **소매점 24%**(123,083) · **편의점 12%**(63,338) |
| `region_share` | 사북읍 32% · 태백시 26% · 고한읍 19% · 정선군 14% · 삼척시 5% · 영월군 4% |

## 4. 검증 (브리프 4종 + 독립 재계산)

**1) 실행·파싱**
```
P5 완료: .../data/processed/dashboard.json
  기준월 2025-12 / 월 12개, 전환율 산출 월 12개
  지역 전환율(근사) 20.5% · 지역 소비 집중도 43(보통) · 업종별 소비 분산도 78
  전월 대비 1.5% · 전분기 대비 1.1%p · AI 제안 안정도 None
  지역 비중: 고한읍 19%, 사북읍 32%, 정선군 14%, 태백시 26%, 영월군 4%, 삼척시 5%
  업종 비중: 카페 2%, 음식점 43%, 편의점 12%, 숙박업 9%, 소매점 24%, 기타 10%
python -m json.tool dashboard.json > /dev/null  →  1) json.tool OK
```

**2) 05 §1 스키마 키 전수 대조** (FE 미완 → 렌더 크로스체크 대체)
```
top: ['updated_at','period_note','conversion','concentration','category_dispersion',
      'region_share','monthly_by_region','category_share','growth','ai_stability']
  conversion: ['headline_rate','is_proxy','monthly']   monthly[-1]: {'month':'2025-12','local_uses':42159,'visitors':205227,'rate':20.5}
  concentration: ['index','grade','monthly']           monthly[-1]: {'month':'2025-12','index':43}
  category_dispersion: ['index','monthly']             growth: ['mom_pct','qoq_pp']
  region_share[0]: {'region':'고한읍','count':94363,'share':0.19}
  category_share[0]: {'category':'카페','count':12104,'share':0.02}
  monthly_by_region[0]: {'month':'2025-01','고한읍':7840,'사북읍':12878,'정선군':5751,'태백시':10150,'영월군':1384,'삼척시':2169}
  updated_at: 2026-08-03 | period_note: 하이원포인트 사용현황 최신 제공분(2025-12) 기준
```
→ 05 §1의 모든 키 존재, 신규 3필드 포함, 초과 키 없음.

**3) 수치 상식 검증**
```
region_share 합=1.0 (True) / category_share 합=1.0 (True)
rate 범위 17.6~23.4 / concentration.index 범위 41~43 (0~100: True) / dispersion 77~78
monthly 배열 길이: conv=12, conc=12, disp=12, by_region=12
region_share count 합=507628 / category_share count 합=507628  (양쪽 일치)
```

**4) Gini·HHI grep** — `dashboard.json` 0건, docs 커밋의 추가 라인(`git show f46dc4b -U0 | grep '^+'`) 0건.
(05 문서 기존 49·169행의 내부 산식 설명은 이번 수정 대상이 아니라 그대로 둠 — UI 노출 경로가 아님)

**5) 추가: 원본 CSV 독립 재계산** (파이프라인 코드를 거치지 않고 pandas로 직접)
```
2025-12 총건수 CSV: 42159 | dashboard: 42159
2025-12 집중도 지수 독립계산: 43 | dashboard: 43
2025-12 분산도 독립계산: 78 | dashboard: 78
mom_pct 독립계산: 1.5 | dashboard: 1.5
qoq_pp 독립계산: 1.1 | dashboard: 1.1 (최근분기 20.68% vs 직전분기 19.57%)
headline 독립계산: 20.5 | dashboard: 20.5
연간 총건수: 507628 | 연간 입장객: 2478656 | 연평균 전환율: 20.5 %
업종 롤업 독립계산: {'기타':48520,'소매점':123083,'숙박업':46143,'편의점':63338,'음식점':214440,'카페':12104}
dashboard category_share: (동일)
```

## 5. 우려·후속

- **전환율 20.5%는 검증 밴드(0.5~20%) 상단을 살짝 넘는다.** 계산 오류가 아니라 실데이터 비율
  (507,628건 ÷ 2,478,656명)이다. 분자=거래 건수·분모=입장 인원수로 단위가 다르고 주민 소비도 분자에
  포함되는 근사 지표라 100%를 넘지 않는 한 정상. `근사 지표` 배지 규칙은 그대로 유지.
- **FE 공유 필요(PR 본문에 명시)**: T3 픽스로 "식품판매업"(연 65,517건 = 전체의 12.9%)이
  편의점 → 소매점으로 이동해 13 문서 목업 도넛과 비중이 다르다. `frontend/src/mocks` 갱신은 FE 담당.
- `run_all.py`는 이미 STEPS에 P5가 있어 수정 없이 동작(브리프대로 미수정). 17행 주석
  "미구현 — P2 산출물 필요"만 stale — 다음 pipeline 태스크에서 정리 권장.
- T6(P8) 완료 후 P5를 재실행해야 `ai_stability`가 null에서 정수로 채워진다 (14 문서 T6 체크리스트에 이미 존재).

## 6. 픽스 라운드 1 (리뷰 Important 2건)

**[1] 05 §2 INCENTIVE 예시 `reasons[0]` 실데이터 정합** (커밋 `bb106d5`)
"지역 전환율이 근사 지표 기준으로도 낮아 수요 측 유인이 필요"는 같은 PR의 실측 headline 20.5%와
모순이라 F6이 mock을 그대로 쓰면 "낮아서 페이백"+"20.5%"가 한 화면에 뜬다. 실측에서 실제로 성립하는
두 근거로 교체했다 — ① 월별 전환율 17.6~23.4% 변동("월별 17~23%대에서 오르내려 저점 월을 방어할
수요 측 유인이 필요") ② 지역 편중(사북읍 32% + 태백시 26% = 58%)을 근거로 "전 지역 공통 적용이
지역 균형에 유리"로 보강. ②는 A-3 프롬프트의 "전 지역 공통 적용 우선 제안" 요건과도 부합한다.
`dashboard.json` 수치와 대조 확인: 월별 rate 범위 17.6~23.4 ✓, 사북읍 0.32+태백시 0.26=0.58 ✓.

**[2] PR #12 본문 FE 공유 절 1줄 추가** (`gh pr edit 12 --body`)
05 §1 예시(mock)의 `concentration`은 `index 68 / "높음"`인데 실데이터는 **43 / "보통"** —
F5 등급 배지 분기·색상이 mock과 실배포에서 달라진다. `grade` 3값을 모두 렌더 가능하게 만들고
`index` 하드코딩 분기를 피하라는 문구로 명시했다. 05 §1 예시 수치 자체는 스키마 예시라 손대지 않았다.
