"""P10: 발행 직전 프라이버시 가공 — 소표본 셀 억제 + 합계 반올림 (심사 보강 Phase 5).

run_all의 마지막 단계로 실행된다. 내부 계산(p5·p6·p9)은 이미 원값으로 끝난 뒤이므로
여기서의 가공은 '발행값'에만 영향을 준다. 스코어·비율은 건드리지 않는다.
"""
import json
from collections import Counter
from pathlib import Path

from category_map import HIGHONE_TO_DISPLAY

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed"
K = 5
ROUND_UNIT = 100
NOTE = ("가맹점 5곳 미만 셀의 건수는 비공개. 합계는 100 단위 반올림으로 차분 복원 "
        "정밀도를 낮춤(완전 차단은 아님). 비율·순위·스코어는 반올림 전 원값으로 계산됨.")


def _load(name):
    return json.loads((PROCESSED / name).read_text(encoding="utf-8"))


def _save(name, doc):
    (PROCESSED / name).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def suppressed_pairs(merchants):
    counts = Counter((m["eup"], m["category"]) for m in merchants)
    return {pair for pair, n in counts.items() if n < K}


def _round(value):
    return round(value / ROUND_UNIT) * ROUND_UNIT


def _meta(pairs):
    return {"k": K,
            "suppressed_cells": [{"eup": e, "category": c} for e, c in sorted(pairs)],
            "aggregate_rounding": {"unit": ROUND_UNIT},
            "note": NOTE}


def apply_usage(doc, pairs):
    for row in doc["usage"]:
        disp = HIGHONE_TO_DISPLAY.get(row["category"])
        for eup, category in pairs:
            if disp == category and eup in row:
                row[eup] = None
    doc["privacy_meta"] = _meta(pairs)
    return doc


def apply_daily(doc, pairs):
    """일·요일 축 산출물의 억제 (심사 보강 v4.1 C4 후속).

    `weekday_category`의 키는 **표시 6분류**다(usage_monthly의 하이원 18종과 다르다 —
    p1_usage.build_daily가 DISPLAY_CATEGORIES로 이미 롤업한다). 그래서 억제 쌍을 그대로 쓴다.

    여기까지 억제하지 않으면 월 원장에서 지운 값이 요일 축으로 그대로 복원된다:
    실측 영월군 편의점 = [491, 604, 578, 522, 515, 651, 683], 합 4,044건 — 숨기려던 값 자체다.

    반올림 대상은 usage_monthly/dashboard와 같은 원칙이다. 억제 셀 하나를 지워도
    **같은 행·같은 열의 다른 집계가 정확하면 빼기 한 번으로 되살아나므로**, 그 두 마진을 흐린다.
      · 행 마진 = 억제 지역의 공개 업종 셀 (지역 요일 합계에서 빼면 억제분이 나온다)
      · 열 마진 = '전체'의 억제 업종 (다른 5개 지역을 빼면 억제 지역이 남는다)
    `daily_total`은 셀이 아니라 지역 총합이라 **원값 그대로 둔다** — 일 단위 값이 6~230건이라
    100 단위로 반올림하면 값 자체가 무너지고(최솟값 6 → 0), 화면의 일별 추이가 못 쓰게 된다.
    차분 정밀도는 행 마진 반올림이 대신 낮춘다(dashboard가 monthly_by_region을 반올림한 것과
    같은 효과 — 등식의 어느 한쪽만 흐리면 된다).
    """
    weekday = doc.get("weekday_category") or {}
    for eup, category in pairs:
        if isinstance(weekday.get(eup), dict) and category in weekday[eup]:
            weekday[eup][category] = None
    for eup in {e for e, _ in pairs}:
        for category, counts in (weekday.get(eup) or {}).items():
            if isinstance(counts, list):
                weekday[eup][category] = [_round(v) for v in counts]
    for category in {c for _, c in pairs}:
        counts = (weekday.get("전체") or {}).get(category)
        if isinstance(counts, list):
            weekday["전체"][category] = [_round(v) for v in counts]
    doc["privacy_meta"] = _meta(pairs)
    return doc


def apply_dashboard(doc, pairs):
    eups = {e for e, _ in pairs}
    cats = {c for _, c in pairs}
    for row in doc["monthly_by_region"]:
        for eup in eups:
            if isinstance(row.get(eup), (int, float)):
                row[eup] = _round(row[eup])
    for entry in doc.get("region_share", []):
        if entry.get("region") in eups and isinstance(entry.get("count"), (int, float)):
            entry["count"] = _round(entry["count"])
    for entry in doc.get("category_share", []):
        if entry.get("category") in cats and isinstance(entry.get("count"), (int, float)):
            entry["count"] = _round(entry["count"])
    doc["privacy_meta"] = _meta(pairs)
    return doc


def main():
    pairs = suppressed_pairs(_load("merchants.json"))
    _save("usage_monthly.json", apply_usage(_load("usage_monthly.json"), pairs))
    _save("usage_daily.json", apply_daily(_load("usage_daily.json"), pairs))
    _save("dashboard.json", apply_dashboard(_load("dashboard.json"), pairs))
    cell_load = _load("cell_load.json")  # p9가 이미 억제 — 검증만
    for cell in cell_load["cells"]:
        if (cell["eup"], cell["category"]) in pairs:
            assert cell["suppressed"], f"p9 억제 누락: {cell}"
    print(f"[p10] suppressed={sorted(pairs)} rounding_unit={ROUND_UNIT}")


if __name__ == "__main__":
    main()
