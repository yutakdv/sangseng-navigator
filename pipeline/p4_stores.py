"""P4: 소상공인시장진흥공단 상가(상권)정보 수집 → data/raw/api_cache/stores_<지역>.json.

수집 전략(06 P4): 지역 단위로 통째로 받아 캐시하고, 반경 500m 필터는 로컬 haversine으로 계산한다.
후보 지점마다 API 반경 조회를 반복하면 호출 수가 폭발하고 재현성이 깨진다.

--- API 명세 (승인 페이지 대신 실호출 검증, 2026-08-03) ------------------------------
Base   : https://apis.data.go.kr/B553077/api/open/sdsc2
인증   : .env 의 DATA_GO_KR_API_KEY (Decoding 키 64자, % 인코딩 없음)
오퍼레이션
  largeUpjongList                        업종 대분류 25종 (→ category_map.py 주석에 박제)
  storeListInDong?divId=<구분>&key=<코드>   행정동/시군구/시도 단위 상가 목록  ← 이 스크립트가 사용
  storeListInRectangle?minx&miny&maxx&maxy 사각형 상가 목록 (행정동 코드 확보 실패 시 대안 — 미사용)
공통 파라미터: serviceKey, pageNo, numOfRows, type=json
  numOfRows 최대 1000 (2000 요청 시 응답 numOfRows 가 1000 으로 잘림 — 실측)
divId 실측: adongCd=행정동 **8자리**(51770253 고한읍 / 51770256 사북읍)
           signguCd=시군구 5자리(51770 정선군 / 51190 태백시 / 51750 영월군 / 51230 삼척시)
           ctprvnCd=시도 2자리(51 강원특별자치도, 110,206건)
           ※ 행정동 코드를 10자리(5177025300)로 주면 resultCode 03 NODATA_ERROR
응답 형태(실측):
  {"header": {"resultCode":"00","resultMsg":"NORMAL SERVICE","stdrYm":"202606","columns":[...]},
   "body": {"totalCount":533,"pageNo":1,"numOfRows":1000,"items":[{...}]}}
items 주요 필드: bizesNm(상호명) indsLclsNm(업종 대분류명) lon(경도) lat(위도)
                adongCd/adongNm(행정동) signguCd/signguNm(시군구) bizesId(상가업소번호)
페이징 실측: totalCount 3009(정선군)을 1000행 4페이지로 완주, 페이지 간 bizesId 중복 0건

PublicDataReader(SmallShop, 1.1.1) 시도 결과 → **직접 호출로 확정**. 실측한 탈락 사유 3가지:
  ① get_data() 가 requests.get 에 timeout 을 주지 않는다 — 고한읍(533건) 한 건 조회가 11분 넘게
     응답 없이 매달려 강제 종료. socket.setdefaulttimeout 으로도 끊기지 않았다
     (같은 조건의 직접 호출은 1초 이내 응답)
  ② numOfRows=99999 고정 + 페이징 없음 → 서버가 1000 으로 잘라도 그대로 반환(조용한 누락).
     06 공통 원칙 2 "totalCount 기준 전 페이지 순회"를 만족시킬 수 없다
  ③ verify=False (TLS 검증 비활성) 로 호출한다
"""
import argparse
import json
import os
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

from category_map import LCLS_EXCLUDED, LCLS_TO_DISPLAY
from common import ANCHOR, RADIUS_M, RAW_DIR, REGIONS, haversine_m

load_dotenv(Path(__file__).parents[1] / ".env")

API_BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2"
OP = "storeListInDong"
CACHE_DIR = RAW_DIR / "api_cache"
PAGE_SIZE = 1000        # 실측 상한
SLEEP_S = 0.1           # 호출 간격
RETRIES = 3             # 실패 시 3회 후 중단 (silent 실패 금지)
TIMEOUT_S = 30
LAT_RANGE = (36.5, 38.5)   # 06 공통 원칙 5
LNG_RANGE = (127.5, 129.5)

# REGIONS 6종의 조회 키 — 전부 실호출로 확정 (2026-08-03, totalCount 병기)
REGION_QUERY = {
    "고한읍": ("adongCd", "51770253"),    # 533
    "사북읍": ("adongCd", "51770256"),    # 511
    "정선군": ("signguCd", "51770"),      # 3009 (고한·사북 포함 → 아래에서 제외)
    "태백시": ("signguCd", "51190"),      # 2700
    "영월군": ("signguCd", "51750"),      # 2811
    "삼척시": ("signguCd", "51230"),      # 4260
}

