"""B2: DynamoDB CRUD — 카드 저장·조회 (05 문서 §7·§8)."""
import os

import boto3
from botocore.exceptions import ClientError
from decimal import Decimal

# clock 으로 옮긴 뒤 재노출 — db.KST·db.now_iso 를 쓰는 기존 호출부(seed_demo.py, tests,
# cardgen, routes)를 그대로 두기 위함 (감사 2절 #5)
from app.clock import KST, now_iso      # noqa: F401

_kw = {"region_name": os.environ.get("AWS_REGION", "ap-northeast-2")}
if os.environ.get("DYNAMO_ENDPOINT"):          # Docker/로컬 테스트 (T7)
    _kw["endpoint_url"] = os.environ["DYNAMO_ENDPOINT"]
# `or` 로 받는다 — .env 의 `CARDS_TABLE=` (빈 문자열)이면 테이블명이 ""가 되어 카드 API 전부가 500
_table = boto3.resource("dynamodb", **_kw).Table(os.environ.get("CARDS_TABLE") or "sangseng-cards")


def _clean(v):
    """boto3의 Decimal → int/float 변환 (FastAPI JSON 직렬화 깨짐 방지 — 05 문서 §8).

    저장된 표기에 소수점이 있으면 float, 없으면 int — 값이 정수라는 이유로 float 를 int 로
    내리지 않는다. 정수 판정(v == v.to_integral_value())으로 내리면 read-modify-write 때마다
    05 §2 의 scenarios[].delta_pp 가 [1.0, 2.0] → [1, 2] 로 바뀐다 (감사 ②).
    지수 표기('1E+2')는 소수점이 없으므로 int(100)로 떨어진다. 음의 지수('1E-8')는 int 로
    절삭돼 0이 되지만, 카드에 실리는 최소 절대값이 0.47(score)이라 그 경로에는 닿지 않는다.
    참고: 끝자리 0 절삭이 **최상위 속성에만** 적용되고 map/list 안의 숫자는 저장 표기가 그대로
    돌아온다는 것은 **DynamoDB Local 실측**이다(delta_pp 가 scenarios 배열 안이라 보존된다).
    실 DynamoDB 가 중첩까지 절삭하면 delta_pp 표기가 [1, 2]로 돌아갈 수 있어, T17 배포 직후
    승인 왕복 1회로 확인한다(09 §4). 화면 표기는 FE 가 소수 1자리로 고정하므로(05 §2) 그래도 안전하다.
    """
    if isinstance(v, Decimal):
        return float(v) if "." in str(v) else int(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def _to_ddb(v):
    """반대 방향: float → Decimal (DynamoDB는 float 저장 불가)."""
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, dict):
        return {k: _to_ddb(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_to_ddb(x) for x in v]
    return v


class ConcurrentUpdate(RuntimeError):
    """읽은 뒤 다른 요청이 먼저 상태를 변경해 조건부 쓰기가 실패했다."""


def _is_conditional_failure(exc: ClientError) -> bool:
    return exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def put_card(card: dict):
    """시드·테스트용 전체 저장. 상태 변경 라우트에서는 조건부 update 함수를 사용한다."""
    _table.put_item(Item=_to_ddb(card))


def create_card(card: dict):
    """새 카드만 저장한다. ID 충돌 시 기존 카드를 덮어쓰지 않는다."""
    item = {**card, "version": card.get("version", 0)}
    try:
        _table.put_item(
            Item=_to_ddb(item),
            ConditionExpression="attribute_not_exists(#id)",
            ExpressionAttributeNames={"#id": "id"},
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            raise ConcurrentUpdate("card id already exists") from None
        raise


def get_card(cid: str): return _clean(_table.get_item(Key={"id": cid}).get("Item"))


def _scan_all() -> list[dict]:
    """DynamoDB Scan 1MB 페이지 경계를 끝까지 순회한다."""
    items: list[dict] = []
    kwargs = {}
    while True:
        page = _table.scan(**kwargs)
        items.extend(page.get("Items", []))
        cursor = page.get("LastEvaluatedKey")
        if not cursor:
            break
        kwargs["ExclusiveStartKey"] = cursor
    return items


def list_cards():
    # 원자적 번호 발급용 내부 레코드는 API 카드 목록에 노출하지 않는다.
    return [_clean(i) for i in _scan_all() if not str(i.get("id", "")).startswith("__counter__#")]


def decide_card(
    cid: str,
    decision: str,
    *,
    initial_progress: str | None,
    selected_rate: int | None = None,
) -> dict:
    """pending 카드의 결정을 조건부·원자적으로 기록하고 이벤트를 append한다."""
    now = now_iso()
    names = {
        "#status": "status",
        "#progress": "progress",
        "#events": "events",
        "#version": "version",
    }
    values = {
        ":pending": "pending",
        ":decision": decision,
        ":decided_at": now,
        ":progress": initial_progress if decision == "approved" else None,
        ":empty": [],
        ":event": [{"at": now, "action": decision}],
        ":one": 1,
    }
    sets = [
        "#status = :decision",
        "decided_at = :decided_at",
        "#progress = :progress",
        "#events = list_append(if_not_exists(#events, :empty), :event)",
    ]
    if selected_rate is not None:
        sets.append("selected_rate = :selected_rate")
        values[":selected_rate"] = selected_rate
    try:
        result = _table.update_item(
            Key={"id": cid},
            UpdateExpression=f"SET {', '.join(sets)} ADD #version :one",
            ConditionExpression="#status = :pending",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=_to_ddb(values),
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            raise ConcurrentUpdate("card decision changed concurrently") from None
        raise
    return _clean(result["Attributes"])


def update_progress(cid: str, progress: str, *, expected_progress, require_verified: bool) -> dict:
    """상태·이벤트·version을 한 조건부 쓰기로 갱신한다."""
    now = now_iso()
    names = {
        "#status": "status",
        "#progress": "progress",
        "#events": "events",
        "#version": "version",
    }
    values = {
        ":approved": "approved",
        ":expected_progress": expected_progress,
        ":progress": progress,
        ":empty": [],
        ":event": [{"at": now, "action": f"progress:{progress}"}],
        ":one": 1,
    }
    condition = "#status = :approved AND #progress = :expected_progress"
    if require_verified:
        names["#verification"] = "candidate_verification"
        names["#verification_status"] = "status"
        values[":verified"] = "verified"
        condition += " AND #verification.#verification_status = :verified"
    try:
        result = _table.update_item(
            Key={"id": cid},
            UpdateExpression=(
                "SET #progress = :progress, "
                "#events = list_append(if_not_exists(#events, :empty), :event) "
                "ADD #version :one"
            ),
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=_to_ddb(values),
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            raise ConcurrentUpdate("card progress changed concurrently") from None
        raise
    return _clean(result["Attributes"])


def update_verification(cid: str, verification: dict, *, expected_version: int | None) -> dict:
    """적격성 체크 전체를 version 기반 낙관적 잠금으로 교체한다."""
    now = now_iso()
    names = {"#status": "status", "#events": "events", "#version": "version"}
    values = {
        ":approved": "approved",
        ":verification": verification,
        ":empty": [],
        ":event": [{"at": now, "action": f"verification:{verification['status']}"}],
        ":one": 1,
    }
    if expected_version is None:
        condition = "#status = :approved AND attribute_not_exists(#version)"
    else:
        condition = "#status = :approved AND #version = :expected_version"
        values[":expected_version"] = expected_version
    try:
        result = _table.update_item(
            Key={"id": cid},
            UpdateExpression=(
                "SET candidate_verification = :verification, "
                "#events = list_append(if_not_exists(#events, :empty), :event) "
                "ADD #version :one"
            ),
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=_to_ddb(values),
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            raise ConcurrentUpdate("candidate verification changed concurrently") from None
        raise
    return _clean(result["Attributes"])


def next_card_id(prefix: str) -> str:
    """AC-/INC- + 3자리 순번을 원자적 counter로 발급한다.

    개수+1이 아닌 이유: 카드가 삭제되거나 비순차 ID(AC-901 등)가 섞이면 개수+1이 이미 쓰인
    ID를 만들어 기존 카드를 덮어쓸 수 있다. 최초 1회만 기존 최대값으로 counter를 초기화하고,
    이후에는 DynamoDB ADD를 사용해 동시 generate 요청도 서로 다른 번호를 받는다.
    """
    counter_id = f"__counter__#{prefix.rstrip('-')}"
    mx = 0
    for c in list_cards():
        cid = c["id"]
        if not cid.startswith(prefix):
            continue
        try:
            mx = max(mx, int(cid[len(prefix):]))
        except ValueError:              # 순번이 아닌 접미사는 건너뛴다
            continue
    try:
        _table.put_item(
            Item={"id": counter_id, "sequence": mx},
            ConditionExpression="attribute_not_exists(#id)",
            ExpressionAttributeNames={"#id": "id"},
        )
    except ClientError as exc:
        if not _is_conditional_failure(exc):
            raise
    result = _table.update_item(
        Key={"id": counter_id},
        UpdateExpression="ADD #sequence :one",
        ExpressionAttributeNames={"#sequence": "sequence"},
        ExpressionAttributeValues={":one": 1},
        ReturnValues="UPDATED_NEW",
    )
    sequence = int(result["Attributes"]["sequence"])
    return f"{prefix}{sequence:03d}"
