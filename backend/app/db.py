"""B2: DynamoDB CRUD — 카드 저장·조회 (05 문서 §7·§8)."""
import os, boto3
from decimal import Decimal
from datetime import datetime, timezone, timedelta
KST = timezone(timedelta(hours=9))

_kw = {"region_name": os.environ.get("AWS_REGION", "ap-northeast-2")}
if os.environ.get("DYNAMO_ENDPOINT"):          # Docker/로컬 테스트 (T7)
    _kw["endpoint_url"] = os.environ["DYNAMO_ENDPOINT"]
_table = boto3.resource("dynamodb", **_kw).Table(os.environ.get("CARDS_TABLE", "sangseng-cards"))


def _clean(v):
    """boto3의 Decimal → int/float 변환 (FastAPI JSON 직렬화 깨짐 방지 — 05 문서 §8)."""
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
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


def now_iso(): return datetime.now(KST).isoformat(timespec="seconds")
def put_card(card: dict): _table.put_item(Item=_to_ddb(card))
def get_card(cid: str): return _clean(_table.get_item(Key={"id": cid}).get("Item"))
def list_cards(): return [_clean(i) for i in _table.scan().get("Items", [])]


def next_card_id(prefix: str) -> str:
    """AC-/INC- + 3자리 순번 (Scan 기반 — 데모 규모에서 경합 무시, 05 문서 §8)."""
    n = sum(1 for c in list_cards() if c["id"].startswith(prefix))
    return f"{prefix}{n + 1:03d}"
