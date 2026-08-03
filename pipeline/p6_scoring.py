"""P6: 2단계 스코어링 — 1단계 읍 우선순위(eup_scores.json) + 2단계 후보 지점(candidates.json).

산식 정본은 docs/plan/06 P6 주석 + common.py 상수(EUP_WEIGHTS 0.5/0.5, CAND_WEIGHTS 각 1/3,
ANCHOR, RADIUS_M 500). 출력 스키마 정본은 05 §1 — eup_ranking·candidates 모두 계산 근거 필드를
포함한다(감사 가능성 원칙, 순위는 산식 결과 그대로 — 서사 맞춤 조정 금지).

절대 규칙 — 1·2단계 데이터 분리 (06 P6 검증 항목):
  1단계 stage1_eup_ranking() 은 읍 단위 집계(usage_monthly)만 받는다 — 좌표 인자 없음.
  2단계 stage2_candidates() 는 읍 이름 순위 목록과 좌표 데이터(소진공 상가 캐시·merchants.json)만
  쓴다 — usage_monthly 인자 없음. 두 단계는 "읍 이름 목록"으로만 연결된다.

min-max 정규화는 min==max면 전원 0.5 (15 §5 확정 가드 — 분모 0 방지).
"""
import json
from bisect import bisect_left, bisect_right

import requests

from category_map import DISPLAY_CATEGORIES, store_display_category
from common import (ANCHOR, CAND_WEIGHTS, EUP_WEIGHTS, PROCESSED_DIR, RADIUS_M, RAW_DIR, REGIONS,
                    haversine_m)
from p4_stores import load_stores

# 06 P6 "상위 1~2개 읍" — 상한 2 채택: B4 AI 비교(05 §2 카드 예시)가 두 읍의 후보를 전제한다
SELECT_EUPS = 2
# 후보 대상 표시 분류 5종 — store_display_category 가 None(후보 제외 대분류)·"기타"면 후보 아님
CANDIDATE_CATEGORIES = [c for c in DISPLAY_CATEGORIES if c != "기타"]
LAT_M_PER_DEG = 111_320  # 위도 1도 ≈ 111.32km — 반경 검색 위도 창(1차 컷)용

# 하이원포인트 가맹점 상시모집 신청 자격은 "대상지역 내 주소지·사업장을 둔 **개인사업자**(법인 제외)"다
# (강원랜드 상시모집 공고 https://www.kangwonland.com/kangwonland/selectBbsNttView.do
#  ?key=141&bbsNo=16&nttNo=156943). 자격이 없는 법인을 추천하면 카드가 그대로 무효라 후보에서 뺀다.
# ⚠ 이건 **상호명만 보고 하는 추정**이다 — 상호에 법인격 표기가 없는 법인은 걸러지지 않고,
#   반대로 표기를 우연히 포함한 개인사업자가 빠질 수 있다. 실제 자격은 신청·심사에서 확정된다.
CORPORATE_MARKERS = ("협동조합", "㈜", "(주)", "주식회사", "유한회사", "유한책임회사", "합자회사",
                     "농업회사법인", "영농조합", "어업회사법인", "사단법인", "재단법인",
                     "의료법인", "사회복지법인", "법인")

# 도로 접근성 병기 (05 §1 road_distance_km·road_minutes) — OSRM 공개 라우팅 API
OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving"
ROAD_CACHE_PATH = RAW_DIR / "api_cache" / "road_routes.json"
ROAD_TIMEOUT_S = 20


def is_corporate(name: str) -> bool:
    """상호명에 법인격 표기가 있는가 (개인사업자 자격 필터 — 추정, CORPORATE_MARKERS 주석 참조)."""
    return any(marker in name for marker in CORPORATE_MARKERS)


def minmax01(values: list[float]) -> list[float]:
    """0~1 min-max 정규화. min==max면 전원 0.5 (15 §5 확정 가드)."""
    lo, hi = min(values), max(values)
    if lo == hi:
        return [0.5] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


