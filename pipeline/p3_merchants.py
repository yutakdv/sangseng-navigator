"""P3: 하이원포인트 가맹점 상세정보 수집 + 지오코딩 + category·eup 부여 → data/processed/merchants.json.

산출물은 T5(P6 2단계 포화도·공백도), B1(candidates 병합), B6(위젯 추천)이 소비한다.
스키마는 05 문서 §1 `merchants` 배열: {"name","category","eup","address","lat","lng"}.

--- 가맹점 API 명세 (포털 웹 다운으로 승인 페이지 대신 실호출 검증, 2026-08-03) -----------
GET https://apis.data.go.kr/B552525/pbdata/getStoreInfo
파라미터(전부 필수): serviceKey(.env DATA_GO_KR_API_KEY) / pageNo / numOfRows
응답(JSON, 실측):
  {"resultCode":0,"resultMsg":"Success","numOfRows":"2","pageNo":"1","totalCount":1679,
   "data":[{"FRCS_REG_NO":3526,"FRCS_NM":"#감동","FRCS_BRNO":"<사업자등록번호 10자리>",
            "FRCS_ADDR":"강원도 태백시 번영로 348(황지동) ","FRCS_TELNO":"<전화번호>",
            "PNT_USABLE_AMT":4000000}, ...]}   ← 두 식별자는 캐시 저장 시 제외한다(아래 DROP_FIELDS)
  numOfRows 는 1000 까지 실측 확인 (1679건 = 2페이지). totalCount 기준으로 완주한다(06 공통 원칙 2).
⚠ **업종 필드가 없다** — category 는 category_map.py 매핑 ③ 규칙으로 부여한다(아래 §category).
⚠ FRCS_ADDR 끝에 trailing space 가 있다 — strip 필수.
⚠ 시도 표기가 "강원도"(825) / "강원특별자치도"(798) / "강원"(56) 세 가지로 섞여 있다.
   Kakao 는 셋 다 인식하므로 주소 문자열은 건드리지 않고 그대로 질의한다.

⚠ 원응답 캐시(merchants_raw.json)는 커밋 대상이라 **FRCS_TELNO(전화번호)·FRCS_BRNO(사업자등록번호)를
   저장 전에 떨군다** (DROP_FIELDS). 개인사업자 식별자를 Public 레포에 싣지 않기 위함이며(12 문서 §4),
   파이프라인은 두 필드를 소비하지 않으므로 merchants.json 산출에는 영향이 0 이다.

--- 지오코딩 -----------------------------------------------------------------------
geocode(addr) -> (lat, lng) | None 함수 하나로 감싼다 (provider 교체 가능, 06 P3).
  1순위 Kakao Local: GET https://dapi.kakao.com/v2/local/search/address.json?query=<주소>
                     헤더 Authorization: KakaoAK <.env KAKAO_REST_API_KEY>, 호출 간격 0.1초
  2순위 VWorld 폴백: .env 에 VWORLD_API_KEY 가 있을 때만 시도한다. 현재 키가 없어 skip 되며,
                     그 사실을 stdout 에 1회 알린다 (코드 경로는 키가 생기면 바로 동작).
보정 1단계: 원주소 실패 시 괄호 안 동 이름·층/호 등 상세주소를 떼고 도로명+건물번호까지만 재질의.
캐시: 주소→좌표를 data/raw/api_cache/geocode.json 에 누적 (재실행 시 호출 생략).
      ⚠ 이 캐시는 **커밋하지 않는다** (.gitignore 등재 — 카카오 응답 재배포 제약, 12 문서 §4).
      재현성은 산출물 merchants.json 이 담보한다. 원응답 캐시 merchants_raw.json 은 커밋한다.
실패분은 data/raw/api_cache/geocode_failed.json 에 기록하고 실패율을 stdout 에 출력한다.

--- eup·category 부여 ---------------------------------------------------------------
eup     : 주소 문자열에서 고한읍·사북읍 토큰을 먼저 보고(둘 다 정선군 소속), 없으면 시군구 4종.
          어디에도 안 걸리면 "기타" 로 두고 건수를 출력한다.
category: 표시 6분류만 허용 (카페·음식점·편의점·숙박업·소매점·기타).
          ① 상호명 키워드 규칙 category_map.merchant_display_category()
          ② 미분류분은 같은 읍의 소진공 상가 캐시에서 상호명 정규화 일치를 찾아
             category_map.store_display_category(store) 로 부여 (대분류 직접 롤업 금지)
          ③ 그래도 없으면 "기타"
          ⚠ B5 시뮬레이션(T12)의 폴백 1·2단계 분모가 merchants[].category 일치에 의존한다.
            원시 업종명·공백·누락 값을 절대 넣지 말 것.

실행: python p3_merchants.py [--refresh]   (--refresh 는 가맹점 API 재호출. 지오코딩 캐시는 유지)
"""
import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

