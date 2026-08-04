"""Action Card 상태 전이 정본.

화면 문구와 API 검증이 같은 의미를 쓰도록 가맹점 확충 업무의 단계와
필수 적격성 항목을 이 모듈에 모은다. 기존 status 값(pending/approved/...)은
API 호환을 위해 유지하고, 실제 운영 의미는 progress와 적격성으로 구체화한다.
"""

REQUIRED_ELIGIBILITY_CHECKS = (
    "영업 상태",
    "가맹 자격",
    "사업자 참여 의향",
    "관광객 이용 적합성",
    "정산 연동 가능성",
)

CHECK_STATUSES = ("unverified", "verified", "failed")

EXPANSION_PROGRESS = (
    "후보 접촉·검토 시작",
    "적격성 확인",
    "가맹 심사",
    "추진중",
    "보류",
    "완료",
)

# 기존 시드·배포 데이터의 `검토중`은 새 의미의 첫 단계로 읽는다.
LEGACY_PROGRESS = {"검토중": "후보 접촉·검토 시작"}
INCENTIVE_PROGRESS = ("검토중", "추진중", "보류", "완료")
VERIFICATION_REQUIRED_PROGRESS = ("적격성 확인", "가맹 심사", "추진중", "완료")

EXPANSION_FLOW = tuple(value for value in EXPANSION_PROGRESS if value != "보류")
INCENTIVE_FLOW = tuple(value for value in INCENTIVE_PROGRESS if value != "보류")


def normalize_progress(card: dict) -> str | None:
    progress = card.get("progress")
    if card.get("type") == "EXPANSION":
        return LEGACY_PROGRESS.get(progress, progress)
    return progress


def normalize_checks(raw_checks) -> list[dict]:
    """구형 string[]과 신형 object[]를 동일한 체크 구조로 변환한다."""
    by_label: dict[str, str] = {}
    for raw in raw_checks or []:
        if isinstance(raw, str):
            by_label[raw] = "unverified"
            continue
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label") or raw.get("key") or "").strip()
        status = str(raw.get("status") or "unverified")
        if label in REQUIRED_ELIGIBILITY_CHECKS and status in CHECK_STATUSES:
            by_label[label] = status
    return [
        {"key": label, "label": label, "status": by_label.get(label, "unverified")}
        for label in REQUIRED_ELIGIBILITY_CHECKS
    ]


def verification_status(checks: list[dict]) -> str:
    statuses = [check.get("status") for check in checks]
    if "failed" in statuses:
        return "ineligible"
    if statuses and all(status == "verified" for status in statuses):
        return "verified"
    return "unverified"


def is_verified(card: dict) -> bool:
    if card.get("type") != "EXPANSION":
        return True
    verification = card.get("candidate_verification") or {}
    checks = normalize_checks(verification.get("checks"))
    return verification_status(checks) == "verified"


def progress_options(card: dict) -> tuple[str, ...]:
    return EXPANSION_PROGRESS if card.get("type") == "EXPANSION" else INCENTIVE_PROGRESS


def can_set_progress(card: dict, progress: str) -> tuple[bool, str | None]:
    """Validate an auditable, sequential progress transition.

    A same-state record is valid because operators often need to add a dated
    note or observed metric without claiming that the workflow advanced.
    Holding is possible from every non-completed stage; resuming must return to
    the exact stage that was active immediately before the hold.
    """
    if progress not in progress_options(card):
        return False, "지원하지 않는 추진 상태입니다"
    current = normalize_progress(card)
    if current == progress:
        return True, None
    if current == "완료":
        return False, "완료된 업무는 이전 단계로 되돌릴 수 없습니다. 정정 기록을 별도로 남겨 주세요"
    if progress == "보류":
        if current is None:
            return False, "시작되지 않은 업무는 보류로 변경할 수 없습니다"
        return True, None
    if current == "보류":
        resume = card.get("progress_before_hold")
        if card.get("type") == "EXPANSION":
            resume = LEGACY_PROGRESS.get(resume, resume)
        if not resume:
            return False, "보류 전 단계 정보가 없어 재개할 수 없습니다. 정정 기록을 먼저 남겨 주세요"
        if progress != resume:
            return False, f"보류 해제 시 직전 단계({resume})로만 재개할 수 있습니다"
    else:
        flow = EXPANSION_FLOW if card.get("type") == "EXPANSION" else INCENTIVE_FLOW
        if current is None:
            expected = flow[0]
        elif current not in flow:
            return False, f"현재 추진 상태({current})에서 전이할 수 없습니다"
        else:
            index = flow.index(current)
            expected = flow[index + 1] if index + 1 < len(flow) else None
        if progress != expected:
            if expected is None:
                return False, "더 진행할 수 있는 다음 단계가 없습니다"
            return False, f"현재 단계({current})에서는 다음 단계({expected})로만 이동할 수 있습니다"
    if card.get("type") == "EXPANSION" and progress in VERIFICATION_REQUIRED_PROGRESS and not is_verified(card):
        return False, "필수 적격성 5개 항목을 모두 확인한 뒤 선택할 수 있습니다"
    return True, None
