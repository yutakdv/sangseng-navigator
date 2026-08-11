"""Application service for validated, idempotent progress records."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, timedelta

from app import db, korean, progress_db
from app.clock import KST, now_iso
from app.services import workflow


class UnsupportedProgress(ValueError):
    pass


class InvalidProgressRecord(ValueError):
    pass


class MissingRequirement(ValueError):
    """조건부로 필수가 되는 값이 빠졌다 — 라우트가 422로 변환한다 (05 문서 §8).

    "값이 있는데 유효하지 않다"(400)와 등급을 가른다. 담당자가 할 일이 다르기 때문이다 —
    앞은 없는 값을 채우는 일이고 뒤는 잘못 쓴 값을 되돌리는 일이다.
    """


# 지표 정의의 **정본**. 단위를 자유 입력으로 열면 %와 %p를 뒤바꾼 값이 감사 기록에 남고,
# 그 오류는 화면에서 실제와 5배 다른 값으로 나타난다. 요청으로 받지 않고 여기서 채운다.
# `is_proxy`는 절대 규칙 2 — 지역 전환율은 분자·분모 단위가 달라 비율이 아니라 1인당 건수다.
# `minimum`/`maximum`/`integer`는 값이 스칼라이던 시절 pydantic 필드 제약(`ge`/`le`/`int`)이 지던
# 규칙이다. 값을 객체로 감싸면서 그 제약이 사라져 음수 건수·999% 전환율·8.7곳 같은 값이 그대로
# 리포트 수치로 올라갔다. 단위와 같은 자리에 두어 다시 흩어지지 않게 한다.
METRIC_DEFINITIONS = {
    "usage_count": {"unit": "건", "is_proxy": False, "minimum": 0, "integer": True},
    "conversion_rate_pct": {"unit": "%", "is_proxy": True, "minimum": 0, "maximum": 100},
    "active_merchant_count": {"unit": "곳", "is_proxy": False, "minimum": 0, "integer": True},
    "spend_krw": {"unit": "원", "is_proxy": False, "minimum": 0, "integer": True},
    "concentration_index": {"unit": "지수", "is_proxy": False, "minimum": 0, "maximum": 100},
}
REQUIRED_MEASUREMENT_FIELDS = ("measured_from", "measured_to", "source", "scope")
# 오류 문구는 화면에 그대로 나가므로 필드명이 아니라 담당자 용어로 말한다
MEASUREMENT_LABELS = {
    "measured_from": "측정 시작일",
    "measured_to": "측정 종료일",
    "source": "출처",
    "scope": "측정 범위",
}
DONE = "완료"


class TransitionNotAllowed(RuntimeError):
    pass


class IdempotencyConflict(RuntimeError):
    pass


def _parse_timestamp(value) -> datetime:
    if value is None:
        return datetime.now(KST)
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError as exc:
            raise InvalidProgressRecord("recorded_at은 ISO-8601 형식이어야 합니다") from exc
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise InvalidProgressRecord("recorded_at에는 시간대 오프셋이 필요합니다")
    return value.astimezone(KST)


def _as_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def _record_id(card_id: str, idempotency_key: str | None) -> tuple[str, str | None]:
    if not idempotency_key:
        return f"pr_{uuid.uuid4().hex}", None
    digest = hashlib.sha256(f"{card_id}:{idempotency_key}".encode()).hexdigest()
    return f"pr_{digest[:32]}", digest


def _json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _json_value(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value


def _request_fingerprint(payload: dict, *, default_source: str) -> str:
    """Hash the semantic request fields, excluding the idempotency key itself."""
    metrics = _json_value({
        key: value
        for key, value in (payload.get("metrics") or {}).items()
        if value is not None
    })
    canonical = {
        "progress": payload.get("progress"),
        "recorded_at": payload.get("recorded_at"),
        "progress_pct": payload.get("progress_pct"),
        "note": payload.get("note"),
        "blocker": payload.get("blocker"),
        "next_action": payload.get("next_action"),
        "owner": payload.get("owner"),
        "due_at": payload.get("due_at"),
        "source": payload.get("source") or default_source,
        "metrics": metrics,
        "completion_evidence": payload.get("completion_evidence"),
    }
    raw = json.dumps(
        _json_value(canonical),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def normalize_metrics(raw: dict | None, *, recorded_at: datetime) -> dict:
    """관측값을 저장 형태로 정규화하고 서버가 아는 단위를 채운다.

    스칼라(구형 `{"usage_count": 1362}`)로 오면 측정 메타가 없다는 뜻이므로 거부한다 —
    조용히 받아 두면 기간·출처를 모르는 숫자가 리포트 수치로 올라간다.
    """
    metrics = {}
    for key, value in (raw or {}).items():
        if value is None:
            continue
        definition = METRIC_DEFINITIONS.get(key)
        if definition is None:
            raise InvalidProgressRecord(f"지원하지 않는 관측 지표입니다: {key}")
        if not isinstance(value, dict):
            raise MissingRequirement(
                f"{key} 값에는 측정 기간·출처·범위가 필요합니다 (기간·출처 없는 숫자는 "
                "나중에 무엇을 잰 값인지 확인할 수 없습니다)"
            )
        if value.get("value") is None:
            raise MissingRequirement(f"{key}의 값이 필요합니다")
        missing = [MEASUREMENT_LABELS[f] for f in REQUIRED_MEASUREMENT_FIELDS if not value.get(f)]
        if missing:
            raise MissingRequirement(korean.i_ga(f"{key}의 {', '.join(missing)}") + " 필요합니다")
        measured_from, measured_to = _as_date(value["measured_from"]), _as_date(value["measured_to"])
        if measured_from is None or measured_to is None:
            raise InvalidProgressRecord(f"{key}의 측정 기간은 YYYY-MM-DD 형식이어야 합니다")
        if measured_from > measured_to:
            raise InvalidProgressRecord(f"{key}의 측정 시작일은 종료일보다 늦을 수 없습니다")
        if measured_to > recorded_at.date():
            raise InvalidProgressRecord(f"{key}의 측정 종료일은 기록 시각보다 미래일 수 없습니다")
        metrics[key] = {
            "value": _checked_value(key, value["value"], definition),
            "measured_from": str(value["measured_from"]),
            "measured_to": str(value["measured_to"]),
            "source": str(value["source"]),
            "scope": str(value["scope"]),
            "unit": definition["unit"],
            "is_proxy": definition["is_proxy"],
        }
    return metrics


def _checked_value(key: str, raw, definition: dict) -> float | int:
    """지표 정의의 범위·정수 제약을 적용한다 (05 문서 §2 관측 지표)."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise InvalidProgressRecord(f"{key}의 값은 숫자여야 합니다")
    low, high = definition.get("minimum"), definition.get("maximum")
    if low is not None and raw < low:
        raise InvalidProgressRecord(f"{key}의 값은 {low} 이상이어야 합니다")
    if high is not None and raw > high:
        raise InvalidProgressRecord(f"{key}의 값은 {high} 이하여야 합니다")
    if definition.get("integer"):
        if float(raw) != int(raw):
            raise InvalidProgressRecord(f"{key}의 값은 정수여야 합니다")
        return int(raw)
    return raw


