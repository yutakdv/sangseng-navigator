"""B2: DynamoDB CRUD — 카드 저장·조회 (05 문서 §7·§8)."""
import os, boto3
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
    지수 표기('1E+2')는 소수점이 없으므로 int(100)로 떨어진다 — 실측 확인.
    참고: 끝자리 0 절삭은 **최상위 속성에만** 적용된다(top-level 1.0 → 1). delta_pp 처럼
    map/list 안에 들어간 숫자는 저장 표기가 그대로 돌아오므로 이 규칙으로 float 가 보존된다.
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


def put_card(card: dict): _table.put_item(Item=_to_ddb(card))
def get_card(cid: str): return _clean(_table.get_item(Key={"id": cid}).get("Item"))
def list_cards(): return [_clean(i) for i in _table.scan().get("Items", [])]


def next_card_id(prefix: str) -> str:
    """AC-/INC- + 3자리 순번 — 기존 ID의 **최대 순번 + 1** (05 문서 §8).

    개수+1이 아닌 이유: 카드가 삭제되거나 비순차 ID(AC-901 등)가 섞이면 개수+1이 이미 쓰인
    ID를 만들어 put_card 가 기존 카드를 조용히 덮어쓴다 (감사 2절 #6).
    Scan 기반이라 동시 generate 경합은 그대로 남지만 데모 규모에서는 무시한다.
    """
    mx = 0
    for c in list_cards():
        cid = c["id"]
        if not cid.startswith(prefix):
            continue
        try:
            mx = max(mx, int(cid[len(prefix):]))
        except ValueError:              # 순번이 아닌 접미사는 건너뛴다
            continue
    return f"{prefix}{mx + 1:03d}"