from category_map import (
    DISPLAY_CATEGORIES,
    merchant_display_category,
    normalize_name,
    store_display_category,
)
from common import PROCESSED_DIR, RAW_DIR, REGIONS
from p4_stores import load_stores

load_dotenv(Path(__file__).parents[1] / ".env")

ENDPOINT = "https://apis.data.go.kr/B552525/pbdata/getStoreInfo"
CACHE_DIR = RAW_DIR / "api_cache"
RAW_CACHE = CACHE_DIR / "merchants_raw.json"
GEOCODE_CACHE = CACHE_DIR / "geocode.json"          # 커밋 금지 (.gitignore)
GEOCODE_FAILED = CACHE_DIR / "geocode_failed.json"  # 커밋 대상 (실패율 발표 명시용)
OUT_PATH = PROCESSED_DIR / "merchants.json"

# 커밋되는 원응답 캐시에서 제외하는 개인사업자 식별자 (12 문서 §4 — Public 전환 대비).
# 파이프라인이 읽는 필드는 FRCS_NM·FRCS_ADDR 뿐이라 산출물에는 영향이 없다.
DROP_FIELDS = ("FRCS_TELNO", "FRCS_BRNO")

PAGE_SIZE = 1000        # 실측 상한
RETRIES = 3             # 실패 시 3회 후 명확한 에러로 중단 (silent 실패 금지)
RETRY_WAIT_S = 2.0
TIMEOUT_S = 30
GEOCODE_INTERVAL_S = 0.1
LAT_RANGE = (36.5, 38.5)   # 06 공통 원칙 5
LNG_RANGE = (127.5, 129.5)
SUCCESS_TARGET = 0.90      # 06 P3 검증 목표

KAKAO_URL = "https://dapi.kakao.com/v2/local/search/address.json"
VWORLD_URL = "https://api.vworld.kr/req/address"
KEY_PATTERN = re.compile(r"(serviceKey|key)=[^&\s]*")  # 에러 메시지에서 키 마스킹

EUP_TOKENS = ("고한읍", "사북읍")   # 시군구보다 먼저 본다 — 둘 다 정선군 소속이라 순서가 곧 의미다
SIGUNGU_TOKENS = ("정선군", "태백시", "영월군", "삼척시")
PAREN = re.compile(r"\([^)]*\)")
ROAD_NUMBER = re.compile(r"^\d+(-\d+)?$")


# --- 수집 -------------------------------------------------------------------------

def _api_key() -> str:
    key = os.environ.get("DATA_GO_KR_API_KEY", "").strip()
    if not key:
        raise SystemExit("P3 실패: DATA_GO_KR_API_KEY 미설정 — .env 를 확인할 것 (04 문서 §1)")
    return key


def _get(page: int) -> dict:
    """한 페이지 호출. 통신·JSON 파싱 실패만 재시도하고, resultCode != 0 은 즉시 중단한다."""
    params = {"serviceKey": _api_key(), "pageNo": page, "numOfRows": PAGE_SIZE}
    last = ""
    for attempt in range(1, RETRIES + 1):
        res = None
        try:
            res = requests.get(ENDPOINT, params=params, timeout=TIMEOUT_S)
            res.raise_for_status()
            payload = res.json()
        except (requests.RequestException, ValueError) as exc:
            body = res.text[:200] if res is not None else ""
            last = KEY_PATTERN.sub(r"\1=***", f"{type(exc).__name__}: {exc} / 응답 앞부분: {body!r}")
            print(f"  [retry {attempt}/{RETRIES}] p{page} — {last}")
            if attempt < RETRIES:
                time.sleep(RETRY_WAIT_S)
            continue

        if str(payload.get("resultCode")) != "0":
            raise SystemExit(
                f"P3 실패: p{page} API 오류 resultCode={payload.get('resultCode')} "
                f"resultMsg={payload.get('resultMsg')} — 파라미터·인증키 확인"
            )
        return payload

    raise SystemExit(f"P3 실패: p{page} — {RETRIES}회 재시도 모두 실패. 마지막 오류: {last}")


