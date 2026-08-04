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
from datetime import datetime
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

from fastapi.testclient import TestClient        # noqa: E402

from app.main import app                         # noqa: E402  (.env 로드가 app.db 바인딩보다 먼저)
from app import dataload                         # noqa: E402
from app import db                               # noqa: E402
from app import llm                              # noqa: E402
from app.services import simulate                # noqa: E402

import seed_demo                                 # noqa: E402

client = TestClient(app)

# ── 05 문서가 고정한 계약 문구·값 (바뀌면 FE와 어긋난다) ──
ASSUMPTION_NOTE = "가정 기반 전망이며 실제와 다를 수 있음"
INCENTIVE_ASSUMPTION_NOTE = "페이백률-전환율 관계는 실측 데이터가 없어 팀 설정 가정(탄력성)에 기반한 전망"
POLICY_NOTE = "확충 완료된 신규 가맹점을 우선 추천합니다"
EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"]
SCENARIO_RATES = [3, 5, 7]
MANDATORY_INCENTIVE_RISKS = ["예산", "약관", "미구현"]
KST_OFFSET = "+09:00"                                       # 05 §8 시각 표기 — 모든 타임스탬프 KST
# health의 산출물별 보고 대상 (05 §6 산출 JSON). risk_signal은 07 B4 ⑥ "없으면 컷"인 선택 입력이라
# data_loaded(필수 AND) 판정에서 빠진다.
REQUIRED_DATASETS = ["dashboard", "eup_scores", "candidates", "merchants"]
OPTIONAL_DATASET = "risk_signal"

# ── LLM 목업 응답 (실호출 금지) ──
FAKE_COMPARISON = "목업 비교문 — 1순위와 2순위를 비교한 문장입니다."
FAKE_AI = {
    "adjusted": True,
    "ai_rank_target": "영월군 소매점",       # 시드 카드(카페=추진중, 음식점=pending)와 겹치지 않는 타깃
    "comparison": FAKE_COMPARISON,
    "reasons": ["목업 근거 1", "목업 근거 2"],
    "risks": ["목업 리스크 1"],
    "expected_effect": "목업 예상 효과",      # 고정 문구 없음 — 서버가 붙이는지 확인용
    "confidence": "상",
}
FAKE_NARRATIVE = "목업 서술입니다. 가정에 기반한 예상 수치입니다."
FAKE_BLURB = "목업 추천 문구"


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
        self.blurbs = None                                          # None이면 가맹점 수만큼 자동 생성

    def __call__(self, system, user, schema, schema_name="result", timeout=None, attempts=2):
        self.calls.append(schema_name)
        self.attempts.append(attempts)
        props = schema.get("properties", {})
        if "narrative" in props:                                    # cards.simulate
            return {"narrative": self.narrative}
        if "blurbs" in props:                                       # widget.recommend
            if self.blurbs is not None:
                return {"blurbs": self.blurbs}
            n = len(json.loads(user)["가맹점"])
            return {"blurbs": [f"{FAKE_BLURB} {i + 1}" for i in range(n)]}
        return {**FAKE_AI, "ai_rank_target": self.ai_rank_target}   # cardgen (CARD_AI_SCHEMA)


@pytest.fixture(autouse=True)
def fake_llm(monkeypatch):
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


def _put_expansion(cid, eup, category, status="pending", progress=None):
    """최소 EXPANSION 카드 직접 put — 시드로는 못 만드는 타깃·상태 조합이 필요할 때만 쓴다."""
    db.put_card({"id": cid, "type": "EXPANSION", "status": status, "progress": progress,
                 "title": f"{eup} {category} 업종 가맹점 확충",
                 "target": {"eup": eup, "category": category},
                 "created_at": db.now_iso(),
                 "decided_at": None if status == "pending" else db.now_iso(), "events": []})


# ── 1. health / 정적 서빙 ────────────────────────────────────────────────

