"""B7: 로컬 통합 스모크 — health→dashboard→candidates→generate→decision→progress→simulate→kpi→widget.

표준 실행 (14 문서 T14 — 이후 모든 PR의 스모크 기준):

    docker compose up -d dynamodb
    cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q

원칙:
- LLM은 전 테스트에서 monkeypatch — 실호출 금지(요금·비결정성). 목업은 프롬프트가 아니라
  **요청 스키마**로 분기해 호출부가 기대하는 필드를 정확히 채운다.
- DynamoDB는 DynamoDB Local 전용. 시드 리셋이 테이블을 비우므로 `DYNAMO_ENDPOINT`가 없거나
  로컬을 가리키지 않으면 **실패**시킨다 — 스킵하면 "안 돌았는데 exit 0"이라 스모크 기준이 무의미해진다.
- 테스트는 실데이터(data/processed)를 읽으므로 값을 하드코딩하지 않고 구조·타입·범위만 검증한다.
  문자열을 하드코딩하는 곳은 05 문서가 고정한 계약 문구(가정 기반 전망 등)뿐 — 바뀌면 잡아야 하는 값이다.
- 상태 의존을 없애기 위해 매 테스트 전에 `seed_demo` 재사용으로 `--reset`과 같은 상태로 되돌린다.
"""
import json
import math
import os
import sys
import traceback
import types
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))          # 어느 디렉터리에서 실행해도 `import app`이 되도록

# DynamoDB Local로 인정하는 호스트 — localhost 계열 + docker compose 서비스명(컨테이너 안에서 실행할 때).
# 0.0.0.0은 컨테이너가 전 인터페이스에 바인드했을 때 실제로 쓰이는 표기라 함께 인정한다.
LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "dynamodb"}
RUN_HINT = ("`docker compose up -d dynamodb` 후 "
            "`cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q`")

# 스킵하지 않고 실패시킨다 — 이 스모크는 모든 PR의 통과 기준이라 "안 돌았는데 exit 0"이면 안 된다.
_endpoint = os.environ.get("DYNAMO_ENDPOINT")
if not _endpoint:
    pytest.fail(f"DYNAMO_ENDPOINT가 설정되지 않아 스모크를 실행할 수 없습니다 — {RUN_HINT}", pytrace=False)
if "://" not in _endpoint:
    # 스킴이 없으면 urlparse의 hostname이 None이라("localhost:8001" → scheme='localhost') 아래 로컬
    # 판정이 무조건 실패한다. boto3의 endpoint_url도 스킴을 요구하므로 "로컬이 아님"이 아니라
    # 표기 문제임을 알려주고 멈춘다 — fail-closed는 그대로다.
    pytest.fail(f"DYNAMO_ENDPOINT={_endpoint} 에 스킴이 없습니다 — `http://localhost:8001`처럼 "
                f"스킴을 포함해 지정하세요. {RUN_HINT}", pytrace=False)
if urlparse(_endpoint).hostname not in LOCAL_HOSTS:
    # 시드 리셋이 테이블을 통째로 비우므로 실 AWS 엔드포인트로는 절대 돌리지 않는다.
    pytest.fail(f"DYNAMO_ENDPOINT={_endpoint} 는 DynamoDB Local이 아닙니다 — 이 스모크는 테이블을 "
                f"비우므로 로컬({'/'.join(sorted(LOCAL_HOSTS))})에서만 실행합니다. {RUN_HINT}", pytrace=False)

os.environ.setdefault("AWS_ACCESS_KEY_ID", "local")     # DynamoDB Local은 자격증명 "형식"만 요구
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "local")
os.environ.setdefault("CARDS_TABLE", "sangseng-cards")  # .env의 빈 값이 테이블명을 덮지 않도록 선점
os.environ.setdefault("MUTATION_API_TOKEN", "local-test-mutation-token")

from fastapi.testclient import TestClient        # noqa: E402

from app.main import app                         # noqa: E402  (.env 로드가 app.db 바인딩보다 먼저)
from app import dataload                         # noqa: E402
from app import db                               # noqa: E402
from app import llm                              # noqa: E402
from app.routes import cards as cards_route      # noqa: E402

# 아래 fake_llm 픽스처가 llm.generate_json 을 통째로 갈아끼우므로, 어댑터 자체를 검증하는
# 테스트(§8)를 위해 원본을 미리 잡아 둔다.
REAL_GENERATE_JSON = llm.generate_json
from app.services import cardgen, cards_view, simulate, workflow      # noqa: E402

import seed_demo                                 # noqa: E402

client = TestClient(app, headers={"Authorization": "Bearer local-test-mutation-token"})

# ── 05 문서가 고정한 계약 문구·값 (바뀌면 FE와 어긋난다) ──
ASSUMPTION_NOTE = "가정 기반 전망이며 실제와 다를 수 있음"
INCENTIVE_ASSUMPTION_NOTE = "페이백률-전환율 관계는 실측 데이터가 없어 팀 설정 가정(탄력성)에 기반한 전망"
POLICY_NOTE = "완료된 확충 업종 우선 · 그 외 하이원리조트 거점 직선거리 기준"
EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"]
SCENARIO_RATES = [3, 5, 7]
MANDATORY_INCENTIVE_RISKS = ["예산", "약관", "미구현"]
KST_OFFSET = "+09:00"                                       # 05 §8 시각 표기 — 모든 타임스탬프 KST
# health의 산출물별 보고 대상 (05 §6 산출 JSON). risk_signal·manifest는 선택 입력이라
# data_loaded(필수 AND) 판정에서 빠진다 (risk_signal=07 B4 ⑥ "없으면 컷", manifest=A4 버전 부가 정보).
REQUIRED_DATASETS = ["dashboard", "eup_scores", "candidates", "merchants"]
OPTIONAL_DATASET = "risk_signal"               # 개별 결손 시나리오 테스트용 대표값
OPTIONAL_DATASETS_ALL = {OPTIONAL_DATASET, "manifest"}   # health()가 실제로 순회하는 선택 산출물 전체

# ── LLM 목업 응답 (실호출 금지) ──
# risks·dissent는 05 §2 개정으로 평문이 아니라 **객체**다 — `{text, claim_type, evidence_ids}` /
# `{text, risk_type, evidence_ids}`. 평문으로 두면 서버 검증에 전부 걸려 규칙 폴백으로 떨어지고,
# 목업이 "LLM 응답을 채택한 경로"를 더 이상 재현하지 못한다.
FAKE_COMPARISON = "목업 비교문 — 1순위와 2순위를 비교한 문장입니다."
FAKE_DISSENT = [        # risk_type 3종이 서로 달라야 채택된다 (05 §2 반대 의견)
    {"text": "반대1 가능성", "risk_type": "데이터시점", "evidence_ids": []},
    {"text": "반대2 가능성", "risk_type": "추정방법", "evidence_ids": []},
    {"text": "반대3 가능성", "risk_type": "계절성", "evidence_ids": []},
]
FAKE_AI = {
    "adjusted": True,
    "ai_rank_target": "영월군 소매점",       # 시드 카드(카페=추진중, 음식점=pending)와 겹치지 않는 타깃
    "comparison": FAKE_COMPARISON,
    "reasons": ["목업 근거 1", "목업 근거 2"],
    "risks": [{"text": "목업 리스크 1", "claim_type": "비정량리스크", "evidence_ids": []}],
    "expected_effect": "목업 예상 효과",      # 고정 문구 없음 — 서버가 붙이는지 확인용
    "confidence": "상",
    "dissent": FAKE_DISSENT,
}
# INCENTIVE는 스키마가 갈라져 LLM이 비정량 리스크만 쓴다 (INCENTIVE_AI_SCHEMA).
# 필수 리스크 3종(예산·약관·미구현) 키워드를 일부러 피해 서버 보충 경로가 그대로 살아 있게 한다.
FAKE_INCENTIVE_RISKS = [
    {"text": "목업 인센티브 리스크", "claim_type": "비정량리스크", "evidence_ids": []},
]
FAKE_NARRATIVE = "목업 서술입니다. 가정에 기반한 예상 수치입니다."
# 위젯 blurb 목업은 두지 않는다 — 위젯은 LLM을 호출하지 않고 routes/widget.py `_fallback_blurb`의
# 결정론 문구만 쓴다(§7 위젯 테스트가 그 문구를 그대로 단언한다).


class FakeLLM:
    """`app.llm.generate_json` 대체 — 요청 스키마의 properties로 호출부를 식별해 응답을 맞춘다.

    속성 3개를 테스트에서 갈아끼워 "형식은 맞는데 내용이 틀린" 응답도 재현한다
    (스키마는 지키므로 LLM 예외가 아니라 **호출부의 내용 가드**가 걸리는 경로).
    """

    def __init__(self):
        self.calls = []
        self.attempts = []                                          # 호출부별 재시도 설정 (지연 상한 검증용)
        self.ai_rank_target = FAKE_AI["ai_rank_target"]
        self.narrative = FAKE_NARRATIVE

    def __call__(self, system, user, schema, schema_name="result", timeout=None, attempts=2):
        self.calls.append(schema_name)
        self.attempts.append(attempts)
        props = schema.get("properties", {})
        if "narrative" in props:                                    # cards.simulate
            return {"narrative": self.narrative}
        if set(props) == {"risks"}:                                 # cardgen (INCENTIVE_AI_SCHEMA)
            return {"risks": list(FAKE_INCENTIVE_RISKS)}
        return {**FAKE_AI, "ai_rank_target": self.ai_rank_target}   # cardgen (CARD_AI_SCHEMA)


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch):
    monkeypatch.delenv("DEMO_READ_ONLY", raising=False)
    fake = FakeLLM()
    monkeypatch.setattr(llm, "generate_json", fake)
    return fake


@pytest.fixture(scope="session")
def table():
    try:
        seed_demo.ensure_table()
    except Exception as exc:
        raise RuntimeError(
            f"DynamoDB Local({os.environ['DYNAMO_ENDPOINT']})에 연결할 수 없습니다 — "
            "`docker compose up -d dynamodb` 후 다시 실행하세요") from exc


@pytest.fixture(autouse=True)
def seeded(table):
    """매 테스트 전 `seed_demo.py --reset`과 같은 상태(데모 카드 3장)로 되돌린다."""
    seed_demo.clear_table()
    for card in seed_demo.demo_cards():
        db.put_card(card)


def _cards():
    res = client.get("/api/cards")
    assert res.status_code == 200
    return res.json()["cards"]


def _generate(card_type="EXPANSION"):
    return client.post("/api/cards/generate", json={"type": card_type})


# 05 §2 결정 요청 — actor_id는 pydantic 레벨 필수이고, 반려·보류와 저신뢰 승인에는 reason이 필요하다.
ACTOR = {"actor_id": "test.operator", "actor_name": "테스트 담당자"}
DECISION_REASON = "테스트에서 남기는 결정 사유"


def _decide(cid, decision, **extra):
    """결정 요청 — 계약상 항상 필요한 담당자 정보를 채워 보낸다.

    사유가 필수인 경로(반려·보류·저신뢰 승인)는 호출부가 `reason=`을 명시하고, 필수 여부 자체를
    검증하는 테스트는 이 헬퍼를 쓰지 않고 body를 직접 만든다.
    """
    # 승인에는 데이터 보호·근거 검증·편향/윤리 영향 확인이 필수다. 개별 테스트가 누락 경로를
    # 재현하지 않는 한 정상 승인 헬퍼는 실제 UI와 같은 확인값을 채운다.
    if decision == "approved" and "safety_reviewed" not in extra:
        extra["safety_reviewed"] = True
    return client.post(f"/api/cards/{cid}/decision", json={"decision": decision, **ACTOR, **extra})


def _record(cid, **payload):
    """추진 기록 저장 — note는 필수라 기본값을 채운다 (05 §2 ProgressRecord 입력)."""
    body = {"note": "테스트 추진 기록", **payload}
    return client.post(f"/api/cards/{cid}/progress-records", json=body)


def _measured(value, *, source="테스트 관측 출처", scope="테스트 측정 범위", days_back=1):
    """관측값 1건 — 값만으로는 저장되지 않는다(기간·출처·범위 필수, 05 §2)."""
    end = datetime.now(db.KST).date() - timedelta(days=days_back)
    return {"value": value,
            "measured_from": (end - timedelta(days=30)).isoformat(),
            "measured_to": end.isoformat(),
            "source": source, "scope": scope}


def _complete(cid, evidence, **payload):
    """완료 기록 — 빠른 상태 변경으로는 만들 수 없고 증빙이 필수다 (05 §2·§8)."""
    return _record(cid, progress="완료", progress_pct=100, completion_evidence=evidence, **payload)


