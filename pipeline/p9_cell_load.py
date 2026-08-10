"""P9: 셀(지역×표시업종) 가맹점 이용 부하 — 심사 보강 Phase 2.

금액 데이터가 원본에 없어(건수 컬럼뿐) '한도 소진율'은 산출하지 않는다.
부하 지수 = 최근 3개월 평균 월 거래 건수 ÷ 셀 가맹점 수 (추정치).
가맹점 5곳 미만 셀은 k-익명성 보호로 값 비공개(suppressed).
"""
import json
from collections import defaultdict
from pathlib import Path

from category_map import HIGHONE_TO_DISPLAY

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed"
REGIONS = ["고한읍", "사북읍", "정선군", "태백시", "영월군", "삼척시"]
WINDOW = 3
K_ANONYMITY = 5
METHOD_NOTE = (
    "부하 지수 = 최근 3개월 평균 월 거래 건수 ÷ 셀 가맹점 수. "
    "원본 데이터가 건수 기준이라 금액 기반 한도 소진율은 산출하지 않는다(추정치)."
)


def quantile(vals, q):
    s = sorted(vals)
    idx = (len(s) - 1) * q
    lo = int(idx)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)


def _window_months(usage, base_month):
    months = sorted({r["month"] for r in usage if r["month"] <= base_month})
    return months[-WINDOW:]


def build_cells(usage, merchants, base_month):
    window = _window_months(usage, base_month)
    counts = defaultdict(int)
    for m in merchants:
        counts[(m["eup"], m["category"])] += 1
    uses = defaultdict(int)
    for row in usage:
        if row["month"] not in window:
            continue
        disp = HIGHONE_TO_DISPLAY.get(row["category"])
        if disp is None:
            continue
        for region in REGIONS:
            uses[(region, disp)] += row.get(region) or 0
    cells = []
    for (eup, category), n in sorted(counts.items()):
        if n < K_ANONYMITY:
            cells.append({"eup": eup, "category": category, "merchants": n,
                          "monthly_uses_avg": None, "load_index": None,
                          "tier": "suppressed", "suppressed": True})
            continue
        avg = round(uses.get((eup, category), 0) / len(window), 1)
        cells.append({"eup": eup, "category": category, "merchants": n,
                      "monthly_uses_avg": avg, "load_index": round(avg / n, 1),
                      "tier": "mid", "suppressed": False})
    return cells


def assign_tiers(cells):
    vals = [c["load_index"] for c in cells if not c["suppressed"]]
    hi = quantile(vals, 0.75)
    lo = quantile(vals, 0.25)
    for c in cells:
        if c["suppressed"]:
            continue
        c["tier"] = "high" if c["load_index"] >= hi else ("low" if c["load_index"] <= lo else "mid")
    return {"high": round(hi, 1), "low": round(lo, 1)}


def main():
    usage_doc = json.loads((PROCESSED / "usage_monthly.json").read_text(encoding="utf-8"))
    merchants = json.loads((PROCESSED / "merchants.json").read_text(encoding="utf-8"))
    cells = build_cells(usage_doc["usage"], merchants, usage_doc["base_month"])
    thresholds = assign_tiers(cells)
    out = {
        "base_month": usage_doc["base_month"],
        "window_months": _window_months(usage_doc["usage"], usage_doc["base_month"]),
        "method_note": METHOD_NOTE,
        "k_anonymity": K_ANONYMITY,
        "thresholds": thresholds,
        "cells": cells,
    }
    (PROCESSED / "cell_load.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[p9] cell_load.json cells={len(cells)} thresholds={thresholds}")


if __name__ == "__main__":
    main()