def test_health_reports_dataset_breakdown():
    """05 §5 — 기존 키(ok·data_loaded)를 유지한 채 산출물별 로드 여부를 함께 보고한다."""
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()

    assert body["ok"] is True and body["data_loaded"] is True
    assert set(body["datasets"]) == set(REQUIRED_DATASETS) | {OPTIONAL_DATASET}
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


def test_dashboard_returns_real_data():
    """05 §1 — 값이 아니라 구조·타입·범위로 검증 (실데이터는 파이프라인 재실행마다 바뀐다)."""
    res = client.get("/api/dashboard")
    assert res.status_code == 200
    body = res.json()

    conv = body["conversion"]
    assert isinstance(conv["headline_rate"], (int, float)) and conv["headline_rate"] > 0
    assert conv["is_proxy"] is True                     # 절대 규칙 2 — 근사 지표 배지의 근거
    assert "입장 연인원" in conv["proxy_note"]           # 05 §1 — 배지만으로 못 막는 오인 차단 문구
    assert "28.5%" in conv["proxy_note"]                # 금액 기준 공식 비율과 다른 지표임을 고지
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


# ── 2. 카드 목록 (seed --reset 상태) ─────────────────────────────────────

def test_cards_list_reflects_demo_seed():
    cards = _cards()
    assert len(cards) == 3
    assert [c["id"] for c in cards] == ["AC-002", "INC-001", "AC-001"]   # created_at 내림차순

    assert len(client.get("/api/cards", params={"type": "EXPANSION"}).json()["cards"]) == 2
    pending = client.get("/api/cards", params={"status": "pending"}).json()["cards"]
    assert {c["id"] for c in pending} == {"AC-002", "INC-001"}

    one = client.get("/api/cards/AC-001")
    assert one.status_code == 200 and one.json()["card"]["progress"] == "추진중"
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
    assert fake_llm.attempts == [2]                                   # 재시도 기본값 유지 (위젯만 1회)

    assert card["id"] == "AC-003" and card["type"] == "EXPANSION"
    assert card["status"] == "pending" and card["progress"] is None   # 절대 규칙 4 — AI는 제안만
    assert card["target"] == {"eup": "영월군", "category": "소매점"}
    assert card["ai_rank"] == 1 and card["score_rank"] != 1 and card["ai"]["adjusted"] is True
    assert card["ai"]["comparison"] == FAKE_COMPARISON                # LLM 출력이 그대로 실렸는지
    assert card["ai"]["risks"]                                        # A-1 규칙 — 리스크 ≥1
    assert ASSUMPTION_NOTE in card["ai"]["expected_effect"]           # 절대 규칙 3 — 고정 문구 보장
    assert card["sources"] == EXPANSION_SOURCES
    assert card["scenarios"] is None and card["decided_at"] is None
    assert [e["action"] for e in card["events"]] == ["generated"]

    ranking = card["ai"]["original_ranking"]                          # 절대 규칙 5 — 정량 순위 병기
    assert [r["rank"] for r in ranking] == list(range(1, len(ranking) + 1))
    assert all({"rank", "candidate", "score"} == set(r) for r in ranking)


def test_generate_expansion_is_idempotent_for_same_target():
    """05 §8 중복 가드 — 동일 (type, target)의 pending 카드가 있으면 기존 카드를 200으로 반환."""
    first = _generate("EXPANSION")
    assert first.status_code == 201
    second = _generate("EXPANSION")
    assert second.status_code == 200
    assert second.json()["card"]["id"] == first.json()["card"]["id"]
    assert len(_cards()) == 4


def test_generate_skips_target_already_in_progress(fake_llm):
    """추진중 타깃(AC-001 영월군 카페)을 AI가 제안해도 다른 후보로 통째 교체된다 (A-1 중복 제안 금지)."""
    fake_llm.ai_rank_target = "영월군 카페"
    card = _generate("EXPANSION").json()["card"]

    assert card["target"]["category"] != "카페"
    assert card["ai"]["comparison"] != FAKE_COMPARISON       # 타깃-사유 불일치 방지: 텍스트까지 교체
    assert card["ai"]["risks"] and card["ai"]["original_ranking"]
    assert ASSUMPTION_NOTE in card["ai"]["expected_effect"]