def _first_merchant(eup, category):
    """실데이터에서 (읍×업종) 가맹점 1곳 — 배지 근거가 되는 merchant_id를 하드코딩하지 않는다."""
    return next(m for m in dataload.load("merchants")
                if m["eup"] == eup and m["category"] == category)


# 완료 증빙은 타입별로 요구가 다르다 (05 §2) — INCENTIVE는 적용 기간·책임자·예산 한도 확인이 전부 필수
INCENTIVE_EVIDENCE = {"applied_from": "2026-09-01", "applied_to": "2026-11-30",
                      "owner": "지역상생팀 테스트 담당자", "budget_cap_confirmed": True}
DOCUMENT_EVIDENCE = {"document": "가맹 계약서 사본 (테스트)"}


def _verify_all(cid="AC-001"):
    return client.post(
        f"/api/cards/{cid}/verification",
        json={"checks": [{"label": label, "status": "verified"}
                         for label in workflow.REQUIRED_ELIGIBILITY_CHECKS]},
    )


def _put_expansion(cid, eup, category, status="pending", progress=None):
    """최소 EXPANSION 카드 직접 put — 시드로는 못 만드는 타깃·상태 조합이 필요할 때만 쓴다."""
    db.put_card({"id": cid, "type": "EXPANSION", "status": status, "progress": progress,
                 "title": f"{eup} {category} 업종 가맹점 확충",
                 "target": {"eup": eup, "category": category},
                 "created_at": db.now_iso(),
                 "decided_at": None if status == "pending" else db.now_iso(), "events": []})


def _break_llm(monkeypatch):
    """LLM 호출을 예외로 만든다 — 키 만료·쿼터 초과와 같은 경로 (llm.LLMError로 감싸이기 전 단계)."""
    def boom(*args, **kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(llm, "generate_json", boom)


# ── 1. health / 정적 서빙 ────────────────────────────────────────────────

def test_health_reports_dataset_breakdown():
    """05 §5 — 기존 키(ok·data_loaded)를 유지한 채 산출물별 로드 여부를 함께 보고한다."""
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()

    assert body["ok"] is True and body["data_loaded"] is True
    assert set(body["datasets"]) == set(REQUIRED_DATASETS) | OPTIONAL_DATASETS_ALL
    assert all(v is True for v in body["datasets"].values())    # 커밋된 data/processed 기준


def test_health_data_loaded_counts_required_datasets_only(monkeypatch):
    """data_loaded는 필수 4종의 AND — 선택 산출물(risk_signal) 결손으로는 내려가지 않는다 (07 B4 ⑥)."""
    real_load = dataload.load

    def _missing(name):
        def _load(n):
            if n == name:
                raise FileNotFoundError(n)
            return real_load(n)
        return _load

    monkeypatch.setattr(dataload, "load", _missing(OPTIONAL_DATASET))
    body = client.get("/api/health").json()
    assert body["datasets"][OPTIONAL_DATASET] is False and body["data_loaded"] is True

    monkeypatch.setattr(dataload, "load", _missing("merchants"))
    body = client.get("/api/health").json()
    assert body["datasets"]["merchants"] is False and body["data_loaded"] is False
    assert body["ok"] is True          # 엔드포인트 자체는 200 — 결손은 보고만 하고 죽지 않는다


def test_health_ready_returns_200_when_all_required_datasets_present():
    """ALB 대상그룹 전용 경로 — 정상 이미지에서는 200."""
    res = client.get("/api/health/ready")
    assert res.status_code == 200
    assert res.json() == {"ready": True}


def test_health_ready_returns_503_when_required_dataset_missing(monkeypatch):
    """정적 JSON이 빠진 이미지가 healthy로 판정되면 서킷 브레이커가 롤백하지 못하고
    고장난 버전이 무중단으로 전량 배포된다 — 그래서 이 경로는 반드시 실패해야 한다."""
    real_load = dataload.load

    def _load(name):
        if name == "merchants":
            raise FileNotFoundError(name)
        return real_load(name)

    monkeypatch.setattr(dataload, "load", _load)
    res = client.get("/api/health/ready")
    assert res.status_code == 503
    assert "merchants" in res.json()["detail"]


def test_health_ready_ignores_optional_dataset(monkeypatch):
    """risk_signal은 '없으면 컷'인 선택 입력이라 ready를 내리지 않는다 (07 B4 ⑥)."""
    real_load = dataload.load

    def _load(name):
        if name == OPTIONAL_DATASET:
            raise FileNotFoundError(name)
        return real_load(name)

    monkeypatch.setattr(dataload, "load", _load)
    assert client.get("/api/health/ready").status_code == 200


def test_dashboard_returns_real_data():
    """05 §1 — 값이 아니라 구조·타입·범위로 검증 (실데이터는 파이프라인 재실행마다 바뀐다)."""
    res = client.get("/api/dashboard")
    assert res.status_code == 200
    body = res.json()

    conv = body["conversion"]
    assert isinstance(conv["headline_rate"], (int, float)) and conv["headline_rate"] > 0
    assert conv["is_proxy"] is True                     # 절대 규칙 2 — 근사 지표 배지의 근거
    assert "입장 연인원" in conv["proxy_note"]           # 05 §1 — 배지만으로 못 막는 오인 차단 문구
    assert "29.4%" in conv["proxy_note"]                # 금액 기준 공식 비율과 다른 지표임을 고지
    assert conv["monthly"] and all(
        {"month", "local_uses", "visitors", "rate"} <= set(m) for m in conv["monthly"])

    for key in ("concentration", "category_dispersion"):
        assert 0 <= body[key]["index"] <= 100
        assert body[key]["monthly"] and all(0 <= m["index"] <= 100 for m in body[key]["monthly"])

    assert {r["region"] for r in body["region_share"]} == set(simulate.REGIONS)
    assert abs(sum(r["share"] for r in body["region_share"]) - 1) < 0.05
    assert body["category_share"] and all(0 <= c["share"] <= 1 for c in body["category_share"])


def test_candidates_merges_scores_and_merchants():
    """05 §1 — eup_scores + candidates + merchants 병합, 근거 필드 상시 포함(감사 가능성)."""
    res = client.get("/api/candidates")
    assert res.status_code == 200
    body = res.json()

    ranking = body["eup_ranking"]
    assert [r["rank"] for r in ranking] == list(range(1, len(ranking) + 1))
    assert body["selected_eups"] and set(body["selected_eups"]) <= {r["eup"] for r in ranking}

    cands = body["candidates"]
    assert 1 <= len(cands) <= 5
    required = {"id", "eup", "category", "lat", "lng", "name", "score",
                "gap", "proximity", "saturation", "nearby_merchants", "nearby_stores",
                "road_distance_km", "road_minutes"}    # 도로 접근성 병기 (05 §1, 값은 null 가능)
    assert all(required <= set(c) for c in cands)
    scores = [c["score"] for c in cands]
    assert scores == sorted(scores, reverse=True)

    assert body["merchants"]
    assert all({"name", "category", "eup", "address", "lat", "lng"} <= set(m)
               for m in body["merchants"][:20])


def test_risk_signal_serves_artifact_verbatim():
    """05 §1 — 대시보드 요인 카드(13 §2-15)가 쓰는 under2y_ratio의 서빙 경로.

    응답은 산출 JSON과 **완전히 같아야** 한다 — 감싸거나 필드를 더하면 파이프라인 산출물과
    API 응답이 서로 다른 형태가 된다 (05 §6).
    """
    res = client.get("/api/risk-signal")
    assert res.status_code == 200
    assert res.json() == dataload.load("risk_signal")               # 가공 없이 그대로

    rows = res.json()
    assert isinstance(rows, list) and rows                           # 최상위가 배열 (05 §6)
    assert all({"sigungu", "under2y_ratio"} == set(r) for r in rows)
    assert all(0 <= r["under2y_ratio"] <= 1 for r in rows)


# ── 2. 카드 목록 (seed --reset 상태) ─────────────────────────────────────

def test_cards_list_reflects_demo_seed():
    cards = _cards()
    assert len(cards) == 3
    assert [c["id"] for c in cards] == ["AC-002", "INC-001", "AC-001"]   # created_at 내림차순

    assert len(client.get("/api/cards", params={"type": "EXPANSION"}).json()["cards"]) == 2
    pending = client.get("/api/cards", params={"status": "pending"}).json()["cards"]
    assert {c["id"] for c in pending} == {"AC-002", "INC-001"}

    one = client.get("/api/cards/AC-001")
    assert one.status_code == 200 and one.json()["card"]["progress"] == "후보 접촉·검토 시작"
    proposal = client.get("/api/cards/AC-002").json()["card"]
    assert proposal["confidence"] == "하"  # 동일 업종 상가 표본 2곳 — 보수적 신뢰도
    assert proposal["ai"]["grounding"]["status"] == "verified"
    assert proposal["candidate_verification"]["status"] == "unverified"
    assert client.get("/api/cards/AC-999").status_code == 404


def test_cards_filter_combines_type_and_status():
    """05 §2 — `?type=`·`?status=`는 각각도 조합도 걸린다. 결과 0건도 빈 배열 200."""
    def ids(**params):
        res = client.get("/api/cards", params=params)
        assert res.status_code == 200
        return {c["id"] for c in res.json()["cards"]}

    assert ids(type="EXPANSION", status="pending") == {"AC-002"}
    assert ids(type="EXPANSION", status="approved") == {"AC-001"}
    assert ids(type="INCENTIVE", status="pending") == {"INC-001"}
    assert ids(type="INCENTIVE", status="approved") == set()
    assert ids(status="rejected") == set()
    # 쿼리 이름 `type`은 05 §2 계약이고 파이썬 인자명(card_type)은 내부 사정이다 — 인자명이
    # 쿼리로 새면 alias가 빠진 것이라 FE의 `?type=`이 조용히 무시된다.
    assert ids(card_type="INCENTIVE") == {"AC-001", "AC-002", "INC-001"}


# ── 3. generate (LLM monkeypatch) ────────────────────────────────────────

def test_generate_expansion_creates_pending_card(fake_llm):
    res = _generate("EXPANSION")
    assert res.status_code == 201
    card = res.json()["card"]
    assert fake_llm.calls == ["action_card"]
    assert fake_llm.attempts == [2]                                   # 재시도 기본값 유지 (llm.generate_json attempts=2)

    assert card["id"] == "AC-003" and card["type"] == "EXPANSION"
    assert card["status"] == "pending" and card["progress"] is None   # 절대 규칙 4 — AI는 제안만
    # 정량 1위 음식점은 진행 중, 2위 소매점은 승인 대기라 서버가 선택 가능한 후보 1위(원 3위)를 고른다.
    # target은 05 §2 개정으로 후보 상가 안정 키와 가맹 확인 ID를 함께 싣는다.
    chosen = next(c for c in dataload.load("candidates")
                  if c["eup"] == "영월군" and c["category"] == "숙박업")
    assert card["target"] == {
        "eup": "영월군", "category": "숙박업",
        "candidate_store_id": cardgen.candidate_store_key(chosen),
        "verified_merchant_id": None,       # 완료 증빙 전까지 null이 정상 상태
    }
    assert "@" in card["target"]["candidate_store_id"]                # 좌표까지 포함한 안정 키
    assert card["target"]["candidate_store_id"] != chosen["id"]      # CAND-00N(순위 슬롯)이 아니다
    assert card["ai_rank"] == 1 and card["score_rank"] != 1 and card["ai"]["adjusted"] is True
    assert card["ai"]["comparison"] != FAKE_COMPARISON                # LLM 자유서술은 그대로 노출하지 않는다
    assert "Score 0.48" in card["ai"]["comparison"]                  # 정본 후보 수치로 재생성
    assert card["ai"]["grounding"]["selection_method"] == "deterministic_highest_available_score"
    assert card["ai"]["grounding"]["status"] == "verified"
    # 설명 출처와 화면 문장이 같은 사실을 말하는지 (05 §2 — 이 카드는 LLM 응답을 실제로 채택했고
    # 근거 ID 대조·스코프 단정 검사까지 통과했다)
    assert card["ai"]["grounding"]["narrative_status"] == "ai_generated_evidence_checked"
    assert card["ai"]["grounding"]["explanation_source"] == "llm"
    assert {"evidence_ids", "claim_scope", "dissent_diversity"} <= set(card["ai"]["grounding"]["checks"])
    assert cardgen.NARRATIVE_NOTE["llm"] in card["ai"]["reasons"]
    assert card["candidate_verification"]["status"] == "unverified"
    assert card["ai"]["risks"]                                        # A-1 규칙 — 리스크 ≥1
    assert ASSUMPTION_NOTE in card["ai"]["expected_effect"]           # 절대 규칙 3 — 고정 문구 보장
    assert card["sources"] == EXPANSION_SOURCES
    assert card["scenarios"] is None and card["decided_at"] is None
    assert [e["action"] for e in card["events"]] == ["generated"]

    ranking = card["ai"]["original_ranking"]                          # 절대 규칙 5 — 정량 순위 병기
    assert [r["rank"] for r in ranking] == list(range(1, len(ranking) + 1))
    assert all({"rank", "candidate", "score"} == set(r) for r in ranking)

    # 파생 필드는 카드를 반환하는 모든 응답에 실린다 (05 §2 allowed_next_progress)
    assert card["allowed_next_progress"] and all(
        {"value", "allowed"} <= set(option) for option in card["allowed_next_progress"])


def test_generate_hands_target_weekday_pattern_to_the_llm(monkeypatch):
    """AI 입력 ⑧ — 타깃 요일 패턴(참고용)이 usage_daily 집계에서 그대로 조립된다 (05 §6).

    시드 상태의 확정 타깃(영월군 숙박업)은 하이원 실적 0인 공백 업종이라 읍 전 업종
    패턴 폴백이 **기본 경로**다 — 폴백 사실이 집계_대상 라벨에 명시되는지까지 본다.

    읍 전 업종 합계는 업종 셀이 아니라 `daily_total`(지역 총합)에서 나와야 한다 — 소표본
    억제(P10)로 영월군 카페·편의점 셀이 None이라, 셀을 더하면 읍 합계가 17% 낮아진다.
    """
    captured = {}

    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        # B2: user 메시지가 <data>...</data>로 감싸이므로 안쪽 JSON만 파싱한다.
        captured["payload"] = json.loads(user.split("<data>", 1)[1].rsplit("</data>", 1)[0])
        return dict(FAKE_AI)

    monkeypatch.setattr(llm, "generate_json", spy)
    assert _generate("EXPANSION").status_code == 201

    signal = captured["payload"]["8_타깃_요일_패턴(참고용)"]
    daily = dataload.load("usage_daily")
    by_cat = daily["weekday_category"]["영월군"]
    assert sum(by_cat["숙박업"]) == 0 and "전 업종" in signal["집계_대상"]   # 폴백 경로가 기본
    assert by_cat["편의점"] is None                                      # 억제 셀이 실제로 비어 있다
    totals = cardgen.eup_weekday_totals(daily, "영월군", by_cat)
    open_cells = [sum(c[i] for c in by_cat.values() if isinstance(c, list)) for i in range(7)]
    assert sum(totals) > sum(open_cells)                                 # 억제분이 빠지지 않았다
    expected = {
        label: round(totals[i] / daily["weekday_days"][i], 1)
        for i, label in enumerate(daily["weekday_labels"])
    }
    assert signal["요일별_하루평균_건수"] == expected                     # 입력에 없는 수치를 만들지 않는다
    assert signal["최대_요일"] in daily["weekday_labels"]


def test_generate_survives_missing_usage_daily(monkeypatch):
    """usage_daily 부재 시 입력 ⑧만 빠지고 생성은 정상 — ⑦ risk_signal과 같은 실패 내성."""
    captured = {}

    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        # B2: user 메시지가 <data>...</data>로 감싸이므로 안쪽 JSON만 파싱한다.
        captured["payload"] = json.loads(user.split("<data>", 1)[1].rsplit("</data>", 1)[0])
        return dict(FAKE_AI)

    monkeypatch.setattr(llm, "generate_json", spy)
    real_load = dataload.load

    def load_without_daily(name):
        if name == "usage_daily":
            raise FileNotFoundError(name)
        return real_load(name)

    monkeypatch.setattr(dataload, "load", load_without_daily)
    assert _generate("EXPANSION").status_code == 201
    assert not any(key.startswith("8_") for key in captured["payload"])


def test_generate_expansion_deduplicates_immediate_retry():
    """버튼/네트워크의 즉시 재전송은 최근 알고리즘 생성 카드를 200으로 재사용한다."""
    first = _generate("EXPANSION")
    assert first.status_code == 201
    second = _generate("EXPANSION")
    assert second.status_code == 200
    assert second.json()["card"]["id"] == first.json()["card"]["id"]
    assert len(_cards()) == 4


def test_generate_skips_target_already_in_progress(fake_llm):
    """LLM이 어떤 타깃 문자열을 내도 서버가 진행 중인 업무를 제외한 정량 최상위를 선택한다."""
    fake_llm.ai_rank_target = "영월군 카페"
    card = _generate("EXPANSION").json()["card"]

    assert (card["target"]["eup"], card["target"]["category"]) == ("영월군", "숙박업")
    assert card["ai"]["comparison"] != FAKE_COMPARISON       # 타깃-사유 불일치 방지: 텍스트까지 교체
    assert card["ai"]["risks"] and card["ai"]["original_ranking"]
    assert ASSUMPTION_NOTE in card["ai"]["expected_effect"]


def test_generate_skips_target_already_under_review(fake_llm):
    """승인 후 검토중인 지역×업종도 활성 Work Item이므로 새 카드로 복제하지 않는다."""
    _put_expansion("AC-090", "영월군", "숙박업", status="approved", progress="검토중")
    fake_llm.ai_rank_target = "영월군 숙박업"

    card = _generate("EXPANSION").json()["card"]

    assert (card["target"]["eup"], card["target"]["category"]) == ("삼척시", "편의점")
    assert card["ai"]["grounding"]["status"] == "verified"


def test_generate_returns_409_when_every_candidate_is_blocked(fake_llm):
    """전 후보에 진행 중인 업무가 있고 승인 대기 카드도 없으면 결론은 '제안할 카드 없음' — 409.

    후보 하나를 골라 되돌아가면 A-1이 금지한 타깃의 카드가 저장되므로, 조용한 폴백이 아니라
    에러가 정답이다.
    """
    # 시드의 유일한 승인 대기 카드를 치운다 — 남아 있으면 아래 200 경로로 빠진다
    db.put_card({**db.get_card("AC-002"), "status": "rejected", "decided_at": db.now_iso()})
    for i, cand in enumerate(dataload.load("candidates"), start=100):
        _put_expansion(f"AC-{i}", cand["eup"], cand["category"],
                       status="approved", progress="추진중")
    before = {c["id"] for c in _cards()}

    res = _generate("EXPANSION")
    assert res.status_code == 409
    assert fake_llm.calls == []                     # 가용성 판정이 LLM 호출보다 앞선다 (12초 낭비 방지)
    assert {c["id"] for c in _cards()} == before    # 새 카드도, 덮어쓴 카드도 없다


def test_generate_returns_existing_pending_card_when_candidates_exhausted(fake_llm):
    """후보가 소진된 이유가 '승인 대기 카드'면 409가 아니라 그 카드를 200으로 돌려준다 (05 §8).

    심사위원이 버튼을 두 번째로 누르는 상황이 정확히 이 경로다 — 첫 클릭이 만든 pending 카드가
    마지막 후보를 차지한다. 그때 409만 주면 대표 AI 기능이 '제안할 후보가 없습니다'로만 보인다.
    dedupe 창(60초) 밖에서도 성립해야 하므로 생성 시각을 창 밖으로 밀어 두고 확인한다.
    """
    for i, cand in enumerate(dataload.load("candidates"), start=100):
        _put_expansion(f"AC-{i}", cand["eup"], cand["category"],
                       status="approved", progress="추진중")
    stale = datetime.now(db.KST) - timedelta(seconds=cardgen.GENERATION_DEDUPE_SECONDS + 60)
    db.put_card({**db.get_card("AC-002"), "created_at": stale.isoformat(timespec="seconds")})
    before = {c["id"] for c in _cards()}

    res = _generate("EXPANSION")
    assert res.status_code == 200                   # 신규 생성이 아니므로 201이 아니다
    assert res.json()["card"]["id"] == "AC-002"   # 시드의 승인 대기 카드
    assert fake_llm.calls == []
    assert {c["id"] for c in _cards()} == before    # 새 카드는 만들지 않는다


def test_generate_does_not_overwrite_non_sequential_ids(fake_llm):
    """비순차 ID가 섞여 있어도 다음 ID는 **최대 순번+1** (05 §8).

    시드(AC-001·AC-002)에 AC-004를 더하면 AC- 카드가 3장이라 옛 '개수+1' 방식은 이미 존재하는
    AC-004를 다시 내주고, put_card가 그 카드를 조용히 덮어쓴다. 그 최소 사례를 그대로 재현한다.
    """
    _put_expansion("AC-004", "태백시", "편의점")     # candidates.json 밖 타깃 = 중복 가드·가용성과 무관
    before = client.get("/api/cards/AC-004").json()["card"]

    res = _generate("EXPANSION")
    assert res.status_code == 201
    assert res.json()["card"]["id"] == "AC-005"

    kept = client.get("/api/cards/AC-004").json()["card"]
    assert kept == before                            # 같은 ID에 다른 카드가 덮이지 않았다
    assert {c["id"] for c in _cards()} == {"AC-001", "AC-002", "INC-001", "AC-004", "AC-005"}


def test_card_id_counter_is_atomic_under_concurrency():
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(lambda _: db.next_card_id("AC-"), range(8)))
    assert len(ids) == len(set(ids)) == 8
    assert sorted(int(cid.removeprefix("AC-")) for cid in ids) == list(range(3, 11))


