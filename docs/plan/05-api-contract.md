# 05. API 계약 — FE↔BE 단일 진실

> **예시 JSON은 스키마·필드 형태의 기준이다.** mock 데이터의 실제 값 원천은 `data/processed/`의
> 실산출이며, `./scripts/sync-mocks.sh`로 생성한 뒤 `frontend/src/mocks/`에 **커밋한다**
> (정적 import·Vercel 빌드·`NEXT_PUBLIC_API_BASE` 미설정 시 mock 모드 폴백에 필요 — 12 문서 §5).
> 예시의 지역·업종·수치는 스키마 설명용이며 실데이터와 다를 수 있다 — 값을 보고 mock을 손으로 만들지 말 것.
> 데이터가 갱신되면 스크립트를 다시 실행해 커밋한다.
> 계약 변경 절차: ① 이 문서 수정 → ② `scripts/sync-mocks.sh` 재실행 → ③ 팀원 공유 → ④ 코드 수정.
> 모든 응답은 `application/json`, 에러는 `{"detail": "메시지"}` + 4xx/5xx.

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
    "proxy_note": "분자=지역 사용 건수, 분모=입장 연인원(교대 합산)으로 단위가 달라 비율이 아닌 근사 지표입니다. 강원랜드가 공개한 금액 기준 지역 사용 비율(2024년 28.5%)과는 다른 지표입니다.",
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
  "ai_stability": null
}
```

규칙: `conversion.is_proxy=true`이면 FE는 반드시 `근사 지표` 배지 렌더.
`concentration.index`는 0~100 정규화값(내부 Gini 비노출), `grade`는 높음/보통/낮음.

- `conversion.proxy_note`: **고정 설명 문구**(파이프라인 P5가 채움). 배지만으로는 막지 못하는 오인을
  본문으로 차단한다 — 배지 툴팁·상세 영역에 이 문구를 **그대로** 노출한다(요약·의역 금지).
  - 분모는 "입장객 수"가 아니라 **입장 연인원(교대 합산)**이다. 강원랜드 일자별 카지노 입장객 API는
    하루를 영업 교대(1부/2부/3부) 최대 3행으로 주며 P2가 이를 합산하므로, 같은 사람이 교대를 넘겨
    머무르면 중복 계수된다. `monthly[].visitors`의 라벨도 "입장 연인원"으로 표기할 것
  - 우리 지표(건수÷연인원 ≈ **연인원 1인당 0.21건**)와 강원랜드·언론이 쓰는 **금액 기준** 지역 사용
    비율(2024년 콤프 발생액 1,242.33억 중 지역 354.8억 = 28.5%)은 **종류가 다른 지표**다.
    자릿수가 비슷해 같은 값의 다른 추정치로 오인되기 쉬우므로 화면·발표 어디서도 "강원랜드 공식
    지역 사용 비율"과 나란히 놓고 비교하지 않는다
업종 표시 롤업: 대시보드·위젯의 업종 표시는 13 문서 §5의 6분류(카페·음식점·편의점·숙박업·소매점·기타)로
롤업하며, 하이원 18종·소진공 대분류(`indsLclsNm`)와의 매핑 정본은 `pipeline/category_map.py` 하나다.

- `category_share`: 전 기간 누적 건수를 위 표시 6분류로 롤업한 업종 도넛용 배열
  (`category`는 13 §5 고정 순서, 롤업 정본은 `category_map.py`의 매핑 ① `HIGHONE_TO_DISPLAY`, `share` 합=1.0)
- `growth.qoq_pp`: **지역 전환율의 전분기 대비 변화(%p)** — 분기는 데이터 최신 월(2025-12) 기준
  최근 3개월(2025-10~12) vs 직전 3개월(2025-07~09)이며, 분기 전환율은
  3개월 건수 합 ÷ 3개월 **입장 연인원(교대 합산)** 합 × 100
- `ranking_stability`: P8 민감도 분석 `sensitivity.json`의 `top3_stable_ratio × 100`
  (정수, "추천 순위 안정도" 타일). AI 모델 품질 지표가 아니다. P8 실행 전에는 `null`.
  `ai_stability`는 이전 소비자 호환용 별칭이며 신규 화면은 사용하지 않는다

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
    {"name": "OO식당", "category": "음식점", "eup": "사북읍", "address": "강원도 정선군 사북읍 ...",
     "lat": 37.2205, "lng": 128.8101}
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
  실제로 CAND-001은 11.0km·50.8분(평균 13km/h)으로, 나머지 후보(45~64km/h)와 달리 임도 경유로
  추정된다. 화면·발표에서는 **소요시간 중심**으로 말하고 거리 수치를 단정하지 않는다.
  `proximity`는 **직선거리** 기반이라 산악 지형에서 실제 접근성과 역전될 수 있다 — 그 한계를
  우리가 먼저 드러내려고 병기하는 참고 필드다. **순위 산식에는 들어가지 않으며**(가중치·정렬 불변),
  FE도 이 값으로 재정렬하지 않는다. 도로 경로 검증은 별도 과제라 순위 반영은 로드맵으로 둔다.
  화면·문서 어디에서도 후보를 "거점에서 가장 가깝다"고 단정하지 않는다 —
  "직선 X km / 도로 Y km·Z분"처럼 두 값을 함께 적는다
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

- 응답은 **최상위 배열**이며 산출 JSON과 완전히 같다 — `scripts/sync-mocks.sh`가 같은 파일을
  `frontend/src/mocks/risk_signal.json`으로 복사하므로, 감싸거나 필드를 더하면 mock 모드와
  실 API 모드가 갈린다 (§6 mock 원천 단일화)
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
  "title": "사북읍 카페 업종 가맹점 확충",
  "target": {"eup": "사북읍", "category": "카페"},
  "score_rank": 2,
  "ai_rank": 1,
  "confidence": "중",
  "ai": {
    "adjusted": true,
    "comparison": "정량 2위 사북읍 카페(Score 0.57)를 AI 제안 1위로 검토했습니다. 정량 1위 고한읍 편의점(Score 0.59)보다 Score가 0.02 낮습니다. 두 후보의 도로 소요시간을 함께 확인한 뒤 결정해야 합니다.",
    "reasons": ["정량 기준: Score 0.57 · 2위", "상권 기준: 업종공백도 1.0 · 반경 500m 내 동일 업종 가맹점 0곳", "AI는 후보 선택에만 사용했으며 숫자·순위·상태는 서버가 정본 데이터로 재검증했습니다"],
    "risks": ["신규 가맹점 초기 실적 저조 가능성", "가맹 협상이 분기 내 완료되지 않을 수 있음"],
    "expected_effect": "가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
    "grounding": {
      "status": "verified",
      "source": "structured",
      "checks": ["target", "score", "rank", "progress", "road_time"]
    },
    "original_ranking": [
      {"rank": 1, "candidate": "고한읍 편의점", "score": 0.59},
      {"rank": 2, "candidate": "사북읍 카페", "score": 0.57}
    ]
  },
  "candidate_verification": {
    "status": "unverified",
    "checks": [
      {"key": "business_status", "label": "영업 상태", "status": "unverified"},
      {"key": "membership_eligibility", "label": "가맹 자격", "status": "unverified"},
      {"key": "participation_intent", "label": "사업자 참여 의향", "status": "unverified"},
      {"key": "visitor_fit", "label": "관광객 이용 적합성", "status": "unverified"},
      {"key": "settlement_integration", "label": "정산 연동 가능성", "status": "unverified"}
    ],
    "note": "후보 접촉·검토 시작은 가맹 확정이 아니며, 적격성 확인과 가맹 심사를 별도로 거칩니다"
  },
  "operations": {
    "owner": null,
    "target_date": null,
    "estimated_cost": null,
    "contact_result": null,
    "ineligibility_reason": null,
    "actual_outcome": null
  },
  "version": 0,
  "scenarios": null,
  "sources": ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"],
  "created_at": "2026-08-01T10:00:00+09:00",
  "decided_at": null
}
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
- `candidate_verification.checks[].status`: `unverified` | `verified` | `failed`. 다섯 필수 항목이 모두
  `verified`가 아니면 `적격성 확인` 이후 단계와 `완료`를 선택할 수 없다. 하나라도 `failed`면 카드의
  사용자 표시 상태는 `부적격 또는 반려`이며 재검토 전 최종 상태로 이동하지 않는다
- **AI 사실성 경계:** LLM은 `ai_rank_target` 선택과 비정량 리스크 초안에만 관여한다. 사용자에게
  보이는 후보명·Score·순위·진행 상태·도로 소요시간·비교 문장은 서버가 구조화 데이터로 다시 만든다.
  `ai.grounding.status=verified`는 이 재검증을 통과했다는 뜻이지 후보 사업자의 적격성이 확인됐다는 뜻은
  아니다. 후자는 `candidate_verification.status=unverified`에서 별도로 관리한다.
- 후보 적격성 확인 전 생성 카드의 `confidence`는 최대 `중`이다. `상`은 영업 상태·가맹 자격·참여 의향
  등 운영 검증을 저장하고 감사할 수 있게 된 뒤에만 허용한다.
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
    "reasons": ["적립이 아닌 사용 단계 정책 — 지역 가맹점 결제분에 한정해 리워드가 붙으므로 콤프 발행액(적립)은 늘지 않고 게임 참여 유인과도 무관", "지역 전환율이 월별 17~23%대에서 오르내려 저점 월을 방어할 수요 측 유인이 필요", "사용 건수가 사북읍·태백시에 절반 이상 몰려 있어 특정 지역 한정이 아닌 전 지역 공통 적용이 지역 균형에 유리", "페이백률이 높을수록 효과와 재원 부담이 함께 커지는 트레이드오프가 뚜렷"],
    "risks": ["재원 확보는 예산 부서의 별도 승인 사항", "기존 포인트 적립·할인 약관과의 중복 적용 여부 확인 필요", "실제 자동 지급 시스템 연동은 미구현(로드맵)"],
    "expected_effect": "5% 적용 시 지역 전환율 약 1.0~2.0%p 개선 예상 (가정 기반 전망이며 실제와 다를 수 있음)",
    "original_ranking": null
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

- INCENTIVE의 `ai`는 EXPANSION과 **동일 스키마를 재사용**하며 순위 필드(`original_ranking`)만 `null`이다
  (`comparison`=시나리오 비교문, `reasons`=권고 근거, `risks`=A-3 프롬프트의 필수 리스크 3종).

### 엔드포인트

| 메서드 | 경로 | 설명 | 요청 body | 응답 |
|---|---|---|---|---|
| GET | `/api/cards` | 목록. 쿼리: `type`, `status` (선택) | — | `{"cards": [Card]}` |
| GET | `/api/cards/{id}` | 단건 | — | `{"card": Card}` |
| POST | `/api/cards/generate` | 스코어링+AI로 카드 생성 | `{"type": "EXPANSION"}` 또는 `{"type": "INCENTIVE"}` | `{"card": Card}` — 신규 201, 동일 타깃 pending 중복 시 기존 카드 200 (§8) |
| POST | `/api/cards/{id}/decision` | 담당자 결정. EXPANSION의 `approved` 표시는 **후보 접촉·검토 시작** | `{"decision": "approved"\|"rejected"\|"held", "selected_rate": 3\|5\|7}` — `selected_rate`는 **INCENTIVE 카드를 approved할 때만 필수**, 그 외 생략 | `{"card": Card}` |
| POST | `/api/cards/{id}/verification` | EXPANSION 후보 적격성 5항목 저장 | `{"checks": [{"key": "business_status", "status": "verified"}, ...], "note": "..."}` | `{"card": Card}` |
| POST | `/api/cards/{id}/progress` | 추진 상태 변경 (approved만 가능) | `{"progress": "후보 접촉·검토 시작"\|"적격성 확인"\|"가맹 심사"\|"추진중"\|"보류"\|"완료"}` (INCENTIVE는 기존 4단계) | `{"card": Card}` |
| POST | `/api/cards/{id}/simulate` | 가맹 전환 시 예상 효과 (반사실 재계산+LLM) | — | 아래 |

`simulate` 응답:
```json
{
  "simulation": {
    "current_index": 42.5,
    "projected_index": 42.5,
    "delta_pp": [0.0, 0.1],
    "expected_monthly_count": 62.4,
    "estimate_basis": "대상 지역·업종의 최근 3개월 가맹점당 평균",
    "base_month": "2025-12",
    "effect_assessment": "미미",
    "decision_note": "집중도 개선폭이 매우 작게 추정됩니다. 승인 전에 가맹 유치 비용·사업자 참여 의향·예상 월 사용건수를 비교하고, 보류도 정상적인 선택지로 검토하세요.",
    "narrative": "사북읍 카페 업종에 신규 가맹점이 1곳 추가되어도 예상 월 이용 건수가 6개 지역 전체 규모에 견주면 작아, 지역 소비 집중도는 소수점 첫째 자리 기준으로 변화가 나타나지 않을 것으로 예상됩니다. 이는 유사 가맹점의 평균 초기 실적을 가정한 전망이며, 실제 결과는 입지·홍보 여부에 따라 달라질 수 있습니다.",
    "assumption_note": "가정 기반 전망이며 실제와 다를 수 있음"
  }
}
```

- `expected_monthly_count`는 반사실 계산에 더한 예상 월 이용 건수, `estimate_basis`는 3단계 폴백 중
  실제 적용 근거, `base_month`는 전망의 기준월이다. FE는 효과 지수만 보여주지 말고 세 값을 함께 보여
  “0.0%p”가 계산 실패인지 규모가 작은 정상 결과인지 구분하게 한다.
- `effect_assessment`는 `개선|심화|혼재|미미`이며 `decision_note`는 승인 권고가 아니라 담당자가 다음에
  확인할 사항을 제시한다. `미미` 또는 최대 변화폭 0.1%p 이하는 보류도 정상 선택지라고 명시한다.

- `current_index`·`projected_index`는 **소수 1자리**다(§1 `concentration.index`의 정수 표기와 다름).
  정수로 반올림하면 원시 집중도가 42.53처럼 경계에 걸릴 때 0.05%p 변화가 "43 → 42"로 보여
  같은 응답의 `delta_pp`와 10배 어긋난다. FE도 소수 1자리로 표기한다
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

## 3. KPI

### `GET /api/kpi`
전부 시스템 자체 상태값(DynamoDB)으로 계산 — 추가 데이터 불필요.

```json
{
  "adoption_rate": 0.5,
  "execution_rate": 0.5,
  "avg_approval_hours": 1.2,
  "regional_balance_index": 80,
  "counts": {"total": 4, "pending": 1, "approved": 2, "rejected": 1, "held": 0, "done": 1}
}
```

- 채택률 = approved / 전체, 실행 전환율 = (추진중+완료) / approved
- 평균 승인 소요 = avg(decided_at − created_at)
- 지역 균형지수 = 승인 EXPANSION 카드의 6지역 분포에 **지역 소비 집중도와 동일한 정규화 지수**(0~100)를
  적용해 `100 − 집중도`. **완전 균등 = 100, 한 지역 몰림(완전 편중) = 0**.
  §1 `concentration.index`와 같은 자를 쓰므로 진단 지표와 나란히 읽을 수 있다
  (내부 산식은 정규화 지니 — 화면·발표 용어 비노출 원칙은 그대로)
- 지역 균형지수는 **EXPANSION 카드만** 집계 (INCENTIVE는 `target`이 없어 지역 분포에 넣을 수 없음)
- `regional_balance_index`의 분모는 **`REGIONS` 6개 지역 고정** — 승인(approved) 카드가 한 건도 없는
  지역도 0건으로 포함해 위 산식으로 계산하고, 결과는 반올림한 정수. 지표 특성상 승인 카드가
  여러 지역에 쌓일수록 상승한다 (승인 1장 = `0`, 서로 다른 2개 지역 = `20` — 데모 초반의 낮은 값은
  정상 동작이며, 위 예시의 `80`은 여러 지역에 고루 쌓인 상태를 가정한 값이다)
- `avg_approval_hours`의 집계 대상은 **`decided_at`이 있는 모든 카드**(approved+rejected+held) —
  "의사결정 소요 시간"이라는 지표 의미에 맞춘 정의. `decided_at − created_at`의 평균을 소수 1자리로 반올림

## 4. 방문객 위젯

### `GET /api/widget/recommend?region=사북읍&category=카페`

```json
{
  "recommendations": [
    {
      "name": "OO카페", "category": "카페", "address": "정선군 사북읍 ...",
      "lat": 37.2211, "lng": 128.8123,
      "badge": "신규",
      "payback": {"rate": 5, "label": "지금 여기서 쓰면 5% 페이백"},
      "blurb": "사북 시장 골목의 신규 하이원포인트 가맹점이에요. 산책 후 들르기 좋아요."
    }
  ],
  "policy_note": "완료된 확충 업종 우선 · 그 외 하이원리조트 거점 직선거리 기준",
  "total": 18
}
```

- `badge:"신규"` = EXPANSION 카드가 `progress=완료`인 (읍×업종)과 매칭되는 가맹점 (데모: 목업 1~2건 허용)
- `payback` = INCENTIVE 카드가 `완료` 상태일 때만 포함, 아니면 `null`. `rate`는 해당 카드의 `selected_rate` 값
- `blurb` = LLM 생성 문구 (LLM 실패 시 규칙 기반 fallback 문구)
- **추천 정렬 근거(BE 확정):** ① `badge:"신규"`가 붙는 가맹점 먼저 ② 그다음 거점(`ANCHOR`)까지의
  **직선거리 오름차순**. 상위 3곳까지 반환한다. 원본 순서(상호명순)로 두면 필터 없이 호출할 때
  방문객 동선과 무관한 가맹점이 먼저 나오기 때문이다
  - **거리 값은 응답에 싣지 않는다**(정렬 근거로만 사용). `blurb` 생성 프롬프트에도 넣지 않는다 —
    §1 캐비엇대로 화면·문구 어디에서도 "가장 가깝다"고 단정하지 않기 위함이다.
    FE는 위치 권한을 사용하지 않는다는 점과 하이원리조트 거점 직선거리 기준임을 함께 밝힌다. 산악
    도로 실제 이동시간과 순서가 다를 수 있으므로 “내 주변”·“가까운 순”이라고 라벨링하지 않는다.
  - 좌표(`lat`/`lng`)가 없는 가맹점은 거리 비교에서 맨 뒤로 밀린다

## 5. 기타

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/health` | `{"ok": true, "data_loaded": true, "datasets": {...}}` |

