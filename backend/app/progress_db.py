"""Progress record persistence and card-state transactions.

Progress records are kept outside the card item so an audit trail cannot grow a
single DynamoDB item past the 400 KiB item limit.  A record Put and the compact
current-state projection on the card are committed with one TransactWriteItems
request; callers therefore never observe a card state without its source record.
"""
from __future__ import annotations

import base64
import json
import os
from datetime import date, datetime, time
from typing import Iterable

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from app import db
from app.clock import KST


TABLE_NAME = os.environ.get("PROGRESS_RECORDS_TABLE") or "sangseng-progress-records"
CARD_RECORDED_AT_INDEX = "card-recorded-at-index"
REPORT_BUCKET_RECORDED_AT_INDEX = "report-bucket-recorded-at-index"

_kw = {"region_name": os.environ.get("AWS_REGION", "ap-northeast-2")}
if os.environ.get("DYNAMO_ENDPOINT"):
    _kw["endpoint_url"] = os.environ["DYNAMO_ENDPOINT"]
_resource = boto3.resource("dynamodb", **_kw)
_table = _resource.Table(TABLE_NAME)
_client = _resource.meta.client


def _serialize_map(value: dict) -> dict:
    """Prepare a native dict for the resource-derived client's TransactWriteItems.

    ``_resource.meta.client``에는 boto3 문서형 변환기가 붙어 있어 **네이티브 파이썬 값**을
    받는다 — TypeSerializer로 저수준 형식({"N": "1"})까지 만들면 이중 직렬화가 되어
    MAP으로 해석되고 ValidationException(500)이 난다. float→Decimal 변환만 하면 된다.
    """
    return db._to_ddb(value)  # noqa: SLF001 - shared Decimal conversion contract


def _public(record: dict | None) -> dict | None:
    if record is None:
        return None
    clean = db._clean(record)  # noqa: SLF001 - shared Decimal response contract
    return {
        key: value
        for key, value in clean.items()
        if key not in {
            "recorded_at_key",
            "report_bucket",
            "idempotency_hash",
            "request_fingerprint",
        }
    }


def public_record(record: dict | None) -> dict | None:
    """Strip storage-only idempotency and index attributes from a record."""
    return _public(record)


