"""P2: 강원랜드 일자별 카지노 입장객 API → 월별 총 입장객 (usage_monthly.json 병합).

산출 `visitors_monthly`는 "지역 전환율"의 분모다 (분자=하이원포인트 거래 건수 — 단위가
달라 근사 지표로 표기, docs/plan/06 P5).

API 명세 (실호출 검증 2026-08-03):
  GET https://apis.data.go.kr/B552525/DailCustCntService/getDailCustCnt
  파라미터(전부 필수): serviceKey / pageNo / numOfRows / dateFrom / dateTo
    - 날짜 형식은 반드시 `YYYY-MM-DD` (다른 형식은 resultCode 33 DATE_STRING_PATTERN_MISSMATCH)
  응답(JSON 실측):
    {"resultCode":0,"resultMsg":"Success","totalCount":6,
     "data":[{"BSN_DT":"2025-01-01","BSN_HR_CN":"1부","NATIVE_CNT":6638,"FRGNR_CNT":52}, ...]}
    - 하루 = 영업 교대(1부/2부/3부) 최대 3행 → 일 입장객 = Σ(NATIVE_CNT + FRGNR_CNT)
  ⚠ 콜드 스타트: 서버가 처음/간헐적으로 SERVICETIMEOUT_ERROR(code 05) 또는 HTTP_ERROR(code 04)를
    XML(OpenAPI_ServiceResponse)로 반환 → JSON 파싱 실패는 재시도 대상(3회, 2.5초 간격),
    3회 실패 시 중단. 반대로 정상 JSON인데 resultCode != 0 이면 파라미터 오류이므로 즉시 중단.

실행: python p2_visitors.py [--refresh]
  캐시(data/raw/api_cache/visitors.json)가 있으면 API를 호출하지 않는다 (06 공통 원칙 1).
"""
import argparse
import calendar
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

from common import PROCESSED_DIR, RAW_DIR

load_dotenv(Path(__file__).parents[1] / ".env")

ENDPOINT = "https://apis.data.go.kr/B552525/DailCustCntService/getDailCustCnt"
CACHE_PATH = RAW_DIR / "api_cache" / "visitors.json"

COLLECT_MONTHS = [f"2025-{m:02d}" for m in range(1, 13)]  # 수집 구간 (P1 사용현황과 동일 연도)
NUM_OF_ROWS = 200      # 월 최대 93행 → 1페이지로 끝나지만 페이징 로직은 유지 (06 공통 원칙 2)
MAX_PAGES = 20         # 무한 루프 가드
RETRIES = 3            # 콜드 스타트 대응
RETRY_WAIT_S = 2.5
CALL_INTERVAL_S = 0.5  # 원천 서버가 느려 호출 간 간격을 둔다


def month_range(month: str) -> tuple[str, str]:
    """'2025-01' → ('2025-01-01', '2025-01-31')."""
    year, mon = int(month[:4]), int(month[5:7])
    return f"{month}-01", f"{month}-{calendar.monthrange(year, mon)[1]:02d}"


def call_api(service_key: str, month: str, page: int) -> dict:
    """한 페이지 호출. 콜드 스타트(비-JSON 응답)만 재시도한다."""
    date_from, date_to = month_range(month)
    params = {
        "serviceKey": service_key,
        "pageNo": page,
        "numOfRows": NUM_OF_ROWS,
        "dateFrom": date_from,
        "dateTo": date_to,
    }
    last_error = ""
    for attempt in range(1, RETRIES + 1):
        time.sleep(CALL_INTERVAL_S)
        res = None
        try:
            res = requests.get(ENDPOINT, params=params, timeout=30)
            payload = res.json()
        except (requests.RequestException, ValueError) as exc:
            body = res.text[:200] if res is not None else ""
            last_error = f"{type(exc).__name__}: {exc} / 응답 앞부분: {body!r}"
            print(f"  [retry {attempt}/{RETRIES}] {month} p{page} — {last_error}")
            if attempt < RETRIES:
                time.sleep(RETRY_WAIT_S)
            continue

        if str(payload.get("resultCode")) != "0":
            raise SystemExit(
                f"P2 실패: {month} p{page} API 오류 resultCode={payload.get('resultCode')} "
                f"resultMsg={payload.get('resultMsg')} — 파라미터(날짜 형식 YYYY-MM-DD)·인증키 확인"
            )
        return payload

    raise SystemExit(f"P2 실패: {month} p{page} — {RETRIES}회 재시도 모두 실패. 마지막 오류: {last_error}")