def test_generate_returns_409_when_every_candidate_is_blocked(fake_llm):
    """전 후보가 추진중/완료면 A-1 중복 제안 금지의 결론은 '제안할 카드 없음' — 409로 알린다.

    후보 하나를 골라 되돌아가면 A-1이 금지한 타깃의 카드가 저장되므로, 조용한 폴백이 아니라
    에러가 정답이다.
    """
    for i, cand in enumerate(dataload.load("candidates"), start=100):
        _put_expansion(f"AC-{i}", cand["eup"], cand["category"],
                       status="approved", progress="추진중")
    before = {c["id"] for c in _cards()}

    res = _generate("EXPANSION")
    assert res.status_code == 409
    assert fake_llm.calls == []                     # 가용성 판정이 LLM 호출보다 앞선다 (12초 낭비 방지)
    assert {c["id"] for c in _cards()} == before    # 새 카드도, 덮어쓴 카드도 없다


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


def test_generate_incentive_builds_scenarios(fake_llm):
    dup = _generate("INCENTIVE")                            # 시드의 pending INC-001이 그대로 반환
    assert dup.status_code == 200 and dup.json()["card"]["id"] == "INC-001"

    assert client.post("/api/cards/INC-001/decision", json={"decision": "rejected"}).status_code == 200
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


def test_generate_rejects_unknown_type():
    assert _generate("SOMETHING").status_code == 400


# ── 4. decision / progress (상태 전이·에러 경로) ─────────────────────────

def test_decision_approves_expansion_card():
    res = client.post("/api/cards/AC-002/decision", json={"decision": "approved"})
    assert res.status_code == 200
    card = res.json()["card"]
    assert card["status"] == "approved" and card["progress"] == "검토중"
    assert card["decided_at"] and card["events"][-1]["action"] == "approved"

    again = client.post("/api/cards/AC-002/decision", json={"decision": "approved"})
    assert again.status_code == 409                                  # pending이 아니면 409


def test_decision_holds_card():
    """05 §2 — held도 '결정'이라 decided_at·events를 남긴다. 승인이 아니므로 progress는 붙지 않는다."""
    res = client.post("/api/cards/AC-002/decision", json={"decision": "held"})
    assert res.status_code == 200
    card = res.json()["card"]

    assert card["status"] == "held" and card["progress"] is None
    assert card["decided_at"].endswith(KST_OFFSET)                 # 05 §8 시각 표기
    assert [e["action"] for e in card["events"]] == ["generated", "held"]
    assert card["events"][-1]["at"].endswith(KST_OFFSET)

    # pending이 아니게 됐으므로 재결정 409, 승인 상태가 아니므로 progress도 409 (05 §8)
    assert client.post("/api/cards/AC-002/decision",
                       json={"decision": "approved"}).status_code == 409
    assert client.post("/api/cards/AC-002/progress",
                       json={"progress": "추진중"}).status_code == 409

    kpi = client.get("/api/kpi").json()
    assert kpi["counts"]["held"] == 1                               # 05 §3 counts에 집계
    assert kpi["avg_approval_hours"] > 0     # decided_at 있는 모든 카드가 평균 대상 (approved+rejected+held)


def test_decision_error_paths():
    assert client.post("/api/cards/AC-999/decision", json={"decision": "approved"}).status_code == 404
    assert client.post("/api/cards/AC-002/decision", json={"decision": "yes"}).status_code == 400
    assert client.post("/api/cards/AC-001/decision", json={"decision": "approved"}).status_code == 409