def fetch_all() -> tuple[list[dict], int]:
    """totalCount 기준 전 페이지 순회 (06 공통 원칙 2). 미완주면 중단."""
    rows: list[dict] = []
    total, page = None, 1
    while True:
        payload = _get(page)
        if total is None:
            total = int(payload.get("totalCount") or 0)
        data = payload.get("data") or []
        print(f"  p{page}: {len(data)}건 (누적 {len(rows) + len(data)} / totalCount {total})")
        rows.extend(data)
        if not data or len(rows) >= total:
            break
        page += 1
    if len(rows) != total:
        raise SystemExit(f"P3 실패: 페이징 미완주 — 수집 {len(rows)}건 / totalCount {total}건")
    return rows, total


def strip_pii(rows: list[dict]) -> list[dict]:
    """캐시 저장 전 개인사업자 식별자 제거 — 나머지 필드는 원응답 순서 그대로 남긴다."""
    return [{k: v for k, v in row.items() if k not in DROP_FIELDS} for row in rows]


def load_raw(refresh: bool) -> dict:
    if RAW_CACHE.exists() and not refresh:
        cache = json.loads(RAW_CACHE.read_text(encoding="utf-8"))
        print(f"[cache] 가맹점 원응답 {len(cache['data']):,}건 ({RAW_CACHE.name}) — 재호출 안 함 "
              f"(갱신은 --refresh)")
        return cache

    print(f"[api  ] 가맹점 수집: {ENDPOINT}")
    rows, total = fetch_all()
    cache = {
        "endpoint": ENDPOINT,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params_note": f"serviceKey/pageNo/numOfRows 필수, numOfRows={PAGE_SIZE}, "
                       "totalCount 기준 페이징 완주",
        "total_count": total,
        "data": strip_pii(rows),   # 전화번호·사업자등록번호는 커밋 대상 캐시에 남기지 않는다
    }
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    RAW_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  캐시 저장: {RAW_CACHE} ({len(rows):,}건, {'·'.join(DROP_FIELDS)} 제외)")
    return cache


# --- 지오코딩 ---------------------------------------------------------------------

def _address_variants(address: str) -> list[str]:
    """질의 후보 — 원주소, 그리고 상세주소(괄호·층·호)를 떼고 도로명+건물번호까지만 남긴 형태."""
    full = " ".join(address.split())
    simple = " ".join(PAREN.sub(" ", full).split())
    tokens = simple.split()
    for i, tok in enumerate(tokens):
        if ROAD_NUMBER.match(tok) and i + 1 < len(tokens):
            simple = " ".join(tokens[: i + 1])
            break
    return [full] if simple == full else [full, simple]


def _in_range(lat: float, lng: float) -> bool:
    return LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LNG_RANGE[0] <= lng <= LNG_RANGE[1]


def _kakao(query: str, key: str) -> tuple[float, float] | None:
    res = requests.get(KAKAO_URL, params={"query": query, "size": 1},
                       headers={"Authorization": f"KakaoAK {key}"}, timeout=TIMEOUT_S)
    if res.status_code != 200:
        print(f"    [kakao {res.status_code}] {query} — {res.text[:120]}")
        return None
    docs = res.json().get("documents") or []
    if not docs:
        return None
    return float(docs[0]["y"]), float(docs[0]["x"])


def _vworld(query: str, key: str) -> tuple[float, float] | None:
    """VWorld 폴백 — 도로명(ROAD) 실패 시 지번(PARCEL)까지 시도."""
    for addr_type in ("ROAD", "PARCEL"):
        res = requests.get(VWORLD_URL, params={
            "service": "address", "request": "getcoord", "version": "2.0",
            "crs": "epsg:4326", "type": addr_type, "address": query, "key": key,
        }, timeout=TIMEOUT_S)
        if res.status_code != 200:
            continue
        body = res.json().get("response", {})
        if body.get("status") != "OK":
            continue
        point = body.get("result", {}).get("point", {})
        if point:
            return float(point["y"]), float(point["x"])
    return None


