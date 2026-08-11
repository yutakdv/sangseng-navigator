"""카드 응답 표현 — 저장하지 않는 파생 필드를 붙인다 (05 문서 §2 `allowed_next_progress`).

전이 규칙의 정본은 `services/workflow.py` 하나인데, 그 판정을 응답에 싣지 않으면 화면이
같은 규칙을 다시 구현할 수밖에 없다. 실제로 FE는 적격성 게이트만 복제하고 순차 전이·보류
재개 규칙은 복제하지 못해, 셀렉트가 서버가 거부할 단계를 정상 선택지로 보여준 뒤 사용자가
고르면 409가 났다. 판정을 서버가 지고 화면은 표시만 하도록 여기서 계산해 내보낸다.

**저장하지 않는다** — 카드 항목에 넣으면 다른 요청이 상태를 바꾼 뒤에도 낡은 목록이 남는다.
"""
from app.services import workflow

NOT_APPROVED_REASON = "승인된 카드만 추진 상태를 기록할 수 있습니다"
COMPLETION_EVIDENCE_HINT = "완료는 증빙과 함께 추진 기록으로 저장합니다"


def allowed_next_progress(card: dict) -> list[dict]:
    """지금 이 카드에서 고를 수 있는 단계 목록 — `{value, allowed, reason}`.

    허용되지 않는 항목도 **이유와 함께 전부 싣는다**. 목록에서 빼면 화면이 왜 못 고르는지
    말할 수 없고, 담당자는 선택지가 사라진 이유를 추측하게 된다.
    """
    options = []
    approved = card.get("status") == "approved"
    for value in workflow.progress_options(card):
        if not approved:
            options.append({"value": value, "allowed": False, "reason": NOT_APPROVED_REASON})
            continue
        allowed, detail = workflow.can_set_progress(card, value)
        entry = {"value": value, "allowed": allowed}
        if not allowed:
            entry["reason"] = detail or "허용되지 않는 추진 상태 전이입니다"
        elif value == workflow.DONE:
            # 허용이지만 빠른 상태 변경으로는 못 가는 단계 — 화면이 폼으로 유도해야 한다 (05 §8)
            entry["reason"] = COMPLETION_EVIDENCE_HINT
        options.append(entry)
    return options


def present(card: dict | None) -> dict | None:
    """API가 카드를 내보낼 때 항상 통과하는 지점."""
    if card is None:
        return None
    return {**card, "allowed_next_progress": allowed_next_progress(card)}


def present_all(cards: list[dict]) -> list[dict]:
    return [present(card) for card in cards]