def test_scan_all_follows_last_evaluated_key(monkeypatch):
    class PagedTable:
        def __init__(self):
            self.calls = []

        def scan(self, **kwargs):
            self.calls.append(kwargs)
            if not kwargs:
                return {"Items": [{"id": "AC-001"}], "LastEvaluatedKey": {"id": "AC-001"}}
            return {"Items": [{"id": "AC-002"}]}

    fake = PagedTable()
    monkeypatch.setattr(db, "_table", fake)
    assert [item["id"] for item in db._scan_all()] == ["AC-001", "AC-002"]
    assert fake.calls == [{}, {"ExclusiveStartKey": {"id": "AC-001"}}]


def test_generate_incentive_builds_scenarios(fake_llm):
    dup = _generate("INCENTIVE")                            # 시드의 pending INC-001이 그대로 반환
    assert dup.status_code == 200 and dup.json()["card"]["id"] == "INC-001"

    assert _decide("INC-001", "rejected", reason=DECISION_REASON).status_code == 200
    res = _generate("INCENTIVE")
    assert res.status_code == 201
    card = res.json()["card"]

    assert card["id"] == "INC-002" and card["target"] is None
    assert card["score_rank"] is None and card["ai_rank"] is None
    assert [s["rate"] for s in card["scenarios"]] == SCENARIO_RATES
    assert all(len(s["delta_pp"]) == 2 and s["budget_note"] for s in card["scenarios"])
    assert card["selected_rate"] is None                    # 승인 시점에만 확정 (05 §2)
    assert card["assumption_note"] == INCENTIVE_ASSUMPTION_NOTE
    assert card["ai"]["adjusted"] is False and card["ai"]["original_ranking"] is None
    for keyword in MANDATORY_INCENTIVE_RISKS:               # A-3 필수 리스크 3종 보충
        assert any(keyword in r for r in card["ai"]["risks"]), keyword
    # INCENTIVE는 LLM이 비정량 리스크만 쓴다(INCENTIVE_AI_SCHEMA) — 그 문장은 채택되고,
    # 비교문·근거·예상 효과는 서버가 시나리오 상수로 만든다 (05 §2).
    assert FAKE_INCENTIVE_RISKS[0]["text"] in card["ai"]["risks"]
    assert FAKE_COMPARISON not in card["ai"]["comparison"]
    assert card["confidence"] == "중"                       # 서버 고정 — LLM 자기평가를 쓰지 않는다
    mid = next(s for s in cardgen.SCENARIOS if s["rate"] == 5)
    assert f"{mid['delta_pp'][0]}~{mid['delta_pp'][1]}%p" in card["ai"]["comparison"]
    assert f"{mid['delta_pp'][0]}~{mid['delta_pp'][1]}%p" in card["ai"]["expected_effect"]


# ── 3b. dissent(반대 의견) — 기존 카드 생성 호출의 CARD_AI_SCHEMA 확장 (B1) ──────────────


def test_card_carries_three_dissent_points(fake_llm):
    """LLM이 검증을 통과하는 객체 3개를 주면 text만 뽑아 채택하고 출처를 'llm'으로 남긴다."""
    card = _generate("EXPANSION").json()["card"]
    assert card["ai"]["dissent"] == [d["text"] for d in FAKE_DISSENT]
    assert len(card["ai"]["dissent"]) == 3
    assert card["ai"]["grounding"]["dissent_source"] == "llm"
    assert "dissent_diversity" in card["ai"]["grounding"]["checks"]