def test_incentive_approval_requires_selected_rate():
    """05 §8 — INCENTIVE approved에는 selected_rate(3|5|7)가 필수, EXPANSION에 온 값은 무시."""
    assert client.post("/api/cards/INC-001/decision",
                       json={"decision": "approved"}).status_code == 400
    assert client.post("/api/cards/INC-001/decision",
                       json={"decision": "approved", "selected_rate": 4}).status_code == 400

    card = client.post("/api/cards/INC-001/decision",
                       json={"decision": "approved", "selected_rate": 5}).json()["card"]
    assert card["selected_rate"] == 5 and card["progress"] == "검토중"

    exp = client.post("/api/cards/AC-002/decision",
                      json={"decision": "approved", "selected_rate": 7}).json()["card"]
    assert exp.get("selected_rate") is None


def test_incentive_scenarios_survive_decimal_round_trip():
    """05 §8 숫자 직렬화 — 읽기-수정-쓰기를 반복해도 delta_pp가 float로 남는다 ([1.0, 2.0] → [1, 2] 방지).

    승인·추진 상태 변경은 카드를 통째로 다시 저장하므로, Decimal 복원이 정수로 내려앉으면
    FE의 "1~2%p"가 조용히 "1~2"로 바뀐다.
    """
    approved = client.post("/api/cards/INC-001/decision",
                           json={"decision": "approved", "selected_rate": 5}).json()["card"]
    assert client.post("/api/cards/INC-001/progress",
                       json={"progress": "완료"}).status_code == 200      # 두 번째 왕복
    stored = client.get("/api/cards/INC-001").json()["card"]

    for card in (approved, stored):
        assert [s["rate"] for s in card["scenarios"]] == SCENARIO_RATES
        assert all(isinstance(v, float) for s in card["scenarios"] for v in s["delta_pp"])
    assert next(s["delta_pp"] for s in stored["scenarios"] if s["rate"] == 5) == [1.0, 2.0]
    assert stored["selected_rate"] == 5 and isinstance(stored["selected_rate"], int)


def test_progress_transitions_require_approved_card():
    for step in ("추진중", "완료"):
        card = client.post("/api/cards/AC-001/progress", json={"progress": step}).json()["card"]
        assert card["progress"] == step
        assert card["events"][-1]["action"] == f"progress:{step}" and card["events"][-1]["at"]

    assert client.post("/api/cards/AC-002/progress",
                       json={"progress": "추진중"}).status_code == 409     # pending 카드
    assert client.post("/api/cards/AC-001/progress",
                       json={"progress": "진행중"}).status_code == 400     # 허용 밖 값
    assert client.post("/api/cards/AC-999/progress",
                       json={"progress": "완료"}).status_code == 404


# ── 5. simulate (LLM monkeypatch) ────────────────────────────────────────

def test_simulate_expansion_card(fake_llm):
    res = client.post("/api/cards/AC-002/simulate")
    assert res.status_code == 200
    sim = res.json()["simulation"]
    assert fake_llm.calls == ["narrative"]
    assert fake_llm.attempts == [2]                                # 재시도 기본값 유지 (위젯만 1회)

    assert 0 <= sim["current_index"] <= 100 and 0 <= sim["projected_index"] <= 100
    lo, hi = sim["delta_pp"]
    assert lo <= hi and all(isinstance(v, (int, float)) for v in sim["delta_pp"])
    assert sim["narrative"] == FAKE_NARRATIVE                     # LLM 문구 채택 (fallback 아님)
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert sim["assumption_note"] == ASSUMPTION_NOTE              # 절대 규칙 3 — 고정 문구


