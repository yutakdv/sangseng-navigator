"""B5: 반사실 재계산 — 순수 계산 함수만, LLM 무관 (docs/plan/07 B5, 15 문서 §5 T12).

usage_monthly.json 최신 월의 6개 지역 분포에 타깃 (읍×업종) 예상 월 건수(가정치)를 더해
지역 소비 집중도(0~100 지수)를 재계산한다. 모든 결과는 가정 기반 전망이다.
"""
import math

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


def _base_month(usage: dict) -> str:
    """기준월 — 파이프라인이 싣는 `base_month`를 우선 사용 (06 문서 공통 원칙 3).

    months 배열의 정렬에 기대지 않기 위한 것. base_month가 없거나 months에 없는 값이면
    기존 동작대로 months[-1]로 폴백한다 (현 산출물은 둘이 같다).
    """
    bm = usage.get("base_month")
    return bm if bm in usage["months"] else usage["months"][-1]


def _recent_months(usage: dict, n: int = 3) -> list:
    """기준월을 끝으로 하는 최근 n개월 (06 문서 공통 원칙 3)."""
    months = usage["months"]
    end = months.index(_base_month(usage)) + 1
    return months[max(0, end - n):end]


def _avg_monthly(rows: list, recent: list, eups: list, category: str | None = None) -> float:
    """최근 recent 개월에서 (지역 목록 × 표시 업종) 건수 합의 월평균. category=None이면 전 업종."""
    total = 0
    for row in rows:
        if row["month"] not in recent:
            continue
        if category is not None and HIGHONE_TO_DISPLAY.get(row["category"], "기타") != category:
            continue
        total += sum(row.get(e) or 0 for e in eups)
    return total / len(recent)


def _monthly_per_merchant_samples(
    usage: dict, merchants: list, eup: str, category: str
) -> tuple[list[float], int]:
    """최근 월별 가맹점당 건수 표본과 폴백 단계를 반환한다.

    정적인 가맹점 수를 각 월의 실제 건수에 적용한다. 표본 평균은 기존 예상 건수와 같지만,
    월별 변동을 보존하므로 임의의 ±30% 대신 관측 기반 사분위 범위를 만들 수 있다.
    """
    recent = _recent_months(usage)
    rows = usage["usage"]
    n1 = sum(1 for m in merchants if m.get("eup") == eup and m.get("category") == category)
    n2 = sum(1 for m in merchants if m.get("category") == category)

    if n1 > 0:
        eups, selected_category, denominator, step = [eup], category, n1, 1
    elif n2 > 0:
        eups, selected_category, denominator, step = REGIONS, category, n2, 2
    else:
        if not merchants:
            raise ValueError("가맹점 데이터가 비어 있어 예상 건수를 계산할 수 없습니다")
        eups, selected_category, denominator, step = REGIONS, None, len(merchants), 3

    samples = []
    for month in recent:
        total = 0
        for row in rows:
            if row["month"] != month:
                continue
            if (selected_category is not None
                    and HIGHONE_TO_DISPLAY.get(row["category"], "기타") != selected_category):
                continue
            total += sum(row.get(region) or 0 for region in eups)
        samples.append(total / denominator)
    return samples, step


def _percentile(values: list[float], quantile: float) -> float:
    """작은 표본에도 재현 가능한 선형 보간 분위수 (0<=quantile<=1)."""
    if not values:
        raise ValueError("분위수 계산 표본이 비어 있습니다")
    if not 0 <= quantile <= 1:
        raise ValueError("quantile은 0과 1 사이여야 합니다")
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def expected_monthly_count(usage: dict, merchants: list, eup: str, category: str) -> tuple[float, int]:
    """타깃 (읍×업종) 신규 가맹점 1곳의 예상 월 건수(가정치)와 사용된 폴백 단계를 반환.

    분모 0 폴백 체인 (15 문서 §5 T12 확정 — 순서 변경 금지):
      1) 타깃 읍×업종 하이원 가맹점 n₁>0 → 해당 읍×업종 최근 3개월 월평균 건수 ÷ n₁
      2) n₁=0 (공백 업종 — 기본 케이스): 전 지역 해당 업종 가맹점 n₂>0
         → 전 지역 해당 업종 최근 3개월 월평균 건수 ÷ n₂
      3) n₂=0 → 전 지역 전 업종 최근 3개월 월평균 건수 ÷ 전체 가맹점 수 (가맹점당 평균 건수)

    merchants가 비어 있지 않음(3단계 분모>0)은 호출부(라우트 503 가드)가 보장한다.
    """
    samples, step = _monthly_per_merchant_samples(usage, merchants, eup, category)
    return sum(samples) / len(samples), step


