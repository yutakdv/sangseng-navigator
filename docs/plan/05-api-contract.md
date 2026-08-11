# 05. API 계약 — FE↔BE 단일 진실

> **예시 JSON은 스키마·필드 형태의 기준이다.** 예시의 지역·업종·수치는 스키마 설명용이며
> 실데이터와 다를 수 있다.
> **FE mock 폴백은 2026-08-11 ECS 실배포에서 제거됐다** — `NEXT_PUBLIC_API_BASE`가 없으면
> FE는 빌드 단계에서 실패한다(설정 누락이 가짜 데이터로 배포되던 문제).
> BE 엔드포인트가 없는 정적 산출물 4종(`usage_monthly`·`usage_daily`·`cell_load`·`manifest`)만
> `./scripts/sync-fe-static.sh`로 `frontend/src/data/`에 복사해 **커밋한다**(정적 import·Vercel 빌드에 필요).
> 계약 변경 절차: ① 이 문서 수정 → ② 필요하면 `scripts/sync-fe-static.sh` 재실행 → ③ 팀원 공유 → ④ 코드 수정.
> 모든 응답은 `application/json`, 에러는 `{"detail": "메시지"}` + 4xx/5xx.
> **`detail`은 언제나 단일 문자열이다** — FastAPI가 스키마 미달에 자동으로 내는 422는 원래 `detail`이
> 오류 객체 배열이라 이 계약과 FE 파서(`lib/api.ts`가 문자열일 때만 채택)를 함께 깬다. BE는
> `RequestValidationError` 핸들러로 배열을 사람이 읽는 한 문장으로 합쳐 내보낸다(`app/main.py`).
> 화면은 이 문자열을 그대로 사용자에게 보여주므로, 메시지는 담당자가 무엇을 고쳐야 하는지 말해야 한다.

Base URL: 로컬 `http://localhost:8000` / 배포 후 API Gateway URL. 경로 프리픽스 `/api`.

## 1. 진단·대시보드

### `GET /api/dashboard`
파이프라인 산출 `dashboard.json`을 그대로 반환.

```json
{
  "updated_at": "2026-07-30",
  "period_note": "하이원포인트 사용현황 최신 제공분 기준",
  "conversion": {
    "headline_rate": 3.2,
    "is_proxy": true,
    "proxy_note": "분자=지역 사용 건수, 분모=입장 연인원(교대 합산)으로 단위가 달라 비율이 아닌 근사 지표입니다. 강원랜드가 공개한 금액 기준 지역 사용 비율(2024년 29.4%)과는 다른 지표입니다.",
    "monthly": [
      {"month": "2025-01", "local_uses": 12450, "visitors": 385200, "rate": 3.2}
    ]
  },
  "concentration": {
    "index": 68, "grade": "높음",
    "monthly": [{"month": "2025-01", "index": 59}]
  },
  "category_dispersion": {
    "index": 55,
    "monthly": [{"month": "2025-01", "index": 52}]
  },
  "region_share": [
    {"region": "고한읍", "count": 5210, "share": 0.28},
    {"region": "사북읍", "count": 4110, "share": 0.22},
    {"region": "정선군", "count": 3300, "share": 0.18},
    {"region": "태백시", "count": 2900, "share": 0.16},
    {"region": "영월군", "count": 1700, "share": 0.09},
    {"region": "삼척시", "count": 1300, "share": 0.07}
  ],
  "monthly_by_region": [
    {"month": "2025-01", "고한읍": 480, "사북읍": 391, "정선군": 300, "태백시": 250, "영월군": 160, "삼척시": 120}
  ],
  "category_share": [
    {"category": "음식점", "count": 6800, "share": 0.37}
  ],
  "growth": {"mom_pct": -2.1, "qoq_pp": -0.4},
  "ranking_stability": null,
  "ai_stability": null,
  "impact_meta": {
    "basis": "count",
    "annual_local_uses": 507628,
    "annual_visitors": 2478656,
    "per_pp_additional_uses": 24787,
    "note": "지역 전환율(근사 지표) 1%p 개선 시 연간 지역 사용 건수 추가분 추정 = 연간 입장 연인원 × 1%. 건수 기준이며 금액 환산은 포함하지 않는다. 가정 기반 전망이며 실제와 다를 수 있음."
  },
  "privacy_meta": {
    "k": 5,
    "suppressed_cells": [
      {"eup": "영월군", "category": "카페"},
      {"eup": "영월군", "category": "편의점"}
    ],
    "aggregate_rounding": {"unit": 100},
    "canonical_total": 507628,
    "privacy_rounding_adjustment": {"region_share": 25, "category_share": -42, "monthly_by_region": 25},
    "note": "가맹점 5곳 미만 셀의 건수는 비공개. 합계는 100 단위 반올림으로 차분 복원 정밀도를 낮춤(완전 차단은 아님). 비율·순위·스코어는 반올림 전 원값으로 계산됨."
  }
}
```

규칙: `conversion.is_proxy=true`이면 FE는 반드시 `근사 지표` 배지 렌더.
`concentration.index`는 0~100 정규화값(내부 Gini 비노출), `grade`는 높음/보통/낮음.

- `conversion.proxy_note`: **고정 설명 문구**(파이프라인 P5가 채움). 배지만으로는 막지 못하는 오인을
  본문으로 차단한다 — 배지 툴팁·상세 영역에 이 문구를 **그대로** 노출한다(요약·의역 금지).
  - 분모는 "입장객 수"가 아니라 **입장 연인원(교대 합산)**이다. 강원랜드 일자별 카지노 입장객 API는
    하루를 영업 교대(1부/2부/3부) 최대 3행으로 주며 P2가 이를 합산하므로, 같은 사람이 교대를 넘겨
    머무르면 중복 계수된다. `monthly[].visitors`의 라벨도 "입장 연인원"으로 표기할 것
  - 우리 지표(건수÷연인원 ≈ **연인원 1인당 0.21건**)와 강원랜드가 쓰는 **금액 기준** 지역 사용
    비율(2024년 하이원포인트 지역 사용금액 355억 원, 지역사용률 29.4% — 강원랜드 2024년도
    지속가능경영보고서)은 **종류가 다른 지표**다. 자릿수가 비슷해 같은 값의 다른 추정치로
    오인되기 쉬우므로 화면·발표 어디서도 "강원랜드 공식 지역 사용 비율"과 나란히 놓고 비교하지 않는다
업종 표시 롤업: 대시보드·위젯의 업종 표시는 13 문서 §5의 6분류(카페·음식점·편의점·숙박업·소매점·기타)로
롤업하며, 하이원 18종·소진공 대분류(`indsLclsNm`)와의 매핑 정본은 `pipeline/category_map.py` 하나다.

- `category_share`: 전 기간 누적 건수를 위 표시 6분류로 롤업한 업종 도넛용 배열
  (`category`는 13 §5 고정 순서, 롤업 정본은 `category_map.py`의 매핑 ① `HIGHONE_TO_DISPLAY`, `share` 합=1.0)
- `growth.mom_pct`: **전월 대비 "일평균" 사용 건수 증감률(%)** — `월 건수 ÷ 그 달의 일수`로 만든
  일평균끼리 비교한다 (`pipeline/p5_metrics.py`). 월 길이(28~31일) 편향을 제거하는 정의라 단순
  월합 증감과 **부호가 다를 수 있다** — 실데이터 2025-12는 월합 기준 +1.5%인데 일평균 기준 −1.8%다.
  화면 라벨은 "전월 일평균"으로 표기해 "총 사용 건수가 줄었다"로 오독되지 않게 한다.
- `growth.qoq_pp`: **지역 전환율의 전분기 대비 변화(%p)** — 분기는 데이터 최신 월(2025-12) 기준
  최근 3개월(2025-10~12) vs 직전 3개월(2025-07~09)이며, 분기 전환율은
  3개월 건수 합 ÷ 3개월 **입장 연인원(교대 합산)** 합 × 100
- `ranking_stability`: P8 민감도 분석 `sensitivity.json`의 `top3_stable_ratio × 100`
  (정수, "추천 순위 안정도" 타일). AI 모델 품질 지표가 아니다. P8 실행 전에는 `null`.
  `ai_stability`는 이전 소비자 호환용 별칭이며 신규 화면은 사용하지 않는다
- `impact_meta`: "지역 전환율 1%p 개선 = 연간 지역 사용 건수 몇 건 추가" 임팩트 헤드라인의
  역추적 가능한 원천(`pipeline/p5_metrics.py`의 `build_impact_meta`, `conversion.monthly`의
  겹치는 월 합산). **건수 기준 고정**(`basis: "count"`) — 강원랜드 공개 금액 기준 지역 사용 비율
  (2024년 29.4%)과는 종류가 다른 별개 지표라 금액 환산을 포함하지 않는다(README·발표 전용).
  화면에 노출하는 숫자는 `per_pp_additional_uses`(연간 입장 연인원 × 1%, 반올림) 하나뿐이며
  `annual_local_uses`·`annual_visitors`는 근거 표기용이다. `note`는 고정 설명 문구로, 배지만으로는
  막지 못하는 오인을 막기 위해 **그대로** 노출한다(요약·의역 금지).
- `privacy_meta`: 발행 직전 마지막 파이프라인 단계(`pipeline/p10_privacy.py`, P10)가 붙이는
  소표본 보호 메타데이터 — `usage_monthly.json`·`usage_daily.json`·`dashboard.json`에 실린다.
  공통 필드는 `k`·`suppressed_cells`·`aggregate_rounding`·`note`이고,
  **`canonical_total`·`privacy_rounding_adjustment`는 `dashboard.json`에만** 있다 —
  정본 총계의 정의가 `conversion.monthly`이고 그 배열은 대시보드 산출물에만 있기 때문이다.
  `k`(=5) 미만 가맹점 셀은 `suppressed_cells`에 나열되며, `usage_monthly.usage`에서 해당
  (지역×업종) 셀 값이 `null`로 비공개 처리된다. `dashboard.json`은 값을 비공개하지 않는 대신
  차분 복원(다른 합계와의 차로 비공개 셀 값을 역산하는 것)을 어렵게 하기 위해 **영향받는
  합계만** `aggregate_rounding.unit`(=100) 단위로 반올림한다 — `monthly_by_region`의 영향
  지역 열, `region_share`·`category_share`의 영향 항목 `count`가 대상이다. **`rate`·`share`·
  `headline_rate`·스코어·`impact_meta`는 반올림 전 원값을 그대로 유지**한다(P10은 발행값만
  가공하고, 진단·스코어링은 이미 원값으로 끝난 뒤 실행되므로 자동 보장). `note`는 고정 설명
  문구이며 화면에 노출할 때 요약·의역하지 않는다.
  - **`canonical_total`**: 반올림을 타지 않는 정본 총 사용 건수. 정의는 `conversion.monthly[].local_uses`의
    합이며 `impact_meta.annual_local_uses`와 항상 같은 값이다. **화면이 "지역 사용 건수"로 표시하는
    총계는 이 값 하나뿐이다** — 공개 배열의 `count`를 더해 총계를 만들지 않는다.
  - **`privacy_rounding_adjustment`**: 배열별 `count` 합에서 `canonical_total`을 뺀 값(공개값 − 정본).
    반올림이 만든 차이를 화면이 설명할 수 있게 하는 근거다. 실측 2026-08-11 기준
    `region_share` +25 · `category_share` −42 · `monthly_by_region` +25로 **셋이 서로 다르다** —
    이 값을 노출하기 전에는 같은 응답 안의 총계 세 개가 서로 다른 이유를 화면이 댈 수 없었다.
    부분 합(지역 하나·업종 하나)은 여전히 반올림된 공개값이며, 그 사실을 밝힐 때 이 값을 인용한다.
  억제 대상 원본 근거는 `cell_load.json`의
  `suppressed`/`tier: "suppressed"`(P9가 이미 표시)와 같다 — P10은 이를 검증만 하고 다시
  계산하지 않는다.

### `GET /api/candidates`
지도·카드 상세용 스코어링 결과 (`eup_scores.json` + `candidates.json` 병합).

```json
{
  "eup_ranking": [
    {"rank": 1, "eup": "사북읍", "score": 0.71, "low_usage": 0.65, "decline": 0.77},
    {"rank": 2, "eup": "고한읍", "score": 0.58, "low_usage": 0.52, "decline": 0.64}
  ],
  "selected_eups": ["사북읍"],
  "candidates": [
    {
      "id": "CAND-001", "eup": "사북읍", "category": "카페",
      "lat": 37.2211, "lng": 128.8123, "name": "OO카페",
      "score": 0.57, "gap": 0.83, "proximity": 0.7, "saturation": 0.0,
      "market_coverage": 0.17, "gap_confidence": 0.8,
      "nearby_merchants": 0, "nearby_same_category_stores": 4, "nearby_stores": 34,
      "straight_distance_km": 9.4, "selection_basis": "selected_region_coverage",
      "road_distance_km": 11.0, "road_minutes": 50.8
    }
  ],
  "merchants": [
    {"merchant_id": "1043", "name": "OO식당", "category": "음식점", "eup": "사북읍",
     "address": "강원도 정선군 사북읍 ...", "lat": 37.2205, "lng": 128.8101}
  ]
}
```