```json
{
  "ok": true,
  "data_loaded": true,
  "datasets": {"dashboard": true, "eup_scores": true, "candidates": true,
               "merchants": true, "risk_signal": true}
}
```

- `datasets`: 산출 JSON 5종의 로드 성공 여부(각 `true`/`false`). `dashboard` 하나만 보면 나머지
  결손을 놓치므로 개별로 보고한다 (배포 후 `deploy-backend.sh`의 data 복사 누락 진단용)
- `data_loaded`: **필수 4종**(`dashboard`·`eup_scores`·`candidates`·`merchants`)의 AND.
  `risk_signal`은 07 문서 B4 ⑥에서 "없으면 컷"인 선택 입력이라 `datasets`에만 싣고 AND에서는 뺀다
- 기존 키 `ok`·`data_loaded`는 형태·의미 그대로다 — `datasets`만 추가되었다

## 6. 파이프라인 산출 JSON (data/processed/) 스키마

| 파일 | 내용 | 주 소비처 |
|---|---|---|
| `dashboard.json` | §1의 `GET /api/dashboard` 응답 그대로 | BE 서빙, FE mock |
| `eup_scores.json` | §1 `eup_ranking` + `selected_eups` | BE(candidates, 카드 생성) |
| `candidates.json` | §1 `candidates` 배열 | BE(candidates, 카드 생성) |
| `merchants.json` | §1 `merchants` 배열 (지오코딩·주소 포함) | BE(candidates, 위젯) |
| `risk_signal.json` | `[{"sigungu": "정선군", "under2y_ratio": 0.1507}]` | BE(카드 생성 AI 입력 ⑥, `GET /api/risk-signal`), FE mock |
| `sensitivity.json` | `{"combos": 25, "top3_stable_ratio": 0.88, "detail": [...]}` | 발표 슬라이드 |
| `usage_monthly.json` | 월×지역×업종 원자료 집계 (재계산·검증용) | pipeline, simulate, **FE 지역 드릴다운(정적 import)** |
| `usage_daily.json` | 일·요일 축 집계 — 요일×표시6분류(지역별+전체) 누적, 지역별 일 총건수 시계열 | **FE 지역 드릴다운 요일 섹션(정적 import)**, BE(카드 생성 AI 입력 ⑧) |

