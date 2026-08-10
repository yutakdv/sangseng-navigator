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


def apply_dashboard(doc, pairs):
    eups = {e for e, _ in pairs}
    cats = {c for _, c in pairs}
    for row in doc["monthly_by_region"]:
        for eup in eups:
            if isinstance(row.get(eup), (int, float)):
                row[eup] = round(row[eup] / ROUND_UNIT) * ROUND_UNIT
    for entry in doc.get("region_share", []):
        if entry.get("region") in eups and isinstance(entry.get("count"), (int, float)):
            entry["count"] = round(entry["count"] / ROUND_UNIT) * ROUND_UNIT
    for entry in doc.get("category_share", []):
        if entry.get("category") in cats and isinstance(entry.get("count"), (int, float)):
            entry["count"] = round(entry["count"] / ROUND_UNIT) * ROUND_UNIT
    doc["privacy_meta"] = _meta(pairs)
    return doc


def main():
    pairs = suppressed_pairs(_load("merchants.json"))
    _save("usage_monthly.json", apply_usage(_load("usage_monthly.json"), pairs))
    _save("dashboard.json", apply_dashboard(_load("dashboard.json"), pairs))
    cell_load = _load("cell_load.json")  # p9가 이미 억제 — 검증만
    for cell in cell_load["cells"]:
        if (cell["eup"], cell["category"]) in pairs:
            assert cell["suppressed"], f"p9 억제 누락: {cell}"
    print(f"[p10] suppressed={sorted(pairs)} rounding_unit={ROUND_UNIT}")


if __name__ == "__main__":
    main()