def test_dissent_falls_back_when_llm_is_down(monkeypatch):
    """LLM 호출 자체가 실패하면 dissent도 고정 규칙 문구로 대체된다 (explanation_source와 같은 결)."""
    _break_llm(monkeypatch)
    card = _generate("EXPANSION").json()["card"]
    assert card["ai"]["dissent"] == list(cardgen.DISSENT_FALLBACK)
    assert card["ai"]["grounding"]["dissent_source"] == "rule_fallback"


def test_dissent_falls_back_when_llm_returns_wrong_shape(monkeypatch):
    """LLM 호출은 성공했지만 dissent가 문자열 3개가 아니면(개수 부족·빈 문자열) 규칙 문구로 대체된다.

    explanation_source 자체는 'llm'로 남는다 — 실패한 것은 dissent 필드의 내용 가드뿐이다.
    """
    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        return {**FAKE_AI, "dissent": [FAKE_DISSENT[0]]}

    monkeypatch.setattr(llm, "generate_json", spy)
    card = _generate("EXPANSION").json()["card"]
    assert card["ai"]["dissent"] == list(cardgen.DISSENT_FALLBACK)
    assert card["ai"]["grounding"]["dissent_source"] == "rule_fallback"
    assert card["ai"]["grounding"]["explanation_source"] == "llm"      # 본문 설명은 LLM 응답을 그대로 채택

    def spy_blank(system, user, schema, schema_name="result", timeout=None, attempts=2):
        blank = [{**d, "text": text} for d, text in zip(FAKE_DISSENT, ("", "  ", "정상 문장"))]
        return {**FAKE_AI, "dissent": blank}

    monkeypatch.setattr(llm, "generate_json", spy_blank)
    card = _generate("EXPANSION").json()["card"]
    assert card["ai"]["dissent"] == list(cardgen.DISSENT_FALLBACK)
    assert card["ai"]["grounding"]["dissent_source"] == "rule_fallback"


def test_dissent_falls_back_when_every_point_names_the_same_risk(monkeypatch):
    """05 §2 — 세 항목의 risk_type이 서로 다르지 않으면 반대 '관점'이 아니라 같은 말의 반복이다.

    형식(3개·비어 있지 않음)만 보던 검사로는 걸리지 않는 출력이라 별도 경로로 확인한다.
    """
    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        same = [{**d, "risk_type": "데이터시점"} for d in FAKE_DISSENT]
        return {**FAKE_AI, "dissent": same}

    monkeypatch.setattr(llm, "generate_json", spy)
    card = _generate("EXPANSION").json()["card"]
    assert card["ai"]["dissent"] == list(cardgen.DISSENT_FALLBACK)
    assert card["ai"]["grounding"]["dissent_source"] == "rule_fallback"


def test_dissent_falls_back_when_another_category_is_dragged_in(monkeypatch):
    """05 §2 — 대상 업종과 무관한 표시 업종을 경쟁 상대로 끌어오면 통째 규칙 문구로 대체한다.

    시드 상태의 확정 타깃은 영월군 **숙박업**이므로, 다른 후보 업종(음식점)을 언급하는 순간
    '이 제안이 틀릴 수 있는 이유'가 아니라 무관한 서술이 된다.
    """
    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        off_topic = [{**FAKE_DISSENT[0], "text": "인근 음식점 수요가 더 클 가능성이 있습니다."},
                     FAKE_DISSENT[1], FAKE_DISSENT[2]]
        return {**FAKE_AI, "dissent": off_topic}

    monkeypatch.setattr(llm, "generate_json", spy)
    card = _generate("EXPANSION").json()["card"]
    assert (card["target"]["eup"], card["target"]["category"]) == ("영월군", "숙박업")
    assert card["ai"]["dissent"] == list(cardgen.DISSENT_FALLBACK)
    assert card["ai"]["grounding"]["dissent_source"] == "rule_fallback"


def test_numeric_claim_without_evidence_id_is_discarded(monkeypatch):
    """05 §2 — `정본수치인용`인데 근거 ID가 없는 문장이 가장 위험하다(대조할 대상이 없다).

    그 문장만 폐기하고 근거 ID가 실린 문장은 남는다 — dissent처럼 통째 대체하지 않는다.
    폐기 후 남는 것이 없어도 서버 필수 리스크가 카드를 비게 두지 않는다.
    """
    grounded_text = "반경 500m 안에 동일 업종 하이원포인트 가맹점이 없어 초기 이용 흐름을 예측하기 어려울 가능성"
    ungrounded_text = "인근 상권 매출이 3배 높다는 점이 위험 요인"
    unknown_text = "존재하지 않는 근거를 인용한 문장"

    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        return {**FAKE_AI, "risks": [
            {"text": grounded_text, "claim_type": "정본수치인용",
             "evidence_ids": ["CAND-003.nearby_merchants"]},
            {"text": ungrounded_text, "claim_type": "정본수치인용", "evidence_ids": []},
            {"text": unknown_text, "claim_type": "정본수치인용", "evidence_ids": ["CAND-777"]},
        ]}

    monkeypatch.setattr(llm, "generate_json", spy)
    risks = _generate("EXPANSION").json()["card"]["ai"]["risks"]

    assert grounded_text in risks               # 요청에 실제로 보낸 근거 ID라 살아남는다
    assert ungrounded_text not in risks         # 수치를 인용한다면서 근거가 없다
    assert unknown_text not in risks            # 요청에 없던 ID를 지어냈다
    assert risks                                # 서버 필수 리스크가 남아 카드가 비지 않는다


def test_new_business_wording_is_discarded(monkeypatch):
    """05 §2 — 후보는 이미 영업 중인 상가라 '창업·신설'로 읽히는 문장은 폐기한다."""
    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        return {**FAKE_AI, "risks": [
            {"text": "신규 창업 직후 고객 확보가 늦어질 가능성",
             "claim_type": "비정량리스크", "evidence_ids": []},
            {"text": "이 지역 최초의 가맹점이라 참고할 실적이 없음",
             "claim_type": "비정량리스크", "evidence_ids": []},
        ]}

    monkeypatch.setattr(llm, "generate_json", spy)
    risks = _generate("EXPANSION").json()["card"]["ai"]["risks"]

    assert not any("창업" in risk for risk in risks)
    assert not any("최초" in risk for risk in risks)
    assert risks


def test_incentive_card_has_rule_based_dissent(fake_llm):
    """INCENTIVE는 시나리오가 서버 고정값이라 dissent도 LLM에 맡기지 않고 항상 규칙 기반이다."""
    assert _decide("INC-001", "rejected", reason=DECISION_REASON).status_code == 200
    card = _generate("INCENTIVE").json()["card"]
    assert card["ai"]["dissent"] == list(cardgen.INCENTIVE_DISSENT)
    assert len(card["ai"]["dissent"]) == 3
    assert card["ai"]["grounding"]["dissent_source"] == "rule_based"


def test_demo_seed_cards_carry_rule_based_dissent():
    """시드 3장도 dissent를 갖추고 있어야 mock 패리티·C3 섹션이 첫 화면부터 보인다."""
    for cid in ("AC-001", "AC-002", "INC-001"):
        card = client.get(f"/api/cards/{cid}").json()["card"]
        assert len(card["ai"]["dissent"]) == 3
        assert all(isinstance(d, str) and d.strip() for d in card["ai"]["dissent"])
        assert card["ai"]["grounding"]["dissent_source"] == "rule_based"


def test_expansion_card_admits_the_explanation_is_rule_based_when_llm_fails(monkeypatch):
    """LLM이 죽어도 카드는 만들되, 화면 문구가 'AI가 썼다'고 말하면 안 된다 (감사 M1).

    심사 기간에 키 만료·쿼터 초과가 나면 모든 제안이 조용히 규칙 기반이 되는데, 그 사실이
    grounding에만 남고 reasons는 AI를 주장하면 화면과 데이터가 서로 다른 말을 한다.
    """
    _break_llm(monkeypatch)
    card = _generate("EXPANSION").json()["card"]
    grounding = card["ai"]["grounding"]

    assert grounding["explanation_source"] == "rule_fallback"
    assert grounding["narrative_status"] == "rule_based"
    assert grounding["numeric_status"] == "verified"          # 숫자·순위 재검증은 그대로 성립한다
    assert cardgen.NARRATIVE_NOTE["rule_fallback"] in card["ai"]["reasons"]
    assert cardgen.NARRATIVE_NOTE["llm"] not in card["ai"]["reasons"]
    assert card["ai"]["risks"] and ASSUMPTION_NOTE in card["ai"]["expected_effect"]


def test_incentive_card_reports_its_explanation_source(fake_llm):
    assert _decide("INC-001", "rejected", reason=DECISION_REASON).status_code == 200
    grounding = _generate("INCENTIVE").json()["card"]["ai"]["grounding"]

    assert grounding["explanation_source"] == "llm"
    assert grounding["narrative_status"] == "ai_generated_evidence_checked"
    # 수치가 실측이 아니라 팀 설정 가정이라 EXPANSION처럼 verified를 주장하지 않는다 (05 §2)
    assert grounding["status"] == "partial" and grounding["numeric_status"] == "fixed_by_server"
    assert grounding["selection_method"] == "fixed_scenarios_3_5_7"
    assert grounding["checks"] == cardgen.INCENTIVE_GROUNDING_CHECKS


def test_incentive_card_marks_rule_based_when_llm_fails(monkeypatch):
    assert _decide("INC-001", "rejected", reason=DECISION_REASON).status_code == 200
    _break_llm(monkeypatch)
    card = _generate("INCENTIVE").json()["card"]

    assert card["ai"]["grounding"]["explanation_source"] == "rule_fallback"
    assert card["ai"]["grounding"]["narrative_status"] == "rule_based"
    for keyword in MANDATORY_INCENTIVE_RISKS:                  # A-3 필수 리스크는 폴백에도 남는다
        assert any(keyword in r for r in card["ai"]["risks"]), keyword


def test_demo_seed_cards_do_not_claim_ai_wrote_the_explanation():
    """시드 3장은 사람이 실데이터로 검증한 규칙 기반 문구다 — 심사 첫 화면이 곧 이 카드들이다."""
    for cid in ("AC-001", "AC-002", "INC-001"):
        card = client.get(f"/api/cards/{cid}").json()["card"]
        grounding = card["ai"]["grounding"]
        assert grounding["explanation_source"] == "rule_seed"
        assert grounding["narrative_status"] == "rule_based"
        assert cardgen.NARRATIVE_NOTE["llm"] not in card["ai"]["reasons"]


def test_generate_rejects_unknown_type():
    assert _generate("SOMETHING").status_code == 400


# ── 4. decision / progress (상태 전이·에러 경로) ─────────────────────────

def test_decision_approves_expansion_card():
    # AC-002는 confidence=하라 승인에 확인 근거가 필요하다 (05 §2 저신뢰 승인 게이트)
    res = _decide("AC-002", "approved", reason=DECISION_REASON)
    assert res.status_code == 200
    card = res.json()["card"]
    assert card["status"] == "approved" and card["progress"] == "후보 접촉·검토 시작"
    assert card["decided_at"] and card["events"][-1]["action"] == "approved"

    # 결정 1건의 감사 기록 — 신원이 검증되지 않았다는 사실까지 함께 남는다 (05 §2 decision)
    assert card["decision"] == {
        "outcome": "approved", "reason": DECISION_REASON,
        "actor_id": ACTOR["actor_id"], "actor_name": ACTOR["actor_name"],
        "source": "operator_ui", "auth": "shared_token", "verified": False,
        "at": card["decided_at"],
        "safety_review": {
            "policy": cards_route.SAFETY_REVIEW_POLICY,
            "acknowledged": True,
            "scope": list(cards_route.SAFETY_REVIEW_SCOPE),
        },
    }
    assert card["reproposal_block"] is None            # 승인에는 재제안 차단이 붙지 않는다
    event = card["events"][-1]
    assert event["actor_id"] == ACTOR["actor_id"] and event["source"] == "operator_ui"
    assert event["reason"] == DECISION_REASON

    again = _decide("AC-002", "approved", reason=DECISION_REASON)
    assert again.status_code == 409                                  # pending이 아니면 409


def test_decision_requires_actor_id():
    """05 §2 — actor_id는 스키마 레벨 필수다. 누가 결정했는지 없는 감사 기록은 성립하지 않는다."""
    res = client.post("/api/cards/AC-002/decision",
                      json={"decision": "approved", "reason": DECISION_REASON})
    assert res.status_code == 422
    assert isinstance(res.json()["detail"], str)                     # 05 머리말 — detail은 단일 문자열
    assert "담당자" in res.json()["detail"]
    assert client.get("/api/cards/AC-002").json()["card"]["status"] == "pending"

    blank = client.post("/api/cards/AC-002/decision",
                        json={"decision": "approved", "actor_id": "   ", "reason": DECISION_REASON})
    assert blank.status_code == 422


