"""P5: usage_monthly.json → 진단 지표 (dashboard.json).

출력 스키마 정본은 docs/plan/05-api-contract.md §1 (`GET /api/dashboard` 응답 그대로).
계산식 정본은 06 문서 P5 + common.py — 지역 소비 집중도(gini→0~100 지수)·업종별 소비 분산도(1−HHI)·
지역 전환율(6개 지역 건수 합 ÷ 월 입장 연인원 × 100, 근사 지표 고정 + proxy_note 병기).

기준월은 하드코딩하지 않고 데이터 최신 월(`base_month`)로 잡는다 (06 공통 원칙 3).
전환율은 분자(사용현황)와 분모(입장객)가 겹치는 월만 사용한다 (06 공통 원칙 4).
"""
import calendar
import json
from datetime import date

from category_map import DISPLAY_CATEGORIES, display_of_highone
from common import PROCESSED_DIR, REGIONS, gini, gini_to_index, grade, hhi_dispersion_index

# 05 §1 conversion.proxy_note — 배지만으로는 막지 못하는 오인을 본문으로 차단하는 고정 문구.
# 분모는 "입장객 수"가 아니라 **입장 연인원**이다: 강원랜드 일자별 입장객 API가 하루를 영업 교대
# (1부/2부/3부)로 나눠 주고 P2가 합산하므로 교대를 넘겨 머문 사람은 중복 계수된다.
# 우리 값(건수÷연인원 ≈ 연인원 1인당 0.21건)과 강원랜드·언론의 **금액 기준** 지역 사용 비율
# (2024년 콤프 발생액 1,242.33억 중 지역 354.8억 = 28.5%)은 종류가 다른 지표인데 자릿수가 비슷해
# 같은 지표의 다른 추정치로 오인된다 — is_proxy 플래그만으로는 그 오인을 막지 못했다.
PROXY_NOTE = (
    "분자=지역 사용 건수, 분모=입장 연인원(교대 합산)으로 단위가 달라 비율이 아닌 근사 지표입니다. "
    "강원랜드가 공개한 금액 기준 지역 사용 비율(2024년 28.5%)과는 다른 지표입니다."
)


def with_shares(pairs, key):
    """[(이름, 건수)] → [{key, count, share}] — share 소수 2자리, 반올림 후 합=1.0 보정."""
    total = sum(c for _, c in pairs)
    if total == 0:
        raise SystemExit("P5 실패: 건수 합이 0 — usage_monthly.json 확인")
    rows = [{key: name, "count": count, "share": round(count / total, 2)} for name, count in pairs]
    residual = round(1.0 - sum(r["share"] for r in rows), 2)
    if residual:  # 최대 항목에 잔차를 몰아 합을 정확히 1.0으로 맞춘다
        top = max(rows, key=lambda r: r["count"])
        top["share"] = round(top["share"] + residual, 2)
    return rows


def quarter_rate(months, uses_by_month, visitors):
    """분기 전환율 = 3개월 건수 합 ÷ 3개월 입장객 합 × 100 (05 §1 growth.qoq_pp 정의)."""
    return sum(uses_by_month[m] for m in months) / sum(visitors[m] for m in months) * 100


