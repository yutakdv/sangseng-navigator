"""Application service for validated, idempotent progress records."""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, timedelta

from app import db, progress_db
from app.clock import KST, now_iso
from app.services import workflow


class UnsupportedProgress(ValueError):
    pass


class InvalidProgressRecord(ValueError):
    pass


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
    metrics = {
        key: value
        for key, value in (payload.get("metrics") or {}).items()
        if value is not None
    }
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
    }
    raw = json.dumps(
        _json_value(canonical),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode()).hexdigest()


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

    metrics = {
        key: value
        for key, value in (payload.get("metrics") or {}).items()
        if value is not None
    }
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
            require_verified=(
                card.get("type") == "EXPANSION"
                and progress in workflow.VERIFICATION_REQUIRED_PROGRESS
            ),
            entering_hold=entering_hold,
            resuming_hold=resuming_hold,
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
