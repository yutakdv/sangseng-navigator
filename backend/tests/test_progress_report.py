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
from app.services import workflow  # noqa: E402
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
        "metrics": {"usage_count": 100, "conversion_rate_pct": 20.0},
        "idempotency_key": "record-once",
    }
    created = _post("AC-001", payload)
    assert created.status_code == 201
    body = created.json()
    assert body["created"] is True
    assert body["card"]["progress"] == "적격성 확인"
    assert body["record"]["progress_pct"] == 30
    assert body["record"]["source"] == "담당자 입력"
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
    assert _post(
        "AC-001",
        {"progress": "완료", "progress_pct": 100, "note": "완료"},
    ).status_code == 201
    assert _post("AC-001", {"progress": "추진중", "note": "완료 역행"}).status_code == 409
    # 같은 완료 상태의 후속 실측/메모는 상태를 되돌리지 않으므로 허용한다.
    assert _post("AC-001", {"progress": "완료", "note": "완료 후 점검"}).status_code == 201


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
        "metrics": {"usage_count": 100, "conversion_rate_pct": 20, "concentration_index": 50},
    }).status_code == 201
    assert _post("RPT-001", {
        "progress": "추진중", "recorded_at": _at(15), "progress_pct": 60,
        "note": "latest", "metrics": {"usage_count": 120, "conversion_rate_pct": 21.5, "concentration_index": 45},
    }).status_code == 201

    assert _post("RPT-002", {
        "progress": "검토중", "recorded_at": _at(8), "progress_pct": 20,
        "note": "baseline", "due_at": _date(2),
        "metrics": {"usage_count": 200, "concentration_index": 40},
    }).status_code == 201
    assert _post("RPT-002", {
        "progress": "추진중", "recorded_at": _at(5), "progress_pct": 70,
        "note": "running",
    }).status_code == 201
    assert _post("RPT-002", {
        "progress": "완료", "recorded_at": _at(3), "progress_pct": 100,
        "note": "done", "metrics": {"usage_count": 240, "concentration_index": 38},
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