def _as_date(value) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def validate_completion(card: dict, evidence: dict | None) -> dict:
    """`완료` 기록의 증빙 검사 — 타입별로 요구가 다르다 (05 문서 §2).

    완료는 위젯 확충 배지와 KPI 실행 전환율에 직결되므로 근거 없이 만들어져서는 안 된다.
    """
    evidence = {k: (v.strip() if isinstance(v, str) else v)
                for k, v in (evidence or {}).items() if v is not None}
    evidence = {k: v for k, v in evidence.items() if v != ""}   # 공백만 적은 값은 없는 것과 같다
    if card.get("type") == "EXPANSION":
        if not (evidence.get("merchant_registration_id") or evidence.get("document")):
            raise MissingRequirement(
                "확충 완료에는 가맹 등록 ID 또는 증빙 문서가 필요합니다"
            )
        return {
            "merchant_registration_id": evidence.get("merchant_registration_id"),
            "document": evidence.get("document"),
        }
    missing = [label for key, label in (
        ("applied_from", "적용 시작일"), ("applied_to", "적용 종료일"), ("owner", "책임자"),
    ) if not evidence.get(key)]
    if evidence.get("budget_cap_confirmed") is None:
        missing.append("예산 한도 확인")
    if missing:
        raise MissingRequirement(korean.i_ga(f"인센티브 완료에는 {', '.join(missing)}") + " 필요합니다")
    if not evidence["budget_cap_confirmed"]:
        raise MissingRequirement("예산 한도가 확인되지 않아 완료로 넘어갈 수 없습니다")
    applied_from, applied_to = _as_date(evidence["applied_from"]), _as_date(evidence["applied_to"])
    if applied_from is None or applied_to is None:
        raise InvalidProgressRecord("적용 기간은 YYYY-MM-DD 형식이어야 합니다")
    if applied_from > applied_to:
        raise InvalidProgressRecord("적용 시작일은 종료일보다 늦을 수 없습니다")
    return {
        "applied_from": applied_from.isoformat(),
        "applied_to": applied_to.isoformat(),
        "owner": str(evidence["owner"]),
        "budget_cap_confirmed": True,
    }