# ---------------------------------------------------------------- 1단계 (읍 단위 집계 데이터만)
def stage1_eup_ranking(usage: dict, weights: dict = EUP_WEIGHTS) -> list[dict]:
    """1단계 — 읍 우선순위. **읍 단위 집계 데이터만** 사용한다 (좌표 인자 없음).

    소비저조도 = 1 − (해당 읍 최근 3개월 건수 / 6개 읍 평균 건수), 0~1 클리핑
    소비증감  = 전분기 대비 감소율 (전분기−최근분기)/전분기 를 0~1 min-max (감소가 클수록 1)
    읍Score  = 0.5×소비저조도 + 0.5×소비증감 (EUP_WEIGHTS)
    "최근 3개월"/"전분기" = base_month 기준 최근 3개월 vs 직전 3개월 (P5 growth.qoq_pp 와 동일 정의)

    weights 는 P8 민감도 분석(p8_sensitivity.py)이 격자 값을 주입하는 용도 — 기본값은 정본 상수다.
    """
    months = usage["months"]
    if len(months) < 6:
        raise SystemExit(f"P6 실패: 월 {len(months)}개 — 분기 비교(6개월)가 불가")
    recent_m, prev_m = months[-3:], months[-6:-3]
    recent, prev = dict.fromkeys(REGIONS, 0), dict.fromkeys(REGIONS, 0)
    for row in usage["usage"]:
        bucket = recent if row["month"] in recent_m else (prev if row["month"] in prev_m else None)
        if bucket is not None:
            for region in REGIONS:
                bucket[region] += row[region]

    mean_recent = sum(recent.values()) / len(REGIONS)
    if mean_recent == 0:
        raise SystemExit("P6 실패: 최근 3개월 전 지역 건수 0 — usage_monthly.json 확인")
    for region in REGIONS:
        if prev[region] == 0:
            raise SystemExit(f"P6 실패: {region} 전분기 건수 0 — 감소율 정의 불가")

    low = {r: min(1.0, max(0.0, 1 - recent[r] / mean_recent)) for r in REGIONS}
    decline = dict(zip(REGIONS, minmax01([(prev[r] - recent[r]) / prev[r] for r in REGIONS])))
    rows = [
        {"eup": r, "score": weights["v1"] * low[r] + weights["v2"] * decline[r],
         "low_usage": low[r], "decline": decline[r], "recent_3m": recent[r], "prev_3m": prev[r]}
        for r in REGIONS
    ]
    rows.sort(key=lambda x: -x["score"])
    for rank, row in enumerate(rows, 1):
        row["rank"] = rank
    print(f"  1단계: 최근 3개월 {recent_m[0]}~{recent_m[-1]} vs 전분기 {prev_m[0]}~{prev_m[-1]} "
          f"(6개 읍 평균 {mean_recent:,.0f}건)")
    return rows


# ---------------------------------------------------------------- 2단계 (좌표 데이터만)
def _radius_counter(points: list[dict]):
    """좌표 목록 → count(lat, lng): 반경 RADIUS_M 내 개수 (위도 창 1차 컷 + haversine 확정)."""
    pts = sorted(points, key=lambda p: p["lat"])
    lats = [p["lat"] for p in pts]
    window = RADIUS_M / LAT_M_PER_DEG * 1.01  # 1% 여유

    def count(lat: float, lng: float) -> int:
        lo, hi = bisect_left(lats, lat - window), bisect_right(lats, lat + window)
        return sum(1 for p in pts[lo:hi] if haversine_m(lat, lng, p["lat"], p["lng"]) <= RADIUS_M)

    return count


def _fetch_route(lat: float, lng: float) -> dict:
    """ANCHOR→(lat,lng) 자동차 경로 1건 (OSRM). 실패는 예외로 올린다 — 조용한 누락 금지."""
    url = f"{OSRM_ROUTE_URL}/{ANCHOR['lng']},{ANCHOR['lat']};{lng},{lat}"
    res = requests.get(url, params={"overview": "false"}, timeout=ROAD_TIMEOUT_S)
    res.raise_for_status()
    body = res.json()
    if body.get("code") != "Ok" or not body.get("routes"):
        raise RuntimeError(f"OSRM code={body.get('code')} {body.get('message', '')}".strip())
    route = body["routes"][0]
    return {"road_distance_km": round(route["distance"] / 1000, 1),
            "road_minutes": round(route["duration"] / 60, 1)}