def geocode(address: str, cache: dict, stats: dict) -> tuple[float, float] | None:
    """주소 → (lat, lng). 실패하면 None. 캐시 적중 시 API 호출 없음.

    provider 교체 가능하도록 호출부는 이 함수 하나만 쓴다 (06 P3).
    """
    if address in cache:
        stats["cached"] += 1
        return tuple(cache[address])

    kakao_key = os.environ.get("KAKAO_REST_API_KEY", "").strip()
    vworld_key = os.environ.get("VWORLD_API_KEY", "").strip()
    if not kakao_key:
        raise SystemExit("P3 실패: KAKAO_REST_API_KEY 미설정 — .env 를 확인할 것 (04 문서 §1)")

    for query in _address_variants(address):
        for provider, fn, key in (("kakao", _kakao, kakao_key), ("vworld", _vworld, vworld_key)):
            if not key:
                if provider == "vworld" and not stats["vworld_skipped"]:
                    print("    [skip] VWORLD_API_KEY 없음 — 2순위 폴백은 건너뛴다 (키 발급 시 자동 동작)")
                stats["vworld_skipped"] += 1
                continue
            time.sleep(GEOCODE_INTERVAL_S)
            stats[f"{provider}_calls"] += 1
            found = fn(query, key)
            if not found:
                continue
            lat, lng = found
            if not _in_range(lat, lng):   # 06 공통 원칙 5 — 버린 좌표는 로그
                print(f"    [drop] 좌표 유효 범위 밖 {lat:.5f},{lng:.5f} — {address}")
                stats["out_of_range"] += 1
                continue
            lat, lng = round(lat, 6), round(lng, 6)
            cache[address] = [lat, lng]
            if query != address:
                stats["simplified"] += 1
            return lat, lng
    return None


# --- eup·category 부여 --------------------------------------------------------------

def eup_of(address: str) -> str:
    """주소 문자열 → 6개 지역 중 하나. 고한읍·사북읍(정선군 소속)을 시군구보다 먼저 본다."""
    for token in EUP_TOKENS:
        if token in address:
            return token
    for token in SIGUNGU_TOKENS:
        if token in address:
            return token
    return "기타"


def _match_key(name: str) -> str:
    """소진공 상호와 맞대보기 위한 키 — 괄호 안 지역 표기("김밥나라(고한)")를 떼고 정규화."""
    return normalize_name(PAREN.sub("", name))


def build_store_index() -> dict[str, dict[str, dict]]:
    """{읍: {정규화 상호: 소진공 상가}} — 2차 매칭용. 캐시가 없는 지역은 건너뛴다."""
    index: dict[str, dict[str, dict]] = {}
    for region in REGIONS:
        try:
            stores = load_stores(region)
        except FileNotFoundError:
            print(f"  [주의] stores_{region}.json 없음 — {region} 은 2차 매칭 없이 진행 "
                  "(p4_stores.py 를 먼저 실행하면 정확도가 올라간다)")
            continue
        by_name: dict[str, dict] = {}
        for store in stores:
            by_name.setdefault(_match_key(store["name"]), store)
        index[region] = by_name
    return index


def assign_category(name: str, eup: str, index: dict[str, dict[str, dict]]) -> tuple[str, str]:
    """상호명 → (표시 6분류, 부여 방법). 방법은 '키워드' | '소진공' | '기타'."""
    display = merchant_display_category(name)
    if display:
        return display, "키워드"
    store = index.get(eup, {}).get(_match_key(name))
    if store:
        # 표시 분류는 store_display_category 만 쓴다 — 대분류 직접 롤업 금지 (단일 정본)
        display = store_display_category(store)
        if display:
            return display, "소진공"
    return "기타", "기타"


# --- 검증 -------------------------------------------------------------------------

