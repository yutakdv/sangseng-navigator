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


def test_simulate_expansion_rejects_suppressed_target():
    """A3 후속: 타깃이 privacy_meta.suppressed_cells에 있으면 거짓 0 대신 ValueError."""
    usage = _usage()
    usage["privacy_meta"] = {"k": 5, "suppressed_cells": [{"eup": "영월군", "category": "카페"}]}
    merchants = [{"eup": "영월군", "category": "카페"}]
    with pytest.raises(ValueError, match="표본 보호"):
        simulate.simulate_expansion(usage, merchants, "영월군", "카페")


def test_simulate_dist_uses_dashboard_region_totals_when_available():
    """A3 후속: usage_monthly의 억제(null→0 가드)로 영월군 usage 합산이 실제보다 낮게 잡히므로,
    dashboard.monthly_by_region(억제 영향 없는 정본)이 있으면 그 쪽 지역 합계를 우선 쓴다.

    실데이터로 확인 — 값을 하드코딩하지 않고 두 소스(usage 합산 vs dashboard 정본)를 직접
    비교해 dashboard가 실제로 반영됨을 증명한다(15 문서 §5 T12 폴백 체인·집중도 산식은 그대로).
    """
    usage = dataload.load("usage_monthly")
    merchants = dataload.load("merchants")
    dashboard = dataload.load("dashboard")
    base_month = usage["base_month"]

    usage_sum = sum(row.get("영월군") or 0 for row in usage["usage"] if row["month"] == base_month)
    dash_total = next(r for r in dashboard["monthly_by_region"] if r["month"] == base_month)["영월군"]
    assert dash_total > usage_sum, "억제로 usage 합산이 저평가되어 있어야 이 검증이 의미 있다"

    without_dashboard = simulate.simulate_expansion(usage, merchants, "영월군", "음식점")
    with_dashboard = simulate.simulate_expansion(usage, merchants, "영월군", "음식점", dashboard=dashboard)

    assert with_dashboard["current_index"] != without_dashboard["current_index"]
    # dashboard 쪽 영월군 총량이 더 크므로(usage 합산보다 활발) 영월군의 상대적 "쏠림 결핍"이
    # 줄어 집중도 지수는 더 낮게(=덜 쏠린 것으로) 나와야 한다.
    assert with_dashboard["current_index"] < without_dashboard["current_index"]


def test_simulate_falls_back_to_usage_sum_when_dashboard_incomplete():
    """dashboard.json에 기준월 행이 없거나 지역 키가 빠져 있으면 usage 셀 합산으로 폴백한다."""
    usage = _usage()
    merchants = [{"eup": "영월군", "category": "카페"}]
    fallback_only = simulate.simulate_expansion(usage, merchants, "영월군", "카페")

    no_month_row = {"monthly_by_region": [{"month": "2024-12", **dict.fromkeys(simulate.REGIONS, 1)}]}
    missing_region_key = {"monthly_by_region": [
        {"month": "2025-03", **{r: 1 for r in simulate.REGIONS if r != "영월군"}}
    ]}
    for dashboard in (None, {}, {"monthly_by_region": []}, no_month_row, missing_region_key):
        result = simulate.simulate_expansion(usage, merchants, "영월군", "카페", dashboard=dashboard)
        assert result["current_index"] == fallback_only["current_index"], dashboard


def test_llm_clients_disable_sdk_internal_retries(monkeypatch):
    """llm.py의 지연 예산(timeout × attempts)은 SDK 내부 재시도가 꺼져 있어야 성립한다.

    openai SDK는 기본 max_retries=2로 타임아웃·429·5xx를 자체 재시도하므로, 막지 않으면
    앱 레벨 시도 1회가 timeout×3까지 늘어나 API Gateway HTTP API의 통합 타임아웃 30초
    (증액 불가) 예산을 넘고, 규칙 기반 폴백에 도달하기 전에 게이트웨이가 504로 끊는다.
    """
    import openai as openai_sdk

    from app import llm

    captured = {}

    def ctor(**kwargs):
        captured.update(kwargs)
        raise RuntimeError("네트워크 호출 전 중단")

    monkeypatch.setattr(openai_sdk, "OpenAI", ctor)

    with pytest.raises(llm.LLMError):
        llm.generate_json("s", "u", {"type": "object"}, attempts=1)
    assert captured.get("max_retries") == 0, (
        "OpenAI 클라이언트가 max_retries=0 없이 생성됨 — SDK 내부 재시도가 살아 있다")


def test_llm_does_not_read_provider_env(monkeypatch):
    """provider 분기 제거 확인 — LLM_PROVIDER가 무엇이든 OpenAI 경로로만 간다."""
    import openai as openai_sdk

    from app import llm

    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    called = {"openai": False}

    def ctor(**kwargs):
        called["openai"] = True
        raise RuntimeError("네트워크 호출 전 중단")

    monkeypatch.setattr(openai_sdk, "OpenAI", ctor)
    with pytest.raises(llm.LLMError):
        llm.generate_json("s", "u", {"type": "object"}, attempts=1)
    assert called["openai"], "LLM_PROVIDER=anthropic 인데 OpenAI 경로로 가지 않았다"


def test_dataload_refreshes_when_processed_file_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(dataload, "CANDIDATE_DIRS", [tmp_path])
    path = tmp_path / "sample.json"
    path.write_text(json.dumps({"version": 1}), encoding="utf-8")
    assert dataload.load("sample") == {"version": 1}

    # 크기도 바꿔 mtime 해상도가 낮은 파일시스템에서도 버전 키가 달라지게 한다.
    path.write_text(json.dumps({"version": 200}), encoding="utf-8")
    assert dataload.load("sample") == {"version": 200}


def test_resolve_allowed_origins_deployed_defaults_to_empty():
    """배포 환경에서 ALLOWED_ORIGINS 미설정이면 어떤 오리진도 허용하지 않는다.

    구 코드는 AWS_LAMBDA_FUNCTION_NAME 유무로 판별했는데 ECS에는 그 변수가 없어
    배포 환경에서도 localhost가 조용히 허용됐다.
    """
    from app import main
    assert main.resolve_allowed_origins(None, True) == []


def test_resolve_allowed_origins_local_defaults_to_localhost():
    from app import main
    assert main.resolve_allowed_origins(None, False) == [
        "http://localhost:3100", "http://127.0.0.1:3100"]


def test_resolve_allowed_origins_rejects_wildcard():
    from app import main
    with pytest.raises(RuntimeError, match="not allowed"):
        main.resolve_allowed_origins("https://a.example,*", True)
