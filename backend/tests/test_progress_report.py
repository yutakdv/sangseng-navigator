"""Progress record transaction, workflow, and observed report integration tests."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import pytest


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "dynamodb"}
endpoint = os.environ.get("DYNAMO_ENDPOINT")
if not endpoint or urlparse(endpoint).hostname not in LOCAL_HOSTS:
    pytest.fail("progress integration tests require a local DYNAMO_ENDPOINT", pytrace=False)

os.environ.setdefault("AWS_ACCESS_KEY_ID", "local")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "local")
os.environ.setdefault("CARDS_TABLE", "sangseng-cards")
os.environ.setdefault("PROGRESS_RECORDS_TABLE", "sangseng-progress-records")
os.environ["MUTATION_API_TOKEN"] = "local-test-mutation-token"
os.environ["DEMO_READ_ONLY"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app import db, progress_db  # noqa: E402
from app.clock import KST  # noqa: E402
from app.main import app  # noqa: E402
from app.services import progress_records, workflow  # noqa: E402
import seed_demo  # noqa: E402


client = TestClient(app)
AUTH = {"Authorization": "Bearer local-test-mutation-token"}


@pytest.fixture(scope="session", autouse=True)
def tables():
    seed_demo.ensure_table()


@pytest.fixture(autouse=True)
def seeded(tables):
    os.environ["DEMO_READ_ONLY"] = "false"
    seed_demo.clear_table()
    for card in seed_demo.demo_cards():
        db.put_card(card)


def _at(days_ago: float) -> str:
    return (datetime.now(KST) - timedelta(days=days_ago)).isoformat(timespec="seconds")


def _date(days_ago: int) -> str:
    return (datetime.now(KST).date() - timedelta(days=days_ago)).isoformat()


def _measured(value, *, days_ago: int = 1, source="테스트 관측 출처", scope="테스트 측정 범위") -> dict:
    """관측값 1건 — 값만으로는 저장되지 않는다(기간·출처·범위 필수, 05 §2).

    측정 종료일은 기록 시각보다 미래일 수 없으므로 기록일보다 하루 앞선 날짜를 쓴다.
    `unit`·`is_proxy`는 넣지 않는다 — 서버가 지표 정의에서 채운다.
    """
    end = datetime.now(KST).date() - timedelta(days=days_ago)
    return {"value": value,
            "measured_from": (end - timedelta(days=30)).isoformat(),
            "measured_to": end.isoformat(),
            "source": source, "scope": scope}


def _metrics(days_ago: int, **values) -> dict:
    return {key: _measured(value, days_ago=days_ago + 1) for key, value in values.items()}


# 완료 증빙은 타입별로 요구가 다르다 (05 §2)
EXPANSION_EVIDENCE = {"document": "가맹 계약서 사본 (테스트)"}
INCENTIVE_EVIDENCE = {"applied_from": _date(30), "applied_to": _date(0),
                      "owner": "지역상생팀 테스트 담당자", "budget_cap_confirmed": True}


def _put_incentive(cid: str, *, created_days_ago: int) -> None:
    db.put_card({
        "id": cid,
        "type": "INCENTIVE",
        "status": "approved",
        "progress": "검토중",
        "title": f"{cid} 관측 테스트",
        "target": None,
        "created_at": _at(created_days_ago),
        "decided_at": _at(created_days_ago - 1),
        "events": [],
        "version": 0,
    })


def _post(cid: str, payload: dict):
    return client.post(
        f"/api/cards/{cid}/progress-records",
        json=payload,
        headers=AUTH,
    )


def _verify(cid: str = "AC-001"):
    return client.post(
        f"/api/cards/{cid}/verification",
        json={"checks": [
            {"label": label, "status": "verified"}
            for label in workflow.REQUIRED_ELIGIBILITY_CHECKS
        ]},
        headers=AUTH,
    )


def test_record_create_is_idempotent_and_old_endpoint_writes_a_record():
    assert _verify().status_code == 200
    payload = {
        "progress": "적격성 확인",
        "progress_pct": 30,
        "note": "필수 적격성 확인 완료",
        "metrics": _metrics(0, usage_count=100, conversion_rate_pct=20.0),
        "idempotency_key": "record-once",
    }
    created = _post("AC-001", payload)
    assert created.status_code == 201
    body = created.json()
    assert body["created"] is True
    assert body["card"]["progress"] == "적격성 확인"
    assert body["record"]["progress_pct"] == 30
    assert body["record"]["source"] == "담당자 입력"
    # 단위·근사 여부는 요청이 아니라 서버 지표 정의에서 온다 (05 §2)
    assert body["record"]["metrics"]["usage_count"]["unit"] == "건"
    assert body["record"]["metrics"]["conversion_rate_pct"]["is_proxy"] is True
    assert body["card"]["events"][-1]["record_id"] == body["record"]["record_id"]
    assert "request_fingerprint" not in body["record"]

    retried = _post("AC-001", payload)
    assert retried.status_code == 200
    assert retried.json()["created"] is False
    assert retried.json()["record"]["record_id"] == body["record"]["record_id"]

    conflicting = _post("AC-001", {**payload, "note": "같은 키의 다른 요청"})
    assert conflicting.status_code == 409
    assert "idempotency_key" in conflicting.json()["detail"]

    quick = client.post(
        "/api/cards/AC-001/progress",
        json={"progress": "가맹 심사", "idempotency_key": "quick-once"},
        headers=AUTH,
    )
    assert quick.status_code == 200
    assert quick.json()["record"]["source"] == "quick_status"
    timeline = client.get("/api/cards/AC-001/progress-records", headers=AUTH).json()
    assert [row["progress"] for row in timeline["records"]] == ["가맹 심사", "적격성 확인"]


def test_workflow_requires_next_stage_and_hold_resumes_previous_stage():
    assert _verify().status_code == 200
    assert _post("AC-001", {"progress": "추진중", "note": "단계 건너뛰기"}).status_code == 409

    assert _post("AC-001", {"progress": "적격성 확인", "note": "확인"}).status_code == 201
    assert _post("AC-001", {"progress": "보류", "note": "서류 대기"}).status_code == 201
    wrong_resume = _post("AC-001", {"progress": "가맹 심사", "note": "잘못된 재개"})
    assert wrong_resume.status_code == 409
    assert "직전 단계(적격성 확인)" in wrong_resume.json()["detail"]
    assert _post("AC-001", {"progress": "적격성 확인", "note": "보류 해제"}).status_code == 201
    assert _post("AC-001", {"progress": "가맹 심사", "note": "심사"}).status_code == 201
    assert _post("AC-001", {"progress": "추진중", "note": "실행"}).status_code == 201
    # 완료에는 증빙이 필수다 — 없으면 422이고 카드는 추진중에 머문다 (05 §2·§8)
    assert _post(
        "AC-001",
        {"progress": "완료", "progress_pct": 100, "note": "증빙 없는 완료"},
    ).status_code == 422
    assert _post(
        "AC-001",
        {"progress": "완료", "progress_pct": 100, "note": "완료",
         "completion_evidence": EXPANSION_EVIDENCE},
    ).status_code == 201
    assert _post("AC-001", {"progress": "추진중", "note": "완료 역행"}).status_code == 409
    # 같은 완료 상태의 후속 실측/메모는 상태를 되돌리지 않으므로 허용한다 (증빙은 다시 요구한다).
    assert _post("AC-001", {"progress": "완료", "note": "완료 후 점검",
                            "completion_evidence": EXPANSION_EVIDENCE}).status_code == 201


def test_same_stage_record_survives_a_candidate_turning_ineligible():
    """05 §2 — 같은 상태를 다시 기록하는 것은 정상이고, 적격성 게이트는 **단계를 올릴 때만** 건다.

    적격성 항목이 failed로 바뀐 뒤 그 사실을 같은 단계 메모로 남기려 하면, 동시 요청이 없는데도
    조건부 쓰기가 깨져 "다른 요청이 먼저 변경했습니다"(409)가 나갔다. 담당자는 부적격 판명을
    그 단계에 기록할 방법이 없었고, `allowed_next_progress`는 그 항목을 여전히 허용으로 내보냈다.
    """
    _verify()
    for stage in ("적격성 확인", "가맹 심사", "추진중"):
        assert _post("AC-001", {"progress": stage, "note": f"{stage} 진입"}).status_code == 201

    # 사업자가 참여 의향을 철회해 후보가 부적격이 된다
    failed = client.post(
        "/api/cards/AC-001/verification",
        json={"checks": [
            {"label": label, "status": "failed" if label == "사업자 참여 의향" else "verified"}
            for label in workflow.REQUIRED_ELIGIBILITY_CHECKS
        ]},
        headers=AUTH,
    )
    assert failed.status_code == 200
    assert failed.json()["card"]["candidate_verification"]["status"] == "ineligible"

    # 같은 단계에 그 사실을 기록할 수 있어야 한다
    recorded = _post("AC-001", {"progress": "추진중", "note": "사업자 참여 의향 철회 — 부적격 처리"})
    assert recorded.status_code == 201

    # 그리고 서버가 내보낸 선택지와 실제 허용이 일치해야 한다
    allowed = {o["value"]: o["allowed"] for o in recorded.json()["card"]["allowed_next_progress"]}
    assert allowed["추진중"] is True        # 같은 단계 재기록
    assert allowed["완료"] is False          # 부적격이라 다음 단계는 막힌다


def test_metric_values_keep_their_range_and_integer_rules():
    """관측값을 객체로 감싸면서 스칼라 시절 필드 제약(ge/le/int)이 통째로 사라졌었다.

    음수 건수·999% 전환율·8.7곳 같은 값이 201로 저장돼 경과 리포트 수치로 그대로 올라갔다.
    등급은 **400**이다 — 05 §8이 가르는 기준대로 "값이 있는데 유효하지 않은" 경우이고,
    "없는 값을 요구하는"(422) 경우와 담당자가 할 일이 다르다.
    """
    _verify()
    _post("AC-001", {"progress": "적격성 확인", "note": "진입"})

    def record(**values):
        return _post("AC-001", {"progress": "적격성 확인", "note": "관측", "metrics": _metrics(1, **values)})

    assert record(usage_count=-500).status_code == 400           # 음수 건수
    assert record(conversion_rate_pct=999).status_code == 400    # 범위 밖 전환율
    assert record(concentration_index=-3.5).status_code == 400   # 음수 지수
    assert record(active_merchant_count=8.7).status_code == 400  # 정수 지표에 소수
    assert record(usage_count=0).status_code == 201              # 0은 정상 관측값이다


def test_incentive_completion_rejects_a_backwards_application_period():
    """적용 시작일이 종료일보다 늦은 증빙은 저장되면 안 된다 (05 §2)."""
    _put_incentive("RPT-INC", created_days_ago=10)
    assert _post("RPT-INC", {"progress": "추진중", "note": "시작"}).status_code == 201
    backwards = _post("RPT-INC", {
        "progress": "완료", "note": "완료",
        "completion_evidence": {"applied_from": "2026-12-01", "applied_to": "2026-01-01",
                                "owner": "지역상생팀", "budget_cap_confirmed": True},
    })
    assert backwards.status_code == 400
    assert "시작일" in backwards.json()["detail"]
    blank_owner = _post("RPT-INC", {
        "progress": "완료", "note": "완료",
        "completion_evidence": {"applied_from": "2026-09-01", "applied_to": "2026-11-30",
                                "owner": "   ", "budget_cap_confirmed": True},
    })
    assert blank_owner.status_code == 422


def test_normalize_metrics_rejects_values_without_measurement_context():
    """05 §2 — 서비스 계층이 직접 지는 규칙(시드·배치도 같은 문을 지난다).

    HTTP 경로에서는 pydantic이 먼저 막지만, 그 앞단이 없는 호출부까지 기간·출처 없는 숫자를
    저장하면 리포트 수치의 출처를 되짚을 수 없다.
    """
    recorded = datetime.now(KST)

    with pytest.raises(progress_records.MissingRequirement):
        progress_records.normalize_metrics({"usage_count": 1362}, recorded_at=recorded)
    # 오류 문구는 화면에 그대로 나가므로 필드명이 아니라 담당자 용어로 빠진 항목을 말한다
    with pytest.raises(progress_records.MissingRequirement, match="측정 범위"):
        partial = {k: v for k, v in _measured(1362).items() if k != "scope"}
        progress_records.normalize_metrics({"usage_count": partial}, recorded_at=recorded)
    with pytest.raises(progress_records.InvalidProgressRecord, match="지원하지 않는"):
        progress_records.normalize_metrics({"알수없는지표": _measured(1)}, recorded_at=recorded)
    with pytest.raises(progress_records.InvalidProgressRecord, match="미래"):
        future = _measured(1362, days_ago=-3)
        progress_records.normalize_metrics({"usage_count": future}, recorded_at=recorded)

    stored = progress_records.normalize_metrics(
        {"usage_count": _measured(1362), "conversion_rate_pct": _measured(21.4)},
        recorded_at=recorded,
    )
    # 단위·근사 여부의 정본은 서버 한 곳이다 — 요청으로 받지 않는다 (절대 규칙 2)
    assert stored["usage_count"]["unit"] == "건" and stored["usage_count"]["is_proxy"] is False
    assert stored["conversion_rate_pct"]["unit"] == "%" and stored["conversion_rate_pct"]["is_proxy"] is True
    assert stored["usage_count"]["measured_from"] and stored["usage_count"]["source"]


def test_validate_completion_requires_type_specific_evidence():
    """05 §2 — 완료는 위젯 배지·KPI 실행 전환율에 직결되므로 근거 없이 만들어질 수 없다."""
    expansion = {"type": "EXPANSION"}
    incentive = {"type": "INCENTIVE"}

    with pytest.raises(progress_records.MissingRequirement):
        progress_records.validate_completion(expansion, None)
    assert progress_records.validate_completion(
        expansion, {"merchant_registration_id": "4247"})["merchant_registration_id"] == "4247"
    assert progress_records.validate_completion(expansion, EXPANSION_EVIDENCE)["document"]

    with pytest.raises(progress_records.MissingRequirement, match="책임자"):
        progress_records.validate_completion(
            incentive, {k: v for k, v in INCENTIVE_EVIDENCE.items() if k != "owner"})
    with pytest.raises(progress_records.MissingRequirement, match="예산 한도"):
        progress_records.validate_completion(
            incentive, {**INCENTIVE_EVIDENCE, "budget_cap_confirmed": False})
    assert progress_records.validate_completion(incentive, INCENTIVE_EVIDENCE)["owner"]


def test_transaction_conflict_does_not_leave_an_orphan_record():
    _put_incentive("TX-001", created_days_ago=3)
    card = db.get_card("TX-001")
    base = {
        "card_id": "TX-001",
        "recorded_at": _at(1),
        "created_at": _at(1),
        "progress": "추진중",
        "previous_progress": "검토중",
        "progress_changed": True,
        "progress_pct": None,
        "note": "transaction test",
        "blocker": None,
        "next_action": None,
        "owner": None,
        "due_at": None,
        "source": "test",
        "metrics": {},
        "card_snapshot": {"type": "INCENTIVE", "title": "TX-001", "eup": None, "category": None},
    }
    first = {**base, "record_id": "pr_tx_first"}
    second = {**base, "record_id": "pr_tx_second"}
    progress_db.write_record_and_project_card(
        card=card,
        record=first,
        expected_progress="검토중",
        expected_version=0,
        require_verified=False,
        entering_hold=False,
        resuming_hold=False,
    )
    with pytest.raises(db.ConcurrentUpdate):
        progress_db.write_record_and_project_card(
            card=card,
            record=second,
            expected_progress="검토중",
            expected_version=0,
            require_verified=False,
            entering_hold=False,
            resuming_hold=False,
        )
    assert progress_db.get_record("pr_tx_first") is not None
    assert progress_db.get_record("pr_tx_second") is None


def test_report_uses_only_observed_baseline_and_latest_values():
    _put_incentive("RPT-001", created_days_ago=40)
    _put_incentive("RPT-002", created_days_ago=12)

    assert _post("RPT-001", {
        "progress": "검토중", "recorded_at": _at(20), "progress_pct": 10,
        "note": "baseline", "due_at": _date(10),
        "metrics": _metrics(20, usage_count=100, conversion_rate_pct=20, concentration_index=50),
    }).status_code == 201
    assert _post("RPT-001", {
        "progress": "추진중", "recorded_at": _at(15), "progress_pct": 60, "note": "latest",
        "metrics": _metrics(15, usage_count=120, conversion_rate_pct=21.5, concentration_index=45),
    }).status_code == 201

    assert _post("RPT-002", {
        "progress": "검토중", "recorded_at": _at(8), "progress_pct": 20,
        "note": "baseline", "due_at": _date(2),
        "metrics": _metrics(8, usage_count=200, concentration_index=40),
    }).status_code == 201
    assert _post("RPT-002", {
        "progress": "추진중", "recorded_at": _at(5), "progress_pct": 70,
        "note": "running",
    }).status_code == 201
    assert _post("RPT-002", {
        "progress": "완료", "recorded_at": _at(3), "progress_pct": 100,
        "note": "done", "completion_evidence": INCENTIVE_EVIDENCE,
        "metrics": _metrics(3, usage_count=240, concentration_index=38),
    }).status_code == 201

    report = client.get(
        "/api/progress-report",
        params={"from": _date(30), "to": _date(0)},
        headers=AUTH,
    )
    assert report.status_code == 200
    body = report.json()
    assert body["period"]["days"] == 31
    assert body["record_count"] == 5
    assert body["recorded_card_count"] == 2
    assert body["cards_without_records"] == 1       # seed AC-001 has no new-style record
    assert body["status_distribution"]["추진중"] == 1
    assert body["status_distribution"]["완료"] == 1
    assert body["completion"] == {"rate": 0.5, "completed_count": 1, "sample_size": 2}
    assert body["average_progress_pct"] == {"value": 80.0, "sample_size": 2}
    assert body["stale"]["count"] == 1 and body["stale"]["items"][0]["card_id"] == "RPT-001"
    assert body["on_time"] == {"rate": 1.0, "on_time_count": 1, "sample_size": 1}

    usage = body["metric_changes"]["usage_count"]
    assert usage["sample_size"] == 2
    assert usage["baseline_average"] == 150
    assert usage["latest_average"] == 180
    assert usage["delta"] == 30 and usage["relative_change_pct"] == 20
    concentration = body["metric_changes"]["concentration_index"]
    assert concentration["delta"] == -3.5
    assert concentration["improvement"] == 3.5
    assert concentration["lower_is_better"] is True
    conversion = body["metric_changes"]["conversion_rate_pct"]
    assert conversion["sample_size"] == 1
    assert conversion["delta"] == 1.5 and conversion["delta_unit"] == "%p"
    assert conversion["relative_change_pct"] is None


def test_empty_report_never_invents_metric_values():
    body = client.get("/api/progress-report", headers=AUTH).json()
    assert body["record_count"] == 0
    assert body["completion"]["rate"] is None
    for metric in body["metric_changes"].values():
        assert metric["sample_size"] == 0
        assert metric["baseline_average"] is None
        assert metric["latest_average"] is None
        assert metric["delta"] is None
        assert metric["improvement"] is None


def test_historical_report_excludes_cards_created_or_approved_after_end():
    _put_incentive("RPT-OLD", created_days_ago=50)
    _put_incentive("RPT-FUTURE", created_days_ago=5)

    body = client.get(
        "/api/progress-report",
        params={"from": _date(60), "to": _date(30)},
        headers=AUTH,
    ).json()

    assert body["record_count"] == 0
    assert body["recorded_card_count"] == 0
    # RPT-OLD was approved by the historical cutoff. RPT-FUTURE and the
    # recent demo approval did not exist yet and therefore cannot be denominators.
    assert body["cards_without_records"] == 1