def fetch_month(service_key: str, month: str) -> list[dict]:
    """totalCount 기준으로 전 페이지를 완주해 원응답 행을 모은다."""
    rows: list[dict] = []
    total_count = None
    for page in range(1, MAX_PAGES + 1):
        payload = call_api(service_key, month, page)
        if total_count is None:
            total_count = int(payload.get("totalCount") or 0)
        data = payload.get("data") or []
        rows.extend(data)
        if not data or len(rows) >= total_count:
            break
    else:
        raise SystemExit(f"P2 실패: {month} 페이징이 {MAX_PAGES}페이지를 넘음 — totalCount={total_count}")

    if total_count is not None and len(rows) != total_count:
        raise SystemExit(f"P2 실패: {month} 수집 {len(rows)}행 ≠ totalCount {total_count}행")
    return rows


def load_cache(service_key: str, refresh: bool) -> dict:
    if CACHE_PATH.exists() and not refresh:
        cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        print(f"P2 캐시 사용: {CACHE_PATH} (갱신하려면 --refresh)")
        return cache

    if not service_key:
        raise SystemExit("P2 실패: .env의 DATA_GO_KR_API_KEY가 비어 있음 (Decoding 키를 입력)")

    print(f"P2 API 수집: {ENDPOINT}")
    months = {}
    for month in COLLECT_MONTHS:
        rows = fetch_month(service_key, month)
        months[month] = rows
        print(f"  {month}: {len(rows)}행")

    cache = {
        "endpoint": ENDPOINT,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params_note": "dateFrom/dateTo = 월초~월말(YYYY-MM-DD), numOfRows=200, totalCount 기준 페이징 완주",
        "months": months,
    }
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  캐시 저장: {CACHE_PATH}")
    return cache


def aggregate(cache: dict) -> dict[str, int]:
    """월 → 총 입장객(내국인+외국인, 전 교대 합)."""
    totals = {}
    for month, rows in cache["months"].items():
        total = 0
        for row in rows:
            total += int(row.get("NATIVE_CNT") or 0) + int(row.get("FRGNR_CNT") or 0)
        totals[month] = total
    return dict(sorted(totals.items()))


def main():
    parser = argparse.ArgumentParser(description="P2 카지노 입장객 수집·월합산")
    parser.add_argument("--refresh", action="store_true", help="캐시를 무시하고 API 재호출")
    args = parser.parse_args()

    cache = load_cache(os.environ.get("DATA_GO_KR_API_KEY", "").strip(), args.refresh)
    visitors = aggregate(cache)

    usage_path = PROCESSED_DIR / "usage_monthly.json"
    if not usage_path.exists():
        raise SystemExit(f"P2 실패: {usage_path} 없음 — p1_usage.py를 먼저 실행")
    usage = json.loads(usage_path.read_text(encoding="utf-8"))

    # 06 공통 원칙 4 — 분자(사용현황)·분모(입장객)가 겹치는 월만 병합
    usage_months = list(usage.get("months") or [])
    merged = {m: visitors[m] for m in usage_months if m in visitors}
    if not merged:
        raise SystemExit(
            f"P2 실패: 겹치는 월 0개 — 사용현황 {usage_months[:1]}~{usage_months[-1:]} vs "
            f"입장객 {COLLECT_MONTHS[0]}~{COLLECT_MONTHS[-1]}"
        )

    usage["visitors_monthly"] = merged  # 기존 키·데이터는 보존, 이 키만 교체
    usage_path.write_text(json.dumps(usage, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"P2 완료: {usage_path}")
    print(f"  visitors_monthly {len(merged)}개월 ({min(merged)}~{max(merged)}), "
          f"월 최소 {min(merged.values()):,}명 / 최대 {max(merged.values()):,}명")
    for month, total in merged.items():
        print(f"    {month}: {total:>9,}명")

    if len(merged) < len(usage_months):
        missing = [m for m in usage_months if m not in merged]
        print(f"  ⚠ 사용현황 월 {len(usage_months)}개 중 입장객 없는 월 {len(missing)}개: {missing} "
              "— 지역 전환율은 겹치는 월만 계산됨")
    extra = [m for m in visitors if m not in merged]
    if extra:
        print(f"  참고: 사용현황과 겹치지 않아 제외한 입장객 월 {len(extra)}개: {extra}")


if __name__ == "__main__":
    main()