def test_simulate_falls_back_when_llm_fails(monkeypatch):
    """LLM 실패 시에도 200 + 규칙 기반 문구 — 데모 루프가 LLM 장애에 끊기지 않아야 한다 (05 §8)."""
    def boom(*args, **kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(llm, "generate_json", boom)
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert sim["assumption_note"] == ASSUMPTION_NOTE


def test_simulate_rejects_narrative_missing_required_words(fake_llm):
    """스키마는 맞지만 '예상'·'가정'이 빠진 narrative는 규칙 기반 문구로 대체된다 (절대 규칙 3)."""
    fake_llm.narrative = "짧은 문장입니다."
    sim = client.post("/api/cards/AC-002/simulate").json()["simulation"]

    assert fake_llm.calls == ["narrative"]                     # 예외가 아니라 내용 가드가 걸린 경로
    assert sim["narrative"] != fake_llm.narrative
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert "영월군 음식점" in sim["narrative"]                  # 규칙 기반 문구 형태 (AC-002 타깃)


def test_simulate_rejects_narrative_with_wrong_direction(fake_llm):
    """집중 심화(음수 delta)를 '개선'으로 서술한 narrative는 채택하지 않는다 (cards.py wrong_direction)."""
    _put_expansion("AC-900", "사북읍", "카페")                  # 이미 소비가 몰린 지역 = 음수 delta
    fake_llm.narrative = "지역 소비 집중도가 개선될 것으로 예상됩니다. 가정에 기반한 수치입니다."
    sim = client.post("/api/cards/AC-900/simulate").json()["simulation"]

    assert sum(sim["delta_pp"]) < 0                            # 전제: 집중 심화 방향
    assert sim["narrative"] != fake_llm.narrative
    assert "상승(집중 심화)" in sim["narrative"]
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]


def test_simulate_reports_no_change_without_claiming_a_direction(fake_llm):
    """변화가 없는 구간(delta [0.0, 0.0])은 방향을 붙이지 않고 LLM에도 맡기지 않는다.

    실데이터 36조합 중 19개가 여기 해당하고 시드 카드 AC-001의 타깃(영월군 카페)도 포함된다.
    부호로만 판정하면 "약 0.0~0.0%p 상승(집중 심화)"처럼 없는 변화를 단정하게 된다.
    """
    sim = client.post("/api/cards/AC-001/simulate").json()["simulation"]

    assert sim["delta_pp"] == [0.0, 0.0]                        # 전제: 변화 없는 구간
    assert fake_llm.calls == []                                 # LLM에 맡기지 않는다
    assert "개선" not in sim["narrative"] and "심화" not in sim["narrative"]
    assert "변화가 나타나지 않을" in sim["narrative"]
    assert "예상" in sim["narrative"] and "가정" in sim["narrative"]
    assert sim["assumption_note"] == ASSUMPTION_NOTE


def test_simulate_never_emits_negative_zero():
    """round(-0.001, 1)은 -0.0이라 그대로 실으면 화면에 "-0.0%p"가 찍힌다 (simulate._round_pp)."""
    usage, merchants = dataload.load("usage_monthly"), dataload.load("merchants")
    categories = sorted({m["category"] for m in merchants})

    seen_zero = False
    for eup in simulate.REGIONS:
        for category in categories:
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


# ── 6. KPI ──────────────────────────────────────────────────────────────

def test_kpi_matches_card_state():
    """05 §3 — 4지표 전부를 카드 목록에서 독립적으로 재계산해 대조한다."""
    client.post("/api/cards/AC-002/decision", json={"decision": "approved"})
    client.post("/api/cards/AC-002/progress", json={"progress": "완료"})

    cards = _cards()
    kpi = client.get("/api/kpi").json()

    approved = [c for c in cards if c["status"] == "approved"]
    running = [c for c in approved if c.get("progress") in ("추진중", "완료")]
    done = [c for c in approved if c.get("progress") == "완료"]
    hours = [(datetime.fromisoformat(c["decided_at"]) - datetime.fromisoformat(c["created_at"])
              ).total_seconds() / 3600 for c in cards if c.get("decided_at")]

    assert kpi["adoption_rate"] == round(len(approved) / len(cards), 2)
    assert kpi["execution_rate"] == round(len(running) / len(approved), 2)
    assert kpi["avg_approval_hours"] == round(sum(hours) / len(hours), 1) > 0
    assert 0 <= kpi["regional_balance_index"] <= 100
    assert kpi["counts"] == {
        "total": len(cards), "pending": sum(1 for c in cards if c["status"] == "pending"),
        "approved": len(approved), "rejected": sum(1 for c in cards if c["status"] == "rejected"),
        "held": sum(1 for c in cards if c["status"] == "held"), "done": len(done),
    }


