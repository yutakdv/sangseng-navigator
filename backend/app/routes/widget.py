"""B6: 방문객 위젯 추천 — merchants.json + 완료 카드 반영 (05 문서 §4, 07 문서 B6)."""
import math

from fastapi import APIRouter, HTTPException

from app import dataload, db

router = APIRouter()
# pipeline/common.py ANCHOR 복제본 (Lambda 번들에 pipeline 모듈이 없어 import 금지)
ANCHOR = {"lat": 37.21164, "lng": 128.82168}
LIMIT = 3                                             # 상위 3곳 (07 문서 B6)
DONE = "완료"
EXPANSION_BADGE = "이번 분기 확충 업종"
POLICY_NOTE = "이번 분기 확충이 완료된 업종을 우선 추천합니다"


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


def _new_targets(cards: list) -> set:
    """`progress=완료`인 EXPANSION 카드의 (읍, 업종) 집합 — 확충 업종 배지 매칭 키 (05 문서 §4)."""
    out = set()
    for card in cards:
        target = card.get("target") or {}
        if (card.get("type") == "EXPANSION" and card.get("progress") == DONE
                and target.get("eup") and target.get("category")):
            out.add((target["eup"], target["category"]))
    return out


def _payback(cards: list) -> dict | None:
    """`완료`된 INCENTIVE 카드의 selected_rate → 페이백 배지. 없으면 None (05 문서 §4).

    페이백은 전 지역 공통 적용이라 추천 항목 전체에 동일하게 붙는다.
    완료 카드가 여럿이면 가장 최근에 결정된 카드의 rate를 쓴다.
    """
    done = [c for c in cards if c.get("type") == "INCENTIVE" and c.get("progress") == DONE
            and c.get("selected_rate")]
    if not done:
        return None
    rate = max(done, key=lambda c: c.get("decided_at") or "")["selected_rate"]
    return {"rate": rate, "label": f"지금 여기서 쓰면 {rate}% 페이백"}


def _fallback_blurb(merchant: dict) -> str:
    """원천 데이터에 있는 지역·업종만 말한다 — 실명 점포의 품질·메뉴를 추정하지 않는다."""
    return f"{merchant['eup']}의 {merchant['category']} 하이원포인트 가맹점이에요"


def _blurbs(picked: list) -> list:
    """검증되지 않은 실명 점포 묘사를 만들지 않도록 결정론적 문구만 반환한다."""
    return [_fallback_blurb(m) for m, _ in picked]


@router.get("/widget/recommend")
def recommend(region: str | None = None, category: str | None = None):
    """(region, category) 필터 → 완료 카드 매칭 가맹점 우선 정렬 → 상위 3곳 + 문구 (05 문서 §4)."""
    try:
        merchants = dataload.load("merchants")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="merchants.json이 아직 생성되지 않았습니다") from exc
    cards = db.list_cards()
    new_targets = _new_targets(cards)
    payback = _payback(cards)

    rows = [m for m in merchants
            if (not region or m.get("eup") == region) and (not category or m.get("category") == category)]
    # 정렬: ① 완료 카드와 매칭되는 확충 업종 먼저 ② 거점(ANCHOR)에서 가까운 순.
    # 원본 순서(상호명순)로 두면 필터 없이 부를 때 방문객 동선과 무관한 가맹점이 먼저 나왔다.
    # 거리 값은 응답에도 blurb 프롬프트에도 싣지 않는다 — 05 §1 캐비엇("거점에서 가장 가깝다고
    # 단정하지 않는다")과 충돌하므로 정렬 근거로만 쓰고 LLM이 근접성을 주장할 수 없게 한다.
    rows.sort(key=lambda m: (0 if (m.get("eup"), m.get("category")) in new_targets else 1, _anchor_km(m)))
    picked = [(m, (m.get("eup"), m.get("category")) in new_targets) for m in rows[:LIMIT]]
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
                "directions_url": f"https://map.kakao.com/link/to/{m['name']},{m['lat']},{m['lng']}",
                "payback": payback,
                "blurb": blurbs[i],
            }
            for i, (m, is_new) in enumerate(picked)
        ],
        "policy_note": POLICY_NOTE,
    }