def record_progress(
    card: dict,
    payload: dict,
    *,
    default_source: str,
) -> tuple[dict, dict, bool]:
    """Create one progress record and atomically project its state onto a card.

    Returns ``(updated_card, public_record, created)``. A retried request with
    the same idempotency key returns the already committed record and
    ``created=False`` without attempting the transition a second time.
    """
    progress = str(payload.get("progress") or "")
    idempotency_key = str(payload.get("idempotency_key") or "").strip() or None
    record_id, idempotency_hash = _record_id(card["id"], idempotency_key)
    request_fingerprint = _request_fingerprint(payload, default_source=default_source)
    existing = (
        progress_db.get_record(record_id, include_internal=True)
        if idempotency_key
        else None
    )
    if existing is not None:
        if existing.get("request_fingerprint") != request_fingerprint:
            raise IdempotencyConflict(
                "같은 idempotency_key가 다른 추진 기록 요청에 이미 사용되었습니다"
            )
        return db.get_card(card["id"]), progress_db.public_record(existing), False

    if progress not in workflow.progress_options(card):
        options = "|".join(workflow.progress_options(card))
        raise UnsupportedProgress(f"progress는 {options} 중 하나여야 합니다")
    if card.get("status") != "approved":
        raise TransitionNotAllowed(
            f"승인된 카드만 추진 상태를 기록할 수 있습니다 (현재 status={card.get('status')})"
        )
    allowed, detail = workflow.can_set_progress(card, progress)
    if not allowed:
        raise TransitionNotAllowed(detail or "허용되지 않는 추진 상태 전이입니다")

    recorded = _parse_timestamp(payload.get("recorded_at"))
    now = datetime.now(KST)
    if recorded > now + timedelta(minutes=5):
        raise InvalidProgressRecord("recorded_at은 현재 시각보다 5분 이상 미래일 수 없습니다")
    created_at = _as_datetime(card.get("created_at"))
    if created_at is not None and recorded < created_at:
        raise InvalidProgressRecord("recorded_at은 카드 생성 시각보다 이를 수 없습니다")
    previous_recorded_at = _as_datetime(card.get("last_progress_record_at"))
    if previous_recorded_at is None:
        previous = progress_db.latest_record(card["id"])
        previous_recorded_at = _as_datetime(previous.get("recorded_at")) if previous else None
    if previous_recorded_at is not None and recorded < previous_recorded_at:
        raise InvalidProgressRecord("recorded_at은 이미 저장된 최신 추진 기록보다 이를 수 없습니다")

    progress_pct = payload.get("progress_pct")
    if progress == "완료" and progress_pct is not None and float(progress_pct) != 100:
        raise InvalidProgressRecord("완료 상태의 progress_pct는 100이어야 합니다")

    metrics = normalize_metrics(payload.get("metrics"), recorded_at=recorded)
    completion_evidence = None
    verified_merchant_id = None
    if progress == DONE:
        if not payload.get("allow_completion", True):
            raise MissingRequirement(
                "완료는 증빙과 함께 추진 기록으로 저장해 주세요. 빠른 상태 변경에는 "
                "가맹 등록 ID·증빙을 실을 자리가 없습니다"
            )
        completion_evidence = validate_completion(card, payload.get("completion_evidence"))
        # 가맹 등록 ID가 실리면 카드 타깃에 반영한다 — 위젯 확충 배지가 이 값으로만 붙는다(05 §4).
        # ID 없이 증빙 문서만 준 완료는 카드는 완료되되 위젯 반영은 대기로 남는다.
        # `target` 맵이 없는 카드에는 반영하지 않는다 — 중첩 경로 갱신은 DynamoDB에서
        # ValidationException(=500)이 되고, 담당자는 완료가 왜 실패했는지 알 수 없다.
        # 계약상 EXPANSION은 항상 `target`을 갖지만(§2), 구형·수기 카드 하나로 500을 내지 않는다.
        if isinstance(card.get("target"), dict):
            verified_merchant_id = completion_evidence.get("merchant_registration_id")
    target = card.get("target") or {}
    previous_progress = workflow.normalize_progress(card)
    record = {
        "record_id": record_id,
        "card_id": card["id"],
        "recorded_at": recorded.isoformat(timespec="seconds"),
        "created_at": now_iso(),
        "progress": progress,
        "previous_progress": previous_progress,
        "progress_changed": previous_progress != progress,
        "progress_pct": float(progress_pct) if progress_pct is not None else None,
        "note": payload.get("note"),
        "blocker": payload.get("blocker"),
        "next_action": payload.get("next_action"),
        "owner": payload.get("owner"),
        "due_at": payload.get("due_at"),
        "source": str(payload.get("source") or default_source),
        "metrics": metrics,
        "completion_evidence": completion_evidence,
        "card_snapshot": {
            "type": card.get("type"),
            "title": card.get("title"),
            "eup": target.get("eup"),
            "category": target.get("category"),
        },
    }
    if idempotency_hash:
        record["idempotency_hash"] = idempotency_hash
        record["request_fingerprint"] = request_fingerprint

    entering_hold = previous_progress != "보류" and progress == "보류"
    resuming_hold = previous_progress == "보류" and progress != "보류"
    try:
        updated = progress_db.write_record_and_project_card(
            card=card,
            record=record,
            expected_progress=card.get("progress"),
            expected_version=card.get("version"),
            # 적격성 게이트는 **단계를 올릴 때만** 건다 — `can_set_progress`가 같은 단계 재기록을
            # 게이트보다 먼저 통과시키므로(05 §2 "같은 상태를 다시 기록하는 것은 정상"), 여기서
            # 목표 단계만 보고 조건을 걸면 판정과 저장이 어긋난다. 실제 증상: 적격성 항목 하나가
            # failed로 바뀐 뒤 그 사실을 같은 단계 메모로 남기려 하면, 동시 요청이 없는데도
            # 조건부 쓰기가 깨져 "다른 요청이 먼저 변경했습니다"(409)가 나갔다.
            require_verified=(
                card.get("type") == "EXPANSION"
                and progress in workflow.VERIFICATION_REQUIRED_PROGRESS
                and previous_progress != progress
            ),
            entering_hold=entering_hold,
            resuming_hold=resuming_hold,
            verified_merchant_id=verified_merchant_id,
        )
    except db.ConcurrentUpdate:
        # A concurrent retry with the same key may have won the transaction.
        if idempotency_key:
            existing = progress_db.get_record(record_id, include_internal=True)
            if existing is not None:
                if existing.get("request_fingerprint") != request_fingerprint:
                    raise IdempotencyConflict(
                        "같은 idempotency_key가 다른 추진 기록 요청에 이미 사용되었습니다"
                    ) from None
                return db.get_card(card["id"]), progress_db.public_record(existing), False
        raise

    return updated, progress_db.get_record(record_id), True
