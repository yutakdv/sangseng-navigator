"""B2·B4·B5: Action Card CRUD·생성·상태 전이·시뮬레이션 (generate는 B4에서 추가)."""
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import dataload, db, llm, prompts
from app.services import simulate

router = APIRouter()

DECISIONS = ("approved", "rejected", "held")
PROGRESSES = ("검토중", "추진중", "보류", "완료")
RATES = (3, 5, 7)

ASSUMPTION_NOTE = "가정 기반 전망이며 실제와 다를 수 있음"   # 절대 규칙 3 — 고정 문구
NARRATIVE_SCHEMA = {
    "type": "object",
    "properties": {"narrative": {"type": "string"}},
    "required": ["narrative"],
    "additionalProperties": False,
}


class DecisionBody(BaseModel):
    decision: str
    selected_rate: int | None = None      # INCENTIVE 승인 시에만 필수 (05 문서 §2·§8)


class ProgressBody(BaseModel):
    progress: str


def _get_or_404(cid: str) -> dict:
    card = db.get_card(cid)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return card


def _log(card: dict, action: str):
    """상태 변경 이력 append (05 문서 §7)."""
    card.setdefault("events", []).append({"at": db.now_iso(), "action": action})


@router.get("/cards")
def get_cards(type: str | None = None, status: str | None = None):
    cards = db.list_cards()
    if type:
        cards = [c for c in cards if c.get("type") == type]
    if status:
        cards = [c for c in cards if c.get("status") == status]
    cards.sort(key=lambda c: c.get("created_at") or "", reverse=True)
    return {"cards": cards}


@router.get("/cards/{cid}")
def get_one(cid: str):
    return {"card": _get_or_404(cid)}


@router.post("/cards/{cid}/decision")
def decide(cid: str, body: DecisionBody):
    """승인/반려/보류 — pending 카드에서만 가능 (05 문서 §8)."""
    if body.decision not in DECISIONS:
        raise HTTPException(status_code=400, detail="decision은 approved|rejected|held 중 하나여야 합니다")
    card = _get_or_404(cid)
    if card.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"pending 카드만 결정할 수 있습니다 (현재 status={card.get('status')})")
    if body.decision == "approved" and card.get("type") == "INCENTIVE":
        if body.selected_rate not in RATES:
            raise HTTPException(status_code=400, detail="selected_rate(3|5|7)가 필요합니다")
        card["selected_rate"] = body.selected_rate      # EXPANSION에 온 selected_rate는 무시
    card["status"] = body.decision
    card["decided_at"] = db.now_iso()                   # 반려·보류도 기록 (05 문서 §3 avg_approval_hours)
    if body.decision == "approved":
        card["progress"] = "검토중"
    _log(card, body.decision)
    db.put_card(card)
    return {"card": card}


def _fallback_narrative(r: dict) -> str:
    """LLM 실패 시 규칙 기반 문구 — 수치 포함, '예상'·'가정' 포함, 3문장 이내 존댓말."""
    lo, hi = r["delta_pp"]
    return (f"{r['eup']} {r['category']} 업종에 신규 가맹점이 1곳 추가되면 지역 소비 집중도가 "
            f"{r['current_index']}에서 {r['projected_index']}로, 약 {lo}~{hi}%p 개선될 것으로 예상됩니다. "
            "이는 유사 가맹점의 평균 초기 실적을 가정한 전망이며, 실제 결과는 입지·홍보 여부에 따라 "
            "달라질 수 있습니다.")


@router.post("/cards/{cid}/simulate")
def simulate_card(cid: str):
    """확보 시 예상 효과 — EXPANSION 반사실 재계산 + LLM 설명 (05 문서 §2, 07 문서 B5)."""
    card = _get_or_404(cid)
    if card.get("type") != "EXPANSION":     # EXPANSION 전용 — 400 규칙이 우선 (05 문서 §8)
        raise HTTPException(status_code=400, detail="INCENTIVE 카드는 scenarios를 사용합니다")
    try:
        usage = dataload.load("usage_monthly")
        merchants = dataload.load("merchants")      # §1 merchants 배열 — 요청 시점 로드
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"{exc}.json이 아직 생성되지 않았습니다")
    if not merchants:       # 폴백 체인 3단계 분모(전체 가맹점 수) 0 방지 — 빈 산출물도 미준비로 본다
        raise HTTPException(status_code=503, detail="merchants.json에 가맹점이 없습니다")
    target = card.get("target") or {}
    result = simulate.simulate_expansion(usage, merchants, target.get("eup"), target.get("category"))

    # narrative에 '예상'·'가정'이 항상 포함되도록 입력에 지침을 싣고, 누락 시 fallback으로 대체
    user_payload = {
        "대상": f"{result['eup']} {result['category']} 업종 신규 가맹점 1곳",
        "현재 지역 소비 집중도": result["current_index"],
        "확보 시 예상 집중도": result["projected_index"],
        "예상 개선폭 범위(%p)": result["delta_pp"],
        "신규 가맹점 예상 월 이용 건수(가정치)": result["expected_monthly_count"],
        "작성 지침": "설명문에 '예상'과 '가정' 두 단어를 반드시 포함할 것",
    }
    narrative = None
    try:
        out = llm.generate_json(prompts.SIMULATE_PROMPT, json.dumps(user_payload, ensure_ascii=False),
                                NARRATIVE_SCHEMA, schema_name="narrative", timeout=8)
        narrative = out.get("narrative")
    except Exception:
        pass
    if not narrative or "예상" not in narrative or "가정" not in narrative:
        narrative = _fallback_narrative(result)
    return {"simulation": {
        "current_index": result["current_index"],
        "projected_index": result["projected_index"],
        "delta_pp": result["delta_pp"],
        "narrative": narrative,
        "assumption_note": ASSUMPTION_NOTE,
    }}


@router.post("/cards/{cid}/progress")
def set_progress(cid: str, body: ProgressBody):
    """추진 상태 변경 — approved 카드에서만 가능 (05 문서 §8)."""
    if body.progress not in PROGRESSES:
        raise HTTPException(status_code=400, detail="progress는 검토중|추진중|보류|완료 중 하나여야 합니다")
    card = _get_or_404(cid)
    if card.get("status") != "approved":
        raise HTTPException(status_code=409, detail=f"승인된 카드만 추진 상태를 변경할 수 있습니다 (현재 status={card.get('status')})")
    card["progress"] = body.progress
    _log(card, f"progress:{body.progress}")
    db.put_card(card)
    return {"card": card}
