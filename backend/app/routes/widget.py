"""B6: 방문객 위젯 추천 — merchants.json + 완료 카드 반영 (05 문서 §4, 07 문서 B6)."""
import math
from urllib.parse import quote

from fastapi import APIRouter, HTTPException

from app import dataload, db

router = APIRouter()
# pipeline/common.py ANCHOR 복제본 (Lambda 번들에 pipeline 모듈이 없어 import 금지)
ANCHOR = {"lat": 37.21164, "lng": 128.82168}
DEFAULT_LIMIT = 12                                    # 첫 화면은 충분히 비교 가능한 12곳
MAX_LIMIT = 120                                        # 전체 1,678건을 한 번에 보내지 않는 안전선
DONE = "완료"
EXPANSION_BADGE = "이번 분기 확충 업종"
POLICY_NOTE = "완료된 확충 업종 우선 · 그 외 하이원리조트 거점 직선거리 기준"


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 좌표 사이 직선거리(km) — 추천 정렬에만 쓰는 보조 계산."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def _anchor_km(m: dict) -> float:
    """거점(ANCHOR)까지의 직선거리 — 좌표가 없는 가맹점은 맨 뒤로 (inf)."""
    lat, lng = m.get("lat"), m.get("lng")
    if lat is None or lng is None:
        return float("inf")
    return _haversine_km(ANCHOR["lat"], ANCHOR["lng"], lat, lng)


def _expanded_merchant_ids(cards: list) -> tuple[set, int]:
    """`progress=완료`인 EXPANSION 카드가 확인한 가맹점 ID 집합과 완료 카드 수 (05 문서 §4).

    예전에는 (읍, 업종) 집합으로 매칭했다. 확충 후보는 **아직 가맹점이 아닌 상가**라, 그 방식은
    배지를 완료 카드와 무관한 기존 가맹점들에 붙였고(공백 업종이면 아무 데도 못 붙였다) 방문객은
    실제로 확충된 적 없는 점포를 "이번 분기 확충"으로 읽었다. 지금은 완료 기록에 실린 가맹 등록
    ID(`target.verified_merchant_id`)와 `merchant_id`가 정확히 일치할 때만 붙는다.
    ID가 아직 없거나(증빙 문서만 있는 완료) 산출물에 반영되기 전이면 배지를 붙이지 않는다 —
    가맹 등록에서 다음 파이프라인 산출까지의 시차는 정상이고, 그 구간에 배지를 붙이면
    없는 가맹점을 추천하게 된다.
    """
    ids, completed = set(), 0
    for card in cards:
        if card.get("type") != "EXPANSION" or card.get("progress") != DONE:
            continue
        completed += 1
        merchant_id = (card.get("target") or {}).get("verified_merchant_id")
        if merchant_id:
            ids.add(str(merchant_id))
    return ids, completed


def _payback(cards: list) -> dict | None:
    """`완료`된 INCENTIVE 카드의 selected_rate → 페이백 배지. 없으면 None (05 문서 §4).

    페이백은 전 지역 공통 적용이라 추천 항목 전체에 동일하게 붙는다.
    완료 카드가 여럿이면 가장 최근에 **완료된** 카드의 rate를 쓴다.
    """
    done = [c for c in cards if c.get("type") == "INCENTIVE" and c.get("progress") == DONE
            and c.get("selected_rate")]
    if not done:
        return None
    def completion_time(card: dict) -> str:
        if card.get("completed_at"):
            return card["completed_at"]
        completed_events = [
            event.get("at") or "" for event in card.get("events", [])
            if event.get("action") == f"progress:{DONE}"
        ]
        return max(completed_events, default=card.get("decided_at") or "")

    rate = max(done, key=completion_time)["selected_rate"]
    return {"rate": rate, "label": f"지금 여기서 쓰면 {rate}% 페이백"}


def _fallback_blurb(merchant: dict) -> str:
    """원천 데이터에 있는 지역·업종만 말한다 — 실명 점포의 품질·메뉴를 추정하지 않는다."""
    return f"{merchant['eup']}의 {merchant['category']} 하이원포인트 가맹점이에요"


def _blurbs(picked: list) -> list:
    """검증되지 않은 실명 점포 묘사를 만들지 않도록 결정론적 문구만 반환한다."""
    return [_fallback_blurb(m) for m, _ in picked]


@router.get("/widget/recommend")
def recommend(region: str | None = None, category: str | None = None, limit: int = DEFAULT_LIMIT):
    """필터 결과를 우선순위로 정렬해 반환한다. limit을 늘리면 목록을 더 볼 수 있다."""
    try:
        merchants = dataload.load("merchants")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="merchants.json이 아직 생성되지 않았습니다") from exc
    cards = db.list_cards()
    expanded_ids, completed_cards = _expanded_merchant_ids(cards)
    payback = _payback(cards)
    # 확인된 ID 중 실제로 산출물에 들어온 것만 배지 근거가 된다. 나머지는 "반영 대기"이고,
    # 그 건수를 응답에 실어 담당자 화면이 "완료했는데 왜 위젯에 없지"에 답할 수 있게 한다.
    present_ids = {str(m.get("merchant_id")) for m in merchants if m.get("merchant_id")}
    reflected = len(expanded_ids & present_ids)

    def is_expanded(m: dict) -> bool:
        merchant_id = m.get("merchant_id")
        return bool(merchant_id) and str(merchant_id) in expanded_ids

    rows = [m for m in merchants
            if (not region or m.get("eup") == region) and (not category or m.get("category") == category)]
    # 정렬: ① 완료 카드가 확인한 가맹점 먼저 ② 거점(ANCHOR)에서 가까운 순.
    # 원본 순서(상호명순)로 두면 필터 없이 부를 때 방문객 동선과 무관한 가맹점이 먼저 나왔다.
    # 거리 값은 응답에도 blurb 프롬프트에도 싣지 않는다 — 05 §1 캐비엇("거점에서 가장 가깝다고
    # 단정하지 않는다")과 충돌하므로 정렬 근거로만 쓰고 LLM이 근접성을 주장할 수 없게 한다.
    rows.sort(key=lambda m: (
        0 if is_expanded(m) else 1,
        _anchor_km(m),
        str(m.get("name") or ""),
        str(m.get("address") or ""),
    ))
    visible_limit = max(1, min(MAX_LIMIT, limit))
    picked = [(m, is_expanded(m)) for m in rows[:visible_limit]]
    blurbs = _blurbs(picked) if picked else []
    return {
        "recommendations": [
            {
                "name": m["name"],
                "category": m["category"],
                "address": m["address"],
                "lat": m["lat"],
                "lng": m["lng"],
                "badge": EXPANSION_BADGE if is_new else None,
                "directions_url": (
                    f"https://map.kakao.com/link/to/{quote(str(m['name']), safe='')},{m['lat']},{m['lng']}"
                    if m.get("lat") is not None and m.get("lng") is not None else None
                ),
                "payback": payback,
                "blurb": blurbs[i],
            }
            for i, (m, is_new) in enumerate(picked)
        ],
        "policy_note": POLICY_NOTE,
        "total": len(rows),
        "expansion_sync": {
            "completed_cards": completed_cards,
            "reflected": reflected,
            "pending_sync": completed_cards - reflected,
        },
    }