- `risk_signal.json` 표시 주의: 실측 4개 시군이 **14.6~15.1%로 최대 편차 0.5%p**라 지역 간 비교
  근거가 못 된다. 화면에 노출할 때 **'위험' 라벨·경고색·순위 정렬을 쓰지 않고**
  "운영 2년 미만 사업자 비중(배경 정보)"으로만 적는다 (AI 입력에서도 참고용 진단 지표 — 07 B4 ⑥).
- `usage_monthly.json`의 `region_note`·`eup_ranking`의 "삼척시"는 도계읍 한정이다 (§1 지역 라벨 주의).
- `usage_monthly.json`은 **BE 엔드포인트 없이** FE가 mock 사본을 정적 import 해 지역 소비 분석
  드릴다운(업종 구성·월별 추이·상위 업종)에 쓴다 — 분기 배치 산출물이라 양 모드 데이터가 동일하다.
  표시 6분류 롤업은 `pipeline/category_map.py`의 `HIGHONE_TO_DISPLAY`가 정본이며
  `frontend/src/lib/regionAnalysis.ts`가 이를 복제한다(파이프라인 변경 시 함께 수정).
- `usage_daily.json`도 같은 이유로 **BE 엔드포인트 없이** FE 정적 import(드릴다운 "요일·일별
  패턴" 섹션). 요일 축은 파이프라인이 표시 6분류로 **사전 롤업**해 싣는다(월 원장의 18종 유지와
  다름 — 소비처가 전부 6분류 단위). BE는 카드 생성 AI 입력 ⑧(타깃 요일 패턴, 참고용)에만 읽고
  파일이 없으면 해당 입력을 생략한다. 상세 스키마·결정 배경은
  `docs/superpowers/specs/2026-08-08-daily-weekday-analysis-design.md`.

