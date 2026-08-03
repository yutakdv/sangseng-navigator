"""B6: 방문객 위젯 추천 — merchants.json + 완료 카드 반영 (05 문서 §4, 07 문서 B6)."""
import json

from fastapi import APIRouter, HTTPException

from app import dataload, db, llm, prompts

router = APIRouter()

LIMIT = 3                                             # 상위 3곳 (07 문서 B6)
DONE = "완료"
NEW_BADGE = "신규"
POLICY_NOTE = "확충 완료된 신규 가맹점을 우선 추천합니다"
BLURB_SCHEMA = {
    "type": "object",
    "properties": {"blurbs": {"type": "array", "items": {"type": "string"}}},
    "required": ["blurbs"],
    "additionalProperties": False,
}


def _new_targets(cards: list) -> set:
    """`progress=완료`인 EXPANSION 카드의 (읍, 업종) 집합 — 신규 배지 매칭 키 (05 문서 §4)."""
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


def _fallback_blurb(merchant: dict, is_new: bool) -> str:
    """LLM 실패 시 규칙 기반 문구 (05 문서 §8) — 신규 가맹점만 '새로 생긴' 뉘앙스를 덧붙인다."""
    if is_new:
        return f"{merchant['eup']}에 새로 생긴 {merchant['category']} 하이원포인트 가맹점이에요"
    return f"{merchant['eup']}의 {merchant['category']} 하이원포인트 가맹점이에요"


def _blurbs(picked: list) -> list:
    """추천 문구를 LLM 1회 호출로 일괄 생성 — 실패·개수 부족 시 규칙 기반 문구로 대체.

    응답 지연 방지를 위해 타임아웃 5초 (05 문서 §8). 목록당 호출 1회로 묶어
    3곳을 각각 호출할 때의 지연 누적을 피한다.
    재시도도 끈다(attempts=1) — 기본 2회면 최악 10초라 위젯 체감 지연이 커진다.
    문구는 없어도 fallback 으로 대체되는 부가 정보라 재시도보다 상한 5초가 낫다.
    """
    fallback = [_fallback_blurb(m, is_new) for m, is_new in picked]
    payload = {
        "가맹점": [{"이름": m["name"], "지역": m["eup"], "업종": m["category"], "신규 가맹점": is_new}
                 for m, is_new in picked],
        "작성 지침": ("가맹점마다 한 문장씩, 입력 순서 그대로 blurbs 배열에 담을 것. "
                   "이름·지역·업종 외의 사실(분위기·풍경·메뉴·인기도)은 지어내지 말 것"),
    }
    try:
        out = llm.generate_json(prompts.WIDGET_BLURB_PROMPT, json.dumps(payload, ensure_ascii=False),
                                BLURB_SCHEMA, schema_name="blurbs", timeout=5, attempts=1)
        blurbs = out.get("blurbs") or []
    except Exception:
        return fallback
    return [blurbs[i] if i < len(blurbs) and isinstance(blurbs[i], str) and blurbs[i].strip() else fallback[i]
            for i in range(len(picked))]


@router.get("/widget/recommend")
def recommend(region: str | None = None, category: str | None = None):
    """(region, category) 필터 → 완료 카드 매칭 가맹점 우선 정렬 → 상위 3곳 + 문구 (05 문서 §4)."""
    try:
        merchants = dataload.load("merchants")
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="merchants.json이 아직 생성되지 않았습니다")
    cards = db.list_cards()
    new_targets = _new_targets(cards)
    payback = _payback(cards)

    rows = [m for m in merchants
            if (not region or m.get("eup") == region) and (not category or m.get("category") == category)]
    # 완료 카드와 매칭되는 가맹점을 최상단으로 (안정 정렬 — 그 외는 merchants.json 원본 순서 유지)
    rows.sort(key=lambda m: 0 if (m.get("eup"), m.get("category")) in new_targets else 1)
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
                "badge": NEW_BADGE if is_new else None,
                "payback": payback,
                "blurb": blurbs[i],
            }
            for i, (m, is_new) in enumerate(picked)
        ],
        "policy_note": POLICY_NOTE,
    }
