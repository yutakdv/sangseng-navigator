import pytest

from common import REGIONS, hhi_dispersion_index
from p6_scoring import (
    _decline_scores,
    market_gap,
    minmax01,
    proximity_score,
    saturation_score,
    stage1_eup_ranking,
)


def test_hhi_dispersion_is_normalized_for_fixed_six_categories():
    assert hhi_dispersion_index([10] * 6) == 100
    assert hhi_dispersion_index([60, 0, 0, 0, 0, 0]) == 0
    assert hhi_dispersion_index([0] * 6) == 0
    with pytest.raises(ValueError):
        hhi_dispersion_index([1, -1, 2])


def test_decline_signal_does_not_reward_growth_or_flat_data():
    assert _decline_scores([-0.2, -0.1, 0.0]) == [0.0, 0.0, 0.0]
    assert _decline_scores([0.2, -0.1]) == [1.0, 0.0]
    assert minmax01([7.0, 7.0]) == [0.5, 0.5]


def test_stage1_ends_at_base_month_and_keeps_raw_decline_for_audit():
    months = ["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"]
    rows = []
    for month in months:
        values = dict.fromkeys(REGIONS, 100)
        if month in {"2025-04", "2025-05", "2025-06"}:
            values["고한읍"] = 150  # 증가 — 감소 신호는 0이어야 한다.
            values["사북읍"] = 50
        if month == "2025-07":
            values["고한읍"] = 1  # 기준월 뒤 값은 계산에 들어가면 안 된다.
        rows.append({"month": month, "category": "커피전문점", **values})

    ranking = stage1_eup_ranking({"months": months, "base_month": "2025-06", "usage": rows})
    by_region = {row["eup"]: row for row in ranking}
    assert by_region["고한읍"]["recent_3m"] == 450
    assert by_region["고한읍"]["raw_decline_rate"] == pytest.approx(-0.5)
    assert by_region["고한읍"]["decline"] == 0
    assert by_region["사북읍"]["raw_decline_rate"] == pytest.approx(0.5)
    assert by_region["사북읍"]["decline"] == 1


def test_candidate_components_are_fixed_scale_and_sample_aware():
    sparse_gap, sparse_coverage = market_gap(1, 0)
    denser_gap, _ = market_gap(10, 0)
    assert sparse_gap == pytest.approx(2 / 3)
    assert sparse_coverage == pytest.approx(1 / 3)
    assert denser_gap > sparse_gap
    assert proximity_score(0) == 1
    assert proximity_score(20_000) == pytest.approx(0.5)
    assert saturation_score(0) == 0
    assert saturation_score(3) == pytest.approx(0.5)
