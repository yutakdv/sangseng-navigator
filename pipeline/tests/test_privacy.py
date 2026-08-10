"""발행 산출물 전수 스캔 — n<5 셀 미억제 0건 (심사 보강 Phase 5)."""
import json
from collections import Counter
from pathlib import Path

from category_map import HIGHONE_TO_DISPLAY

PROCESSED = Path(__file__).resolve().parents[2] / "data" / "processed"
K = 5


def _suppressed_pairs():
    merchants = json.loads((PROCESSED / "merchants.json").read_text(encoding="utf-8"))
    counts = Counter((m["eup"], m["category"]) for m in merchants)
    return {pair for pair, n in counts.items() if n < K}


def test_small_cells_exist_in_current_data():
    assert _suppressed_pairs() == {("영월군", "카페"), ("영월군", "편의점")}


def test_usage_monthly_suppresses_small_cells():
    pairs = _suppressed_pairs()
    doc = json.loads((PROCESSED / "usage_monthly.json").read_text(encoding="utf-8"))
    assert doc["privacy_meta"]["k"] == K
    for row in doc["usage"]:
        disp = HIGHONE_TO_DISPLAY.get(row["category"])
        for eup, category in pairs:
            if disp == category and eup in row:
                assert row[eup] is None, f"{row['month']} {row['category']} {eup} 미억제"


def test_cell_load_suppresses_small_cells():
    pairs = _suppressed_pairs()
    doc = json.loads((PROCESSED / "cell_load.json").read_text(encoding="utf-8"))
    for cell in doc["cells"]:
        if (cell["eup"], cell["category"]) in pairs:
            assert cell["suppressed"] is True and cell["load_index"] is None


def test_dashboard_rounds_affected_aggregates():
    pairs = _suppressed_pairs()
    eups = {e for e, _ in pairs}
    dash = json.loads((PROCESSED / "dashboard.json").read_text(encoding="utf-8"))
    unit = dash["privacy_meta"]["aggregate_rounding"]["unit"]
    for row in dash["monthly_by_region"]:
        for eup in eups:
            if eup in row:
                assert row[eup] % unit == 0, f"{row.get('month')} {eup} 반올림 누락"
