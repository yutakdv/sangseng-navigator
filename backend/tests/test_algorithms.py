import json

import pytest

from app import dataload, korean
from app.services import cardgen, simulate


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


# ── 조사(助詞) 생성 — 05 §8 (서버가 만드는 문장에 값이 그대로 박힌다) ─────────────────


def test_particles_follow_the_final_consonant_of_korean_words():
    """받침이 있으면 을·은·이·과·으로, 없으면 를·는·가·와·로."""
    assert korean.eul("사북읍") == "사북읍을" and korean.eul("카페") == "카페를"
    assert korean.eun("음식점") == "음식점은" and korean.eun("카페") == "카페는"
    assert korean.i_ga("음식점") == "음식점이" and korean.i_ga("카페") == "카페가"
    assert korean.wa("소매점") == "소매점과" and korean.wa("카페") == "카페와"
    assert korean.euro("적격성 확인") == "적격성 확인으로" and korean.euro("카페") == "카페로"
    # ㄹ 받침은 "으로"가 아니라 "로"다
    assert korean.euro("서울") == "서울로"


def test_particles_read_numbers_out_loud():
    """05 §8 — 숫자는 **읽는 소리**로 판정한다. 값에 따라 반드시 갈리는 자리다."""
    assert korean.eul("0.48") == "0.48을"        # …영점사'팔' — 받침 있음
    assert korean.eul("1,552") == "1,552를"      # …오십'이' — 받침 없음
    assert korean.eul(6) == "6을"                # '육'
    assert korean.i_ga("0.57") == "0.57이" and korean.i_ga("1,552") == "1,552가"
    # 1의 자리가 0이면 마지막 **자릿수 이름**(십·백·천)이 소리를 결정한다 — 전부 받침 있음
    assert korean.eul("1,550") == "1,550을" and korean.eul("100") == "100을"


def test_particles_ignore_trailing_punctuation_and_read_latin_letters():
    """"(Score 0.57)"처럼 닫는 괄호로 끝나는 값이 실제로 문장에 들어간다."""
    assert korean.eul("(Score 0.57)") == "(Score 0.57)을"
    assert korean.wa("영월군 소매점(Score 0.49)") == "영월군 소매점(Score 0.49)와"   # …사'구'
    assert korean.eun("Score") == "Score는"       # 'e' = 이 — 받침 없음
    assert korean.eul("") == "을"                 # 판정할 수 없으면 받침 있음으로 본다
    # 알파벳 이름 중 받침이 있는 것은 엘(ㄹ)·엠·엔뿐이다 — 아르·에프·에스·엑스는
    # 르/프/스로 끝나 받침이 없다. 카드 ID·담당자 ID가 이 경로로 들어온다.
    assert korean.eul("kim.js") == "kim.js를"     # '에스'
    assert korean.eul("ACL") == "ACL을"           # '엘'
    assert korean.eul("item") == "item을"         # '엠'


def test_euro_treats_rieul_readings_of_numbers_and_letters():
    """`(으)로`만 ㄹ 받침을 따로 본다 — 1(일)·7(칠)·8(팔)은 ㄹ이라 "로"가 붙는다.

    한글만 ㄹ을 판정하면 "AC-001으로"처럼 카드 ID가 붙는 문장에서 곧바로 틀린다.
    """
    assert korean.euro("1") == "1로" and korean.euro("7") == "7로" and korean.euro("8") == "8로"
    assert korean.euro("2") == "2로"              # '이' — 받침 없음
    assert korean.euro("3") == "3으로"            # '삼' — ㄹ이 아닌 받침
    assert korean.euro("10") == "10으로"          # '십'
    assert korean.euro("AC-001") == "AC-001로"    # …공공'일'
    assert korean.euro("가맹 심사") == "가맹 심사로" and korean.euro("추진중") == "추진중으로"


# ── 근거 ID 대조 — 화이트리스트가 페이로드와 정확히 같아야 한다 (05 §2) ─────────────