def annotate_road_access(candidates: list[dict]) -> None:
    """후보에 거점→후보 **도로** 거리·소요시간을 병기한다 (05 §1 road_distance_km·road_minutes).

    관광동선근접도(proximity)는 직선거리 기반이라 산악 지형에서 실제 접근성과 역전될 수 있다
    (고한↔상동은 만항재 해발 1,330m를 넘는다). 그 한계를 우리가 먼저 드러내려는 참고 필드이므로
    **순위 산식에는 넣지 않는다** — 가중치·정렬 불변이고, 도로시간 기반 재정렬은 별도 검증 과제다.
    결과는 road_routes.json 에 캐시해 재실행 재현성을 지키고, 실패하면 두 필드를 None 으로 두고
    사유를 로그로 남긴다(값을 지어내지 않는다).

    호출은 main() 의 최종 후보 5건에 대해서만 한다 — stage2_candidates 안에서 호출하면 P8 민감도
    분석이 가중치 격자마다 재호출해 공개 API 호출이 폭증한다.
    """
    cache = (json.loads(ROAD_CACHE_PATH.read_text(encoding="utf-8"))
             if ROAD_CACHE_PATH.exists() else {})
    hits = len(cache)
    for c in candidates:
        key = f"{ANCHOR['lat']},{ANCHOR['lng']}>{c['lat']},{c['lng']}"
        if key not in cache:
            try:
                cache[key] = _fetch_route(c["lat"], c["lng"])
            except Exception as exc:    # 통신·응답 실패 — 필드를 null 로 두고 계속 진행
                print(f"  [warn] 도로 경로 조회 실패 {c['id']} {c['name']}: {type(exc).__name__}: {exc}")
        route = cache.get(key) or {}
        c["road_distance_km"] = route.get("road_distance_km")
        c["road_minutes"] = route.get("road_minutes")
    if len(cache) > hits:
        ROAD_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        ROAD_CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  도로 접근성 병기: 신규 조회 {len(cache) - hits}건 / 캐시 {hits}건 "
          f"(OSRM, 순위 산식 미반영)")