def test_approval_requires_safety_review_acknowledgement():
    """승인만은 원 순위·반대 관점·데이터 보호 범위 확인 없이는 통과할 수 없다.

    반려·보류까지 이 체크를 강제하면 위험을 발견해 멈추려는 결정도 막히므로 승인 게이트에만 둔다.
    """
    missing = client.post(
        "/api/cards/AC-002/decision",
        json={"decision": "approved", "reason": DECISION_REASON, **ACTOR},
    )
    assert missing.status_code == 422
    assert "편향" in missing.json()["detail"] and "소표본" in missing.json()["detail"]
    assert client.get("/api/cards/AC-002").json()["card"]["status"] == "pending"

    # 반려는 안전 확인 없이도 가능하고, 통과시키지 않은 검토를 감사 기록에 거짓으로 남기지 않는다.
    rejected = _decide("AC-002", "rejected", reason="윤리 영향 추가 검토 필요").json()["card"]
    assert "safety_review" not in rejected["decision"]


def test_rejection_requires_reason_and_records_a_reproposal_block():
    """05 §2·§8 — 사유 없는 반려는 422, 사유가 있으면 재제안 차단 창까지 카드에 남는다."""
    missing = client.post("/api/cards/AC-002/decision", json={"decision": "rejected", **ACTOR})
    assert missing.status_code == 422
    assert isinstance(missing.json()["detail"], str) and "사유" in missing.json()["detail"]

    reason = "동일 상권에 분기 예산이 이미 배정되어 이번 분기에는 추진하지 않음"
    card = _decide("AC-002", "rejected", reason=reason, cooldown_days=30,
                   recheck_condition="다음 분기 예산 확정 후 재검토").json()["card"]

    assert card["status"] == "rejected" and card["decision"]["reason"] == reason
    assert card["decision"]["outcome"] == "rejected" and card["decision"]["verified"] is False
    block = card["reproposal_block"]
    assert block["cooldown_days"] == 30 and block["reason"] == reason
    assert block["recheck_condition"] == "다음 분기 예산 확정 후 재검토"
    assert block["until"] == cardgen.cooldown_until(card["decided_at"], 30)
    assert block["until"] > card["decided_at"]
    assert card["events"][-1]["reason"] == reason


def test_low_confidence_approval_requires_a_reason():
    """05 §2 — confidence=하 카드는 확인 근거 없이 승인할 수 없다. 반려·보류와 다른 게이트다."""
    assert client.get("/api/cards/AC-002").json()["card"]["confidence"] == "하"
    missing = client.post("/api/cards/AC-002/decision", json={"decision": "approved", **ACTOR})
    assert missing.status_code == 422
    assert "신뢰도" in missing.json()["detail"]

    # confidence=중 카드는 사유 없이도 승인된다 — 게이트가 저신뢰에만 걸린다는 대조군
    _put_expansion("AC-930", "태백시", "카페")
    db.put_card({**db.get_card("AC-930"), "confidence": "중"})
    assert client.post("/api/cards/AC-930/decision",
                       json={"decision": "approved", "safety_reviewed": True,
                             **ACTOR}).status_code == 200

    ok = _decide("AC-002", "approved", reason="동절기 방문 수요를 별도 확인함")
    assert ok.status_code == 200 and ok.json()["card"]["decision"]["reason"]


def test_decision_version_mismatch_returns_409():
    """05 §2·§8 — 화면이 읽은 뒤 다른 요청이 카드를 바꿨으면 낙관적 잠금이 409를 낸다."""
    current = client.get("/api/cards/AC-002").json()["card"].get("version", 0)
    stale = client.post("/api/cards/AC-002/decision",
                        json={"decision": "approved", "reason": DECISION_REASON,
                              "version": current + 5, "safety_reviewed": True, **ACTOR})
    assert stale.status_code == 409
    assert client.get("/api/cards/AC-002").json()["card"]["status"] == "pending"

    ok = _decide("AC-002", "approved", reason=DECISION_REASON, version=current)
    assert ok.status_code == 200 and ok.json()["card"]["status"] == "approved"


def test_decision_holds_card():
    """05 §2 — held도 '결정'이라 decided_at·events를 남긴다. 승인이 아니므로 progress는 붙지 않는다."""
    reason = "사업자 참여 의향 확인 전까지 보류"
    res = _decide("AC-002", "held", reason=reason)
    assert res.status_code == 200
    card = res.json()["card"]

    assert card["status"] == "held" and card["progress"] is None
    assert card["decided_at"].endswith(KST_OFFSET)                 # 05 §8 시각 표기
    assert [e["action"] for e in card["events"]] == ["generated", "held"]
    assert card["events"][-1]["at"].endswith(KST_OFFSET)
    assert card["decision"]["outcome"] == "held" and card["reproposal_block"]["reason"] == reason

    # pending이 아니게 됐으므로 재결정 409, 승인 상태가 아니므로 progress도 409 (05 §8)
    assert _decide("AC-002", "approved", reason=DECISION_REASON).status_code == 409
    assert client.post("/api/cards/AC-002/progress",
                       json={"progress": "추진중"}).status_code == 409

    kpi = client.get("/api/kpi").json()
    assert kpi["counts"]["held"] == 1                               # 05 §3 counts에 집계
    assert kpi["avg_approval_hours"] > 0     # decided_at 있는 모든 카드가 평균 대상 (approved+rejected+held)


def test_decision_error_paths():
    """05 §8 검사 순서 — 404 → 400(decision 값) → 409(상태 전이) → 422(조건부 필수)."""
    assert _decide("AC-999", "approved", reason=DECISION_REASON).status_code == 404
    assert _decide("AC-002", "yes").status_code == 400
    assert _decide("AC-001", "approved", reason=DECISION_REASON).status_code == 409

    # 없는 카드에 잘못된 body를 보내도 404가 먼저 나간다
    assert _decide("AC-999", "yes").status_code == 404
    # 결정할 수 없는 카드(이미 approved)의 조건부 필수 값을 먼저 따지지 않는다 — 409가 앞선다
    assert client.post("/api/cards/AC-001/decision",
                       json={"decision": "rejected", **ACTOR}).status_code == 409


def test_incentive_approval_requires_selected_rate():
    """05 §8 — 누락은 422(없는 값 요구), 범위 밖은 400(잘못 쓴 값). EXPANSION에 온 값은 무시."""
    missing = client.post("/api/cards/INC-001/decision",
                          json={"decision": "approved", "safety_reviewed": True, **ACTOR})
    assert missing.status_code == 422
    assert isinstance(missing.json()["detail"], str)
    out_of_range = client.post("/api/cards/INC-001/decision",
                               json={"decision": "approved", "selected_rate": 4,
                                     "safety_reviewed": True, **ACTOR})
    assert out_of_range.status_code == 400
    assert "3|5|7" in out_of_range.json()["detail"]

    card = _decide("INC-001", "approved", selected_rate=5).json()["card"]
    assert card["selected_rate"] == 5 and card["progress"] == "검토중"

    exp = _decide("AC-002", "approved", reason=DECISION_REASON, selected_rate=7).json()["card"]
    assert exp.get("selected_rate") is None


def test_incentive_rejection_ignores_selected_rate():
    """05 §2 — selected_rate는 **승인 시점에만** 저장된다 (pending/반려 상태에서는 null).

    반려·보류 경로는 RATES(3|5|7) 검증 분기를 지나지 않으므로, body에 실려 온 값을
    그대로 저장하면 범위 밖 값(999)까지 무검증으로 영구 잔존한다(반려 카드는 재결정 불가).
    """
    res = _decide("INC-001", "rejected", reason=DECISION_REASON, selected_rate=999)
    assert res.status_code == 200
    assert res.json()["card"]["selected_rate"] is None
    assert client.get("/api/cards/INC-001").json()["card"]["selected_rate"] is None
    # INCENTIVE는 target이 없어 재제안 차단 대상이 아니다 (05 §2 reproposal_block)
    assert res.json()["card"]["reproposal_block"] is None


def test_incentive_scenarios_survive_decimal_round_trip():
    """05 §8 숫자 직렬화 — 읽기-수정-쓰기를 반복해도 delta_pp가 float로 남는다 ([1.0, 2.0] → [1, 2] 방지).

    승인·추진 상태 변경은 카드를 통째로 다시 저장하므로, Decimal 복원이 정수로 내려앉으면
    FE의 "1~2%p"가 조용히 "1~2"로 바뀐다.
    """
    approved = _decide("INC-001", "approved", selected_rate=5).json()["card"]
    assert client.post("/api/cards/INC-001/progress",
                       json={"progress": "추진중"}).status_code == 200
    # 완료는 증빙과 함께 추진 기록으로만 만들 수 있다 (05 §8)
    assert _complete("INC-001", INCENTIVE_EVIDENCE).status_code == 201
    stored = client.get("/api/cards/INC-001").json()["card"]

    for card in (approved, stored):
        assert [s["rate"] for s in card["scenarios"]] == SCENARIO_RATES
        assert all(isinstance(v, float) for s in card["scenarios"] for v in s["delta_pp"])
    assert next(s["delta_pp"] for s in stored["scenarios"] if s["rate"] == 5) == [1.0, 2.0]
    assert stored["selected_rate"] == 5 and isinstance(stored["selected_rate"], int)


def test_progress_transitions_require_approved_card():
    # 후보 적격성이 미확인인 상태에서 가맹 심사·추진·완료로 건너뛸 수 없다.
    assert client.post("/api/cards/AC-001/progress", json={"progress": "완료"}).status_code == 409
    verified = _verify_all()
    assert verified.status_code == 200
    assert verified.json()["card"]["candidate_verification"]["status"] == "verified"

    for step in ("적격성 확인", "가맹 심사", "추진중"):
        card = client.post("/api/cards/AC-001/progress", json={"progress": step}).json()["card"]
        assert card["progress"] == step
        assert card["events"][-1]["action"] == f"progress:{step}" and card["events"][-1]["at"]

    # 완료만은 이 경로로 만들 수 없다 — 증빙을 실을 자리가 없기 때문 (05 §8)
    blocked = client.post("/api/cards/AC-001/progress", json={"progress": "완료"})
    assert blocked.status_code == 422
    assert "추진 기록" in blocked.json()["detail"]
    assert client.get("/api/cards/AC-001").json()["card"]["progress"] == "추진중"

    done = _complete("AC-001", DOCUMENT_EVIDENCE)
    assert done.status_code == 201
    assert done.json()["card"]["progress"] == "완료"
    assert done.json()["card"]["events"][-1]["action"] == "progress:완료"

    assert client.post("/api/cards/AC-002/progress",
                       json={"progress": "추진중"}).status_code == 409     # pending 카드
    assert client.post("/api/cards/AC-001/progress",
                       json={"progress": "진행중"}).status_code == 400     # 허용 밖 값
    assert client.post("/api/cards/AC-999/progress",
                       json={"progress": "완료"}).status_code == 404


def test_quick_status_change_cannot_complete_any_card_type():
    """05 §8 — 완료는 위젯 배지·KPI 실행 전환율에 직결되므로 증빙 없이 만들어질 수 없다.

    EXPANSION·INCENTIVE 어느 쪽도 빠른 상태 변경으로는 완료가 되지 않으며, 응답 문구가
    추진 기록 API로 안내한다. 404·400·409보다 뒤에 오는 검사라 상태 전이는 정상이어야 한다.
    """
    assert _decide("INC-001", "approved", selected_rate=5).status_code == 200
    assert client.post("/api/cards/INC-001/progress", json={"progress": "추진중"}).status_code == 200

    res = client.post("/api/cards/INC-001/progress", json={"progress": "완료"})
    assert res.status_code == 422
    assert isinstance(res.json()["detail"], str) and "추진 기록" in res.json()["detail"]
    card = client.get("/api/cards/INC-001").json()["card"]
    assert card["progress"] == "추진중" and card.get("completed_at") is None


def test_rejected_expansion_target_is_not_reproposed_during_the_cooldown():
    """05 §8 — 반려한 타깃은 차단 창이 끝날 때까지 후보에서 빠진다.

    예전에는 반려 카드가 후보 판정에서 "없음"으로 돌아와, 최고점 후보를 반려한 직후 같은 버튼이
    **같은 타깃**을 다시 제안했다 — 담당자의 반려 판단이 시스템에 아무 영향을 주지 못했다.
    """
    assert _decide("AC-002", "rejected", reason="이번 분기에는 추진하지 않음").status_code == 200
    blocked = next(c for c in dataload.load("candidates")
                   if c["eup"] == "영월군" and c["category"] == "소매점")
    assert cardgen._target_state(blocked, db.list_cards()) == cardgen.BLOCKED_STATE

    card = _generate("EXPANSION").json()["card"]
    assert (card["target"]["eup"], card["target"]["category"]) != ("영월군", "소매점")
    assert (card["target"]["eup"], card["target"]["category"]) == ("영월군", "숙박업")