def test_evidence_whitelist_matches_what_the_request_actually_sent():
    """넓으면 보내지도 않은 근거가 통과하고, 좁으면 정당한 인용이 폐기된다.

    특히 반려 이력은 AI 입력 ⑤가 **최근 창 안 · 타깃 있음**만 싣는다 — 그 필터를 화이트리스트가
    따르지 않으면 오래된 반려 카드 ID를 인용한 문장이 검증을 통과한다.
    """
    cands = [{"id": "CAND-001", "eup": "영월군", "category": "숙박업", "rank": 1}]
    fresh = {"id": "AC-900", "status": "rejected", "target": {"eup": "영월군", "category": "카페"},
             "decided_at": db_now()}
    stale = {"id": "AC-901", "status": "rejected", "target": {"eup": "영월군", "category": "카페"},
             "decided_at": "2020-01-01T00:00:00+09:00"}
    targetless = {"id": "AC-902", "status": "rejected", "target": None, "decided_at": db_now()}

    whitelist = cardgen.evidence_whitelist(
        cands, [fresh, stale, targetless], {"eup": "영월군", "category": "숙박업"})

    assert "HISTORY.REJECTED.AC-900" in whitelist       # 입력 ⑤에 실제로 실린다
    assert "HISTORY.REJECTED.AC-901" not in whitelist   # 최근 창 밖 — 페이로드에 없다
    assert "HISTORY.REJECTED.AC-902" not in whitelist   # 타깃 없음 — 페이로드에 없다
    # 프롬프트가 입력 8로 리스크를 쓰라고 지시하므로 요일 근거 ID도 발급해야 한다
    assert "WEEKDAY.영월군.숙박업" in whitelist


def test_evidence_ids_accept_field_level_citations_of_multi_segment_blocks():
    """`RISK.영월군.under2y_ratio`처럼 블록 ID 자체가 여러 마디인 경우가 있다.

    앞 한 마디만 대조하면 정당한 필드 단위 인용이 폐기되고, 화면에는 그 문장이 조용히 사라진다.
    """
    whitelist = {"CAND-001", "RISK.영월군", "HISTORY.REJECTED.AC-900"}
    ok = ["CAND-001", "CAND-001.gap", "RISK.영월군", "RISK.영월군.under2y_ratio",
          "HISTORY.REJECTED.AC-900", "HISTORY.REJECTED.AC-900.reason"]
    assert cardgen._evidence_known(ok, whitelist)
    for bad in (["CAND-999"], ["CAND-999.gap"], ["RISK.정선군"], ["HISTORY.REJECTED.AC-901"],
                ["HISTORY"], [""], [123], "문자열"):
        assert not cardgen._evidence_known(bad, whitelist), bad


def db_now() -> str:
    from app import db
    return db.now_iso()


# ── INCENTIVE 서술 — 서버가 시나리오 상수로 만든다 (05 §2) ──────────────────────────


def test_incentive_narrative_quotes_the_server_scenarios():
    """예전에는 이 셋이 LLM 원문이라 "5% 적용 시 3.0%p 개선"처럼 서버 가정과 어긋난 문장이
    카드에 남을 수 있었다. 수치를 문장에 넣는 주체가 서버면 그 어긋남이 구조적으로 불가능해진다.
    """
    dashboard = dataload.load("dashboard")
    comparison, reasons, expected = cardgen._incentive_narrative(dashboard)
    by_rate = {s["rate"]: s for s in cardgen.SCENARIOS}

    for rate in (3, 5, 7):
        low, high = by_rate[rate]["delta_pp"]
        assert f"{low}~{high}%p" in comparison, rate
    low, high = by_rate[5]["delta_pp"]
    assert f"{low}~{high}%p" in expected              # 예상 효과는 5% 시나리오를 인용한다

    # 나머지 수치도 정본 집계에서 온다 — 문장에 상수를 새로 박지 않는다
    rates = [m["rate"] for m in dashboard["conversion"]["monthly"]]
    assert f"{min(rates)}~{max(rates)}%" in reasons[1]
    top_two = sorted(dashboard["region_share"], key=lambda r: r["share"], reverse=True)[:2]
    assert top_two[0]["region"] in reasons[2] and top_two[1]["region"] in reasons[2]

    # 05 §2 페이백 설계 표현 규칙 — 적립이 아니라 사용 단계, 발행액 증액 없음
    assert "발행액 증액은 수반하지 않습니다" in comparison
    assert not any(word in comparison for word in ("추가 적립", "추가 지급"))


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