def stage2_candidates(eups_by_rank: list[str], select_n: int = SELECT_EUPS,
                      weights: dict = CAND_WEIGHTS) -> tuple[list[dict], list[str]]:
    """2단계 — 후보 지점. **좌표 데이터만** 사용한다 (usage_monthly 인자 없음).

    업종공백도    = 1 − (반경 500m 내 동일 표시 업종 하이원 가맹점 수 / 반경 내 소진공 전체 상가 수)
    관광동선근접도 = (1 / ANCHOR 까지 거리 m) 를 후보군 내 0~1 min-max
    기존가맹포화도 = 반경 내 동일 표시 업종 하이원 가맹점 수를 후보군 내 0~1 min-max
    후보Score    = (1/3)×업종공백도 + (1/3)×관광동선근접도 − (1/3)×기존가맹포화도 (CAND_WEIGHTS)
    업종별 최고점 상가 = 그 업종의 대표 후보 → 전 업종 대표 후보 Score 내림차순 상위 5개.
    후보 풀에서 **법인 추정 상호는 제외**한다 (상시모집 자격=개인사업자, CORPORATE_MARKERS 주석).
    반경 분모(nearby_stores)는 그대로 전체 상가를 세므로 산식 자체는 바뀌지 않는다.
    반환: (candidates 배열, 실제 사용한 읍 목록 — 후보 0개면 차순위 읍 자동 재시도로 늘어날 수 있음)

    weights 는 P8 민감도 분석(p8_sensitivity.py)이 격자 값을 주입하는 용도 — 기본값은 정본 상수다.
    """
    # 반경 분모·가맹점 수는 수집분 전체에서 센다 — 읍 경계에 걸친 반경이 이웃 지역 상가를 놓치지 않게
    count_stores = _radius_counter([s for region in REGIONS for s in load_stores(region)])
    merchants = json.loads((PROCESSED_DIR / "merchants.json").read_text(encoding="utf-8"))
    count_merchants = {
        cat: _radius_counter([m for m in merchants if m["category"] == cat])
        for cat in CANDIDATE_CATEGORIES
    }

    used, queue = list(eups_by_rank[:select_n]), list(eups_by_rank[select_n:])
    while True:
        pool, corporate = [], []
        for eup in used:
            for s in load_stores(eup):
                cat = store_display_category(s)
                if cat not in CANDIDATE_CATEGORIES:
                    continue
                if is_corporate(s["name"]):     # 개인사업자만 신청 가능 (CORPORATE_MARKERS 주석)
                    corporate.append(f"{eup} {s['name']}")
                    continue
                pool.append({"eup": eup, "category": cat, "name": s["name"],
                             "lat": s["lat"], "lng": s["lng"]})
        if pool or not queue:
            break
        nxt = queue.pop(0)
        print(f"  [fallback] 선정 읍 {used}에서 후보 0개 — 차순위 읍 '{nxt}' 자동 재시도 (06 P6 예외처리)")
        used.append(nxt)
    if not pool:
        raise SystemExit("P6 실패: 전 지역에서 후보 상가 0개 — p4 캐시·category_map 확인")
    print(f"  법인 추정 상호 제외 {len(corporate)}건 (상시모집 자격=개인사업자)"
          + (f": {', '.join(corporate[:8])}{' …' if len(corporate) > 8 else ''}" if corporate else ""))

    kept = []
    for c in pool:
        nearby_stores = count_stores(c["lat"], c["lng"])
        if nearby_stores == 0:  # 자기 자신이 포함되므로 실제로는 0이 될 수 없다 — 방어적 가드
            print(f"  [drop] {c['eup']} {c['name']}: 반경 {RADIUS_M}m 내 상가 0곳 — 업종공백도 분모 0")
            continue
        dist = haversine_m(ANCHOR["lat"], ANCHOR["lng"], c["lat"], c["lng"])
        if dist == 0:
            raise SystemExit(f"P6 실패: {c['name']} 좌표가 ANCHOR와 동일 — 근접도(1/거리) 정의 불가")
        nearby_merchants = count_merchants[c["category"]](c["lat"], c["lng"])
        c.update(nearby_stores=nearby_stores, nearby_merchants=nearby_merchants,
                 gap=1 - nearby_merchants / nearby_stores, inv_dist=1 / dist)
        kept.append(c)
    if not kept:
        raise SystemExit("P6 실패: 반경 내 상가 가드로 후보가 전부 제외됨")

    for c, prox, sat in zip(kept, minmax01([c["inv_dist"] for c in kept]),
                            minmax01([c["nearby_merchants"] for c in kept])):
        c["proximity"], c["saturation"] = prox, sat
        c["score"] = weights["w1"] * c["gap"] + weights["w2"] * prox - weights["w3"] * sat

    best: dict[str, dict] = {}  # 업종별 최고점 상가 = 그 업종의 대표 후보
    for c in kept:
        if c["category"] not in best or c["score"] > best[c["category"]]["score"]:
            best[c["category"]] = c
    top = sorted(best.values(), key=lambda c: -c["score"])[:5]

    dist_line = " / ".join(
        f"{cat} {sum(1 for c in kept if c['category'] == cat)}" for cat in CANDIDATE_CATEGORIES)
    print(f"  2단계: 후보 풀 {len(kept)}개 ({dist_line}) → 업종 대표 {len(top)}개")
    candidates = [
        {"id": f"CAND-{i:03d}", "eup": c["eup"], "category": c["category"], "name": c["name"],
         "lat": c["lat"], "lng": c["lng"], "score": round(c["score"], 2), "gap": round(c["gap"], 2),
         "proximity": round(c["proximity"], 2), "saturation": round(c["saturation"], 2),
         "nearby_stores": c["nearby_stores"], "nearby_merchants": c["nearby_merchants"]}
        for i, c in enumerate(top, 1)
    ]
    return candidates, used


