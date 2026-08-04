import json

import pytest

from app import dataload
from app.services import simulate


def _usage():
    rows = []
    for month, target_count in zip(("2025-01", "2025-02", "2025-03"), (10, 20, 30)):
        values = dict.fromkeys(simulate.REGIONS, 100)
        values["영월군"] = target_count
        rows.append({"month": month, "category": "커피전문점", **values})
    return {
        "months": ["2025-01", "2025-02", "2025-03"],
        "base_month": "2025-03",
        "usage": rows,
    }


def test_simulation_uncertainty_uses_observed_monthly_quartiles():
    usage = _usage()
    merchants = [{"eup": "영월군", "category": "카페"}]
    samples, step = simulate._monthly_per_merchant_samples(usage, merchants, "영월군", "카페")
    assert samples == [10, 20, 30]
    assert step == 1
    assert simulate._percentile(samples, 0.25) == 15
    assert simulate._percentile(samples, 0.75) == 25

    result = simulate.simulate_expansion(usage, merchants, "영월군", "카페")
    assert result["expected_monthly_count"] == 20
    assert result["expected_monthly_range"] == [15, 25]
    assert "25~75" in result["uncertainty_method"]


def test_simulation_rejects_empty_merchant_denominator():
    with pytest.raises(ValueError, match="가맹점 데이터가 비어"):
        simulate.expected_monthly_count(_usage(), [], "영월군", "카페")


def test_dataload_refreshes_when_processed_file_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(dataload, "CANDIDATE_DIRS", [tmp_path])
    path = tmp_path / "sample.json"
    path.write_text(json.dumps({"version": 1}), encoding="utf-8")
    assert dataload.load("sample") == {"version": 1}

    # 크기도 바꿔 mtime 해상도가 낮은 파일시스템에서도 버전 키가 달라지게 한다.
    path.write_text(json.dumps({"version": 200}), encoding="utf-8")
    assert dataload.load("sample") == {"version": 200}
