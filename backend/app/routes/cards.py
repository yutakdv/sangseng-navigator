"""B2·B4: Action Card CRUD·생성·상태 전이 (generate는 B4에서 추가)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import db

router = APIRouter()

DECISIONS = ("approved", "rejected", "held")
PROGRESSES = ("검토중", "추진중", "보류", "완료")
RATES = (3, 5, 7)


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