# 정선군 조회는 고한읍·사북읍을 포함한다. P1 실측 판정(정선군 컬럼 = 고한·사북 제외 잔여,
# p1_usage.check_region_overlap)과 의미를 맞추기 위해 수집 단계에서 두 읍을 뺀다.
# → 6개 캐시 파일을 합산해도 이중집계가 없다.
REGION_EXCLUDE_ADONG = {"정선군": ("51770253", "51770256")}


def _api_key() -> str:
    key = os.environ.get("DATA_GO_KR_API_KEY", "").strip()
    if not key:
        raise SystemExit("P4 실패: DATA_GO_KR_API_KEY 미설정 — .env 를 확인할 것 (04 문서 §1)")
    return key


def _get(params: dict) -> dict:
    """resultCode 00 이 아니거나 통신 실패면 3회 재시도 후 중단."""
    last = None
    for attempt in range(1, RETRIES + 1):
        try:
            res = requests.get(f"{API_BASE}/{OP}", params=params, timeout=TIMEOUT_S)
            res.raise_for_status()
            body = res.json()
        except Exception as exc:  # 통신·JSON 파싱 실패
            last = f"{type(exc).__name__}: {exc}"
        else:
            header = body.get("header", {})
            if header.get("resultCode") == "00":
                return body
            last = f"resultCode={header.get('resultCode')} {header.get('resultMsg')}"
        if attempt < RETRIES:
            time.sleep(attempt)
    raise SystemExit(f"P4 실패: {OP} 호출 {RETRIES}회 실패 (divId={params.get('divId')}, "
                     f"key={params.get('key')}, pageNo={params.get('pageNo')}) — {last}")


def fetch_region(region: str) -> tuple[list[dict], int, str]:
    """totalCount 기준 전 페이지 순회 (06 공통 원칙 2). 미완주면 중단."""
    div_id, key = REGION_QUERY[region]
    base = {"serviceKey": _api_key(), "type": "json", "divId": div_id, "key": key,
            "numOfRows": PAGE_SIZE}
    items: list[dict] = []
    total, stdr_ym, page = None, None, 1
    while True:
        body = _get({**base, "pageNo": page})
        head, payload = body["header"], body.get("body", {})
        stdr_ym = stdr_ym or head.get("stdrYm", "")
        if total is None:
            total = int(payload.get("totalCount", 0))
        page_items = payload.get("items") or []
        items.extend(page_items)
        if not page_items or len(items) >= total:
            break
        page += 1
        time.sleep(SLEEP_S)
    if len(items) != total:
        raise SystemExit(f"P4 실패: {region} 페이징 미완주 — 수집 {len(items)}건 / totalCount {total}건")
    return items, total, stdr_ym


def build_cache(region: str, items: list[dict], total: int, stdr_ym: str) -> dict:
    """조회 키 검증 → 지역 제외 → 좌표 유효성 가드 → 필요한 필드만 저장."""
    div_id, key = REGION_QUERY[region]
    name_field = "adongNm" if div_id == "adongCd" else "signguNm"
    wrong = sorted({i.get(name_field) for i in items} - {region})
    if wrong:
        raise SystemExit(f"P4 실패: {region} 조회 키({div_id}={key})가 다른 지역을 반환 — {wrong}")

    exclude = REGION_EXCLUDE_ADONG.get(region, ())
    stores, seen = [], set()
    excluded = dup = 0
    dropped: list[str] = []
    for it in items:
        if it.get("adongCd") in exclude:
            excluded += 1
            continue
        bizes_id = it.get("bizesId")
        if bizes_id in seen:
            dup += 1
            continue
        seen.add(bizes_id)
        try:
            lat, lng = float(it["lat"]), float(it["lon"])
        except (KeyError, TypeError, ValueError):
            dropped.append(f"{it.get('bizesNm')}(좌표없음 lat={it.get('lat')} lon={it.get('lon')})")
            continue
        if not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]):
            dropped.append(f"{it.get('bizesNm')}(범위밖 {lat:.5f},{lng:.5f})")
            continue
        stores.append({
            "name": it.get("bizesNm", ""),
            "lcls": it.get("indsLclsNm", ""),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
        })
    for d in dropped:  # 06 공통 원칙 5 — 버린 좌표는 반드시 로그
        print(f"    [drop] {region} 좌표 유효성 가드: {d}")

    return {
        "region": region,
        "source": f"{API_BASE}/{OP}",
        "params": {"divId": div_id, "key": key},
        "stdr_ym": stdr_ym,
        "collected_at": date.today().isoformat(),
        "total_count": total,
        "excluded_adong": list(exclude),
        "excluded_count": excluded,
        "duplicate_count": dup,
        "dropped_invalid_coord": len(dropped),
        "note": ("정선군은 시군구 전체 조회에서 고한읍·사북읍 행정동을 제외한 잔여 지역 "
                 "(P1 지역 컬럼 의미와 동일)" if exclude else ""),
        "stores": stores,
    }


