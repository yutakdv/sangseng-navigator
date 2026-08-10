"""p9 셀 부하 지수 검증 — 심사 보강 Phase 2 대체 산식."""
from p9_cell_load import build_cells, assign_tiers, quantile


def _usage(month, category, **regions):
    row = {"month": month, "category": category}
    row.update(regions)
    return row


def test_load_index_is_recent3_avg_over_merchant_count():
    usage = [
        _usage("2025-10", "커피전문점", 사북읍=30),
        _usage("2025-11", "커피전문점", 사북읍=30),
        _usage("2025-12", "커피전문점", 사북읍=60),
        _usage("2025-09", "커피전문점", 사북읍=999),  # 창 밖 — 제외돼야 함
    ]
    merchants = [{"eup": "사북읍", "category": "카페"}] * 5
    cells = build_cells(usage, merchants, base_month="2025-12")
    cell = next(c for c in cells if c["eup"] == "사북읍" and c["category"] == "카페")
    assert cell["merchants"] == 5
    assert cell["monthly_uses_avg"] == 40.0     # (30+30+60)/3
    assert cell["load_index"] == 8.0            # 40/5


def test_small_cell_is_suppressed_with_null_values():
    usage = [_usage("2025-12", "슈퍼마켓", 영월군=100)]
    merchants = [{"eup": "영월군", "category": "편의점"}] * 4  # n=4 < 5
    cells = build_cells(usage, merchants, base_month="2025-12")
    cell = next(c for c in cells if c["eup"] == "영월군")
    assert cell["suppressed"] is True
    assert cell["load_index"] is None and cell["monthly_uses_avg"] is None
    assert cell["tier"] == "suppressed"
    assert cell["merchants"] == 4  # 가맹점 수 자체는 merchants.json에서 공개 파생 가능하므로 유지


def test_tiers_split_at_quartiles():
    cells = [{"load_index": v, "suppressed": False} for v in [10, 20, 30, 40, 50, 60, 70, 80]]
    assign_tiers(cells)
    assert [c["tier"] for c in cells] == ["low", "low", "mid", "mid", "mid", "mid", "high", "high"]


def test_quantile_pure_python():
    assert quantile([1, 2, 3, 4], 0.25) == 1.75
    assert quantile([5], 0.5) == 5
