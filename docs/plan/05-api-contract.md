# 05. API 계약 — FE↔BE 단일 진실

> 이 문서의 예시 JSON이 곧 `frontend/src/mocks/`의 내용이다. 계약 변경 절차:
> ① 이 문서 수정 → ② mock 수정 → ③ 팀원 공유 → ④ 코드 수정.
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
  "growth": {"mom_pct": -2.1}
}
```

규칙: `conversion.is_proxy=true`이면 FE는 반드시 `근사 지표` 배지 렌더.
`concentration.index`는 0~100 정규화값(내부 Gini 비노출), `grade`는 높음/보통/낮음.
업종 표시 롤업: 대시보드·위젯의 업종 표시는 13 문서 §5의 6분류(카페·음식점·편의점·숙박업·소매점·기타)로
롤업하며, 하이원 18종·소진공 대분류(`indsLclsNm`)와의 매핑 정본은 `pipeline/category_map.py` 하나다.

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
      "lat": 37.2211, "lng": 128.8123, "name_hint": "사북시장 인근",
      "score": 0.57, "gap": 1.0, "proximity": 0.7, "saturation": 0.0,
      "nearby_merchants": 0, "nearby_stores": 34
    }
  ],
  "merchants": [
    {"name": "OO식당", "category": "음식점", "eup": "사북읍", "address": "강원도 정선군 사북읍 ...",
     "lat": 37.2205, "lng": 128.8101}
  ]
}
```

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
  "confidence": "상",
  "ai": {
    "adjusted": true,
    "comparison": "1순위 사북 카페: Score 2위지만 반경 내 공백 업종이며 즉시 착수 가능. 2순위(Score 1위) 고한 편의점: 추진 상태=추진중으로 중복 착수 시 자원 낭비.",
    "reasons": ["사북읍은 1단계 소비저조도 상위 지역", "반경 500m 내 하이원포인트 가맹점 0곳", "겨울 시즌 유동인구 집중 예상(계절성)"],
    "risks": ["신규 가맹점 초기 실적 저조 가능성", "가맹 협상이 분기 내 완료되지 않을 수 있음"],
    "expected_effect": "지역 소비 집중도 약 3~4%p 개선 예상 (가정 기반 전망, 실제와 다를 수 있음)",
    "original_ranking": [
      {"rank": 1, "candidate": "고한읍 편의점", "score": 0.59},
      {"rank": 2, "candidate": "사북읍 카페", "score": 0.57}
    ]
  },
  "scenarios": null,
  "sources": ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"],
  "created_at": "2026-08-01T10:00:00+09:00",
  "decided_at": null
}
```

- `type`: `EXPANSION`(확충) | `INCENTIVE`(페이백)
- `status`: `pending`(승인 대기) | `approved` | `rejected` | `held`
- `progress`: 승인 후에만 — `검토중` | `추진중` | `보류` | `완료` (승인 시 자동으로 `검토중`)
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

### 엔드포인트

| 메서드 | 경로 | 설명 | 요청 body | 응답 |
|---|---|---|---|---|
| GET | `/api/cards` | 목록. 쿼리: `type`, `status` (선택) | — | `{"cards": [Card]}` |
| GET | `/api/cards/{id}` | 단건 | — | `{"card": Card}` |
| POST | `/api/cards/generate` | 스코어링+AI로 카드 생성 | `{"type": "EXPANSION"}` 또는 `{"type": "INCENTIVE"}` | `{"card": Card}` — 신규 201, 동일 타깃 pending 중복 시 기존 카드 200 (§8) |
| POST | `/api/cards/{id}/decision` | 승인/반려/보류 | `{"decision": "approved"\|"rejected"\|"held", "selected_rate": 3\|5\|7}` — `selected_rate`는 **INCENTIVE 카드를 approved할 때만 필수**, 그 외 생략 | `{"card": Card}` |
| POST | `/api/cards/{id}/progress` | 추진 상태 변경 (approved만 가능) | `{"progress": "검토중"\|"추진중"\|"보류"\|"완료"}` | `{"card": Card}` |
| POST | `/api/cards/{id}/simulate` | 확보 시 예상 효과 (반사실 재계산+LLM) | — | 아래 |

`simulate` 응답:
```json
{
  "simulation": {
    "current_index": 68,
    "projected_index": 64,
    "delta_pp": [3, 4],
    "narrative": "사북읍 카페 업종에 신규 가맹점이 1곳 추가되면, 시뮬레이션상 지역 소비 집중도가 약 3~4%p 개선되고 지역 전환율도 소폭 상승할 것으로 예상됩니다. 다만 이 추정은 유사 신규 가맹점의 평균 초기 실적을 가정한 것이며, 실제 결과는 입지·홍보 여부에 따라 달라질 수 있습니다.",
    "assumption_note": "가정 기반 전망이며 실제와 다를 수 있음"
  }
}
```

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
- 평균 승인 소요 = avg(decided_at − created_at), 지역 균형지수 = (1 − 채택 카드의 지역 분포 Gini) × 100
- 지역 균형지수는 **EXPANSION 카드만** 집계 (INCENTIVE는 `target`이 없어 지역 분포에 넣을 수 없음)

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
  "policy_note": "확충 완료된 신규 가맹점을 우선 추천합니다"
}
```

