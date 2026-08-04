"""Progress record input, timeline, and observed outcome report APIs."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import db, progress_db, security
from app.clock import KST
from app.services import progress_records, progress_report


router = APIRouter()


class ProgressMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    usage_count: int | None = Field(None, ge=0)
    conversion_rate_pct: float | None = Field(None, ge=0, le=100)
    active_merchant_count: int | None = Field(None, ge=0)
    spend_krw: int | None = Field(None, ge=0)
    concentration_index: float | None = Field(None, ge=0, le=100)


class ProgressRecordBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    progress: str
    recorded_at: datetime | None = None
    progress_pct: float | None = Field(None, ge=0, le=100)
    note: str = Field(min_length=1, max_length=2000)
    blocker: str | None = Field(None, max_length=1000)
    next_action: str | None = Field(None, max_length=1000)
    owner: str | None = Field(None, max_length=100)
    due_at: date | None = None
    source: str | None = Field(None, max_length=200)
    metrics: ProgressMetrics = Field(default_factory=ProgressMetrics)
    idempotency_key: str | None = Field(None, min_length=1, max_length=128)

    @field_validator("note")
    @classmethod
    def note_must_have_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("note에는 공백이 아닌 내용이 필요합니다")
        return value

    @field_validator("blocker", "next_action", "owner", "source", "idempotency_key")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


def _card_or_404(cid: str) -> dict:
    card = db.get_card(cid)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return card


def _timestamp_at_or_before(value, through: datetime) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return False
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST) <= through


def _approved_as_of(card: dict, through: datetime) -> bool:
    """Current approvals are immutable, but their effective date still matters."""
    return (
        card.get("status") == "approved"
        and _timestamp_at_or_before(card.get("created_at"), through)
        and _timestamp_at_or_before(card.get("decided_at"), through)
    )


def _map_progress_error(exc: Exception) -> HTTPException:
    if isinstance(exc, progress_records.UnsupportedProgress):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, progress_records.InvalidProgressRecord):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, progress_records.TransitionNotAllowed):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, progress_records.IdempotencyConflict):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, db.ConcurrentUpdate):
        return HTTPException(
            status_code=409,
            detail="다른 요청이 먼저 추진 상태를 변경했습니다. 새로고침 후 다시 시도하세요",
        )
    raise exc


@router.post("/cards/{cid}/progress-records", status_code=201)
def create_progress_record(
    cid: str,
    body: ProgressRecordBody,
    response: Response,
    _authorized: None = Depends(security.require_mutation_access),
):
    card = _card_or_404(cid)
    try:
        updated, record, created = progress_records.record_progress(
            card,
            body.model_dump(mode="json"),
            default_source="담당자 입력",
        )
    except (
        progress_records.UnsupportedProgress,
        progress_records.InvalidProgressRecord,
        progress_records.TransitionNotAllowed,
        progress_records.IdempotencyConflict,
        db.ConcurrentUpdate,
    ) as exc:
        raise _map_progress_error(exc) from None
    if not created:
        response.status_code = 200
    return {"card": updated, "record": record, "created": created}


@router.get("/cards/{cid}/progress-records")
def get_card_progress_records(
    cid: str,
    limit: int = Query(50, ge=1, le=100),
    cursor: str | None = None,
    _authorized: None = Depends(security.require_internal_access),
):
    _card_or_404(cid)
    try:
        records, next_cursor = progress_db.list_card_records(
            cid,
            limit=limit,
            cursor=cursor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"records": records, "next_cursor": next_cursor}


@router.get("/progress-report")
def get_progress_report(
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    _authorized: None = Depends(security.require_internal_access),
):
    today = datetime.now(KST).date()
    end = to_date or today
    start = from_date or (end - timedelta(days=89))
    if start > end:
        raise HTTPException(status_code=400, detail="from은 to보다 늦을 수 없습니다")
    if end > today:
        raise HTTPException(status_code=400, detail="to는 KST 오늘보다 미래일 수 없습니다")
    if (end - start).days >= 366:
        raise HTTPException(status_code=400, detail="리포트 조회 기간은 최대 366일입니다")

    through = datetime.combine(end, time.max, tzinfo=KST)
    cards = db.list_cards()
    approved = [card for card in cards if _approved_as_of(card, through)]
    records = progress_db.list_report_records(start, end)
    latest_by_card = {}
    for card in approved:
        latest = progress_db.latest_record(card["id"], through=through)
        if latest is not None:
            latest_by_card[card["id"]] = latest
    return progress_report.build_progress_report(
        approved_cards=approved,
        period_records=records,
        latest_by_card=latest_by_card,
        start=start,
        end=end,
    )