- `candidates[]`는 업종별 대표 후보(그 업종 최고점 상가)를 Score 내림차순 상위 5개까지 담으며,
  **계산 근거 필드를 항상 포함**한다(감사 가능성 원칙·F4 지도 팝업 근거): `name`=소진공 상가 상호명,
  `gap`=업종공백도, `proximity`=관광동선근접도, `saturation`=기존가맹포화도,
  `nearby_stores`=반경 500m 내 소진공 전체 상가 수, `nearby_merchants`=반경 내 동일 표시 업종
  하이원 가맹점 수. 산식·산출 정본은 `pipeline/p6_scoring.py`(06 P6).
- `road_distance_km`·`road_minutes`: 거점(`ANCHOR`)에서 후보까지의 **도로 경로 거리·소요시간**
  (OSRM 공개 라우팅 API로 사전 계산, 소수 1자리. 호출 실패 시 두 필드 모두 `null`).
  ⚠ **공개 라우팅 API 추정치이며 비포장·임도(track) 구간이 포함될 수 있다** — 실측 도로 대장이
  아니다. 절대 수치로 인용하지 말고 **후보 간 상대 비교**(어느 쪽이 시간상 가까운가)에만 쓴다.
  실제로 CAND-001(영월군 음식점)은 직선 9.4km인데 도로는 28.4km·35.2분으로 직선의 3배가 나온다 —
  산악 지형에서 직선거리 기반 `proximity`가 실제 접근성과 크게 어긋날 수 있음을 보여주는 실측 사례다.
  화면·발표에서는 **소요시간 중심**으로 말하고 거리 수치를 단정하지 않는다.
  `proximity`는 **직선거리** 기반이라 산악 지형에서 실제 접근성과 역전될 수 있다 — 그 한계를
  우리가 먼저 드러내려고 병기하는 참고 필드다. **순위 산식에는 들어가지 않으며**(가중치·정렬 불변),
  FE도 이 값으로 재정렬하지 않는다. 도로 경로 검증은 별도 과제라 순위 반영은 로드맵으로 둔다.
  화면·문서 어디에서도 후보를 "거점에서 가장 가깝다"고 단정하지 않는다 —
  "직선 X km / 도로 Y km·Z분"처럼 두 값을 함께 적는다
- `merchants[].merchant_id`: 하이원포인트 가맹점 목록 원응답의 가맹점 등록번호(`FRCS_REG_NO`)를
  문자열로 실은 값. 발행분 전체에서 **결측·중복이 없어야** 하며 파이프라인 P3가 그 불변식을 검증한다.
  Action Card의 `target.verified_merchant_id`가 가리키는 유일한 대상이고, 위젯 확충 배지는 이 값의
  정확 일치로만 붙는다(§4). 상호명·주소는 표기 흔들림이 있어 조인 키로 쓰지 않는다
- **`candidates[].id`(`CAND-001` 등)는 점포 식별자가 아니라 Score 내림차순 "순위 슬롯"이다** —
  파이프라인을 다시 돌려 후보 구성이 바뀌면 같은 `id`가 다른 점포를 가리킨다(실측: 1위 후보가 가맹
  전환되면 `CAND-001`이 다른 상가로 바뀐다). 카드가 후보를 가리킬 때는 이 값을 쓰지 않고
  `target.candidate_store_id`(§2)의 안정 키를 쓴다
