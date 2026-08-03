"""B6: KPI 4종 — 카드 상태값(DynamoDB)만으로 계산, 추가 데이터 불필요 (05 문서 §3, 07 문서 B6)."""
from datetime import datetime

from fastapi import APIRouter

from app import db
from app.services import simulate

router = APIRouter()

DONE = "완료"
RUNNING = ("추진중", "완료")      # 실행 전환율 분자 (05 문서 §3)
STATUSES = ("pending", "approved", "rejected", "held")


def _elapsed_hours(card: dict) -> float | None:
    """created_at → decided_at 경과 시간(시간 단위). 두 시각 모두 KST ISO8601 (05 문서 §8)."""
    created, decided = card.get("created_at"), card.get("decided_at")
    if not created or not decided:
        return None
    try:
        return (datetime.fromisoformat(decided) - datetime.fromisoformat(created)).total_seconds() / 3600
    except (ValueError, TypeError):
        # 형식 불량·naive/aware 혼합(TypeError) 카드는 평균에서만 제외 — KPI 전체를 500으로 만들지 않는다
        return None


def _balance_index(approved: list) -> int | None:
    """지역 균형지수 = 100 − 집중도(승인 EXPANSION 카드의 6지역 분포) (05 문서 §3).

    - 완전 균등 = 100, 한 지역 몰림 = 0. 승인 1장이면 0, 서로 다른 2개 지역이면 20.
    - 집중도는 services/simulate.concentration_index(0~100 정규화 지수) 재사용 —
      대시보드 `concentration.index`(파이프라인 진단 지표)와 같은 자다.
    - 분모는 `REGIONS` 6개 지역 고정 — 승인 카드가 없는 지역도 0건으로 포함한다.
    - 대상은 `target`이 있는 EXPANSION 승인 카드뿐 (INCENTIVE는 지역이 없어 분포에 넣을 수 없음).
      해당 카드가 0장이면 분모 0이므로 null (05 문서 §8).
    """
    counts = {r: 0 for r in simulate.REGIONS}
    total = 0
    for card in approved:
        eup = (card.get("target") or {}).get("eup")
        if card.get("type") == "EXPANSION" and eup in counts:
            counts[eup] += 1
            total += 1
    if total == 0:
        return None
    return round(100 - simulate.concentration_index([counts[r] for r in simulate.REGIONS]))


@router.get("/kpi")
def get_kpi():
    """카드 0건이어도 division-by-zero 없이 응답 — 분모 0인 지표는 전부 null (05 문서 §8)."""
    cards = db.list_cards()
    by_status = {s: [c for c in cards if c.get("status") == s] for s in STATUSES}
    approved = by_status["approved"]
    running = [c for c in approved if c.get("progress") in RUNNING]
    done = [c for c in approved if c.get("progress") == DONE]
    # 평균 의사결정 소요: decided_at이 있는 모든 카드(approved+rejected+held)가 대상 (05 문서 §3)
    hours = [h for h in (_elapsed_hours(c) for c in cards) if h is not None]
    return {
        "adoption_rate": round(len(approved) / len(cards), 2) if cards else None,
        "execution_rate": round(len(running) / len(approved), 2) if approved else None,
        "avg_approval_hours": round(sum(hours) / len(hours), 1) if hours else None,
        "regional_balance_index": _balance_index(approved),
        "counts": {
            "total": len(cards),
            "pending": len(by_status["pending"]),
            "approved": len(approved),
            "rejected": len(by_status["rejected"]),
            "held": len(by_status["held"]),
            "done": len(done),
        },
    }