FE mock 동기화: 레포 루트에서 `./scripts/sync-mocks.sh` — 위 산출 JSON을 `frontend/src/mocks/`로
복사하고, `candidates.json`은 `GET /api/candidates`와 같은 병합 응답 형태로 생성한다.
생성 결과는 커밋한다(FE가 커밋 — 정적 import·mock 모드 폴백에 필요).

## 7. DynamoDB 스키마

- 테이블: `sangseng-cards` (SAM이 생성, 실제 이름은 Outputs 참조)
- PK: `id` (S) — 예: `AC-001`, `INC-001`
- 항목 = Card 객체 그대로 (map). 소량(수십 건)이므로 목록은 GSI 없이 Scan하되
  `LastEvaluatedKey`가 사라질 때까지 모든 페이지를 읽는다
- 상태 변경 이력은 `events` 리스트 속성에 append: `{"at": iso8601, "action": "approved" | "progress:완료" | ...}`
- decision/progress/verification은 DynamoDB conditional update 한 번에 상태·이벤트·`version`을 함께 갱신한다.
  같은 이전 상태에서 출발한 동시 요청 중 하나만 성공하고 나머지는 도메인 `409`가 된다

## 8. 동작 규칙·엣지 케이스 (FE·BE 공통 합의)

| 상황 | 규칙 |
|---|---|
| 카드 ID 생성 | `AC-`(EXPANSION)/`INC-`(INCENTIVE) + 3자리 순번. 타입별 내부 counter item을 DynamoDB `ADD`로 원자 증가시킨다. 최초 1회만 기존 최대 ID로 counter를 초기화하고, 카드 `PutItem`에도 `attribute_not_exists(id)` 조건을 걸어 기존 항목 덮어쓰기를 이중 방지한다 |
| EXPANSION generate 중복 | 동일 `(target.eup, target.category)`에 `승인 대기` 또는 진행 중 업무가 있으면 새 Work Item 후보에서 제외한다. LLM이 기존 pending 타깃을 선택하면 새 카드를 만들지 않고 **기존 카드를 200으로 반환**한다. 승인된 업무가 진행 중인 타깃을 다른 카드로 다시 제안하지 않는다. INCENTIVE는 기존대로 pending 카드를 동시에 1장만 허용한다. |
| generate 시 제안 가능한 신규 후보가 없음 | 전 후보에 승인 대기 또는 진행 중인 업무가 있으면 `409 {"detail": "모든 후보에 승인 대기 또는 진행 중인 업무가 있어 새로 제안할 후보가 없습니다"}`. LLM 장애가 아니라 정상적인 도메인 신호이므로 규칙 기반 fallback으로 넘기지 않는다. |
| `simulate`를 INCENTIVE 카드에 호출 | `400 {"detail": "INCENTIVE 카드는 scenarios를 사용합니다"}` — 시뮬레이션은 EXPANSION 전용 |
| `simulate` 타깃 `eup`이 집계 6개 지역 밖 | `400 {"detail": "집계 대상 지역이 아닙니다: <eup> (대상: 고한읍, 사북읍, 정선군, 태백시, 영월군, 삼척시)"}` — 지역 분포에 더할 자리가 없어 조용히 `delta 0`을 내면 "효과 없음"과 구분되지 않는다 |
| INCENTIVE 승인 시 `selected_rate` 누락/범위 밖 | `400 {"detail": "selected_rate(3|5|7)가 필요합니다"}`. EXPANSION decision에 온 `selected_rate`는 무시. 이 400만은 상태 전이 확인(409) **뒤**에 온다 — pending이 아니라 애초에 결정할 수 없는 카드의 body를 먼저 따질 이유가 없다 |
| 적격성 미확인 EXPANSION의 최종 단계 요청 | `409 {"detail": ...}` — 다섯 항목 검증 전에는 `적격성 확인`·`가맹 심사`·`추진중`·`완료`로 이동할 수 없다 |
| 잘못된 상태 전이·동시 요청 | `409 {"detail": ...}` — 예: pending이 아닌 카드에 decision, approved가 아닌 카드에 progress, 같은 이전 상태를 조건으로 한 중복 요청의 패자 |
| 공개 데모 mutation | `DEMO_READ_ONLY=true`이면 generate/decision/verification/progress를 `403`으로 차단한다. 인증·권한 도입 시 이 공통 mutation dependency에 연결한다 |
| 없는 카드 ID | `404 {"detail": "card not found"}`. **검사 순서는 404 → 400(body 값) → 409(상태 전이)** — 없는 카드에 값이 잘못된 body를 보내도 404가 나간다. 단 body가 **요청 스키마 자체**를 못 넘기면(필드 누락·타입 불일치) 라우트 진입 전 FastAPI가 `422`를 낸다 |
| KPI에서 분모 0 | 해당 지표를 `null`로 반환 (예: approved 0건 → `execution_rate: null`, 채택 0건 → `regional_balance_index: null`). FE는 `null`이면 `—` 표시 |
| 위젯 추천 결과 0건 | `{"recommendations": [], "policy_note": ...}` 200 반환. FE는 "해당 조건의 가맹점이 아직 없어요" 빈 상태 UI |
| 위젯 추천 문구 | 실명 가맹점의 검증되지 않은 맛·분위기·메뉴를 생성하지 않고, 원천 데이터의 지역·업종만으로 `"{region}의 {category} 하이원포인트 가맹점이에요"`를 결정론적으로 표시 |
| 시각 표기 | 모든 타임스탬프 KST ISO8601 (`+09:00`) — `avg_approval_hours` 계산도 KST 기준 |
| 숫자 직렬화 | **BE 구현 주의:** boto3가 DynamoDB 숫자를 `Decimal`로 반환 → FastAPI JSON 직렬화가 깨진다. `db.py` 읽기 경로에서 Decimal→int/float 변환을 일괄 적용할 것 (07 문서 B2). 변환 기준은 **저장 표기에 소수점이 있으면 float, 없으면 int** — 값이 정수라는 이유로 float를 int로 내리지 않는다(그러면 저장·조회를 반복할 때마다 §2 `scenarios[].delta_pp`가 `[1.0, 2.0]` → `[1, 2]`로 바뀐다) |
| 날짜 기준 | "최근 3개월"·"전분기" 등 계산은 **오늘이 아니라 데이터 최신 월 기준**으로 재현한다. 별도로 FE는 최신 월과 현재 월의 차이를 계산해 4개월 이상이면 `갱신 필요` 운영 경고를 모든 담당자 화면에 표시한다. 오래된 데이터로 계산했다는 사실을 숨기지 않으며 승인 전 최신 사용현황·가맹점 영업 상태 재확인을 요구한다. |