def test_kpi_survives_empty_table():
    """05 §8 — 카드 0건이어도 division-by-zero 없이 응답, 분모 0 지표는 null."""
    seed_demo.clear_table()
    kpi = client.get("/api/kpi").json()
    assert kpi["adoption_rate"] is None and kpi["execution_rate"] is None
    assert kpi["avg_approval_hours"] is None and kpi["regional_balance_index"] is None
    assert kpi["counts"]["total"] == 0


# ── 7. 위젯 (신규 배지·페이백·blurb) ─────────────────────────────────────

def test_widget_promotes_completed_targets_and_payback(fake_llm):
    """05 §4 — 완료 카드 전/후로 추천 순서가 바뀌고, 배지·페이백이 붙는다 (데모 마지막 동선)."""
    before = client.get("/api/widget/recommend", params={"region": "영월군"}).json()
    assert before["policy_note"] == POLICY_NOTE
    assert len(before["recommendations"]) == 3
    assert all(r["badge"] is None and r["payback"] is None for r in before["recommendations"])
    assert [r["blurb"] for r in before["recommendations"]] == [f"{FAKE_BLURB} {i}" for i in (1, 2, 3)]

    client.post("/api/cards/AC-001/progress", json={"progress": "완료"})     # 영월군 × 카페
    client.post("/api/cards/INC-001/decision", json={"decision": "approved", "selected_rate": 5})
    client.post("/api/cards/INC-001/progress", json={"progress": "완료"})

    after = client.get("/api/widget/recommend", params={"region": "영월군"}).json()
    recs = after["recommendations"]
    assert [r["name"] for r in recs] != [r["name"] for r in before["recommendations"]]
    assert [r["category"] for r in recs[:2]] == ["카페", "카페"]
    assert [r["badge"] for r in recs[:2]] == ["신규", "신규"]
    assert all(r["payback"] == {"rate": 5, "label": "지금 여기서 쓰면 5% 페이백"} for r in recs)
    assert all({"name", "category", "address", "lat", "lng"} <= set(r) for r in recs)
    assert fake_llm.calls == ["blurbs", "blurbs"]
    assert fake_llm.attempts == [1, 1]      # 위젯만 재시도 끔 — 최악 지연 5초 (timeout 5s × 1회)


def test_widget_blurb_falls_back_when_llm_fails(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("llm down")

    monkeypatch.setattr(llm, "generate_json", boom)
    recs = client.get("/api/widget/recommend",
                      params={"region": "영월군", "category": "카페"}).json()["recommendations"]
    assert recs and all("영월군" in r["blurb"] and "카페" in r["blurb"] for r in recs)


def test_widget_fills_missing_blurbs(fake_llm):
    """LLM이 요청 수보다 적게 돌려줘도 부족분만 규칙 기반 문구로 채운다 (widget._blurbs)."""
    fake_llm.blurbs = ["하나만"]
    recs = client.get("/api/widget/recommend", params={"region": "영월군"}).json()["recommendations"]

    assert len(recs) == 3
    assert recs[0]["blurb"] == "하나만"
    assert all(r["blurb"] == f"영월군의 {r['category']} 하이원포인트 가맹점이에요" for r in recs[1:])


def test_widget_returns_empty_for_unknown_region(fake_llm):
    body = client.get("/api/widget/recommend", params={"region": "없는읍"}).json()
    assert body == {"recommendations": [], "policy_note": POLICY_NOTE}
    assert fake_llm.calls == []                                   # 결과 0건이면 LLM 호출도 없다