def test_zero_cooldown_lets_the_same_target_be_proposed_again():
    """05 §8 — 차단 창이 지나면 다시 후보가 된다. `cooldown_days=0`이 그 경계 사례다.

    영월군 소매점은 정량 2위이고 1위(음식점)는 이미 진행 중이므로, 차단이 풀리면 결정론적으로
    다시 선택되는 타깃이다 — 차단 여부만이 결과를 가른다.
    """
    assert _decide("AC-002", "rejected", reason="검토만 미루고 대상 자체는 유효",
                   cooldown_days=0).status_code == 200
    reopened = next(c for c in dataload.load("candidates")
                    if c["eup"] == "영월군" and c["category"] == "소매점")
    assert cardgen._target_state(reopened, db.list_cards()) == "없음"

    card = _generate("EXPANSION").json()["card"]
    assert (card["target"]["eup"], card["target"]["category"]) == ("영월군", "소매점")


def test_allowed_next_progress_is_the_server_transition_rule():
    """05 §2 — 화면이 전이 규칙을 자체 판정하지 않도록 서버가 계산해 실어 보내는 파생값이다.

    허용되지 않는 항목도 **이유와 함께 전부** 실린다. 저장하면 다른 요청이 상태를 바꾼 뒤에도
    낡은 목록이 남으므로 저장하지 않는다.
    """
    pending = client.get("/api/cards/AC-002").json()["card"]
    assert [o["value"] for o in pending["allowed_next_progress"]] == list(workflow.EXPANSION_PROGRESS)
    assert all(o["allowed"] is False and o["reason"] == cards_view.NOT_APPROVED_REASON
               for o in pending["allowed_next_progress"])

    def options(cid):
        stored = db.get_card(cid)
        assert "allowed_next_progress" not in stored          # 저장하지 않는 파생값
        presented = client.get(f"/api/cards/{cid}").json()["card"]["allowed_next_progress"]
        for option in presented:                              # 서버 전이 규칙과 항목마다 일치한다
            allowed, detail = workflow.can_set_progress(stored, option["value"])
            assert option["allowed"] is allowed, option
            assert option.get("reason") == detail if not allowed else True
        return {o["value"]: o for o in presented}

    by_value = options("AC-001")            # approved · 후보 접촉·검토 시작 · 적격성 미확인
    assert by_value["보류"]["allowed"] is True
    assert by_value["적격성 확인"]["allowed"] is False and "적격성" in by_value["적격성 확인"]["reason"]
    assert by_value["가맹 심사"]["allowed"] is False

    assert _verify_all("AC-001").status_code == 200
    for step in ("적격성 확인", "가맹 심사", "추진중"):
        assert client.post("/api/cards/AC-001/progress", json={"progress": step}).status_code == 200

    by_value = options("AC-001")
    assert by_value["완료"]["allowed"] is True
    # 허용이지만 빠른 상태 변경으로는 못 가는 단계 — 화면이 증빙 폼으로 유도해야 한다 (05 §8)
    assert by_value["완료"]["reason"] == cards_view.COMPLETION_EVIDENCE_HINT
    assert client.post("/api/cards/AC-001/progress", json={"progress": "완료"}).status_code == 422


def test_metric_values_require_period_source_and_scope():
    """05 §2 — 기간·출처·범위 없는 숫자는 감사 기록이 되지 못한다. 단위는 서버가 채운다."""
    assert _verify_all("AC-001").status_code == 200

    scalar = _record("AC-001", progress="적격성 확인", metrics={"usage_count": 1362})
    assert scalar.status_code == 422 and isinstance(scalar.json()["detail"], str)

    incomplete = dict(_measured(1362))
    del incomplete["scope"]
    partial = _record("AC-001", progress="적격성 확인", metrics={"usage_count": incomplete})
    assert partial.status_code == 422 and "측정 범위" in partial.json()["detail"]

    ok = _record("AC-001", progress="적격성 확인",
                 metrics={"usage_count": _measured(1362),
                          "conversion_rate_pct": _measured(21.4)})
    assert ok.status_code == 201
    stored = ok.json()["record"]["metrics"]
    assert stored["usage_count"]["unit"] == "건" and stored["usage_count"]["is_proxy"] is False
    # 절대 규칙 2 — 지역 전환율은 분자·분모 단위가 달라 근사 지표다
    assert stored["conversion_rate_pct"]["unit"] == "%" and stored["conversion_rate_pct"]["is_proxy"] is True
    assert stored["usage_count"]["source"] and stored["usage_count"]["scope"]

    # 단위를 요청으로 열면 %와 %p를 뒤바꾼 값이 감사 기록에 남는다 — 스키마가 거부한다
    spoofed = _record("AC-001", progress="적격성 확인",
                      metrics={"usage_count": {**_measured(1362), "unit": "%"}})
    assert spoofed.status_code == 422


def test_completion_record_requires_type_specific_evidence():
    """05 §2 — 완료 증빙은 타입별로 요구가 다르고, 없으면 422다(없는 값을 요구하는 등급)."""
    assert _verify_all("AC-001").status_code == 200
    for step in ("적격성 확인", "가맹 심사", "추진중"):
        assert client.post("/api/cards/AC-001/progress", json={"progress": step}).status_code == 200

    missing = _record("AC-001", progress="완료", progress_pct=100)
    assert missing.status_code == 422 and "증빙" in missing.json()["detail"]
    assert client.get("/api/cards/AC-001").json()["card"]["progress"] == "추진중"

    merchant = _first_merchant("영월군", "음식점")
    done = _complete("AC-001", {"merchant_registration_id": merchant["merchant_id"]})
    assert done.status_code == 201
    card = done.json()["card"]
    assert card["progress"] == "완료" and card["completed_at"]
    # 가맹 등록 ID는 같은 트랜잭션으로 카드 타깃에 반영된다 — 위젯 배지의 유일한 근거 (05 §4)
    assert card["target"]["verified_merchant_id"] == merchant["merchant_id"]
    assert done.json()["record"]["completion_evidence"]["merchant_registration_id"] == merchant["merchant_id"]


def test_incentive_completion_requires_a_confirmed_budget_cap():
    """05 §2 — 인센티브 완료는 적용 기간·책임자·예산 한도 확인이 전부 필요하다."""
    assert _decide("INC-001", "approved", selected_rate=5).status_code == 200
    assert client.post("/api/cards/INC-001/progress", json={"progress": "추진중"}).status_code == 200

    wrong_type = _complete("INC-001", DOCUMENT_EVIDENCE)          # EXPANSION용 증빙
    assert wrong_type.status_code == 422 and "인센티브" in wrong_type.json()["detail"]

    no_owner = _complete("INC-001", {k: v for k, v in INCENTIVE_EVIDENCE.items() if k != "owner"})
    assert no_owner.status_code == 422 and "책임자" in no_owner.json()["detail"]

    unconfirmed = _complete("INC-001", {**INCENTIVE_EVIDENCE, "budget_cap_confirmed": False})
    assert unconfirmed.status_code == 422 and "예산 한도" in unconfirmed.json()["detail"]
    assert client.get("/api/cards/INC-001").json()["card"]["progress"] == "추진중"

    assert _complete("INC-001", INCENTIVE_EVIDENCE).status_code == 201


def test_validation_errors_always_carry_a_single_string_detail():
    """05 머리말 — FastAPI 기본 422는 detail이 오류 객체 배열이라 계약과 FE 파서를 함께 깬다.

    화면은 이 문자열을 그대로 담당자에게 보여주므로, 무엇을 고쳐야 하는지 말해야 한다.
    """
    cases = [
        ("/api/cards/AC-002/decision", {"decision": "approved"}),          # actor_id 누락
        ("/api/cards/AC-001/progress-records", {"progress": "보류"}),        # note 누락
        ("/api/cards/AC-001/progress-records",                              # 두 건 이상 누락
         {"progress": "보류", "metrics": {"usage_count": {"value": 1}}}),
        ("/api/cards/AC-002/decision", {"decision": "approved", "actor_id": "a",
                                        "cooldown_days": 999}),            # 범위 밖
    ]
    for path, body in cases:
        res = client.post(path, json=body)
        assert res.status_code == 422, (path, body)
        detail = res.json()["detail"]
        assert isinstance(detail, str) and detail.strip(), (path, body)
        assert not detail.startswith("["), detail


def test_verification_marks_failed_candidate_ineligible():
    checks = [{"label": label, "status": "verified"}
              for label in workflow.REQUIRED_ELIGIBILITY_CHECKS]
    checks[2]["status"] = "failed"
    res = client.post("/api/cards/AC-001/verification", json={"checks": checks})
    assert res.status_code == 200
    verification = res.json()["card"]["candidate_verification"]
    assert verification["status"] == "ineligible"
    assert "사업자 참여 의향" in verification["note"]
    assert client.post("/api/cards/AC-001/progress", json={"progress": "완료"}).status_code == 409


def test_public_demo_read_only_blocks_mutations(monkeypatch):
    monkeypatch.setenv("DEMO_READ_ONLY", "true")
    mutations = [
        ("/api/cards/generate", {"type": "EXPANSION"}),
        ("/api/cards/AC-002/decision", {"decision": "held"}),
        ("/api/cards/AC-001/progress", {"progress": "보류"}),
        ("/api/cards/AC-001/progress-records", {"progress": "보류", "note": "보안 확인"}),
        ("/api/cards/AC-001/verification", {"checks": []}),
    ]
    for path, body in mutations:
        res = client.post(path, json=body)
        assert res.status_code == 403 and "읽기 전용" in res.json()["detail"]
    assert client.get("/api/cards").status_code == 200


def test_public_demo_read_only_keeps_simulate_open(monkeypatch, fake_llm):
    """simulate는 상태를 바꾸지 않는 읽기 계산이라 읽기 전용 모드에서도 열려 있어야 한다 (05 §8).

    막으면 승인 판단 근거인 "가맹 전환 시 예상 효과"가 사라지고, 상태 변경이 아닌데도
    "읽기 전용입니다" 문구가 화면에 뜬다. 대신 Bearer 토큰은 그대로 요구한다(LLM 호출 보호).
    """
    monkeypatch.setenv("DEMO_READ_ONLY", "true")
    res = client.post("/api/cards/AC-002/simulate")
    assert res.status_code == 200
    assert res.json()["simulation"]["assumption_note"] == ASSUMPTION_NOTE

    unauthorized = client.post("/api/cards/AC-002/simulate", headers={"Authorization": ""})
    assert unauthorized.status_code == 401


def test_mutations_fail_closed_without_server_token(monkeypatch):
    """읽기 전용이 아니어도 인증 설정이 빠진 배포는 POST를 무인증 허용하지 않는다."""
    monkeypatch.delenv("MUTATION_API_TOKEN", raising=False)
    res = client.post("/api/cards/generate", json={"type": "EXPANSION"})
    assert res.status_code == 503
    assert "MUTATION_API_TOKEN" in res.json()["detail"]
    assert client.get("/api/cards").status_code == 200


def test_mutations_reject_missing_or_wrong_bearer_token():
    for authorization in ("", "Bearer wrong-token"):
        res = client.post(
            "/api/cards/generate",
            json={"type": "EXPANSION"},
            headers={"Authorization": authorization},
        )
        assert res.status_code == 401
        assert res.headers["www-authenticate"] == "Bearer"


def test_progress_notes_and_report_require_internal_bearer_token():
    """담당자 메모·담당자명·장애물이 포함될 수 있는 조회는 공개 API로 열지 않는다."""
    for path in ("/api/progress-report", "/api/cards/AC-001/progress-records"):
        res = client.get(path, headers={"Authorization": ""})
        assert res.status_code == 401
        assert res.headers["www-authenticate"] == "Bearer"


def test_conditional_progress_write_preserves_winning_event():
    card = db.get_card("AC-001")
    expected = card["progress"]
    first = db.update_progress("AC-001", "보류", expected_progress=expected, require_verified=False)
    assert first["progress"] == "보류" and first["events"][-1]["action"] == "progress:보류"
    with pytest.raises(db.ConcurrentUpdate):
        db.update_progress("AC-001", "후보 접촉·검토 시작", expected_progress=expected, require_verified=False)
    stored = db.get_card("AC-001")
    assert stored["progress"] == "보류"
    assert stored["events"][-1]["action"] == "progress:보류"


# ── 5. simulate (LLM monkeypatch) ────────────────────────────────────────