def load_stores(eup: str) -> list[dict]:
    """<eup> 상가 목록 → [{"name","lcls","lat","lng"}]. P6(2단계 스코어링)·B6(nearby_stores)가 소비."""
    path = CACHE_DIR / f"stores_{eup}.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} 없음 — pipeline/p4_stores.py 를 먼저 실행할 것")
    return json.loads(path.read_text(encoding="utf-8"))["stores"]


def _centroid(stores: list[dict]) -> tuple[float, float]:
    return (sum(s["lat"] for s in stores) / len(stores), sum(s["lng"] for s in stores) / len(stores))


def verify(caches: list[dict]) -> None:
    """06 P4 검증: 업종 대분류 실측 목록 + 고한읍·사북읍 반경 500m 내 상가 수 > 0."""
    known = set(LCLS_TO_DISPLAY) | set(LCLS_EXCLUDED)
    counts: dict[str, int] = {}
    for cache in caches:
        for s in cache["stores"]:
            counts[s["lcls"]] = counts.get(s["lcls"], 0) + 1
    unknown = sorted(set(counts) - known)
    if unknown:
        raise SystemExit(f"P4 실패: category_map.py 에 없는 업종 대분류 — {unknown}")

    print(f"\n소진공 업종 대분류 실측 {len(counts)}종 (수집분 전체, category_map.py 25종에 모두 포함):")
    for lcls, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        tag = LCLS_TO_DISPLAY.get(lcls, "— 후보 제외")
        print(f"  {lcls:<22} {n:>6,}건  → 표시 {tag}")

    print(f"\n반경 {RADIUS_M}m 내 상가 수 (로컬 haversine — API 반경 조회 미사용):")
    ok = True
    for eup in ("고한읍", "사북읍"):
        stores = load_stores(eup)
        c_lat, c_lng = _centroid(stores)
        near_c = sum(1 for s in stores if haversine_m(c_lat, c_lng, s["lat"], s["lng"]) <= RADIUS_M)
        near_a = sum(1 for s in stores
                     if haversine_m(ANCHOR["lat"], ANCHOR["lng"], s["lat"], s["lng"]) <= RADIUS_M)
        print(f"  {eup}: 상가 {len(stores)}건 / 중심({c_lat:.5f}, {c_lng:.5f}) 500m 내 {near_c}건 "
              f"/ {ANCHOR['name']} 500m 내 {near_a}건")
        ok = ok and near_c > 0
    if not ok:
        raise SystemExit("P4 실패: 읍 중심 반경 500m 내 상가 0건 — 좌표·수집 범위 확인")


def main() -> None:
    parser = argparse.ArgumentParser(description="P4 소진공 상가정보 수집 (06 문서 P4)")
    parser.add_argument("--refresh", action="store_true", help="캐시를 무시하고 API 재호출")
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    caches = []
    for region in REGIONS:
        path = CACHE_DIR / f"stores_{region}.json"
        if path.exists() and not args.refresh:
            cache = json.loads(path.read_text(encoding="utf-8"))
            print(f"[cache] {region}: {len(cache['stores']):,}건 ({path.name}) — 재호출 안 함")
        else:
            div_id, key = REGION_QUERY[region]
            items, total, stdr_ym = fetch_region(region)
            cache = build_cache(region, items, total, stdr_ym)
            path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"[api  ] {region}: {div_id}={key} totalCount {total:,} → 저장 {len(cache['stores']):,}건 "
                  f"(지역제외 {cache['excluded_count']:,} / 중복 {cache['duplicate_count']} / "
                  f"좌표버림 {cache['dropped_invalid_coord']}) 기준월 {cache['stdr_ym']}")
            time.sleep(SLEEP_S)
        caches.append(cache)

    print(f"\nP4 완료: {CACHE_DIR} — {len(caches)}개 지역 총 {sum(len(c['stores']) for c in caches):,}건")
    verify(caches)


if __name__ == "__main__":
    main()
