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


def test_usage_daily_suppresses_small_cells():
    """요일 축에 억제가 빠지면 월 원장에서 지운 값이 그대로 복원된다 (영월군 편의점 연 4,044건)."""
    pairs = _suppressed_pairs()
    doc = json.loads((PROCESSED / "usage_daily.json").read_text(encoding="utf-8"))
    assert doc["privacy_meta"]["k"] == K
    weekday = doc["weekday_category"]
    # weekday_category의 업종 키는 표시 6분류라 억제 쌍을 그대로 대조한다 (하이원 18종 아님)
    for eup, category in pairs:
        assert weekday[eup][category] is None, f"{eup} {category} 요일 축 미억제"


def test_usage_daily_blurs_recovery_margins():
    """차분 복원의 두 경로(행 마진·열 마진)가 반올림돼 있는지 — 억제만으로는 되살아난다."""
    pairs = _suppressed_pairs()
    doc = json.loads((PROCESSED / "usage_daily.json").read_text(encoding="utf-8"))
    unit = doc["privacy_meta"]["aggregate_rounding"]["unit"]
    weekday = doc["weekday_category"]
    for eup in {e for e, _ in pairs}:                      # 행 마진 — 억제 지역의 공개 셀
        for category, counts in weekday[eup].items():
            if counts is None:
                continue
            assert all(v % unit == 0 for v in counts), f"{eup} {category} 반올림 누락"
    for category in {c for _, c in pairs}:                 # 열 마진 — '전체'의 억제 업종
        assert all(v % unit == 0 for v in weekday["전체"][category]), f"전체 {category} 반올림 누락"


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