def test_simulate_expansion_card(fake_llm):
    res = client.post("/api/cards/AC-002/simulate")
    assert res.status_code == 200
    sim = res.json()["simulation"]
    assert fake_llm.calls == ["narrative"]
    assert fake_llm.attempts == [2]                                # 재시도 기본값 유지 (llm.generate_json attempts=2)

    assert 0 <= sim["current_index"] <= 100 and 0 <= sim["projected_index"] <= 100
    lo, hi = sim["delta_pp"]
    assert lo <= hi and all(isinstance(v, (int, float)) for v in sim["delta_pp"])
    assert sim["narrative"] == FAKE_NARRATIVE                     # LLM 문구 채택 (fallback 아님)
    assert sim["narrative_source"] == "llm"                       # 화면이 "AI가 쓴 문장"이라 말해도 되는 유일한 경우
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert sim["assumption_note"] == ASSUMPTION_NOTE              # 절대 규칙 3 — 고정 문구
    assert sim["expected_monthly_count"] >= 0
    assert len(sim["expected_monthly_range"]) == 2
    assert "25~75" in sim["uncertainty_method"]
    assert sim["estimate_basis"]
    assert sim["base_month"] == "2025-12"
    assert sim["effect_assessment"] in ("미미", "개선", "심화", "혼재")
    assert sim["decision_note"]


def test_simulate_falls_back_when_llm_fails(monkeypatch):
    """LLM 실패 시에도 200 + 규칙 기반 문구 — 데모 루프가 LLM 장애에 끊기지 않아야 한다 (05 §8)."""
    _break_llm(monkeypatch)
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert sim["narrative_source"] == "rule_based"          # 폴백 사실이 응답에 남아야 화면이 칩을 바꾼다
    assert sim["assumption_note"] == ASSUMPTION_NOTE


def test_simulate_rejects_narrative_missing_required_words(fake_llm):
    """스키마는 맞지만 '예상'·'가정'이 빠진 narrative는 규칙 기반 문구로 대체된다 (절대 규칙 3)."""
    fake_llm.narrative = "짧은 문장입니다."
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]

    assert fake_llm.calls == ["narrative"]                     # 예외가 아니라 내용 가드가 걸린 경로
    assert sim["narrative"] != fake_llm.narrative
    assert sim["narrative_source"] == "rule_based"              # 내용 가드로 버린 문구도 AI라 부르지 않는다
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert "영월군 소매점" in sim["narrative"]                  # 규칙 기반 문구 형태 (AC-002 타깃)


def test_simulate_rejects_narrative_inferring_sensitive_attributes(fake_llm):
    """민감 속성 서술 폐기는 LLM 출력 **세 경로 모두**에 걸린다 — 시뮬레이션 문구도 예외가 아니다.

    카드 생성(cardgen)에만 걸어 두면 "민감 속성을 쓰는 AI 문장은 폐기된다"는 README·발표 주장이
    이 경로에서 거짓이 된다. 같은 판정 함수를 공유하는지까지 확인한다.
    """
    fake_llm.narrative = ("고령 사업주가 많은 지역이라 가맹 전환 효과가 낮을 것으로 예상됩니다. "
                          "가정에 기반한 수치입니다.")
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]

    assert fake_llm.calls == ["narrative"]                     # 호출은 됐고 내용 가드가 걸렀다
    assert sim["narrative"] != fake_llm.narrative
    assert sim["narrative_source"] == "rule_based"
    assert "고령" not in sim["narrative"]


def test_simulate_rejects_narrative_with_wrong_direction(fake_llm):
    """계산 방향과 반대로 서술한 narrative는 **양방향 모두** 버린다 (cards.py wrong_direction).

    한쪽(심화→"개선")만 막으면, 개선 구간에서 LLM이 "집중 심화"로 뒤집어 쓴 문장이 그대로
    승인 화면에 실린다. 데모 카드 AC-002가 바로 개선 구간이라 실제로 노출될 수 있는 경로다.
    """
    _put_expansion("AC-900", "사북읍", "카페")                  # 이미 소비가 몰린 지역 = 음수 delta
    fake_llm.narrative = "지역 소비 집중도가 개선될 것으로 예상됩니다. 가정에 기반한 수치입니다."
    sim = client.post("/api/cards/AC-900/simulate").json()["simulation"]

    assert sum(sim["delta_pp"]) < 0                            # 전제: 집중 심화 방향
    assert sim["narrative"] != fake_llm.narrative
    assert sim["narrative_source"] == "rule_based"
    assert "상승(집중 심화)" in sim["narrative"]
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]

    # 반대 방향 — AC-002(영월군 소매점)는 개선 구간이다
    fake_llm.narrative = "지역 소비 집중도가 상승(집중 심화)할 것으로 예상됩니다. 가정에 기반한 수치입니다."
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]

    assert sim["delta_pp"][1] > 0 and sim["delta_pp"][0] >= 0   # 전제: 개선 방향
    assert sim["narrative"] != fake_llm.narrative
    assert sim["narrative_source"] == "rule_based"
    assert "개선될" in sim["narrative"] and "심화" not in sim["narrative"]


def test_simulate_indices_share_the_unit_of_delta_pp(fake_llm):
    """지수와 delta_pp의 단위가 어긋나면 한 문장 안에서 자기모순이 난다 (05 §2).

    정수 반올림이면 원시 집중도 42.53이 0.05%p 변화에도 "43 → 42"(1포인트)로 보여, 같은 응답의
    delta_pp(0.0~0.1%p)와 10배 어긋난다. 지수도 소수 1자리로 맞춘다.
    """
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]
    cur, proj = sim["current_index"], sim["projected_index"]

    assert isinstance(cur, float) and isinstance(proj, float)
    assert round(cur, 1) == cur and round(proj, 1) == proj      # 소수 1자리 고정
    # 지수 변화폭이 delta_pp 범위 안에 있어야 한다 (반올림 오차 0.05 허용)
    assert min(sim["delta_pp"]) - 0.05 <= cur - proj <= max(sim["delta_pp"]) + 0.05


def test_simulate_does_not_hand_indices_to_the_llm(monkeypatch):
    """LLM에 지수 두 값을 주면 "43에서 42로 1포인트 개선"처럼 delta_pp와 어긋난 문장을 쓴다.

    방향과 폭만 주고 지수는 빼는 것이 그 문장을 구조적으로 막는 방법이다 (05 §2).
    """
    captured = {}

    def spy(system, user, schema, schema_name="result", timeout=None, attempts=2):
        # B2: user 메시지가 <data>...</data>로 감싸이므로 안쪽 JSON만 파싱한다.
        captured["payload"] = json.loads(user.split("<data>", 1)[1].rsplit("</data>", 1)[0])
        return {"narrative": FAKE_NARRATIVE}

    monkeypatch.setattr(llm, "generate_json", spy)
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]

    payload = captured["payload"]
    assert "예상 변화(부호 해석 완료)" in payload                  # 방향·폭은 준다
    assert not any("집중도" in key for key in payload), payload.keys()   # 지수는 안 준다
    serialized = json.dumps(payload, ensure_ascii=False)         # 다른 이름으로도 새지 않는다
    assert str(sim["current_index"]) not in serialized
    assert str(sim["projected_index"]) not in serialized


def test_simulate_reports_no_change_without_claiming_a_direction(fake_llm, monkeypatch):
    """변화가 없는 구간(delta [0.0, 0.0])은 방향을 붙이지 않고 LLM에도 맡기지 않는다.

    시드 카드 AC-001의 타깃은 영월군 음식점. "변화 없음" 자체는 실데이터의 우연한 소수점
    정렬이 아니라 **해당 지역·업종의 과거 사용 이력이 0이라 예상 추가 건수가 0**이라는
    구조적 조건에서 나와야 하므로, 여기서는 그 조건을 usage_monthly에 직접 구성해 결정론적으로
    만든다(A3 소표본 억제 도입 이후 실데이터 값이 흔들려 하드코딩 좌표가 깨졌다 — 이 파일
    상단 원칙대로 실데이터 우연값에 기대지 않는다).
    """
    real_load = dataload.load

    def _zero_food_history(name):
        if name != "usage_monthly":
            return real_load(name)
        months = ["2025-01", "2025-02", "2025-03"]
        rows = []
        for month in months:
            row = dict.fromkeys(simulate.REGIONS, 50)
            row["영월군"] = 0    # 타깃(영월군·음식점) 과거 이력 0 → 예상 추가 건수 0 → 지수 불변
            rows.append({"month": month, "category": "일반음식점업", **row})
        return {"months": months, "base_month": "2025-03", "usage": rows}

    monkeypatch.setattr(dataload, "load", _zero_food_history)
    sim = client.post("/api/cards/AC-001/simulate").json()["simulation"]

    assert sim["delta_pp"] == [0.0, 0.0]                        # 전제: 변화 없는 구간
    assert fake_llm.calls == []                                 # LLM에 맡기지 않는다
    assert sim["narrative_source"] == "rule_based"              # 호출 자체가 없었으므로 AI 문구가 아니다
    assert "개선" not in sim["narrative"] and "심화" not in sim["narrative"]
    assert "변화가 나타나지 않을" in sim["narrative"]
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert sim["assumption_note"] == ASSUMPTION_NOTE


def test_simulate_never_emits_negative_zero():
    """round(-0.001, 1)은 -0.0이라 그대로 실으면 화면에 "-0.0%p"가 찍힌다 (simulate._round_pp)."""
    usage, merchants = dataload.load("usage_monthly"), dataload.load("merchants")
    categories = sorted({m["category"] for m in merchants})
    # A3 후속: 소표본 억제 타깃은 simulate_expansion이 ValueError로 거부한다 —
    # 그 경로는 test_simulate_rejects_suppressed_target_cell이 따로 검증하므로 여기선 건너뛴다.
    suppressed = {(c["eup"], c["category"])
                  for c in (usage.get("privacy_meta") or {}).get("suppressed_cells", [])}

    seen_zero = False
    for eup in simulate.REGIONS:
        for category in categories:
            if (eup, category) in suppressed:
                continue
            for value in simulate.simulate_expansion(usage, merchants, eup, category)["delta_pp"]:
                assert not (value == 0 and math.copysign(1, value) < 0), f"{eup} {category}: -0.0"
                seen_zero = seen_zero or value == 0
    assert seen_zero, "0 값이 하나도 없으면 이 테스트는 공허하다"


def test_simulate_error_paths():
    assert client.post("/api/cards/INC-001/simulate").status_code == 400     # EXPANSION 전용
    assert client.post("/api/cards/AC-999/simulate").status_code == 404
    _put_expansion("AC-910", "서울시", "카페")                                # 집계 6지역 밖 타깃
    res = client.post("/api/cards/AC-910/simulate")
    assert res.status_code == 400 and "집계 대상 지역이 아닙니다" in res.json()["detail"]


def test_simulate_rejects_suppressed_target_cell():
    """A3 후속: 타깃이 소표본 억제 셀(k=5 미만) 자체면 거짓 0 대신 400으로 명시 거부한다.

    판정 근거는 usage_monthly.json의 privacy_meta.suppressed_cells(p10 정본)이며 하드코딩하지
    않는다 — 억제 대상이 바뀌어도 이 테스트는 그대로 유효하다.
    """
    usage = dataload.load("usage_monthly")
    eup, category = next(
        (c["eup"], c["category"]) for c in usage["privacy_meta"]["suppressed_cells"])
    _put_expansion("AC-921", eup, category)
    res = client.post("/api/cards/AC-921/simulate")
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "표본 보호" in detail and f"{eup} {category}" in detail


# ── 6. KPI ──────────────────────────────────────────────────────────────

def test_kpi_matches_card_state():
    """05 §3 — 4지표 전부를 카드 목록에서 독립적으로 재계산해 대조한다."""
    assert _decide("AC-002", "approved", reason=DECISION_REASON).status_code == 200
    _verify_all("AC-002")
    for step in ("적격성 확인", "가맹 심사", "추진중"):
        assert client.post(
            "/api/cards/AC-002/progress", json={"progress": step}
        ).status_code == 200
    assert _complete("AC-002", DOCUMENT_EVIDENCE).status_code == 201

    cards = _cards()
    kpi = client.get("/api/kpi").json()

    approved = [c for c in cards if c["status"] == "approved"]
    running = [c for c in approved if c.get("progress") in ("추진중", "완료")]
    done = [c for c in approved if c.get("progress") == "완료"]
    hours = [(datetime.fromisoformat(c["decided_at"]) - datetime.fromisoformat(c["created_at"])
              ).total_seconds() / 3600 for c in cards if c.get("decided_at")]

    decided = [c for c in cards if c["status"] in ("approved", "rejected", "held")]
    assert kpi["adoption_rate"] == round(len(approved) / len(decided), 2)
    assert kpi["execution_rate"] == round(len(running) / len(approved), 2)
    assert kpi["avg_decision_hours"] == kpi["avg_approval_hours"] == round(sum(hours) / len(hours), 1) > 0
    assert 0 <= kpi["regional_balance_index"] <= 100
    assert kpi["counts"] == {
        "total": len(cards), "pending": sum(1 for c in cards if c["status"] == "pending"),
        "approved": len(approved), "rejected": sum(1 for c in cards if c["status"] == "rejected"),
        "held": sum(1 for c in cards if c["status"] == "held"),
        "decided": len(decided), "done": len(done),
    }