def main():
    src = PROCESSED_DIR / "usage_monthly.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    months, base_month = data["months"], data["base_month"]
    visitors = data.get("visitors_monthly")
    if not visitors:
        raise SystemExit("P5 실패: usage_monthly.json에 visitors_monthly 없음 — P2(p2_visitors.py) 먼저 실행")

    # 월 → 지역별 건수 / 업종별 건수 (업종은 하이원 원본 18종 기준 — 분산도용)
    region_by_month = {m: dict.fromkeys(REGIONS, 0) for m in months}
    category_by_month = {m: {} for m in months}
    for row in data["usage"]:
        m = row["month"]
        for region in REGIONS:
            region_by_month[m][region] += row[region]
            category_by_month[m][row["category"]] = category_by_month[m].get(row["category"], 0) + row[region]

    uses_by_month = {m: sum(region_by_month[m].values()) for m in months}

    # 지역 전환율 — 분자·분모가 겹치는 월만 (06 공통 원칙 4). is_proxy 고정 true
    conv_months = [m for m in months if m in visitors]
    if not conv_months:
        raise SystemExit("P5 실패: 사용현황과 입장객의 겹치는 월이 없음")
    conversion_monthly = [
        {
            "month": m,
            "local_uses": uses_by_month[m],
            "visitors": visitors[m],
            "rate": round(uses_by_month[m] / visitors[m] * 100, 1),
        }
        for m in conv_months
    ]

    concentration_monthly = [
        {"month": m, "index": gini_to_index(gini([region_by_month[m][r] for r in REGIONS]))} for m in months
    ]
    dispersion_monthly = [
        {"month": m, "index": hhi_dispersion_index(list(category_by_month[m].values()))} for m in months
    ]

    # 전 기간 누적 — 지역 비중 / 표시 6분류 업종 비중(매핑 ① 롤업, 13 §5 고정 순서)
    region_total = {r: sum(region_by_month[m][r] for m in months) for r in REGIONS}
    display_total = dict.fromkeys(DISPLAY_CATEGORIES, 0)
    for m in months:
        for category, count in category_by_month[m].items():
            display_total[display_of_highone(category)] += count

    prev_month = months[-2]
    def days_in_month(month: str) -> int:
        year, month_num = (int(part) for part in month.split("-"))
        return calendar.monthrange(year, month_num)[1]

    base_daily = uses_by_month[base_month] / days_in_month(base_month)
    prev_daily = uses_by_month[prev_month] / days_in_month(prev_month)
    growth = {
        "mom_pct": round((base_daily - prev_daily) / prev_daily * 100, 1),
        "qoq_pp": (
            round(
                quarter_rate(conv_months[-3:], uses_by_month, visitors)
                - quarter_rate(conv_months[-6:-3], uses_by_month, visitors),
                1,
            )
            if len(conv_months) >= 6
            else None
        ),
    }

    sens_path = PROCESSED_DIR / "sensitivity.json"
    ai_stability = (
        round(json.loads(sens_path.read_text(encoding="utf-8"))["top3_stable_ratio"] * 100)
        if sens_path.exists()
        else None  # P8(p8_sensitivity.py) 실행 전
    )

    out = {
        "updated_at": date.today().isoformat(),
        "period_note": f"하이원포인트 사용현황 최신 제공분({base_month}) 기준",
        "conversion": {
            "headline_rate": conversion_monthly[-1]["rate"],
            "is_proxy": True,
            "proxy_note": PROXY_NOTE,
            "monthly": conversion_monthly,
        },
        "concentration": {
            "index": concentration_monthly[-1]["index"],
            "grade": grade(concentration_monthly[-1]["index"]),
            "monthly": concentration_monthly,
        },
        "category_dispersion": {
            "index": dispersion_monthly[-1]["index"],
            "monthly": dispersion_monthly,
        },
        "region_share": with_shares(list(region_total.items()), "region"),
        "monthly_by_region": [{"month": m, **region_by_month[m]} for m in months],
        "category_share": with_shares(list(display_total.items()), "category"),
        "growth": growth,
        "ai_stability": ai_stability,
    }

    path = PROCESSED_DIR / "dashboard.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"P5 완료: {path}")
    print(f"  기준월 {base_month} / 월 {len(months)}개, 전환율 산출 월 {len(conv_months)}개")
    print(f"  근사 지표 설명: {PROXY_NOTE}")
    print(f"  지역 전환율(근사) {out['conversion']['headline_rate']}% · "
          f"지역 소비 집중도 {out['concentration']['index']}({out['concentration']['grade']}) · "
          f"업종별 소비 분산도 {out['category_dispersion']['index']}")
    print(f"  전월 대비 {growth['mom_pct']}% · 전분기 대비 {growth['qoq_pp']}%p · AI 제안 안정도 {ai_stability}")
    print("  지역 비중: " + ", ".join(f"{r['region']} {r['share']:.0%}" for r in out["region_share"]))
    print("  업종 비중: " + ", ".join(f"{c['category']} {c['share']:.0%}" for c in out["category_share"]))


if __name__ == "__main__":
    main()