# ---------------------------------------------------------------- 검증·저장
def verify(eup_scores: dict, candidates: list[dict]) -> None:
    """06 P6 검증 — rank 정합·selected ⊆ REGIONS·score 내림차순·후보 좌표가 읍 상가 범위 안."""
    ranking = eup_scores["eup_ranking"]
    assert len(ranking) == len(REGIONS), f"eup_ranking {len(ranking)}개 ≠ {len(REGIONS)}"
    assert [r["rank"] for r in ranking] == list(range(1, len(REGIONS) + 1)), "rank 비정합"
    assert all(a["score"] >= b["score"] for a, b in zip(ranking, ranking[1:])), "읍 score 비내림차순"
    assert set(eup_scores["selected_eups"]) <= set(REGIONS), "selected_eups ⊄ REGIONS"
    assert 1 <= len(candidates) <= 5, f"후보 {len(candidates)}개 (1~5 밖)"
    assert all(a["score"] >= b["score"] for a, b in zip(candidates, candidates[1:])), "후보 score 비내림차순"
    cats = [c["category"] for c in candidates]
    assert len(set(cats)) == len(cats) and set(cats) <= set(CANDIDATE_CATEGORIES), "업종 대표 중복/이탈"
    for c in candidates:
        assert c["eup"] in eup_scores["selected_eups"], f"{c['id']} 읍이 선정 읍 밖"
        assert {"road_distance_km", "road_minutes"} <= set(c), f"{c['id']} 도로 접근성 필드 누락"
        assert not is_corporate(c["name"]), f"{c['id']} {c['name']} — 법인 추정 상호가 후보에 남음"
        stores = load_stores(c["eup"])
        lats, lngs = [s["lat"] for s in stores], [s["lng"] for s in stores]
        assert min(lats) <= c["lat"] <= max(lats) and min(lngs) <= c["lng"] <= max(lngs), \
            f"{c['id']} 좌표가 {c['eup']} 상가 좌표 범위 밖"
    print("  검증 OK: rank 정합 / selected ⊆ REGIONS / score 내림차순 / 후보 좌표 범위")


def main() -> None:
    usage = json.loads((PROCESSED_DIR / "usage_monthly.json").read_text(encoding="utf-8"))
    ranking = stage1_eup_ranking(usage)                                   # 읍 단위 데이터만
    candidates, selected = stage2_candidates([r["eup"] for r in ranking])  # 좌표 데이터만
    annotate_road_access(candidates)          # 05 §1 병기 필드 — 순위·점수에는 영향 없음

    eup_scores = {
        "base_month": usage["base_month"],
        "eup_ranking": [
            {"rank": r["rank"], "eup": r["eup"], "score": round(r["score"], 2),
             "low_usage": round(r["low_usage"], 2), "decline": round(r["decline"], 2)}
            for r in ranking
        ],
        "selected_eups": selected,
    }
    path_eup = PROCESSED_DIR / "eup_scores.json"
    path_cand = PROCESSED_DIR / "candidates.json"
    path_eup.write_text(json.dumps(eup_scores, ensure_ascii=False, indent=2), encoding="utf-8")
    path_cand.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"P6 완료: {path_eup} + {path_cand} (기준월 {usage['base_month']})")
    for r in ranking:
        mark = " ★선정" if r["eup"] in selected else ""
        print(f"  {r['rank']}위 {r['eup']:<4} score {r['score']:.2f} "
              f"(저조도 {r['low_usage']:.2f} · 증감 {r['decline']:.2f} · "
              f"최근3개월 {r['recent_3m']:,} / 전분기 {r['prev_3m']:,}){mark}")
    for c in candidates:
        road = ("도로 미상" if c["road_distance_km"] is None
                else f"도로 {c['road_distance_km']}km·{c['road_minutes']}분")
        print(f"  {c['id']} {c['eup']} {c['category']:<3} {c['name']} score {c['score']:.2f} "
              f"(공백 {c['gap']:.2f} · 근접 {c['proximity']:.2f} · 포화 {c['saturation']:.2f} · "
              f"반경상가 {c['nearby_stores']} · 동일업종가맹 {c['nearby_merchants']} · "
              f"직선 {haversine_m(ANCHOR['lat'], ANCHOR['lng'], c['lat'], c['lng']) / 1000:.2f}km · {road})")
    verify(eup_scores, candidates)


if __name__ == "__main__":
    main()
