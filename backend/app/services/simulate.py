"""B5: 반사실 재계산 — 순수 계산 함수만, LLM 무관 (docs/plan/07 B5, 15 문서 §5 T12).

usage_monthly.json 최신 월의 6개 지역 분포에 타깃 (읍×업종) 예상 월 건수(가정치)를 더해
지역 소비 집중도(0~100 지수)를 재계산한다. 모든 결과는 가정 기반 전망이다.
"""

# pipeline/common.py REGIONS 복제본 (Lambda 번들에 pipeline 모듈이 없어 import 금지)
REGIONS = ["고한읍", "사북읍", "정선군", "태백시", "영월군", "삼척시"]

# 하이원 18종 → 표시 6분류 롤업 — pipeline/category_map.py 매핑 ①(HIGHONE_TO_DISPLAY) 복제본,
# 정본은 pipeline (5f63fc6에서 식품판매업→소매점으로 정정된 판 기준 — 편의점은 소진공
# 중분류 "종합 소매" 계열만). usage_monthly의 업종은 하이원 18종이라 카드
# target.category(표시 6분류)와 대조하려면 이 표로 롤업해야 한다.
HIGHONE_TO_DISPLAY = {
    "커피전문점": "카페",
    "일반음식점업": "음식점",
    "휴게음식점업": "음식점",
    "일반주점업": "음식점",
    "슈퍼마켓": "편의점",
    "식품판매업": "소매점",   # 정육·청과·건어물 등 식품 전문 소매 — 소진공 "식료품 소매"와 같은 묶음
    "소매업": "소매점",
    "숙박업": "숙박업",
    "주유소·LPG충전소": "기타",
    "자동차 전문수리업": "기타",
    "자동자 세차업": "기타",
    "세탁업": "기타",
    "이ㆍ미용업": "기타",
    "기타미용업": "기타",
    "목욕장업": "기타",
    "당구장 운영업": "기타",
    "실내 스크린 골프업": "기타",
    "기타": "기타",
}


def concentration_index(counts: list) -> float:
    """지역 소비 집중도 0~100 (float — 반올림은 응답 조립부에서).

    pipeline/common.py의 산식(지니계수 → 최대값 1-1/n 정규화 → ×100)을 pandas 없이
    사칙연산만으로 복제. delta_pp를 소수 1자리로 내려면 중간 반올림이 없어야 한다.
    """
    n = len(counts)
    mean = sum(counts) / n
    if mean == 0:
        return 0.0
    spread = sum(abs(a - b) for a in counts for b in counts) / (2 * n * n * mean)
    return spread / (1 - 1 / n) * 100


def _avg_monthly(rows: list, recent: list, eups: list, category: str | None = None) -> float:
    """최근 recent 개월에서 (지역 목록 × 표시 업종) 건수 합의 월평균. category=None이면 전 업종."""
    total = 0
    for row in rows:
        if row["month"] not in recent:
            continue
        if category is not None and HIGHONE_TO_DISPLAY.get(row["category"], "기타") != category:
            continue
        total += sum(row.get(e, 0) for e in eups)
    return total / len(recent)


def expected_monthly_count(usage: dict, merchants: list, eup: str, category: str) -> tuple[float, int]:
    """타깃 (읍×업종) 신규 가맹점 1곳의 예상 월 건수(가정치)와 사용된 폴백 단계를 반환.

    분모 0 폴백 체인 (15 문서 §5 T12 확정 — 순서 변경 금지):
      1) 타깃 읍×업종 하이원 가맹점 n₁>0 → 해당 읍×업종 최근 3개월 월평균 건수 ÷ n₁
      2) n₁=0 (공백 업종 — 기본 케이스): 전 지역 해당 업종 가맹점 n₂>0
         → 전 지역 해당 업종 최근 3개월 월평균 건수 ÷ n₂
      3) n₂=0 → 전 지역 전 업종 최근 3개월 월평균 건수 ÷ 전체 가맹점 수 (가맹점당 평균 건수)

    merchants가 비어 있지 않음(3단계 분모>0)은 호출부(라우트 503 가드)가 보장한다.
    """
    recent = usage["months"][-3:]        # "최근 3개월" = 데이터 최신 월 기준 (06 문서 공통 원칙 3)
    rows = usage["usage"]
    n1 = sum(1 for m in merchants if m.get("eup") == eup and m.get("category") == category)
    if n1 > 0:
        return _avg_monthly(rows, recent, [eup], category) / n1, 1
    n2 = sum(1 for m in merchants if m.get("category") == category)
    if n2 > 0:
        return _avg_monthly(rows, recent, REGIONS, category) / n2, 2
    return _avg_monthly(rows, recent, REGIONS) / len(merchants), 3


def simulate_expansion(usage: dict, merchants: list, eup: str, category: str) -> dict:
    """반사실 재계산 — 05 §2 simulate 응답 수치의 원천.

    최신 월 지역 분포에서 타깃 읍 건수에 예상 월 건수를 더해 지수를 재계산한다.
    delta_pp는 예상 건수 ×0.7/×1.3 두 시나리오의 개선폭(current−projected) 범위,
    낮은 값 먼저. 클램핑하지 않는다 (T12 브리프 — 상식 범위 밖이면 그대로 노출).
    """
    latest = usage["months"][-1]
    dist = {r: 0 for r in REGIONS}
    for row in usage["usage"]:
        if row["month"] == latest:
            for r in REGIONS:
                dist[r] += row.get(r, 0)
    current = concentration_index([dist[r] for r in REGIONS])
    expected, step = expected_monthly_count(usage, merchants, eup, category)

    def projected(mult: float) -> float:
        return concentration_index(
            [dist[r] + expected * mult if r == eup else dist[r] for r in REGIONS])

    return {
        "current_index": round(current),
        "projected_index": round(projected(1.0)),
        "delta_pp": sorted(round(current - projected(m), 1) for m in (0.7, 1.3)),
        # 이하는 API 응답에 싣지 않는 내부 값 — LLM narrative 입력·검증 보고용
        "eup": eup,
        "category": category,
        "expected_monthly_count": round(expected, 1),
        "fallback_step": step,
        "base_month": latest,
    }