def ensure_table() -> bool:
    """Create the local progress-record table and both query GSIs when absent."""
    try:
        _client.describe_table(TableName=TABLE_NAME)
        return False
    except _client.exceptions.ResourceNotFoundException:
        _client.create_table(
            TableName=TABLE_NAME,
            KeySchema=[{"AttributeName": "record_id", "KeyType": "HASH"}],
            AttributeDefinitions=[
                {"AttributeName": "record_id", "AttributeType": "S"},
                {"AttributeName": "card_id", "AttributeType": "S"},
                {"AttributeName": "report_bucket", "AttributeType": "S"},
                {"AttributeName": "recorded_at_key", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": CARD_RECORDED_AT_INDEX,
                    "KeySchema": [
                        {"AttributeName": "card_id", "KeyType": "HASH"},
                        {"AttributeName": "recorded_at_key", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
                {
                    "IndexName": REPORT_BUCKET_RECORDED_AT_INDEX,
                    "KeySchema": [
                        {"AttributeName": "report_bucket", "KeyType": "HASH"},
                        {"AttributeName": "recorded_at_key", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                },
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        _client.get_waiter("table_exists").wait(TableName=TABLE_NAME)
        return True


def clear_table() -> list[str]:
    """Delete every progress record. Intended for local seed/test reset only."""
    record_ids: list[str] = []
    kwargs: dict = {"ProjectionExpression": "record_id"}
    while True:
        page = _table.scan(**kwargs)
        record_ids.extend(item["record_id"] for item in page.get("Items", []))
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            break
        kwargs["ExclusiveStartKey"] = cursor
    if record_ids:
        with _table.batch_writer() as batch:
            for record_id in record_ids:
                batch.delete_item(Key={"record_id": record_id})
    return record_ids


def get_record(record_id: str, *, include_internal: bool = False) -> dict | None:
    item = _table.get_item(Key={"record_id": record_id}, ConsistentRead=True).get("Item")
    if include_internal:
        return db._clean(item)  # noqa: SLF001 - idempotency validation needs the fingerprint
    return _public(item)


def _encode_cursor(key: dict | None) -> str | None:
    if not key:
        return None
    raw = json.dumps(db._clean(key), ensure_ascii=False, separators=(",", ":"))  # noqa: SLF001
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> dict:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid progress record cursor") from exc
    required = {"record_id", "card_id", "recorded_at_key"}
    if (
        not isinstance(value, dict)
        or not required.issubset(value)
        or any(not isinstance(value[key], str) or not value[key] for key in required)
    ):
        raise ValueError("invalid progress record cursor")
    return value


def list_card_records(
    card_id: str,
    *,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[dict], str | None]:
    """Return one card's records newest-first using the card timeline GSI."""
    kwargs: dict = {
        "IndexName": CARD_RECORDED_AT_INDEX,
        "KeyConditionExpression": Key("card_id").eq(card_id),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if cursor:
        exclusive_start_key = _decode_cursor(cursor)
        if exclusive_start_key["card_id"] != card_id:
            raise ValueError("progress record cursor does not belong to this card")
        kwargs["ExclusiveStartKey"] = exclusive_start_key
    page = _table.query(**kwargs)
    records = [_public(item) for item in page.get("Items", [])]
    return records, _encode_cursor(page.get("LastEvaluatedKey"))


def _month_buckets(start: date, end: date) -> Iterable[str]:
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        yield f"{year:04d}-{month:02d}"
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1


def list_report_records(start: date, end: date) -> list[dict]:
    """Query all records in an inclusive KST date range through the report GSI."""
    start_iso = datetime.combine(start, time.min, tzinfo=KST).isoformat(timespec="seconds")
    end_iso = datetime.combine(end, time.max, tzinfo=KST).isoformat(timespec="microseconds")
    lower = start_iso
    upper = f"{end_iso}~"
    records: list[dict] = []
    for bucket in _month_buckets(start, end):
        kwargs: dict = {
            "IndexName": REPORT_BUCKET_RECORDED_AT_INDEX,
            "KeyConditionExpression": (
                Key("report_bucket").eq(bucket)
                & Key("recorded_at_key").between(lower, upper)
            ),
        }
        while True:
            page = _table.query(**kwargs)
            # Keep the internal sort key until all monthly partitions have been
            # merged. It contains the card version, which makes records created
            # in the same second deterministic as well.
            records.extend(db._clean(item) for item in page.get("Items", []))  # noqa: SLF001
            cursor = page.get("LastEvaluatedKey")
            if not cursor:
                break
            kwargs["ExclusiveStartKey"] = cursor
    records.sort(key=lambda row: (row["recorded_at_key"], row["record_id"]))
    public_records = []
    for record in records:
        public = _public(record)
        # Internal report-only ordering hint. Report responses expose aggregates,
        # not these rows, so the storage key does not leak through the API.
        public["_sort_key"] = record["recorded_at_key"]
        public_records.append(public)
    return public_records


def latest_record(card_id: str, *, through: datetime | None = None) -> dict | None:
    """Return a card's latest record, optionally as-of a KST-aware timestamp."""
    condition = Key("card_id").eq(card_id)
    if through is not None:
        condition &= Key("recorded_at_key").lte(f"{through.isoformat(timespec='microseconds')}~")
    page = _table.query(
        IndexName=CARD_RECORDED_AT_INDEX,
        KeyConditionExpression=condition,
        ScanIndexForward=False,
        Limit=1,
    )
    items = page.get("Items", [])
    return _public(items[0]) if items else None


def write_record_and_project_card(
    *,
    card: dict,
    record: dict,
    expected_progress,
    expected_version: int | None,
    require_verified: bool,
    entering_hold: bool,
    resuming_hold: bool,
    verified_merchant_id: str | None = None,
) -> dict:
    """Atomically put a record and update the card's current progress projection.

    ``verified_merchant_id`` lands on the card in the same transaction as the
    completion record that carried it.  Splitting them would leave a window in
    which the card reads as completed while the widget still has no badge
    source, and no single request would own reconciling that.
    """
    names = {
        "#status": "status",
        "#progress": "progress",
        "#events": "events",
        "#version": "version",
        "#last_at": "last_progress_record_at",
        "#last_id": "last_progress_record_id",
    }
    values = {
        ":approved": "approved",
        ":expected_progress": expected_progress,
        ":progress": record["progress"],
        ":empty": [],
        ":event": [{
            "at": record["recorded_at"],
            "action": f"progress:{record['progress']}",
            "record_id": record["record_id"],
        }],
        ":one": 1,
        ":recorded_at": record["recorded_at"],
        ":record_id": record["record_id"],
    }
    if expected_progress is None:
        values.pop(":expected_progress")
        values[":null_type"] = "NULL"
        progress_condition = (
            "(attribute_not_exists(#progress) OR attribute_type(#progress, :null_type))"
        )
    else:
        progress_condition = "#progress = :expected_progress"
    condition = (
        f"#status = :approved AND {progress_condition} AND "
        "(attribute_not_exists(#last_at) OR #last_at <= :recorded_at)"
    )
    if expected_version is None:
        condition += " AND attribute_not_exists(#version)"
    else:
        condition += " AND #version = :expected_version"
        values[":expected_version"] = expected_version

    if require_verified:
        names["#verification"] = "candidate_verification"
        names["#verification_status"] = "status"
        values[":verified"] = "verified"
        condition += " AND #verification.#verification_status = :verified"

    sets = [
        "#progress = :progress",
        "#events = list_append(if_not_exists(#events, :empty), :event)",
        "#last_at = :recorded_at",
        "#last_id = :record_id",
    ]
    removes: list[str] = []
    if entering_hold:
        names["#before_hold"] = "progress_before_hold"
        values[":before_hold"] = record["previous_progress"]
        sets.append("#before_hold = :before_hold")
    elif resuming_hold:
        names["#before_hold"] = "progress_before_hold"
        removes.append("#before_hold")
    if record["progress"] == "완료":
        names["#completed_at"] = "completed_at"
        sets.append("#completed_at = if_not_exists(#completed_at, :recorded_at)")
    if verified_merchant_id:
        names["#target"] = "target"
        names["#verified_merchant_id"] = "verified_merchant_id"
        values[":verified_merchant_id"] = verified_merchant_id
        sets.append("#target.#verified_merchant_id = :verified_merchant_id")

    update_expression = f"SET {', '.join(sets)}"
    if removes:
        update_expression += f" REMOVE {', '.join(removes)}"
    update_expression += " ADD #version :one"

    # ``recorded_at`` intentionally has second precision in the public API.
    # The next card version is a per-card monotonic tie-breaker so two quick
    # transitions in that second are still returned in commit order.
    next_version = (expected_version or 0) + 1
    item = {
        **record,
        "report_bucket": record["recorded_at"][:7],
        "recorded_at_key": (
            f"{record['recorded_at']}#{next_version:020d}#{record['card_id']}#{record['record_id']}"
        ),
    }
    try:
        _client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": db._table.name,  # noqa: SLF001
                        "Key": _serialize_map({"id": card["id"]}),
                        "UpdateExpression": update_expression,
                        "ConditionExpression": condition,
                        "ExpressionAttributeNames": names,
                        "ExpressionAttributeValues": _serialize_map(values),
                    }
                },
                {
                    "Put": {
                        "TableName": TABLE_NAME,
                        "Item": _serialize_map(item),
                        "ConditionExpression": "attribute_not_exists(#record_id)",
                        "ExpressionAttributeNames": {"#record_id": "record_id"},
                    }
                },
            ]
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"TransactionCanceledException", "ConditionalCheckFailedException"}:
            raise db.ConcurrentUpdate("progress record transaction conflicted") from None
        raise

    updated = db._table.get_item(  # noqa: SLF001
        Key={"id": card["id"]},
        ConsistentRead=True,
    ).get("Item")
    return db._clean(updated)  # noqa: SLF001