def _round_pp(x: float) -> float:
    """%p 값 소수 1자리 반올림 + **음의 0 정규화**.

    round(-0.001, 1) 은 `-0.0` 이고 JSON 에도 `-0.0` 으로 실린다 — 실데이터에서 태백시 카페 등이
    `delta_pp: [-0.0, -0.0]` 을 내므로 화면에 "-0.0~-0.0%p"가 찍힌다. 0 은 부호 없이 내보낸다.
    """
    r = round(x, 1)
    return r + 0.0 if r == 0 else r


def simulate_expansion(usage: dict, merchants: list, eup: str, category: str) -> dict:
    """반사실 재계산 — 05 §2 simulate 응답 수치의 원천.

    기준월 지역 분포에서 타깃 읍 건수에 예상 월 건수를 더해 지수를 재계산한다.
    delta_pp는 최근 3개월의 월별 가맹점당 건수 25·75 분위수를 적용한 개선폭
    (current−projected) 범위다. 데이터 변동을 쓰므로 임의의 ±30% 가정은 사용하지 않는다.

    집계 대상 6개 지역 밖의 eup은 조용히 delta 0을 내지 않고 `ValueError` (라우트가 400으로 변환)
    — 지수 분포에 더할 자리가 없어 "효과 없음"과 구분되지 않기 때문.
    """
    if eup not in REGIONS:
        raise ValueError(f"집계 대상 지역이 아닙니다: {eup} (대상: {', '.join(REGIONS)})")
    latest = _base_month(usage)
    dist = {r: 0 for r in REGIONS}
    for row in usage["usage"]:
        if row["month"] == latest:
            for r in REGIONS:
                dist[r] += row.get(r) or 0   # A3: 소표본 억제로 None 셀 존재(row.get(r, 0)만으론 못 거름)
    current = concentration_index([dist[r] for r in REGIONS])
    samples, step = _monthly_per_merchant_samples(usage, merchants, eup, category)
    expected = sum(samples) / len(samples)
    expected_low = _percentile(samples, 0.25)
    expected_high = _percentile(samples, 0.75)

    def projected(mult: float) -> float:
        return concentration_index(
            [dist[r] + expected * mult if r == eup else dist[r] for r in REGIONS])

    return {
        # 지수는 **소수 1자리** — delta_pp와 단위를 맞춘다. projected는 원시값을 따로 반올림하지
        # 않고 round(current) − round(Δ평균)으로 단일 원천화한다: 세 값을 독립 반올림하면
        # current 42.53·Δ 0.06 같은 경계에서 "42.5 → 42.5인데 0.1%p 개선"처럼 같은 응답 안에서
        # 이동폭과 delta_pp가 모순되는 문장이 나온다 (05 §2). Δ평균은 25~75 분위수 Δ 사이에
        # 있으므로(3표본 평균은 IQR 안, Δ가 count에 단조 — 지역 간 누계 순위 교차가 없는 한)
        # 표시 이동폭도 delta_pp 범위 안에 떨어진다. 실데이터 36조합 전수 검사 위반 0건.
        "current_index": _round_pp(current),
        "projected_index": _round_pp(_round_pp(current) - _round_pp(current - projected(1.0))),
        "delta_pp": sorted(_round_pp(current - concentration_index(
            [dist[r] + count if r == eup else dist[r] for r in REGIONS]
        )) for count in (expected_low, expected_high)),
        # 이하는 API 응답에 싣지 않는 내부 값 — LLM narrative 입력·검증 보고용
        "eup": eup,
        "category": category,
        "expected_monthly_count": round(expected, 1),
        "expected_monthly_range": [round(expected_low, 1), round(expected_high, 1)],
        "uncertainty_method": "최근 3개월 월별 가맹점당 건수 25~75 분위수",
        "fallback_step": step,
        "base_month": latest,
    }