def verify(merchants: list[dict], failed: list[dict], methods: dict[str, int]) -> None:
    """06 P3 검증 + 브리프 §4: 성공률·좌표 범위·eup 분포·샘플 3건."""
    total = len(merchants) + len(failed)
    rate = len(merchants) / total if total else 0.0
    print(f"\n① 지오코딩 성공률: {len(merchants):,}/{total:,} = {rate:.1%} "
          f"(목표 {SUCCESS_TARGET:.0%}) → {'통과' if rate >= SUCCESS_TARGET else '미달'}")
    if failed:
        print(f"   실패 {len(failed)}건 → {GEOCODE_FAILED.name}")
        for item in failed[:5]:
            print(f"     - {item['name']} / {item['address']}")

    bad = [m for m in merchants if not _in_range(m["lat"], m["lng"])]
    lats = [m["lat"] for m in merchants]
    lngs = [m["lng"] for m in merchants]
    print(f"② 좌표 유효 범위 전수 검사: 위도 {min(lats):.4f}~{max(lats):.4f} / "
          f"경도 {min(lngs):.4f}~{max(lngs):.4f} → 범위 밖 {len(bad)}건")
    if bad:
        raise SystemExit(f"P3 실패: 좌표 유효 범위 밖 {len(bad)}건이 산출물에 남았다 — {bad[:3]}")

    print("③ eup 분포:")
    dist: dict[str, int] = {}
    for m in merchants:
        dist[m["eup"]] = dist.get(m["eup"], 0) + 1
    for region in REGIONS + ["기타"]:
        if dist.get(region):
            print(f"     {region:<5} {dist[region]:>5,}건")
    if not (dist.get("고한읍", 0) and dist.get("사북읍", 0)):
        raise SystemExit("P3 실패: 고한읍·사북읍 가맹점이 0건 — 주소 파싱을 확인할 것")

    print("④ 샘플 3건 (주소 ↔ 좌표 눈 확인용):")
    for m in merchants[:3]:
        print(f"     {m['name']} / {m['category']} / {m['eup']} / {m['address']} "
              f"→ ({m['lat']}, {m['lng']})")

    cats: dict[str, int] = {}
    for m in merchants:
        cats[m["category"]] = cats.get(m["category"], 0) + 1
    unknown = sorted(set(cats) - set(DISPLAY_CATEGORIES))
    if unknown:
        raise SystemExit(f"P3 실패: 표시 6분류가 아닌 category 값 — {unknown}")
    print("   표시 분류 분포: " + " / ".join(f"{c} {cats.get(c, 0):,}" for c in DISPLAY_CATEGORIES))
    print("   분류 방법: " + " / ".join(f"{k} {v:,}건" for k, v in methods.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description="P3 가맹점 수집·지오코딩 (06 문서 P3)")
    parser.add_argument("--refresh", action="store_true", help="가맹점 API 캐시를 무시하고 재호출")
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    rows = load_raw(args.refresh)["data"]

    cache = json.loads(GEOCODE_CACHE.read_text(encoding="utf-8")) if GEOCODE_CACHE.exists() else {}
    print(f"[geo  ] 지오코딩 캐시 {len(cache):,}건 로드 ({GEOCODE_CACHE.name}, 커밋 제외)")
    index = build_store_index()

    stats = {"cached": 0, "kakao_calls": 0, "vworld_calls": 0, "vworld_skipped": 0,
             "simplified": 0, "out_of_range": 0}
    methods = {"키워드": 0, "소진공": 0, "기타": 0}
    merchants: list[dict] = []
    failed: list[dict] = []
    eup_etc: list[str] = []

    for i, row in enumerate(rows, 1):
        name = (row.get("FRCS_NM") or "").strip()
        address = " ".join((row.get("FRCS_ADDR") or "").split())  # trailing space·중복 공백 정리
        if not name or not address:
            failed.append({"name": name, "address": address, "reason": "상호명·주소 결측"})
            continue
        eup = eup_of(address)
        if eup == "기타":
            eup_etc.append(address)
        category, method = assign_category(name, eup, index)
        methods[method] += 1

        coord = geocode(address, cache, stats)
        if coord is None:
            failed.append({"name": name, "address": address, "eup": eup, "reason": "지오코딩 실패"})
            continue
        merchants.append({"name": name, "category": category, "eup": eup, "address": address,
                          "lat": coord[0], "lng": coord[1]})
        if i % 200 == 0:
            print(f"  진행 {i:,}/{len(rows):,} — 성공 {len(merchants):,} / 실패 {len(failed)} "
                  f"(캐시 적중 {stats['cached']:,})")

    GEOCODE_CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
    GEOCODE_FAILED.write_text(json.dumps(failed, ensure_ascii=False, indent=1), encoding="utf-8")
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(merchants, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\nP3 완료: {OUT_PATH} — {len(merchants):,}건 "
          f"(Kakao 호출 {stats['kakao_calls']:,} / VWorld 호출 {stats['vworld_calls']:,} / "
          f"캐시 적중 {stats['cached']:,} / 상세주소 보정 성공 {stats['simplified']} / "
          f"범위 밖 폐기 {stats['out_of_range']})")
    if eup_etc:
        print(f"  ⚠ 6개 지역 토큰이 없는 주소 {len(eup_etc)}건 → eup='기타' (예: {eup_etc[:2]})")
    verify(merchants, failed, methods)


if __name__ == "__main__":
    main()