- 지역 라벨 주의: `eup`·`eup_ranking[].eup`의 **"삼척시"는 시 전역이 아니라 하이원포인트
  지역가맹 대상지역인 삼척시 도계읍**을 뜻한다 (대상지역 = 정선군·태백시·영월군·삼척 도계읍,
  https://www.high1.com/www/contents.do?key=1979). 파이프라인도 도계읍만 수집한다
  (`pipeline/p4_stores.py`). 표시명은 원본 CSV 컬럼명을 따라 "삼척시"로 두되,
  툴팁·범례에는 "삼척시 도계읍"으로 적는다

### `GET /api/risk-signal`
대시보드 **요인 카드**(13 §2-15)가 쓰는 배경 지표. `risk_signal.json`을 **가공 없이 그대로** 돌려준다.

```json
[
  {"sigungu": "정선군", "under2y_ratio": 0.1507},
  {"sigungu": "태백시", "under2y_ratio": 0.1497},
  {"sigungu": "영월군", "under2y_ratio": 0.15},
  {"sigungu": "삼척시", "under2y_ratio": 0.1459}
]
```

- 응답은 **최상위 배열**이며 산출 JSON과 완전히 같다 — 감싸거나 필드를 더하면
  `data/processed/risk_signal.json`과 응답 형태가 갈린다
- 요인 카드 4지표 중 `gap`·`proximity`·`saturation`은 `GET /api/candidates`에서, `under2y_ratio`만
  이 엔드포인트에서 온다 (13 §2-15가 확정한 "산출 가능한 지표"). FE는 `api.riskSignal()`로 받는다
- **표시 규칙(필수):** 진단 참고용이며 처방 근거가 아니다(절대 규칙 6). 4개 시군 편차가 0.5%p뿐이라
  지역 비교·순위 정렬·'위험' 라벨·경고색을 쓰지 않고 **"운영 2년 미만 사업자 비중(배경 정보)"**
  중립 표기만 쓴다 (§6·13 §7과 동일 규칙)
- 산출 전이면 `503 {"detail": "risk_signal.json이 아직 생성되지 않았습니다"}`

## 2. Action Card

### Card 객체 (공통 스키마)

```json
{
  "id": "AC-001",
  "type": "EXPANSION",
  "status": "pending",
  "progress": null,
  "allowed_next_progress": [
    {"value": "후보 접촉·검토 시작", "allowed": false, "reason": "승인된 카드만 추진 상태를 기록할 수 있습니다"}
  ],
  "title": "사북읍 카페 업종 가맹점 확충",
  "target": {
    "eup": "사북읍",
    "category": "카페",
    "candidate_store_id": "사북읍 카페 OO카페@37.221100,128.812300",
    "verified_merchant_id": null
  },
  "score_rank": 2,
  "ai_rank": 1,
  "confidence": "중",
  "ai": {
    "adjusted": true,
    "selection_reason": "exclude_in_progress",
    "comparison": "정량 2위 사북읍 카페(Score 0.57)를 AI 제안 1위로 검토했습니다. 정량 1위 고한읍 편의점(Score 0.59)보다 Score가 0.02 낮습니다. 두 후보의 도로 소요시간을 함께 확인한 뒤 결정해야 합니다.",
    "reasons": ["정량 기준: Score 0.57 · 2위", "상권 기준: 업종공백도 1.0 · 반경 500m 내 동일 업종 가맹점 0곳", "AI는 후보 선택에만 사용했으며 숫자·순위·상태는 서버가 정본 데이터로 재검증했습니다"],
    "risks": [
      "가맹 신청은 사업자 의사에 달려 있어 후보 접촉 후에도 계약이 성사되지 않을 가능성",
      "반경 500m 안에 동일 업종 하이원포인트 가맹점이 없어 초기 이용 흐름을 예측하기 어려울 가능성"
    ],
    "expected_effect": "가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
    "grounding": {
      "status": "verified",
      "numeric_status": "verified",
      "narrative_status": "ai_generated_evidence_checked",
      "selection_method": "deterministic_highest_available_score",
      "explanation_source": "llm",
      "dissent_source": "llm",
      "source": "structured",
      "checks": ["target", "score", "rank", "progress", "road_time",
                 "evidence_ids", "claim_scope", "dissent_diversity",
                 "sensitive_attribute_scope"]
    },
    "original_ranking": [
      {"rank": 1, "candidate": "고한읍 편의점", "score": 0.59},
      {"rank": 2, "candidate": "사북읍 카페", "score": 0.57}
    ],
    "dissent": [
      "기준월(2025-12) 이후 소비 패턴이 변했다면 근거 수치가 현재와 다를 가능성이 있습니다.",
      "이 카페 후보의 이용 부하는 건수 기반 추정치라 실제 매출·수요 여력과 다를 가능성이 있습니다.",
      "계절성(겨울 성수기 등)에 따라 제안 시점과 실행 시점의 수요가 다를 가능성이 있습니다."
    ]
  },
  "candidate_verification": {
    "status": "unverified",
    "checks": [
      {"key": "영업 상태", "label": "영업 상태", "status": "unverified"},
      {"key": "가맹 자격", "label": "가맹 자격", "status": "unverified"},
      {"key": "사업자 참여 의향", "label": "사업자 참여 의향", "status": "unverified"},
      {"key": "관광객 이용 적합성", "label": "관광객 이용 적합성", "status": "unverified"},
      {"key": "정산 연동 가능성", "label": "정산 연동 가능성", "status": "unverified"}
    ],
    "note": "후보 접촉·검토 시작은 가맹 확정이 아니며, 적격성 확인과 가맹 심사를 별도로 거칩니다"
  },
  "operations": {
    "owner": null,
    "target_date": null,
    "expected_cost": null,
    "contact_result": null,
    "ineligible_reason": null,
    "actual_outcome": null
  },
  "version": 0,
  "scenarios": null,
  "sources": ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"],
  "generation": {"source": "algorithm", "dedupe_window_seconds": 60},
  "selection_rank": 1,
  "created_at": "2026-08-01T10:00:00+09:00",
  "decided_at": null,
  "decision": null,
  "reproposal_block": null,
  "completed_at": null,
  "progress_before_hold": null,
  "events": [{"at": "2026-08-01T10:00:00+09:00", "action": "generated"}]
}
```

결정이 끝난 카드는 `decision`·`reproposal_block`이 다음 형태로 채워진다(반려 예시):

```json
"decided_at": "2026-08-01T14:20:00+09:00",
"decision": {
  "outcome": "rejected",
  "reason": "동일 상권에 분기 예산이 이미 배정되어 이번 분기에는 추진하지 않음",
  "actor_id": "kim.js",
  "actor_name": "김지수",
  "source": "operator_ui",
  "auth": "shared_token",
  "verified": false,
  "at": "2026-08-01T14:20:00+09:00"
},
"reproposal_block": {
  "until": "2026-10-30T14:20:00+09:00",
  "cooldown_days": 90,
  "recheck_condition": "다음 분기 예산 확정 후 재검토",
  "reason": "동일 상권에 분기 예산이 이미 배정되어 이번 분기에는 추진하지 않음"
},
"events": [
  {"at": "2026-08-01T10:00:00+09:00", "action": "generated"},
  {"at": "2026-08-01T14:20:00+09:00", "action": "rejected", "actor_id": "kim.js",
   "reason": "동일 상권에 분기 예산이 이미 배정되어 이번 분기에는 추진하지 않음", "source": "operator_ui"}
]
```

- 표현 규칙(제도 정합): 가맹점은 강원랜드가 지정하는 것이 아니라 **사업자가 신청하고**
  강원랜드가 서류접수→현장실사→계약으로 심사한다. 따라서 화면·문구에서 **"확보"를 쓰지 않고**
  "가맹 전환"·"우선 모집·유치"로 적는다 (`simulate`의 표시 라벨은 "가맹 전환 시 예상 효과").
  API 필드명·`type` 값(`EXPANSION`)은 그대로 둔다 — 바뀌는 것은 표시 문구뿐이다
- `type`: `EXPANSION`(확충) | `INCENTIVE`(페이백)
- `status`: API 호환용 결정 상태 `pending` | `approved` | `rejected` | `held`. EXPANSION에서 `approved`는
  **후보 접촉·검토 시작을 승인했다는 뜻**이며 가맹 확정이 아니다
- `progress`: EXPANSION은 `후보 접촉·검토 시작` → `적격성 확인` → `가맹 심사` → `추진중` → `완료`,
  그리고 어느 단계에서나 `보류`. INCENTIVE는 `검토중` | `추진중` | `보류` | `완료`를 유지한다
- **`allowed_next_progress`: 지금 이 카드에서 고를 수 있는 다음 단계의 정본**이다. 항목은
  `{value, allowed, reason}`이며 `allowed=false`인 항목도 **이유와 함께 전부 싣는다**(화면이 왜 못
  고르는지 말해야 하므로 목록에서 빼지 않는다). 저장 필드가 아니라 요청 시점에 서버가 계산해
  카드를 반환하는 **모든** 응답에 싣는 파생값이다.
  FE는 순차 전이·보류 재개·적격성 게이트를 **자체 판정하지 않는다** — 서버 규칙과 어긋나면
  화면이 서버가 거부할 선택지를 정상으로 제시하고 사용자는 고른 뒤 409를 본다.
  단계 **표시 순서**용 배열은 FE가 계속 가진다(진행 막대·칩 색), 판정만 서버가 진다
- `progress_before_hold`: `보류` 직전 단계. 보류 해제는 이 단계로만 가능하다(§8). 서버가 관리한다
- `completed_at`: `완료` 기록이 처음 커밋된 시각. 위젯 페이백 최신 카드 판정에 쓴다
- `target.candidate_store_id`: 후보 상가(소진공 상가정보)의 **안정 키**
  `"{eup} {category} {name}@{lat:.6f},{lng:.6f}"`. `candidates[].id`(`CAND-00N`)를 쓰지 않는 이유는
  §1에 있다 — 그 값은 순위 슬롯이라 재산출 시 다른 점포를 가리킨다
- `target.verified_merchant_id`: 그 후보가 실제로 하이원포인트 가맹점이 된 뒤 확인된
  `merchants[].merchant_id`(§1). **확인 전에는 `null`이며 그것이 정상 상태다.**
  두 ID는 원천이 달라 **절대 합치지 않는다** — `candidate_store_id`는 소진공 상가정보(진단 측),
  `verified_merchant_id`는 하이원포인트 가맹점(처방 측)이다(절대 규칙 6)
- `decision`: 결정 1건의 감사 기록. `outcome`은 `status`와 같은 값이고, `reason`은 반려·보류와
  저신뢰 승인에서 필수다(§8). **`verified: false`는 지금 신원이 검증되지 않았다는 사실을 정직하게
  남기는 필드다** — 담당자 계정 체계가 없어 `actor_id`는 화면이 보낸 자기신고 값이고 인증은 공유
  토큰(`auth: "shared_token"`) 하나다. 개인 계정·권한이 도입되면 `auth`·`verified`만 바뀐다.
  없는 값을 검증된 것처럼 저장하지 않기 위한 장치이며 화면도 이 사실을 감추지 않는다.
  승인에는 `safety_review`가 추가되어 서비스 안전 검토 기준 버전과 확인 범위
  (`data_protection`·`source_grounding`·`bias_ethics`)를 남긴다. 반려·보류에는 이 필드가 없다
- `reproposal_block`: 반려·보류된 EXPANSION 타깃의 재제안 차단 창(§8). `until`까지 같은 타깃은
  새 카드로 제안되지 않는다. INCENTIVE는 `target`이 없어 대상이 아니다
- `events[]`: `{at, action}`에 더해 결정 이벤트는 `actor_id`·`reason`·`source`를, 추진 기록 이벤트는
  `record_id`를 함께 싣는다. `action` 문자열 자체는 기존과 같다(`generated`·`approved`·`progress:완료` 등)
- **값이 없는 속성은 응답에서 아예 빠진다** — 카드는 DynamoDB 항목을 그대로 돌려주고(§7),
  DynamoDB는 설정되지 않은 속성을 저장하지 않기 때문이다. 위 예시가 `null`로 적은 필드
  (`completed_at`·`progress_before_hold`·`version`·`generation`·`decision`·`reproposal_block`)는
  **키 자체가 없을 수 있으므로 클라이언트는 옵셔널로 다룬다.** 특히 `version`이 없는 카드
  (시드·이 계약 도입 이전 저장분)에 결정 요청을 보낼 때는 `version`을 생략하거나 `0`을 보낸다 —
  서버가 두 경우를 같게 취급한다
- `candidate_verification.checks[]`는 `{key, label, status}`이며 `key`·`label`은 같은 **한글 항목명**이다
  (영업 상태 · 가맹 자격 · 사업자 참여 의향 · 관광객 이용 적합성 · 정산 연동 가능성 —
  정본은 `services/workflow.REQUIRED_ELIGIBILITY_CHECKS`). `checks[].status`: `unverified` | `verified` |
  `failed`. 상위 `candidate_verification.status`는 서버 계산값 `unverified` | `verified` |
  `ineligible`(하나라도 failed)이다. 다섯 필수 항목이 모두
  `verified`가 아니면 `적격성 확인` 이후 단계와 `완료`를 선택할 수 없다. 하나라도 `failed`면 카드의
  사용자 표시 상태는 `부적격 또는 반려`이며 재검토 전 최종 상태로 이동하지 않는다
- **AI 사실성 경계:** 제안 대상은 LLM 호출 **전에** 서버가 결정론적으로 확정한다(가용 후보 중 최고
  Score — `grounding.selection_method: "deterministic_highest_available_score"`). LLM은 비교 설명과
  비정량 리스크 초안 작성에만 관여하며, LLM이 출력한 `ai_rank_target`은 서버 확정 대상과의 대조
  검증에만 쓰고 폐기한다. 사용자에게
  보이는 후보명·Score·순위·진행 상태·도로 소요시간·비교 문장은 서버가 구조화 데이터로 다시 만든다.
  `ai.grounding.status=verified`는 이 재검증을 통과했다는 뜻이지 후보 사업자의 적격성이 확인됐다는 뜻은
  아니다. 후자는 `candidate_verification.status=unverified`에서 별도로 관리한다.
- **AI 문장의 근거 표기(`claim_type`·`evidence_ids`):** **LLM 출력 스키마**에서 `risks[]`·`dissent[]`는
  평문이 아니라 객체이고, **카드에 저장되는 것은 검증을 통과한 `text`뿐인 문자열 배열**이다
  (위 예시가 그 형태다). 근거 ID는 그 요청 안에서만 유효한 라벨이라 저장하지 않는다 —
  특히 `CAND-00N`은 순위 슬롯이어서(§1) 나중에 읽으면 다른 점포를 가리킨다.
  검증을 통과했다는 사실은 `grounding.checks`와 `narrative_status`가 대신 남긴다.
  `claim_type`은 서버가 실제로 대조할 수 있는 범주로만 열거한다 —
  `정본수치인용`(입력으로 준 값을 인용) · `규칙설명`(제도·절차 서술) · `비정량리스크`(수치 주장 없음).
  `정본수치인용`이면 `evidence_ids`가 비어 있을 수 없고, 서버는 **그 요청에서 실제로 보낸 근거 ID
  집합**과 대조해 미지의 ID를 인용한 문장을 폐기한다. ID 체계는 `CAND-00N`(그 요청의 후보 순위 슬롯,
  필드 단위는 `CAND-002.gap`) · `SEASON.<월>` · `RISK.<시군구>` · `WEEKDAY.<읍>.<업종>` ·
  `HISTORY.REJECTED.<카드ID>` · `SCENARIO.<요율>` · `CONVERSION.headline` · `REGION_SHARE.<지역>`이다.
  요청 안에서만 유효한 라벨이므로 카드에는 검증 결과만 남고 화면은 ID를 노출하지 않는다
- **확충 후보는 "기존 상가의 가맹 전환"이지 신규 창업이 아니다.** 후보의 원천은 소상공인시장진흥공단
  상가정보이고 대상은 **이미 영업 중인 점포**다. 따라서 AI 문장에서 `창업`·`신설`·`개업`·`새로 생기는`
  처럼 신규 창업으로 읽히는 표현을 금지하고, 실행 행위는 `가맹 전환`·`가맹 신청 유도`로만 적는다.
  또 입력의 `0`은 전부 **반경 500m 동일 업종** 스코프이므로, 그 값을 근거로 `지역 최초`·`유일`·
  `업체가 없는 상태`처럼 스코프를 넓혀 단정하지 않는다 — 스코프를 문장에 함께 적어야 한다.
  이 규칙을 어긴 문장은 서버가 폐기하고 규칙 기반 문구로 대체한다
- **반대 의견(`ai.dissent`):** 정확히 3개 객체 배열이며, "이 제안이 틀릴 수 있는 이유"만 담는다 —
  제안을 방어하는 문장이 아니라 반박하는 문장이다. **반대 의견도 AI 산출물이며 정본 수치만
  인용한다** — 입력에 없는 사실을 지어내지 않고, 추측은 "~가능성" 표현으로 쓴다(절대 규칙 4의
  연장: AI는 제안만 하고, 그 제안에 대한 반박까지 함께 제시해 담당자 승인을 돕는다). 별도 LLM
  호출을 추가하지 않고 카드 생성 호출의 `CARD_AI_SCHEMA`에 얹은 필드라, 폴백·grounding 재생성
  경로를 EXPANSION/INCENTIVE 본문과 그대로 공유한다.
  **검증은 개수뿐 아니라 내용까지 본다** — 개수가 3이 아니거나 빈 문자열이 섞였을 때는 물론,
  ① `risk_type` 세 값이 서로 다르지 않거나(같은 위험을 세 번 말하는 것은 반대 관점이 아니다),
  ② 대상 업종과 무관한 다른 표시 업종을 경쟁 상대로 끌어오거나(숙박 제안에 음식점·소매점 경쟁),
  ③ 반려 이력 자체를 실패 근거로 삼는(그 제안이 지금 반려된 이유를 반려당한 사실로 설명하는
  순환 서술) 경우에도 서버가 고정 규칙 문구로 통째 대체한다.
  `risk_type`은 `데이터시점`·`추정방법`·`계절성`·`사업자의사`·`지표한계`·`지역형평`·`제도절차` 중 하나다.
  대체 사실은 `ai.grounding.dissent_source`에 남긴다
  (`llm` | `rule_fallback` | `rule_based` — 의미는 아래 `explanation_source` 표와 같은 축이며,
  INCENTIVE는 시나리오 자체가 서버 고정값이라 LLM이 관여하지 않으므로 항상 `rule_based`다).
  구형 카드(이 필드 도입 이전에 생성·시드된 카드)에는 `dissent`가 없을 수 있다 — 화면은
  `undefined`/누락을 옵셔널로 다루고 없으면 반대 관점 섹션을 그리지 않는다.
- 후보 적격성 확인 전 생성 카드의 `confidence`는 최대 `중`이다. `상`은 영업 상태·가맹 자격·참여 의향
  등 운영 검증을 저장하고 감사할 수 있게 된 뒤에만 허용한다.
  `하`는 서버가 산출한다 — 표본 신뢰도가 낮거나(`gap_confidence < 0.8`) 도로 접근성이 미산출인 후보다.
  **`confidence`가 `하`인 카드를 승인하려면 `reason`(확인 근거)이 필수다**(§8). 낮은 신뢰도를
  근거 없이 통과시키지 않기 위한 게이트이며, 반려·보류는 신뢰도와 무관하게 항상 사유가 필요하다.
  이 값은 **LLM 자기평가를 쓰지 않는다** — INCENTIVE도 시나리오가 서버 고정 가정이라 `중` 고정이다.
  LLM이 제 답의 신뢰도를 스스로 매기면 승인 게이트가 자기신고에 좌우된다
- `INCENTIVE` 타입은 `target`/`score_rank`/`ai_rank` 대신 `scenarios` + `selected_rate` 사용:

```json
"scenarios": [
  {"rate": 3, "delta_pp": [0.5, 1.0], "budget_note": "재원 부담 낮음"},
  {"rate": 5, "delta_pp": [1.0, 2.0], "budget_note": "재원 부담 중간"},
  {"rate": 7, "delta_pp": [2.0, 3.0], "budget_note": "재원 부담 높음"}
],
"selected_rate": null,
"assumption_note": "페이백률-전환율 관계는 실측 데이터가 없어 팀 설정 가정(탄력성)에 기반한 전망"
```

- `selected_rate`: 담당자가 **승인 시 선택한** 페이백률(3|5|7). pending/반려 상태에서는 `null`.
  기획안 원칙 "담당자가 승인한 페이백률만 확정"의 구현 — AI는 시나리오 비교만 제시하고,
  확정 rate는 승인 요청에서만 들어온다. 위젯 `payback.rate`의 유일한 출처.
- **페이백 설계 표현 규칙(필수):** 하이원포인트는 카지노 게임 참여시간·베팅액에 비례해 적립되는
  콤프다. 따라서 "지역에서 쓰면 **추가로 더 적립·지급**한다"는 식으로 쓰면 콤프 **발행액 증가 =
  도박 유인 증가** 논란을 그대로 자초한다. 이 카드는 **적립 단계가 아니라 사용 단계**의 정책이며,
  문구는 **"지역 가맹점 결제분에 한정한 사용 리워드(발행액 증액 없음)"** 또는 "지역 결제 시 한도 우대"로
  통일한다. `payback`·`selected_rate` 등 **필드명·수치·시나리오 구조는 그대로** 두고 표현만 맞춘다.
  (강원랜드는 콤프 부정거래 적발 시 고객 출입정지~영구·가맹점 자격취소 5년으로 제재 중이며
  2026년 한도 상향과 함께 제재를 강화한다 — 발행액을 늘리는 설계는 제안 자체가 성립하지 않는다)

### 후보 선택 사유 (`ai.selection_reason`) — 순위 배지의 계약

`adjusted`(= `score_rank != 1`)만으로는 화면이 "정량 1순위 선택"과 "진행 중인 건 제외하고 선택"
둘 중 하나로만 갈려, 지역 배분 몫으로 고른 카드에까지 둘 중 하나가 **잘못** 붙는다. 사유를 코드로
남겨 화면 문구를 여기서 결정한다 (절대 규칙 5의 감사 가능성).

| 값 | 화면 배지 | 언제 |
|---|---|---|
| `top_score` | **정량 1순위 선택** | 정량 1위를 그대로 선택 (`score_rank == 1`) |
| `exclude_in_progress` | **진행 중인 건 제외하고 선택** | 상위 후보에 진행 중인 업무가 있어 차순위 선택 |
| `region_quota` | **지역 배분 몫에서 선택** | 이번 분기 선정 지역 배분에 따라 그 지역 후보 중에서 선택 |

- 생성 경로(`cardgen`)가 내는 값은 앞의 둘뿐이다. `region_quota`는 분기 배분으로 만든 카드
  (현재는 데모 이력 카드)에 쓴다.
- `ai_rank`/`selection_rank`는 **최종 제안 목록 내 순위**라 항상 1이다 — 정량 순위는 `score_rank`가
  진다. 여기에 정량 순위를 넣으면 화면의 `후보 스코어 N위 → 선택 가능한 후보 N위` 화살표가
  좌우 같은 값이 되어 장치의 요지가 사라진다.
- 값이 없는 구형 카드는 화면이 순위로 추론하고, 단정할 수 없으면 배지를 그리지 않는다.

### AI 설명 출처 (`ai.grounding`) — 화면 칩의 계약

LLM 호출이 실패하거나 애초에 호출하지 않은 카드도 **똑같이 생성된다**. 그때 화면이 "AI가 썼다"고
말하면 절대 규칙 4의 신뢰가 무너지므로, 설명 문구의 출처를 필드로 남기고 화면이 그대로 표시한다.

| `explanation_source` | `narrative_status` | 화면 칩 | 언제 |
|---|---|---|---|
| `llm` | `ai_generated_evidence_checked` | **AI 서술 · 수치·순위 서버 검증** | 후보명·Score·순위·추진 상태·도로 시간은 서버가 정본으로 다시 만들었고, AI가 쓴 문장은 근거 ID 대조와 스코프 단정 검사를 통과했다. **문장의 사실성 전체를 보증하는 뜻은 아니다** — 칩이 검증 범위를 스스로 밝힌다 |
| `rule_fallback` | `rule_based` | **규칙 기반 설명(AI 응답 없음)** | LLM 호출 실패·타임아웃·내용 가드 탈락 |
| `rule_seed` | `rule_based` | **사전 검증 예시 문구** | 데모 시드 카드(사람이 실데이터로 검증해 고정) |

- 칩 라벨이 "서버 검증됨"이던 시절에는 라벨과 바로 옆 설명(`narrative_status`가 미검증이라는 서술)이
  서로 다른 말을 했다. **라벨 자체가 검증 범위를 말해야 한다**는 것이 이 표의 규칙이다.
  화면 문구 3종은 `AI 서술 · 수치·순위 서버 검증` / `AI 서술 · 수치만 서버 고정`(INCENTIVE) /
  `AI 서술 · 서버 검증 없음`(반대 관점)이며 FE `lib/aiSource.ts`가 정본을 갖는다.
  앞 절은 "누가 문장을 썼는가", 뒤 절은 "그중 무엇이 서버 재검증을 거쳤는가"다.

- `ai.reasons`의 출처 문장도 이 값과 **일치해야 한다**. 폴백인데 "AI는 비정량 리스크 문구 생성에만
  사용했습니다"를 그대로 실으면 필드와 문장이 서로 다른 말을 하게 된다.
- `ai.grounding.dissent_source`는 `ai.dissent`(반대 의견 3항)만의 출처다. `explanation_source`와
  갈라지는 이유는, INCENTIVE는 본문 설명(`explanation_source`)은 LLM이 쓸 수 있어도 반대 의견은
  시나리오가 서버 고정값이라 애초에 LLM에 맡기지 않기 때문이다.

  | `dissent_source` | 언제 |
  |---|---|
  | `llm` | LLM이 낸 반대 관점 3개가 형식·내용 검증을 모두 통과해 채택 (EXPANSION) |
  | `rule_fallback` | LLM 호출 실패, 또는 내용 검증 탈락 — 3개 형식 미달·`risk_type` 중복·대상 업종과 무관한 경쟁 서술·반려 이력 순환 인용. 서버 고정 문구(`cardgen.DISSENT_FALLBACK`)로 대체 (EXPANSION) |
  | `rule_based` | LLM을 애초에 호출하지 않음 — INCENTIVE(시나리오 고정)와 데모 시드·mock 카드 |
- **INCENTIVE는 예외**: 시나리오 3/5/7%와 `delta_pp`가 서버 고정값이라
  `status: "partial"` · `numeric_status: "fixed_by_server"` · `selection_method: "fixed_scenarios_3_5_7"`을
  쓴다. **`comparison`·`reasons`·`expected_effect`도 EXPANSION과 마찬가지로 서버가 시나리오 상수와
  `dashboard.json` 정본으로 재생성한다** — 예전에는 이 셋이 LLM 원문 그대로 저장됐고, 인용한 개선폭이
  서버 시나리오와 일치하는지 확인하는 코드가 아예 없어 "5% 적용 시 3.0%p 개선" 같은 문장이 그대로
  카드에 남을 수 있었다. LLM이 쓰는 것은 비정량 리스크뿐이고 `confidence`도 서버 고정이다. EXPANSION용 "검증됨" 배너를 그대로 재사용하지 않는다(검증 대상 자체가 다르다) —
  `explanation_source: "llm"`이면서 `status: "partial"`인 카드의 화면 칩은
  **AI 생성 · 수치만 서버 고정**이다(FE `lib/aiSource.ts`의 `ai_partial`).

### INCENTIVE 카드 완성 예시

```json
{
  "id": "INC-001",
  "type": "INCENTIVE",
  "status": "pending",
  "progress": null,
  "title": "하이원포인트 지역 결제 페이백 (전 지역 공통 — 발행액 증액 없음)",
  "target": null,
  "score_rank": null,
  "ai_rank": null,
  "confidence": "중",
  "ai": {
    "adjusted": false,
    "comparison": "세 시나리오 모두 이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만 리워드가 붙는 사용 단계 설계로, 콤프 발행액 증액은 수반하지 않습니다. 3%는 재원 부담이 가장 낮지만 개선폭이 0.5~1.0%p로 제한적이고, 7%는 2.0~3.0%p로 가장 크지만 재원 부담도 함께 커집니다. 5%는 개선폭 1.0~2.0%p·재원 부담 중간으로, 분기 내 효과 확인과 재원 방어를 동시에 노리는 절충안입니다.",
    "reasons": ["적립이 아닌 사용 단계 정책 — 지역 가맹점 결제분에 한정해 리워드가 붙으므로 콤프 발행액(적립)은 늘지 않고 게임 참여 유인과도 무관", "지역 전환율이 월별 17~23%대에서 오르내려 저점 월을 방어할 수요 측 유인이 필요", "사용 건수가 사북읍·태백시에 절반 이상 몰려 있어 특정 지역 한정이 아닌 전 지역 공통 적용이라 지역 균형을 왜곡하지 않음", "페이백률이 높을수록 효과와 재원 부담이 함께 커지는 트레이드오프가 뚜렷"],
    "risks": ["재원 확보는 예산 부서의 별도 승인 사항", "기존 포인트 적립·할인 약관과의 중복 적용 여부 확인 필요", "실제 자동 지급 시스템 연동은 미구현(로드맵)"],
    "expected_effect": "5% 적용 시 지역 전환율 약 1.0~2.0%p 개선 예상 (가정 기반 전망이며 실제와 다를 수 있음)",
    "original_ranking": null,
    "dissent": [
      "전 지역 공통 페이백이라 지역별 소비 여건 차이를 반영하지 못할 가능성이 있습니다.",
      "페이백률-전환율 관계는 실측 없는 팀 설정 가정이라 실제 효과가 다를 가능성이 있습니다.",
      "지역 전환율은 근사 지표라 개선 폭이 금액 기준 성과와 다를 가능성이 있습니다."
    ]
  },
  "scenarios": [
    {"rate": 3, "delta_pp": [0.5, 1.0], "budget_note": "재원 부담 낮음"},
    {"rate": 5, "delta_pp": [1.0, 2.0], "budget_note": "재원 부담 중간"},
    {"rate": 7, "delta_pp": [2.0, 3.0], "budget_note": "재원 부담 높음"}
  ],
  "selected_rate": null,
  "assumption_note": "페이백률-전환율 관계는 실측 데이터가 없어 팀 설정 가정(탄력성)에 기반한 전망",
  "sources": ["하이원포인트 사용현황"],
  "created_at": "2026-08-01T11:00:00+09:00",
  "decided_at": null
}
```

- INCENTIVE의 `dissent`는 `grounding.dissent_source: "rule_based"`로 고정된다 — 시나리오·개선폭이
  서버 고정 가정이라 LLM이 반대 의견 생성에도 관여하지 않는다(`cardgen.INCENTIVE_DISSENT`).
- INCENTIVE의 `ai`는 EXPANSION과 **동일 스키마를 재사용**하며 순위 필드(`original_ranking`)만 `null`이다
  (`comparison`=시나리오 비교문, `reasons`=권고 근거, `risks`=A-3 프롬프트의 필수 리스크 3종).

### 엔드포인트

| 메서드 | 경로 | 설명 | 요청 body | 응답 |
|---|---|---|---|---|
| GET | `/api/cards` | 목록. 쿼리: `type`, `status` (선택) | — | `{"cards": [Card]}` |
| GET | `/api/cards/{id}` | 단건 | — | `{"card": Card}` |
| POST | `/api/cards/generate` | 스코어링+AI로 카드 생성 | `{"type": "EXPANSION"}` 또는 `{"type": "INCENTIVE"}` | `{"card": Card}` — 신규 201, 동일 타깃 pending 중복 시 기존 카드 200 (§8) |
| POST | `/api/cards/{id}/decision` | 담당자 결정. EXPANSION의 `approved` 표시는 **후보 접촉·검토 시작** | 아래 `결정 요청` | `{"card": Card}` |
| POST | `/api/cards/{id}/verification` | EXPANSION 후보 적격성 5항목 저장 | `{"checks": [{"label": "영업 상태", "status": "verified"}, ...]}` — `label`은 위 한글 항목명 5종, `note`는 서버가 결과에 따라 생성(요청으로 받지 않음) | `{"card": Card}` |
| POST | `/api/cards/{id}/progress` | 추진 상태 변경 (approved만 가능) | `{"progress": "후보 접촉·검토 시작"\|"적격성 확인"\|"가맹 심사"\|"추진중"\|"보류"\|"완료"}` (INCENTIVE는 기존 4단계) | `{"card": Card, "record": ProgressRecord, "created": bool}` — 상태 변경이 `quick_status` 추진 기록도 함께 남긴다 |
| POST | `/api/cards/{id}/simulate` | 가맹 전환 시 예상 효과 (반사실 재계산+LLM). **🔒 인증 필수 · 읽기 계산이라 `DEMO_READ_ONLY` 차단 대상이 아니다** (§8) | — | 아래 |
| POST | `/api/cards/{id}/progress-records` | 추진 기록 저장(상태 전이 + 근거 메모 + 실측 관측값). 상태 변경과 감사 기록을 한 트랜잭션으로 남긴다 | 아래 `ProgressRecord 입력` | `{"card": Card, "record": ProgressRecord, "created": true}` — 신규 201, 같은 `idempotency_key` 재전송이면 기존 기록 200 |
| GET | `/api/cards/{id}/progress-records` | 한 카드의 추진 기록 타임라인 (최신순). **🔒 인증 필수** | 쿼리: `limit`(1~100, 기본 50) · `cursor` | `{"records": [ProgressRecord], "next_cursor": string\|null}` · 토큰 없으면 401 |
| GET | `/api/progress-report` | 기간 추진 경과 리포트 (관측 기록만으로 집계). **🔒 인증 필수** | 쿼리: `from` · `to` (`YYYY-MM-DD`, KST, 양끝 포함) | 아래 `progress-report 응답` · 토큰 없으면 401 |

`결정 요청` (POST body):
```json
{
  "decision": "rejected",
  "selected_rate": null,
  "reason": "동일 상권에 분기 예산이 이미 배정되어 이번 분기에는 추진하지 않음",
  "actor_id": "kim.js",
  "actor_name": "김지수",
  "decision_source": "operator_ui",
  "version": 0,
  "cooldown_days": 90,
  "recheck_condition": "다음 분기 예산 확정 후 재검토",
  "safety_reviewed": false
}
```

- `decision`: `approved` | `rejected` | `held` (필수)
- `selected_rate`: **INCENTIVE 카드를 approved할 때만 필수**(3|5|7). EXPANSION에 오면 무시하고,
  반려·보류에 실려 와도 저장하지 않는다
- `reason`: **반려·보류에서 필수**이고, **`confidence`가 `하`인 카드의 승인에서도 필수**다(확인 근거).
  그 외에는 선택이며 넣으면 그대로 감사 기록에 남는다. 누락은 **422**(§8)
- `actor_id`(필수)·`actor_name`(선택): 결정한 담당자. **화면이 보내는 자기신고 값**이며 서버는
  `decision.verified: false`·`auth: "shared_token"`과 함께 저장해 검증되지 않았음을 명시한다.
  담당자 계정 체계가 붙기 전까지 이 값을 신원 증명으로 읽지 않는다
- `decision_source`: `operator_ui`(기본) | `api`. 어느 경로로 들어온 결정인지 남긴다
- `version`(선택, 권장): 화면이 읽은 카드의 `version`. 보내면 조건부 쓰기에 포함해 그 사이 다른
  요청이 카드를 바꿨으면 **409**를 낸다. 생략하면 `status=pending` 조건만 걸린다
- `cooldown_days`(선택, 기본 90 · 0~365)·`recheck_condition`(선택): **반려·보류에서만** 의미가 있다.
  같은 타깃을 언제까지 다시 제안하지 않을지와 무엇이 바뀌면 다시 볼지를 카드에 남긴다(§8 재제안 차단)
- `safety_reviewed`: **승인에서만 `true`가 필수**다. 담당자가 소표본 보호를 포함한 데이터 보호 범위,
  서버 검증 근거, AI 비교·반대 관점과 편향·윤리 영향을 확인했다는 자기확인이다. 서버는 누락을 422로
  거부하고, 성공한 확인을 `decision.safety_review`에 기준 버전과 함께 남긴다. 특정 기관의 공식
  규정 준수를 가장하는 필드가 아니라 이 서비스가 실제로 강제하는 내부 검토 기준이다

**🔒 인증**: 위 두 GET과 `simulate`는 `Authorization: Bearer <MUTATION_API_TOKEN>` 헤더가 필요하다
(`security.require_internal_access` — 모든 변경 계열 POST와 같은 토큰). 담당자 화면 전용 데이터라
공개 GET(대시보드·후보·위젯)과 층위가 다르기 때문이다. FE 서버 컴포넌트가 `API_MUTATION_TOKEN`
환경변수로 헤더를 붙인다 — 이 값을 빠뜨리면 `/tracking`의 리포트가 401로 접히고 업무 목록만 남는다.

변경 계열 POST와 다른 점은 `DEMO_READ_ONLY`다. 변경 POST는 읽기 전용 모드에서 403이지만
`simulate`는 카드 상태를 바꾸지 않는 계산이라 계속 열려 있다 — 막으면 승인 판단 근거가 사라지고
상태 변경이 아닌 요청에 "읽기 전용입니다" 문구가 뜬다. 토큰을 요구하는 이유는 권한이 아니라
요청마다 LLM을 호출하기 때문이다(무인증 공개 시 비용 남용).

`simulate` 응답:
```json
{
  "simulation": {
    "current_index": 42.5,
    "projected_index": 42.5,
    "delta_pp": [0.0, 0.1],
    "expected_monthly_count": 62.4,
    "expected_monthly_range": [58.9, 66.0],
    "uncertainty_method": "최근 3개월 월별 가맹점당 건수 25~75 분위수",
    "estimate_basis": "대상 지역·업종의 최근 3개월 가맹점당 평균",
    "base_month": "2025-12",
    "effect_assessment": "미미",
    "decision_note": "집중도 개선폭이 매우 작게 추정됩니다. 승인 전에 가맹 유치 비용·사업자 참여 의향·예상 월 사용건수를 비교하고, 보류도 정상적인 선택지로 검토하세요.",
    "narrative": "사북읍 카페 업종에 신규 가맹점이 1곳 추가되어도 예상 월 이용 건수가 6개 지역 전체 규모에 견주면 작아, 지역 소비 집중도는 소수점 첫째 자리 기준으로 변화가 나타나지 않을 것으로 예상됩니다. 이는 유사 가맹점의 평균 초기 실적을 가정한 전망이며, 실제 결과는 입지·홍보 여부에 따라 달라질 수 있습니다.",
    "narrative_source": "rule_based",
    "assumption_note": "가정 기반 전망이며 실제와 다를 수 있음"
  }
}
```

- `narrative_source`는 `narrative` 문구의 출처다: `llm`(LLM 응답을 검증 통과 후 사용) ·
  `rule_based`(LLM 미호출 또는 응답이 내용 가드에 걸려 규칙 문구로 대체). **방향이 `혼재`·`미미`인
  구간은 애초에 LLM을 호출하지 않으므로 항상 `rule_based`**다.
  화면은 이 값으로 설명 출처 칩을 띄운다 — 폴백인데 "AI가 썼다"고 말하지 않기 위한 필드다.

- `expected_monthly_count`는 반사실 계산에 더한 예상 월 이용 건수, `estimate_basis`는 3단계 폴백 중
  실제 적용 근거, `base_month`는 전망의 기준월이다. `expected_monthly_range`는 예상 건수의 관측 기반
  범위(폴백 표본의 최근 3개월 월별 가맹점당 건수 25~75 분위수 — `delta_pp` 구간의 원천),
  `uncertainty_method`는 그 산출 방법 라벨이다. FE는 효과 지수만 보여주지 말고 세 값을 함께 보여
  “0.0%p”가 계산 실패인지 규모가 작은 정상 결과인지 구분하게 한다.
- `effect_assessment`는 `개선|심화|혼재|미미`이며 `decision_note`는 승인 권고가 아니라 담당자가 다음에
  확인할 사항을 제시한다. `미미` 또는 최대 변화폭 0.1%p 이하는 보류도 정상 선택지라고 명시한다.

- `current_index`·`projected_index`는 **소수 1자리**다(§1 `concentration.index`의 정수 표기와 다름).
  정수로 반올림하면 원시 집중도가 42.53처럼 경계에 걸릴 때 0.05%p 변화가 "43 → 42"로 보여
  같은 응답의 `delta_pp`와 10배 어긋난다. FE도 소수 1자리로 표기한다
- `projected_index`는 재계산 원시값의 독립 반올림이 아니라 **`round(current) − round(Δ평균)` 파생값**이다
  (2026-08-08 개정) — 세 값을 따로 반올림하면 "42.5 → 42.5인데 0.1%p 개선" 같은 자기모순 문장이
  나온다. 표시 이동폭(current−projected)은 항상 `delta_pp` 범위 안에 떨어진다
- `current_index`의 기준월 6지역 분포(`dist`)는 **`dashboard.json`의 `monthly_by_region`을 우선**
  사용한다(2026-08-10 A3 후속 개정). `usage_monthly.json`은 P10 소표본 억제로 일부 셀이 `null`이라
  셀 합산으로 `dist`를 만들면 억제 지역의 총량이 실제보다 낮게 잡힌다(실측: 영월군 기준월 총량이
  1,552 → 셀 합산 1,223, −21%). `dashboard.json`의 `monthly_by_region`은 값 자체를 숨기지 않고
  영향받는 열만 100단위로 반올림하므로(오차 ±50) 더 정확한 근사다. `dashboard`에 해당 기준월 행이
  없거나 6지역 중 하나라도 값이 없으면 기존 usage 셀 합산으로 **조용히 폴백**한다(`backend/app/
  services/simulate.py`의 `_region_totals_from_dashboard`). 분모 폴백 체인(15 문서 §5 T12)·
  `concentration_index` 산식 자체는 바뀌지 않았다 — `dist`의 출처만 바뀌었다
- `delta_pp`는 `[낮은 값, 높은 값]`이고 **부호 있는 %p**다(양수 = 집중도 하락 = 개선).
  **FE는 소수 1자리로 포맷을 고정한다** — 저장소 왕복 과정에서 `1.0`이 `1`로 돌아올 여지가 있어
  자릿수를 값에 맡기지 않는다
  `narrative`의 방향 표현은 구간으로 판정한다 — 둘 다 양수면 "개선", 둘 다 음수면 "상승(집중 심화)",
  **0을 걸치면**(`lo<0<hi`) 방향을 단정하지 않고 "양방향 모두 가능", **정확히 `[0.0, 0.0]`이면**
  "소수점 첫째 자리 기준으로 변화가 나타나지 않음"으로 적는다. 뒤의 두 경우는 **LLM을 호출하지 않고**
  규칙 기반 문구만 쓴다 — 없는 개선을 지어내거나 한쪽 방향으로 단정하는 것을 구조적으로 막기 위함이다
  - `[0.0, 0.0]`은 예외가 아니라 흔한 결과다(실데이터 6지역×6업종 36조합 중 19개). 가맹점 1곳 추가가
    6개 지역 전체 집계를 0.05%p도 못 움직이는 경우와, 유사 가맹점 실적이 없어 추정치가 0건인 경우로
    나뉘며 문구가 그 근거를 밝힌다
  - 한쪽 끝만 반올림 결과 `0.0`인 구간(`[0.0, 0.1]`·`[-0.1, 0.0]`)은 **반대쪽 끝의 부호**를 따른다.
    원시값은 양쪽 부호가 같고(예상 건수가 0이면 양쪽 다 0이 되어 `[0.0, 0.0]`), 실데이터 36조합 중 7건이 여기 해당한다
  - `-0.0`은 내보내지 않는다(반올림 결과가 음의 0이면 `0.0`으로 정규화 — 화면에 "-0.0%p"가 찍히는 것 방지)
  - LLM에는 **집중도 지수 두 값을 주지 않는다**(방향과 폭만 전달) — 주면 "43에서 42로 1포인트 개선"처럼
    `delta_pp`와 어긋난 문장을 쓴다. 생성된 문구가 계산 방향과 반대면(개선↔심화) 양방향 모두 규칙 기반 문구로 대체한다

- **타깃이 소표본 억제 셀(k=5 미만) 자체면 `simulate`는 계산하지 않고 `400`을 낸다**
  (2026-08-10 A3 후속 개정) — 판정 근거는 `usage_monthly.json`의 `privacy_meta.suppressed_cells`
  (하드코딩 없음). 억제된 셀은 타깃 읍×업종의 과거 이용 이력 자체가 `null`이라, 이를 그대로
  계산하면 `expected_monthly_count`가 **진짜 0**으로 나와 "예상 효과 없음"과 "표본이 없어 계산
  불가"가 구분되지 않는다 — 집계 6개 지역 밖 타깃을 조용히 delta 0으로 내지 않는 기존 규칙(위)과
  같은 이유·같은 방식(`ValueError` → 라우트가 400)이다. 아래 동작 규칙 표 참고

### 추진 기록 (`progress-records`) · 경과 리포트 (`progress-report`)

카드의 `progress`만 바꾸는 `POST /api/cards/{id}/progress`는 **상태만** 남기고 근거를 남기지 않는다.
추진 기록 API는 상태 전이·근거 메모·실측 관측값을 **하나의 감사 기록**으로 묶고, 그 기록들만으로
경과 리포트를 만든다. 리포트의 모든 수치는 담당자가 실제로 입력한 관측값에서 나오며 추정하지 않는다.

`ProgressRecord 입력` (POST body):
```json
{
  "progress": "추진중",
  "recorded_at": "2026-08-08T14:00:00+09:00",
  "progress_pct": 80,
  "note": "가맹 계약 체결. 포스 연동 진행",
  "blocker": "사업자 측 포스 교체 일정 미정",
  "next_action": "포스 교체 일정 재협의",
  "owner": "지역상생팀",
  "due_at": "2026-08-20",
  "source": "담당자 입력",
  "metrics": {
    "usage_count": {
      "value": 1362,
      "measured_from": "2026-07-01", "measured_to": "2026-07-31",
      "source": "하이원포인트 운영 DB 월 마감",
      "scope": "영월군 음식점 가맹점 전체"
    }
  },
  "completion_evidence": null,
  "idempotency_key": "임의 문자열(재전송 가드)"
}
```
- `note`는 필수(공백 불가, 2000자 이내). 나머지는 전부 선택이며 `metrics`의 5개 키도 개별 선택이다.
- **`metrics`의 값은 스칼라가 아니라 객체다.** 어떤 지표든 값을 실으면 `value`와 함께
  `measured_from`·`measured_to`(측정 기간, `YYYY-MM-DD`) · `source`(관측 출처) · `scope`(측정 범위)가
  **전부 필수**다. 누락은 **422**. 기간·출처·범위 없는 숫자는 나중에 무엇을 잰 값인지 되짚을 수
  없어 감사 기록으로서 의미가 없고, 서로 다른 범위의 값이 한 리포트에서 비교되는 사고를 막지 못한다.
  `measured_from`은 `measured_to`보다 늦을 수 없고 `measured_to`는 `recorded_at`보다 미래일 수 없다.
- **`unit`과 `is_proxy`는 요청으로 받지 않는다** — 서버가 지표 정의에서 채워 저장하고 응답에 싣는다.
  단위를 자유 입력으로 열면 `%`와 `%p`를 뒤바꾼 값이 감사 기록에 남는데, 그 오류는 화면에서
  실제와 5배 다른 값으로 나타난다. 지표 정의(단위·근사 여부·개선 방향)의 정본은 서버 한 곳이다.
- 지표별 단위: `usage_count` 건 · `conversion_rate_pct` %(근사 지표) · `active_merchant_count` 곳 ·
  `spend_krw` 원 · `concentration_index` 지수(0~100, 낮을수록 개선).
- **`completion_evidence`는 `progress`가 `완료`일 때 필수**다(누락은 **422**). 타입별로 요구가 다르다:
  - EXPANSION: `{"merchant_registration_id": "1043"}` 또는 `{"document": "가맹 계약서 사본 2026-08-11"}`
    중 최소 하나. 가맹 등록 ID를 주면 서버가 `target.verified_merchant_id`에 함께 반영하고,
    그때부터 위젯 확충 배지가 그 가맹점에 붙는다(§4). 등록 ID 없이 증빙 문서만 주면 카드는
    완료되지만 **위젯 반영은 대기 상태로 남는다** — 배지 근거가 없기 때문이다.
  - INCENTIVE: `{"applied_from": "2026-09-01", "applied_to": "2026-11-30", "owner": "지역상생팀 김지수",
    "budget_cap_confirmed": true}` 전부 필수. 예산 한도 확인이 `false`면 완료로 넘어갈 수 없다.
- **빠른 상태 변경(`POST /progress`)으로는 `완료`를 만들 수 없다** — 증빙을 실을 자리가 없기 때문이다.
  그 경로의 `완료` 요청은 **422**이며 이 API로 안내한다. 완료는 위젯 배지·KPI 실행 전환율에
  직결되므로 근거 없이 만들어져서는 안 된다.
- `recorded_at`은 **시간대 오프셋 필수**. 생략하면 서버가 현재 KST를 쓴다. 카드 생성 시각보다 이르거나,
  이미 저장된 최신 기록보다 이르거나, 현재보다 5분 이상 미래면 **400**.
- 상태 전이 규칙은 `POST /progress`와 같다(승인 카드만·순차 전이·보류는 직전 단계로만 복귀,
  EXPANSION은 적격성 5항목 확인 후에만 적격성 확인 이후 단계 가능). 위반은 **409**.
- 같은 상태를 다시 기록하는 것은 **정상**이다 — 단계가 진행되지 않아도 날짜별 메모·관측값을 남겨야 한다.
- `metrics.conversion_rate_pct`는 §1의 지역 전환율과 같은 근사 지표다 → **표시하는 모든 화면에
  `근사 지표` 배지를 병기한다**(절대 규칙 2).
- `metrics.spend_krw`(지역 사용액)는 원천 데이터에 금액 필드가 없어 **파이프라인이 채우지 않는다**.
  담당자가 별도 확인한 값을 직접 입력할 때만 쓰이며, 비어 있는 것이 정상이다.

`progress-report 응답` (필드 요약):
```json
{
  "period": {"from": "2026-05-11", "to": "2026-08-08", "timezone": "Asia/Seoul", "days": 90},
  "record_count": 9,
  "recorded_card_count": 2,
  "cards_without_records": 1,
  "status_distribution": {"후보 접촉·검토 시작": 0, "적격성 확인": 0, "가맹 심사": 0,
                          "검토중": 0, "추진중": 1, "보류": 0, "완료": 1},
  "completion": {"rate": 0.5, "completed_count": 1, "sample_size": 2},
  "average_progress_pct": {"value": 80.0, "sample_size": 2},
  "on_time": {"rate": 1.0, "on_time_count": 1, "sample_size": 1},
  "stale": {"threshold_days": 14, "count": 1, "items": [{"card_id": "AC-004", "title": "...",
            "progress": "추진중", "last_recorded_at": "...", "days_since_update": 22}]},
  "stage_durations": [{"from_progress": "가맹 심사", "to_progress": "추진중",
                       "average_hours": 252.0, "median_hours": 252.0, "sample_size": 1}],
  "metric_changes": {"usage_count": {"baseline_average": 791.0, "latest_average": 895.0,
                     "delta": 104.0, "delta_unit": "count", "relative_change_pct": 13.15,
                     "improvement": 104.0, "lower_is_better": false, "sample_size": 2}}
}
```
- 기간 기본값은 **`to` = KST 오늘, `from` = `to` − 89일**(90일). 다음 세 경우는 **400**이다:
  `from > to` · `to`가 KST 오늘보다 미래 · `(to − from)`이 366일 이상.
  → FE가 만들 수 있는 최대 구간은 `from = to − 365일`이다.
- **집계 모집단은 "기간 종료일 시점에 이미 승인돼 있던 카드"다** — `status="approved"`이면서
  `created_at`·`decided_at`이 모두 기간 종료일 23:59:59.999999(KST) 이하인 카드만 센다
  (`routes/progress.py _approved_as_of`). 이 규칙은 `recorded_card_count`·`cards_without_records`·
  `status_distribution`·`completion`·`on_time`에 모두 적용된다. 과거 기간을 조회할 때 그 시점에
  존재하지도 않던 카드를 "미기록"이라고 세지 않기 위함이다. **화면이 리포트 옆에 카드 목록을
  직접 그린다면 같은 필터를 걸어야 한다** — 걸지 않으면 "미기록 0건" 헤더 아래 카드가 뜬다
  (FE는 `lib/progressReportView.ts approvedAsOf`가 같은 정의를 복제한다).
- `status_distribution`은 **기간 종료일까지의 카드별 최신 기록** 기준이다(기간 시작 이전 기록도 본다).
  경과 기록이 하나도 없는 승인 카드는 분포에서 빠지고 `cards_without_records`로만 센다 —
  화면은 이 사실을 문구로 밝혀야 헤더 건수와 칩 합계의 차이가 오해되지 않는다.
- `completion.rate`의 분모는 승인 카드 전체가 아니라 **기록이 있는 카드 수**다.
- `on_time`은 `due_at`과 `완료` 기록이 **둘 다** 있는 카드만 표본으로 센다.
- `stale`은 완료되지 않은 카드 중 마지막 기록이 14일 이상 지난 것.
- `metric_changes[].improvement`는 부호를 지표 의미에 맞춘 값이다 — `concentration_index`는
  `lower_is_better: true`라 **감소가 개선**이며, 화면도 증감 방향과 개선 여부를 구분해 말해야 한다.
- `sample_size: 0`이면 `baseline_average`·`delta`가 전부 `null`이다. 화면은 값을 만들지 않고
  “—”로 두며 “기초값이 없다”는 사실을 밝힌다.

## 3. KPI

### `GET /api/kpi`
전부 시스템 자체 상태값(DynamoDB)으로 계산 — 추가 데이터 불필요.

```json
{
  "adoption_rate": 0.67,
  "execution_rate": 0.5,
  "avg_decision_hours": 1.2,
  "avg_approval_hours": 1.2,
  "regional_balance_index": 80,
  "balance_sample_count": 2,
  "counts": {"total": 4, "pending": 1, "approved": 2, "rejected": 1, "held": 0, "decided": 3, "done": 1}
}
```

- 채택률 = approved / **결정 완료(approved+rejected+held)** — 승인 대기 카드는 아직 채택 여부가
  정해지지 않았으므로 분모에서 제외한다(결정 카드 0건이면 `null`). 위 예시는 결정 3건 중 승인 2건 = 0.67.
  실행 전환율 = (추진중+완료) / approved
- 평균 의사결정 소요 `avg_decision_hours` = avg(decided_at − created_at). `avg_approval_hours`는
  이전 소비자 호환용 별칭(같은 값)이며 신규 화면은 `avg_decision_hours`를 쓴다.
  `counts.decided`는 결정 완료 카드 수(= 채택률 분모)
- 지역 균형지수 = 승인 EXPANSION 카드의 6지역 분포에 **지역 소비 집중도와 동일한 정규화 지수**(0~100)를
  적용해 `100 − 집중도`. **완전 균등 = 100, 한 지역 몰림(완전 편중) = 0**.
  §1 `concentration.index`와 같은 자를 쓰므로 진단 지표와 나란히 읽을 수 있다
  (내부 산식은 정규화 지니 — 화면·발표 용어 비노출 원칙은 그대로)
- 지역 균형지수는 **EXPANSION 카드만** 집계 (INCENTIVE는 `target`이 없어 지역 분포에 넣을 수 없음)
- `balance_sample_count`: 그 지수를 만든 **표본 수** = 집계 6지역 안에 `target.eup`이 있는 승인
  EXPANSION 카드 수. `counts.approved`는 INCENTIVE를 포함해 다른 숫자이므로 표본으로 쓰면 안 된다.
  화면은 이 값으로 표본 품질(예시 데이터/표본 부족/운영 표본)을 판정한다 — 지수만 크게 띄우고
  그것이 카드 2장에서 나온 값이라는 사실을 감추지 않기 위한 필드다. 0이면 지수는 `null`이다.
  `counts` 안이 아니라 **최상위**에 둔다(`counts`는 카드 상태별 건수만 담는 자리다)
- `regional_balance_index`의 분모는 **`REGIONS` 6개 지역 고정** — 승인(approved) 카드가 한 건도 없는
  지역도 0건으로 포함해 위 산식으로 계산하고, 결과는 반올림한 정수. 지표 특성상 승인 카드가
  여러 지역에 쌓일수록 상승한다 (승인 1장 = `0`, 서로 다른 2개 지역 = `20` — 데모 초반의 낮은 값은
  정상 동작이며, 위 예시의 `80`은 여러 지역에 고루 쌓인 상태를 가정한 값이다)
- `avg_decision_hours`(= 별칭 `avg_approval_hours`)의 집계 대상은 **`decided_at`이 있는 모든 카드**
  (approved+rejected+held) —
  "의사결정 소요 시간"이라는 지표 의미에 맞춘 정의. `decided_at − created_at`의 평균을 소수 1자리로 반올림

## 4. 방문객 위젯

### `GET /api/widget/recommend?region=사북읍&category=카페`

```json
{
  "recommendations": [
    {
      "name": "OO카페", "category": "카페", "address": "정선군 사북읍 ...",
      "lat": 37.2211, "lng": 128.8123,
      "badge": "이번 분기 확충 업종",
      "payback": {"rate": 5, "label": "지금 여기서 쓰면 5% 페이백"},
      "blurb": "사북읍의 카페 하이원포인트 가맹점이에요",
      "directions_url": "https://map.kakao.com/link/to/..."
    }
  ],
  "policy_note": "완료된 확충 업종 우선 · 그 외 하이원리조트 거점 직선거리 기준",
  "total": 18,
  "expansion_sync": {"completed_cards": 2, "reflected": 1, "pending_sync": 1}
}
```

- `badge` = **"이번 분기 확충 업종"** (BE 상수 `EXPANSION_BADGE`). `progress=완료`인 EXPANSION 카드의
  **`target.verified_merchant_id`와 `merchant_id`가 정확히 일치하는 가맹점에만** 붙고, 아니면 `null`이다.
  - 예전에는 (읍×업종) 집합으로 매칭했다. 확충 후보는 아직 가맹점이 아닌 상가라 그 방식은 배지를
    **완료 카드와 무관한 기존 가맹점들**에 붙였다(공백 업종이면 아무 데도 못 붙였다). 실제로 확충된
    점포를 가리키지 못하는 배지는 방문객에게 사실이 아닌 정보다
  - **`verified_merchant_id`가 없거나 그 ID가 아직 `merchants` 산출에 없으면 배지를 붙이지 않는다.**
    카드가 완료여도 마찬가지이며, 이 상태를 "반영 대기"라 부른다. 가맹 등록 → 다음 파이프라인
    산출까지의 시차가 정상적으로 존재하므로, 그 구간에 배지를 붙이면 없는 가맹점을 추천하게 된다
- `expansion_sync`: 완료된 확충 카드가 위젯에 실제로 반영된 상태. `completed_cards`(완료 카드 수) ·
  `reflected`(그중 배지가 붙은 수) · `pending_sync`(반영 대기 수). 담당자 화면이 "완료했는데 왜 위젯에
  안 보이지"에 답할 수 있게 하는 근거다 — 화면은 완료를 곧 노출로 단정해 말하지 않는다
- `payback` = INCENTIVE 카드가 `완료` 상태일 때만 포함, 아니면 `null`. `rate`는 해당 카드의 `selected_rate` 값
- `blurb` = **결정론 문구**다(LLM 미사용 — 2026-08-08 확정). 실명 점포의 맛·분위기·메뉴를 추정하지
  않기 위한 설계 결정이며, `prompts.py`의 위젯 프롬프트(A-4)는 제거했다
- **추천 정렬 근거(BE 확정):** ① `badge:"이번 분기 확충 업종"`이 붙는 가맹점 먼저 ② 그다음 거점(`ANCHOR`)까지의
  **직선거리 오름차순**. `limit`은 1~120으로 클램프하며 기본 12곳이다. 원본 순서(상호명순)로 두면 필터 없이 호출할 때
  방문객 동선과 무관한 가맹점이 먼저 나오기 때문이다
  - **거리 값은 응답에 싣지 않는다**(정렬 근거로만 사용). `blurb` 생성 프롬프트에도 넣지 않는다 —
    §1 캐비엇대로 화면·문구 어디에서도 "가장 가깝다"고 단정하지 않기 위함이다.
    FE는 위치 권한을 사용하지 않는다는 점과 하이원리조트 거점 직선거리 기준임을 함께 밝힌다. 산악
    도로 실제 이동시간과 순서가 다를 수 있으므로 “내 주변”·“가까운 순”이라고 라벨링하지 않는다.
  - 좌표(`lat`/`lng`)가 없는 가맹점은 거리 비교에서 맨 뒤로 밀린다

## 5. 기타

### 데이터셋 버전 헤더 (`X-Dataset-Version`)

모든 `/api/*` 응답에 `X-Dataset-Version: <base_month>.<해시8자리>`(예: `2025-12.a1b2c3d4`) 헤더가
실린다 — 화면이 지금 어느 데이터셋 산출로 만들어졌는지 심사위원이 확인하는 용도(Task C1 출처 칩이
표시). 값의 원천은 `data/processed/manifest.json`의 `dataset_version`이며, 파이프라인(`run_all.py`)이
매 실행 끝에 산출 JSON 전체의 sha256을 모아 생성한다(§6 참고). `manifest.json`이 없는(구 데이터)
환경에서는 헤더가 생략될 뿐 응답 자체는 정상 200이다. CORS `expose_headers`에 등록돼 있어 브라우저
JS(`fetch(...).headers.get("X-Dataset-Version")`)에서도 읽을 수 있다.

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/health` | `{"ok": true, "data_loaded": true, "datasets": {...}}` |

```json
{
  "ok": true,
  "demo_read_only": false,
  "data_loaded": true,
  "datasets": {"dashboard": true, "eup_scores": true, "candidates": true,
               "merchants": true, "risk_signal": true, "manifest": true}
}
```

- `datasets`: 산출 JSON 6종의 로드 성공 여부(각 `true`/`false` — 파일 누락뿐 아니라 JSON 파손도
  `false`). `dashboard` 하나만 보면 나머지
  결손을 놓치므로 개별로 보고한다 (배포 후 `build-and-push.sh` 의 data 복사 누락 진단용)
- `data_loaded`: **필수 4종**(`dashboard`·`eup_scores`·`candidates`·`merchants`)의 AND.
  `risk_signal`은 07 문서 B4 ⑥에서 "없으면 컷"인 선택 입력이라 `datasets`에만 싣고 AND에서는 뺀다.
  `manifest`도 마찬가지로 버전 표시용 부가 정보라 `datasets`에만 싣고 AND에서는 뺀다(A4) —
  없어도 `/api/*` 응답 자체는 정상이고 `X-Dataset-Version` 헤더만 생략된다
- `demo_read_only`: `DEMO_READ_ONLY` 환경변수 상태 — FE가 읽기 전용 배너·버튼 잠금을 서버 설정과
  맞추는 데 쓴다
- 기존 키 `ok`·`data_loaded`는 형태·의미 그대로다 — `datasets`·`demo_read_only`가 추가되었다

### `GET /api/health/ready`

ALB 대상그룹 헬스체크 전용. 필수 산출물(dashboard·eup_scores·candidates·merchants)이
하나라도 없으면 **503**을 반환한다.

- 200: `{"ready": true}`
- 503: `{"detail": "필수 산출물 누락: merchants"}`

`/api/health`와 나뉘어 있다 — health는 결손을 **보고**하는 진단용(항상 200)이고,
이 경로는 결손 이미지가 트래픽을 받지 못하게 **차단**하는 용도다.

## 6. 파이프라인 산출 JSON (data/processed/) 스키마

| 파일 | 내용 | 주 소비처 |
|---|---|---|
| `dashboard.json` | §1의 `GET /api/dashboard` 응답 그대로 | BE 서빙, FE mock |
| `eup_scores.json` | §1 `eup_ranking` + `selected_eups` | BE(candidates, 카드 생성) |
| `candidates.json` | §1 `candidates` 배열 | BE(candidates, 카드 생성) |
| `merchants.json` | §1 `merchants` 배열 (`merchant_id`·지오코딩·주소 포함) | BE(candidates, 위젯) |
| `risk_signal.json` | `[{"sigungu": "정선군", "under2y_ratio": 0.1507}]` | BE(카드 생성 AI 입력 ⑥, `GET /api/risk-signal`), FE mock |
| `sensitivity.json` | `{"combos": 25, "top3_stable_ratio": 0.88, "detail": [...]}` | 발표 슬라이드 |
| `usage_monthly.json` | 월×지역×업종 원자료 집계 (재계산·검증용) — `k<5` 셀 건수는 P10이 `null`로 억제, `privacy_meta` 동반 | pipeline, simulate, **FE 지역 드릴다운(정적 import)** |
| `usage_daily.json` | 일·요일 축 집계 — 요일×표시6분류(지역별+전체) 누적, 지역별 일 총건수 시계열 | **FE 지역 드릴다운 요일 섹션(정적 import)**, BE(카드 생성 AI 입력 ⑧) |
| `cell_load.json` | (지역×표시업종) 셀별 가맹점 이용 부하 지수 — 최근 3개월 평균 월 거래 건수 ÷ 셀 가맹점 수 (건수 기반 추정치, k=5 미만 셀은 억제) | **FE 셀 탐색 시뮬레이터(정적 import)**, pipeline(A3 억제 검증 입력) |
| `manifest.json` | 산출 JSON 전체(자기 자신 제외)의 sha256·바이트 수 + `dataset_version`(`<base_month>.<해시8자리>`) — 파이프라인을 다시 돌리면 `generated_at`·해시가 바뀌어 매번 값이 갱신된다 | BE(모든 `/api/*` 응답의 `X-Dataset-Version` 헤더), FE(Task C1 출처 칩) |

- `risk_signal.json` 표시 주의: 실측 4개 시군이 **14.6~15.1%로 최대 편차 0.5%p**라 지역 간 비교
  근거가 못 된다. 화면에 노출할 때 **'위험' 라벨·경고색·순위 정렬을 쓰지 않고**
  "운영 2년 미만 사업자 비중(배경 정보)"으로만 적는다 (AI 입력에서도 참고용 진단 지표 — 07 B4 ⑥).
- `usage_monthly.json`의 `region_note`·`eup_ranking`의 "삼척시"는 도계읍 한정이다 (§1 지역 라벨 주의).
- `usage_monthly.json`은 **BE 엔드포인트 없이** FE가 mock 사본을 정적 import 해 지역 소비 분석
  드릴다운(업종 구성·월별 추이·상위 업종)에 쓴다 — 분기 배치 산출물이라 양 모드 데이터가 동일하다.
  표시 6분류 롤업은 `pipeline/category_map.py`의 `HIGHONE_TO_DISPLAY`가 정본이며
  `frontend/src/lib/regionAnalysis.ts`가 이를 복제한다(파이프라인 변경 시 함께 수정).
- `usage_monthly.json`의 소표본 억제: `pipeline/p10_privacy.py`(P10, `run_all.py` STEPS 마지막
  단계)가 발행 직전 `merchants.json` 기준 (지역×표시업종) 가맹점 수 `n<5`인 셀을 찾아
  `usage.*[eup]`을 `null`로 바꾼다(2026-08-10 기준 실측 대상: 영월군 카페·영월군 편의점).
  `usage_monthly.json`·`dashboard.json` 최상위에 `privacy_meta`가 함께 실린다 — 상세 규칙은 §1
  `privacy_meta` 문단 참고. `null` 셀을 순회·합산하는 소비 코드(BE `simulate.py`)는 `or 0` 가드로
  건너뛰어야 한다(정적 스코어링·진단은 P10 이전 단계에서 이미 원값으로 끝나 영향 없음).
  **`simulate.py`의 라이브 재계산 보정(2026-08-10 A3 후속 개정)**: 초판에서는 `GET .../simulate`가
  요청마다 `usage_monthly.json` 셀 합산으로 6지역 분포를 즉석 계산해, 억제된 셀이 있는 지역의
  총량이 실제보다 최대 −21% 낮게 잡히고(영월군 실측) 타깃이 억제 셀 자체면 `expected_monthly_count`가
  진짜 0으로 나오는 문제가 있었다. 지금은 (1) 6지역 분포를 `dashboard.json`의 `monthly_by_region`
  (억제 영향 없는 정본, 반올림 오차만 ±50)에서 우선 가져오고 usage 셀 합산은 폴백으로만 쓰며,
  (2) 타깃이 억제 셀 자체면 계산 대신 `400`을 낸다 — §2 `simulate` 응답 문단·동작 규칙 표(§8) 참고.
  **남는 한계**: `dashboard.json`의 `monthly_by_region`도 100단위 반올림이라 `current_index`는
  억제 전 원값과 최대 ±50건(→ 지수로는 통상 0.1%p 미만) 오차가 있을 수 있다 — 화면에는 이미
  소수 1자리·"가정 기반 전망" 문구가 함께 나가므로 별도 배지는 추가하지 않는다.
- `usage_daily.json`도 같은 이유로 **BE 엔드포인트 없이** FE 정적 import(드릴다운 "요일·일별
  패턴" 섹션). 요일 축은 파이프라인이 표시 6분류로 **사전 롤업**해 싣는다(월 원장의 18종 유지와
  다름 — 소비처가 전부 6분류 단위). BE는 카드 생성 AI 입력 ⑧(타깃 요일 패턴, 참고용)에만 읽고
  파일이 없으면 해당 입력을 생략한다. 상세 스키마·결정 배경은
  `docs/superpowers/specs/2026-08-08-daily-weekday-analysis-design.md`.
- `cell_load.json`은 **BE 엔드포인트 없이** FE가 mock 사본을 정적 import 해 셀 탐색 시뮬레이터
  (Task C2)에 쓴다 — mock/실API 모드 모두 동일 파일. `pipeline/p9_cell_load.py`(P9) 산출이며,
  원본 CSV에 금액 컬럼이 없어 금액 기반 한도 소진율 대신 **건수 기반 추정치**를 쓴다: 부하 지수 =
  최근 3개월(`window_months`) 평균 월 거래 건수 ÷ 셀 가맹점 수. `thresholds.high`/`thresholds.low`는
  억제되지 않은 셀의 `load_index` 상·하위 사분위수이며 `cells[].tier`(`high`/`mid`/`low`)를 가른다.
  가맹점 5곳 미만(`k_anonymity`) 셀은 `suppressed: true`이고 `monthly_uses_avg`·`load_index`가
  `null`, `tier`는 `"suppressed"`다(k-익명성 보호 — Task A3가 검증). **화면에 노출할 때는 절대 규칙 7
  에 따라 모든 화면에 `추정치` 배지와 산식 툴팁을 함께 표기해야 한다.**
- `manifest.json`은 `run_all.py`가 STEPS 전체가 끝난 뒤(P10 프라이버시 억제가 `usage_monthly.json`·
  `dashboard.json`을 마지막에 제자리 수정하므로, 그 이후에 떠야 해시가 최종 산출과 일치한다)
  `data/processed/*.json`(자기 자신 제외)을 훑어 파일별 sha256·바이트 수를 기록하고, 그 해시들을
  이어붙여 다시 sha256 한 값의 앞 8자리를 `base_month`(=`usage_monthly.json`의 `base_month`)에
  붙여 `dataset_version`을 만든다. **BE 엔드포인트 없이** 모든 `/api/*` 응답의 `X-Dataset-Version`
  헤더(§5)로만 노출되고, FE mock 사본(`frontend/src/mocks/manifest.json`)은 Task C1 출처 칩이
  정적 import 해 같은 문자열을 표시한다. 원본 데이터가 그대로여도 재실행마다 `generated_at`이
  바뀌므로, 이 파일에 의존하는 테스트는 특정 해시값이 아니라 `dataset_version`의 형태(접두사
  `<base_month>.`)만 검증한다.

FE mock 동기화: 레포 루트에서 `./scripts/sync-mocks.sh` — 위 산출 JSON을 `frontend/src/mocks/`로
복사하고, `candidates.json`은 `GET /api/candidates`와 같은 병합 응답 형태로 생성한다.
생성 결과는 커밋한다(FE가 커밋 — 정적 import·mock 모드 폴백에 필요).

## 7. DynamoDB 스키마

- 테이블: `sangseng-cards` (foundation 스택이 이 이름으로 고정 생성)
- PK: `id` (S) — 예: `AC-001`, `INC-001`
- 항목 = Card 객체 그대로 (map). 소량(수십 건)이므로 목록은 GSI 없이 Scan하되
  `LastEvaluatedKey`가 사라질 때까지 모든 페이지를 읽는다
- 상태 변경 이력은 `events` 리스트 속성에 append: `{"at": iso8601, "action": "approved" | "progress:완료" | ...}`.
  결정 이벤트는 `actor_id`·`reason`·`source`를, 추진 기록 이벤트는 `record_id`를 함께 싣는다 —
  **시각과 동작만 남으면 누가 왜 그렇게 결정했는지가 기록에서 사라진다**(§2 `decision`)
- `allowed_next_progress`는 **저장하지 않는다** — 요청 시점에 계산해 응답에만 싣는 파생값이다.
  저장하면 다른 요청이 카드를 바꾼 뒤에도 낡은 목록이 남아 화면이 서버가 거부할 단계를 제시한다
- decision/progress/verification은 DynamoDB conditional update 한 번에 상태·이벤트·`version`을 함께 갱신한다.
  같은 이전 상태에서 출발한 동시 요청 중 하나만 성공하고 나머지는 도메인 `409`가 된다
- **추진 기록 테이블**: `sangseng-progress-records`(foundation 스택 `ProgressRecordsTable`) — PK `record_id`(S).
  GSI ① `card-recorded-at-index`(`card_id`, `recorded_at_key`) = 카드별 타임라인 조회,
  GSI ② `report-bucket-recorded-at-index`(`report_bucket`, `recorded_at_key`) = 기간 리포트 집계.
  기록 저장과 카드 투영(progress·`completed_at`·version)은 `TransactWriteItems`로 원자 커밋한다
  (`app/progress_db.py`·`services/progress_records.py`)

## 8. 동작 규칙·엣지 케이스 (FE·BE 공통 합의)

| 상황 | 규칙 |
|---|---|
| 카드 ID 생성 | `AC-`(EXPANSION)/`INC-`(INCENTIVE) + 3자리 순번. 타입별 내부 counter item을 DynamoDB `ADD`로 원자 증가시킨다. 최초 1회만 기존 최대 ID로 counter를 초기화하고, 카드 `PutItem`에도 `attribute_not_exists(id)` 조건을 걸어 기존 항목 덮어쓰기를 이중 방지한다 |
| EXPANSION generate 중복 | 동일 `(target.eup, target.category)`에 `승인 대기` 또는 진행 중 업무가 있으면 새 Work Item 후보에서 제외한다(대상 선택은 서버 결정론 — LLM은 관여하지 않는다). 직전 60초 안에 알고리즘이 만든 pending 카드가 있으면(재클릭·재전송) 그 카드를 **200으로 반환**한다. 승인된 업무가 진행 중인 타깃을 다른 카드로 다시 제안하지 않는다. INCENTIVE는 기존대로 pending 카드를 동시에 1장만 허용한다. |
| EXPANSION 반려·보류 타깃 재제안 | **반려·보류된 타깃은 `reproposal_block.until`까지 후보에서 제외한다**(기본 90일). 사유·쿨다운·재검토 조건은 결정 시점에 카드에 기록된다(§2). 예전에는 반려 카드가 후보 판정에서 "없음"으로 돌아와, 최고점 후보를 반려한 직후 같은 버튼이 **같은 타깃을 다시 제안**했다 — 담당자의 반려 판단이 시스템에 아무 영향을 주지 못하는 상태였다. 반려 이력은 AI 입력으로도 계속 전달되지만 그것은 참고용이고, 제외는 서버 결정론 규칙이 진다. 차단 창이 지나면 다시 후보가 되며 그때 카드 근거에 이전 반려 사유가 함께 실린다. INCENTIVE는 `target`이 없어 대상이 아니다 |
| generate 시 제안 가능한 신규 후보가 없음 | 가용 후보 0건일 때 두 갈래: ① **승인 대기 EXPANSION 카드가 남아 있으면 최신 pending 카드를 200으로 반환** — 후보 소진의 가장 흔한 원인이 "방금 이 버튼이 만든 pending 카드"라서, 409만 주면 두 번째 클릭에서 대표 AI 기능이 죽은 것처럼 보인다. ② pending도 없이 전부 진행 중이면 `409 {"detail": "제안할 수 있는 신규 후보가 없습니다 (전 후보에 승인 대기 또는 진행 중인 업무가 있음)"}`. LLM 장애가 아니라 정상적인 도메인 신호이므로 규칙 기반 fallback으로 넘기지 않으며, 가용성 판정은 LLM 호출 **전**에 한다. |
| `simulate`를 INCENTIVE 카드에 호출 | `400 {"detail": "INCENTIVE 카드는 scenarios를 사용합니다"}` — 시뮬레이션은 EXPANSION 전용 |
| `simulate` 타깃 `eup`이 집계 6개 지역 밖 | `400 {"detail": "집계 대상 지역이 아닙니다: <eup> (대상: 고한읍, 사북읍, 정선군, 태백시, 영월군, 삼척시)"}` — 지역 분포에 더할 자리가 없어 조용히 `delta 0`을 내면 "효과 없음"과 구분되지 않는다 |
| `simulate` 타깃이 소표본 억제 셀(k=5 미만) 자체 | `400 {"detail": "표본 보호(k=5)로 이 셀의 예상 효과는 산출하지 않습니다: <eup> <category>"}` — 판정은 `usage_monthly.json`의 `privacy_meta.suppressed_cells` 기준(A3 후속) |
| 조건부 필수 body 필드 누락 | **422**. 필드가 스키마에는 선택이지만 **다른 값에 따라 필수가 되는** 경우다: ① 반려·보류의 `reason`, ② `confidence=하` 카드 승인의 `reason`(확인 근거), ③ INCENTIVE 승인의 `selected_rate`, ④ 승인 전 `safety_reviewed=true`, ⑤ `metrics` 값에 딸린 `measured_from`·`measured_to`·`source`·`scope`, ⑥ `완료` 기록의 `completion_evidence`. **값이 있는데 유효하지 않은 것(400)과 등급을 가른다** — 없는 값을 요구하는 것과 잘못 쓴 값을 되돌리는 것은 담당자가 할 일이 다르다 |
| INCENTIVE 승인 시 `selected_rate` 범위 밖 | `400 {"detail": "selected_rate는 3|5|7 중 하나여야 합니다"}`. 누락은 위 행의 **422**다. EXPANSION decision에 온 `selected_rate`는 무시하고, **반려·보류에 실려 온 값도 무시한다**(저장하지 않음 — `selected_rate`는 승인 시점에만 확정). 이 400·422는 상태 전이 확인(409) **뒤**에 온다 — pending이 아니라 애초에 결정할 수 없는 카드의 body를 먼저 따질 이유가 없다 |
| 결정 요청의 `version` 불일치 | `409 {"detail": ...}` — 화면이 읽은 뒤 다른 요청이 카드를 바꿨다. `version`을 생략하면 이 검사를 하지 않는다(§2 결정 요청) |
| 빠른 상태 변경으로 `완료` 요청 | `422 {"detail": ...}` — 완료는 증빙과 함께 `progress-records`로만 기록한다. 응답 문구가 그 API로 안내한다 |
| 적격성 미확인 EXPANSION의 최종 단계 요청 | `409 {"detail": ...}` — 다섯 항목 검증 전에는 `적격성 확인`·`가맹 심사`·`추진중`·`완료`로 이동할 수 없다 |
| 잘못된 상태 전이·동시 요청 | `409 {"detail": ...}` — 예: pending이 아닌 카드에 decision, approved가 아닌 카드에 progress, 같은 이전 상태를 조건으로 한 중복 요청의 패자 |
| 공개 데모 mutation | `DEMO_READ_ONLY=true`이면 카드 상태를 바꾸는 POST 5종(generate/decision/verification/progress/progress-records)을 `403`으로 차단한다. 인증·권한 도입 시 이 공통 mutation dependency에 연결한다. **`simulate`는 차단 대상이 아니다** — 상태를 바꾸지 않는 읽기 계산이라 읽기 전용 모드에서도 200이며, Bearer 토큰만 요구한다(§2 인증). FE도 같은 경계를 따른다: `actions.ts`의 변경 액션 5개는 `isDemoReadOnly`에서 조기 403을 반환하고 `simulateAction`은 반환하지 않는다 |
| 없는 카드 ID | `404 {"detail": "card not found"}`. **검사 순서는 404 → 400(body 값) → 409(상태 전이) → 422(조건부 필수) → 400(값 범위)** — 없는 카드에 값이 잘못된 body를 보내도 404가 나간다. 단 body가 **요청 스키마 자체**를 못 넘기면(필드 누락·타입 불일치) 라우트 진입 전 FastAPI가 `422`를 내며, 이때 `detail`은 머리말 규약대로 단일 문자열로 정규화된다 |
| 위젯 배지가 안 붙는 완료 카드 | 정상 200이며 `badge: null`이다. 완료 카드에 `target.verified_merchant_id`가 없거나 그 ID가 아직 `merchants` 산출에 없으면(반영 대기) 배지를 붙이지 않는다. 위젯 응답의 `expansion_sync`가 완료·반영·대기 건수를 함께 보고한다(§4) |
| KPI에서 분모 0 | 해당 지표를 `null`로 반환 (예: approved 0건 → `execution_rate: null`, 채택 0건 → `regional_balance_index: null`). FE는 `null`이면 `—` 표시 |
| 위젯 추천 결과 0건 | `{"recommendations": [], "policy_note": ...}` 200 반환. FE는 "해당 조건의 가맹점이 아직 없어요" 빈 상태 UI |
| 위젯 추천 문구 | 실명 가맹점의 검증되지 않은 맛·분위기·메뉴를 생성하지 않고, 원천 데이터의 지역·업종만으로 `"{region}의 {category} 하이원포인트 가맹점이에요"`를 결정론적으로 표시 |
| 조사(助詞) 생성 | 값을 문장에 끼워 넣을 때 을/를·은/는·이/가·와/과·(으)로는 **공통 유틸이 받침을 판정해** 만든다(BE `app/korean.py`, FE `lib/korean.ts`). **숫자는 읽는 소리로 판정한다** — `0.48`은 "…팔"이라 `0.48을`, `1,552`는 "…이"라 `1,552를`, `6`은 "육"이라 받침 있음. `은(는)`처럼 병기로 도망가지 않는다 |
| 시각 표기 | 모든 타임스탬프 KST ISO8601 (`+09:00`) — `avg_approval_hours` 계산도 KST 기준 |
| 숫자 직렬화 | **BE 구현 주의:** boto3가 DynamoDB 숫자를 `Decimal`로 반환 → FastAPI JSON 직렬화가 깨진다. `db.py` 읽기 경로에서 Decimal→int/float 변환을 일괄 적용할 것 (07 문서 B2). 변환 기준은 **저장 표기에 소수점이 있으면 float, 없으면 int** — 값이 정수라는 이유로 float를 int로 내리지 않는다(그러면 저장·조회를 반복할 때마다 §2 `scenarios[].delta_pp`가 `[1.0, 2.0]` → `[1, 2]`로 바뀐다) |
| 날짜 기준 | "최근 3개월"·"전분기" 등 계산은 **오늘이 아니라 데이터 최신 월 기준**으로 재현한다. 별도로 FE는 최신 월과 현재 월의 차이를 계산해 4개월 이상이면 `갱신 필요` 운영 경고를 모든 담당자 화면에 표시한다. 오래된 데이터로 계산했다는 사실을 숨기지 않으며 승인 전 최신 사용현황·가맹점 영업 상태 재확인을 요구한다. |