def test_kpi_reports_the_balance_index_sample_size():
    """05 §3 — 지역 균형지수를 만든 표본 수는 `counts` 안이 아니라 최상위에 온다.

    `counts.approved`는 INCENTIVE를 포함해 다른 숫자라 표본으로 쓸 수 없다. 지수만 크게 띄우고
    그것이 카드 몇 장에서 나온 값인지 감추지 않기 위한 필드다.
    """
    seeded_kpi = client.get("/api/kpi").json()
    assert seeded_kpi["balance_sample_count"] == 1          # 시드의 승인 EXPANSION은 AC-001뿐
    assert "balance_sample_count" not in seeded_kpi["counts"]

    assert _decide("AC-002", "approved", reason=DECISION_REASON).status_code == 200
    assert _decide("INC-001", "approved", selected_rate=5).status_code == 200
    kpi = client.get("/api/kpi").json()

    approved = [c for c in _cards() if c["status"] == "approved"]
    expected = sum(1 for c in approved
                   if c["type"] == "EXPANSION"
                   and (c.get("target") or {}).get("eup") in simulate.REGIONS)
    assert kpi["balance_sample_count"] == expected == 2
    assert kpi["counts"]["approved"] == 3                   # INCENTIVE 승인이 포함된 다른 숫자
    assert 0 <= kpi["regional_balance_index"] <= 100

    # 집계 6지역 밖 타깃은 지수에도 표본에도 들어가지 않는다
    _put_expansion("AC-940", "서울시", "카페")
    assert client.post("/api/cards/AC-940/decision",
                       json={"decision": "approved", "safety_reviewed": True,
                             **ACTOR}).status_code == 200
    assert client.get("/api/kpi").json()["balance_sample_count"] == 2


def test_kpi_balance_index_is_null_without_a_sample():
    """05 §8 — 표본이 0이면 지수를 만들지 않는다 (분모 0 지표는 null)."""
    seed_demo.clear_table()
    kpi = client.get("/api/kpi").json()
    assert kpi["balance_sample_count"] == 0 and kpi["regional_balance_index"] is None


def test_kpi_survives_empty_table():
    """05 §8 — 카드 0건이어도 division-by-zero 없이 응답, 분모 0 지표는 null."""
    seed_demo.clear_table()
    kpi = client.get("/api/kpi").json()
    assert kpi["adoption_rate"] is None and kpi["execution_rate"] is None
    assert kpi["avg_approval_hours"] is None and kpi["regional_balance_index"] is None
    assert kpi["counts"]["total"] == 0


# ── 7. 위젯 (신규 배지·페이백·blurb) ─────────────────────────────────────

def _advance_to_done(cid, evidence):
    """적격성 확인 → 완료까지 밟는다. 완료만 증빙과 함께 추진 기록으로 남긴다 (05 §8)."""
    assert _verify_all(cid).status_code == 200
    for step in ("적격성 확인", "가맹 심사", "추진중"):
        assert client.post(f"/api/cards/{cid}/progress", json={"progress": step}).status_code == 200
    assert _complete(cid, evidence).status_code == 201


def test_widget_promotes_completed_targets_and_payback(fake_llm):
    """05 §4 — 완료 카드 전/후로 추천 순서가 바뀌고, 배지·페이백이 붙는다 (데모 마지막 동선).

    배지는 (읍×업종) 집합이 아니라 완료 기록에 실린 **가맹 등록 ID의 정확 일치**로만 붙는다 —
    확충 후보는 아직 가맹점이 아닌 상가라, 집합 매칭은 완료 카드와 무관한 기존 가맹점들에
    배지를 붙였다(방문객에게 사실이 아닌 정보).
    """
    before = client.get("/api/widget/recommend", params={"region": "영월군", "limit": 3}).json()
    assert before["policy_note"] == POLICY_NOTE
    assert len(before["recommendations"]) == 3
    assert all(r["badge"] is None and r["payback"] is None for r in before["recommendations"])
    assert all(r["blurb"] == f"영월군의 {r['category']} 하이원포인트 가맹점이에요" for r in before["recommendations"])
    assert before["expansion_sync"] == {"completed_cards": 0, "reflected": 0, "pending_sync": 0}

    converted = _first_merchant("영월군", "음식점")       # AC-001 타깃(영월군 음식점)이 확인한 가맹점
    _advance_to_done("AC-001", {"merchant_registration_id": converted["merchant_id"]})
    assert _decide("INC-001", "approved", selected_rate=5).status_code == 200
    assert client.post("/api/cards/INC-001/progress", json={"progress": "추진중"}).status_code == 200
    assert _complete("INC-001", INCENTIVE_EVIDENCE).status_code == 201

    after = client.get("/api/widget/recommend", params={"region": "영월군", "limit": 3}).json()
    recs = after["recommendations"]
    assert [r["name"] for r in recs] != [r["name"] for r in before["recommendations"]]
    # 확인된 가맹점 1곳만 배지를 달고 맨 앞으로 온다 — 나머지에는 붙지 않는다
    assert recs[0]["name"] == converted["name"] and recs[0]["badge"] == "이번 분기 확충 업종"
    assert all(r["badge"] is None for r in recs[1:])
    assert after["expansion_sync"] == {"completed_cards": 1, "reflected": 1, "pending_sync": 0}
    assert all(r["payback"] == {"rate": 5, "label": "지금 여기서 쓰면 5% 페이백"} for r in recs)
    assert all({"name", "category", "address", "lat", "lng", "directions_url"} <= set(r) for r in recs)
    assert all(r["directions_url"].startswith("https://map.kakao.com/link/to/") for r in recs)
    assert client.get("/api/cards/AC-001").json()["card"]["target"]["verified_merchant_id"] == \
        converted["merchant_id"]


def test_widget_reports_pending_sync_for_completed_cards_without_a_merchant_id(fake_llm):
    """05 §4·§8 — 증빙 문서만으로 완료한 카드는 정상 200이지만 배지 근거가 없어 '반영 대기'다.

    가맹 등록에서 다음 파이프라인 산출까지 시차가 정상적으로 존재하므로, 그 구간에 배지를
    붙이면 없는 가맹점을 추천하게 된다. 담당자 화면이 "완료했는데 왜 위젯에 없지"에 답할 수
    있도록 건수를 응답에 함께 싣는다.
    """
    _advance_to_done("AC-001", DOCUMENT_EVIDENCE)
    assert client.get("/api/cards/AC-001").json()["card"]["target"]["verified_merchant_id"] is None

    body = client.get("/api/widget/recommend", params={"region": "영월군", "limit": 5}).json()
    assert all(r["badge"] is None for r in body["recommendations"])
    assert body["expansion_sync"] == {"completed_cards": 1, "reflected": 0, "pending_sync": 1}


def test_widget_badge_ignores_merchant_ids_missing_from_the_artifact(fake_llm):
    """05 §4 — 확인된 ID여도 산출물에 아직 없으면 배지를 붙이지 않고 반영 대기로 센다."""
    _advance_to_done("AC-001", {"merchant_registration_id": "9999999-없는-가맹점"})

    body = client.get("/api/widget/recommend", params={"region": "영월군", "limit": 5}).json()
    assert all(r["badge"] is None for r in body["recommendations"])
    assert body["expansion_sync"] == {"completed_cards": 1, "reflected": 0, "pending_sync": 1}


def test_widget_blurb_is_deterministic_and_neutral(fake_llm):
    recs = client.get("/api/widget/recommend",
                      params={"region": "영월군", "category": "카페", "limit": 3}).json()["recommendations"]
    assert recs and all("영월군" in r["blurb"] and "카페" in r["blurb"] for r in recs)
    assert all("새로 생긴" not in r["blurb"] and "맛" not in r["blurb"] for r in recs)


def test_widget_blurbs_are_always_source_based(fake_llm):
    recs = client.get("/api/widget/recommend", params={"region": "영월군", "limit": 3}).json()["recommendations"]

    assert len(recs) == 3
    assert all(r["blurb"] == f"영월군의 {r['category']} 하이원포인트 가맹점이에요" for r in recs)


def test_widget_returns_empty_for_unknown_region(fake_llm):
    body = client.get("/api/widget/recommend", params={"region": "없는읍"}).json()
    assert body == {"recommendations": [], "policy_note": POLICY_NOTE, "total": 0,
                    "expansion_sync": {"completed_cards": 0, "reflected": 0, "pending_sync": 0}}
    assert body["recommendations"] == []


def test_widget_default_and_expanded_lists_expose_total(fake_llm):
    """방문객 목록은 기본 12곳, '더 보기'는 같은 필터에서 그 다음 목록을 이어서 보여 준다."""
    default = client.get("/api/widget/recommend").json()
    expanded = client.get("/api/widget/recommend", params={"limit": 24}).json()

    assert default["total"] > 12
    assert len(default["recommendations"]) == 12
    assert expanded["total"] == default["total"]
    assert len(expanded["recommendations"]) == 24
    assert [r["name"] for r in expanded["recommendations"][:12]] == [
        r["name"] for r in default["recommendations"]
    ]


# ── 8. LLM 어댑터 (실호출 없이 어댑터 자체를 검증) ───────────────────────

def test_llm_failure_never_logs_an_api_key(monkeypatch):
    """인증 실패 메시지에는 SDK가 부분 마스킹한 키가 들어 있다 — 로그·트레이스백에 남기지 않는다.

    호출부는 `log.warning(..., exc_info=True)`로 예외를 통째로 찍으므로, 원인 체인을 끊고
    마스킹된 메시지만 담은 LLMError로 바꾸는 것이 유일한 차단 지점이다 (llm.LLMError).
    """
    leaky = "Error code: 401 - Incorrect API key provided: sk-proj-abc123DEF456ghi. Check your key."

    class _FakeOpenAI:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    raise RuntimeError(leaky)

        def __init__(self, *args, **kwargs):
            pass

        def with_options(self, **kwargs):
            return self

    fake_sdk = types.ModuleType("openai")
    fake_sdk.OpenAI = _FakeOpenAI
    monkeypatch.setitem(sys.modules, "openai", fake_sdk)
    monkeypatch.setenv("LLM_PROVIDER", "openai")

    with pytest.raises(llm.LLMError) as caught:
        REAL_GENERATE_JSON("system", "user", {"type": "object"}, attempts=1)

    rendered = "".join(traceback.format_exception(caught.value))    # 호출부가 남기는 것과 같은 형태
    assert "sk-proj" not in rendered and "abc123DEF456ghi" not in rendered
    assert "<redacted-key>" in rendered
    assert "401" in rendered and "RuntimeError" in rendered         # 원인 구분은 살아 있다
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_llm_retries_with_backoff_then_wraps(monkeypatch):
    """attempts=2면 두 번 시도하고 사이에 backoff 만큼 쉰다 (llm.RETRY_BACKOFF_SECONDS)."""
    slept, calls = [], []

    class _FakeOpenAI:
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    calls.append(kwargs["model"])
                    raise RuntimeError("api down")

        def __init__(self, *args, **kwargs):
            pass

        def with_options(self, **kwargs):
            return self

    fake_sdk = types.ModuleType("openai")
    fake_sdk.OpenAI = _FakeOpenAI
    monkeypatch.setitem(sys.modules, "openai", fake_sdk)
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    monkeypatch.setattr(llm.time, "sleep", slept.append)

    with pytest.raises(llm.LLMError):
        REAL_GENERATE_JSON("system", "user", {"type": "object"}, attempts=2)

    assert len(calls) == 2
    assert slept == [llm.RETRY_BACKOFF_SECONDS]                     # 마지막 시도 뒤에는 쉬지 않는다


# ── A4: 데이터셋 버전 헤더 ────────────────────────────────────────────────

def test_api_responses_carry_dataset_version_header():
    """05 §5 — 모든 /api/* 응답에 X-Dataset-Version이 실려 화면이 어느 데이터로 만들어졌는지 드러난다."""
    res = client.get("/api/dashboard")
    assert res.status_code == 200
    version = res.headers.get("X-Dataset-Version")
    assert version and version.startswith("2025-12."), version
