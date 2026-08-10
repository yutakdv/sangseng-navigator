"""임팩트 헤드라인 수치의 역추적 가능성 검증 — 심사 보강 Phase 4."""
from p5_metrics import build_impact_meta


def test_impact_meta_is_count_based_and_traceable():
    monthly = [
        {"month": "2025-01", "local_uses": 100, "visitors": 1000, "rate": 10.0},
        {"month": "2025-02", "local_uses": 200, "visitors": 3000, "rate": 6.7},
    ]
    meta = build_impact_meta(monthly)
    assert meta["basis"] == "count"
    assert meta["annual_local_uses"] == 300
    assert meta["annual_visitors"] == 4000
    assert meta["per_pp_additional_uses"] == 40  # 연인원 × 1%
    assert "가정 기반" in meta["note"] and "금액 환산" in meta["note"]