- `badge:"신규"` = EXPANSION 카드가 `progress=완료`인 (읍×업종)과 매칭되는 가맹점 (데모: 목업 1~2건 허용)
- `payback` = INCENTIVE 카드가 `완료` 상태일 때만 포함, 아니면 `null`. `rate`는 해당 카드의 `selected_rate` 값
- `blurb` = LLM 생성 문구 (LLM 실패 시 규칙 기반 fallback 문구)

## 5. 기타

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/health` | `{"ok": true, "data_loaded": true}` |

## 6. 파이프라인 산출 JSON (data/processed/) 스키마

| 파일 | 내용 | 주 소비처 |
|---|---|---|
| `dashboard.json` | §1의 `GET /api/dashboard` 응답 그대로 | BE 서빙, FE mock |
| `eup_scores.json` | §1 `eup_ranking` + `selected_eups` | BE(candidates, 카드 생성) |
| `candidates.json` | §1 `candidates` 배열 | BE(candidates, 카드 생성) |
| `merchants.json` | §1 `merchants` 배열 (지오코딩·주소 포함) | BE(candidates, 위젯) |
| `risk_signal.json` | `[{"sigungu": "정선군", "under2y_ratio": 0.31}]` | BE(카드 생성 AI 입력 ⑥) |
| `sensitivity.json` | `{"combos": 25, "top3_stable_ratio": 0.88, "detail": [...]}` | 발표 슬라이드 |
| `usage_monthly.json` | 월×지역×업종 원자료 집계 (재계산·검증용) | pipeline, simulate |

## 7. DynamoDB 스키마

- 테이블: `sangseng-cards` (SAM이 생성, 실제 이름은 Outputs 참조)
- PK: `id` (S) — 예: `AC-001`, `INC-001`
- 항목 = Card 객체 그대로 (map). 소량(수십 건)이므로 목록은 Scan, GSI 없음
- 상태 변경 이력은 `events` 리스트 속성에 append: `{"at": iso8601, "action": "approved" | "progress:완료" | ...}`

## 8. 동작 규칙·엣지 케이스 (FE·BE 공통 합의)

| 상황 | 규칙 |
|---|---|
| 카드 ID 생성 | `AC-`(EXPANSION)/`INC-`(INCENTIVE) + 3자리 순번. BE가 Scan으로 해당 타입 개수+1 산정 (데모 규모에서 경합 무시 가능) |
| generate 중복 | 동일 `(type, target.eup, target.category)`의 `pending` 카드가 이미 있으면 새로 만들지 않고 **기존 카드를 200으로 반환** (데모 중 버튼 연타 대비). INCENTIVE는 `target`이 없으므로 pending INCENTIVE는 동시에 1장만 존재 |
| `simulate`를 INCENTIVE 카드에 호출 | `400 {"detail": "INCENTIVE 카드는 scenarios를 사용합니다"}` — 시뮬레이션은 EXPANSION 전용 |
| INCENTIVE 승인 시 `selected_rate` 누락/범위 밖 | `400 {"detail": "selected_rate(3|5|7)가 필요합니다"}`. EXPANSION decision에 온 `selected_rate`는 무시 |
| 잘못된 상태 전이 | `409 {"detail": ...}` — 예: pending이 아닌 카드에 decision, approved가 아닌 카드에 progress |
| 없는 카드 ID | `404 {"detail": "card not found"}` |
| KPI에서 분모 0 | 해당 지표를 `null`로 반환 (예: approved 0건 → `execution_rate: null`, 채택 0건 → `regional_balance_index: null`). FE는 `null`이면 `—` 표시 |
| 위젯 추천 결과 0건 | `{"recommendations": [], "policy_note": ...}` 200 반환. FE는 "해당 조건의 가맹점이 아직 없어요" 빈 상태 UI |
| 위젯 LLM 실패 | `blurb`를 규칙 기반 문구로 대체 (`"{region}의 {category} 하이원포인트 가맹점이에요"`) — 응답 지연 방지 위해 LLM 타임아웃 5초 |
| 시각 표기 | 모든 타임스탬프 KST ISO8601 (`+09:00`) — `avg_approval_hours` 계산도 KST 기준 |
| 숫자 직렬화 | **BE 구현 주의:** boto3가 DynamoDB 숫자를 `Decimal`로 반환 → FastAPI JSON 직렬화가 깨진다. `db.py` 읽기 경로에서 Decimal→int/float 변환을 일괄 적용할 것 (07 문서 B2) |
| 날짜 기준 | "최근 3개월"·"전분기" 등은 **오늘이 아니라 데이터 최신 월 기준** (공공데이터 갱신 지연 대비, 06 문서 공통 원칙) |
