"""P1: 하이원포인트 사용현황 CSV → 월×지역×업종 집계 (usage_monthly.json)
     + 일·요일 축 집계 (usage_daily.json — 2026-08-08 확장, 피드백 ⑦).

입력 실측 (2026-08-03, docs/plan/04 §2): cp949, 일 단위, 2025-01~2025-12, 5,831행.
usage_daily 스키마·검증 기준: docs/superpowers/specs/2026-08-08-daily-weekday-analysis-design.md, 05 §6.
"""
import json

import pandas as pd

from category_map import DISPLAY_CATEGORIES, display_of_highone
from common import PROCESSED_DIR, RAW_DIR, REGIONS

# 인덱스 = pandas dayofweek (0=월요일)
WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]

# 산출물 메타 — 표시명("삼척시")과 실제 범위가 다른 지역을 산출물만 봐도 알 수 있게 남긴다.
# 하이원포인트 지역가맹 대상지역은 "정선군·태백시·영월군·삼척 도계읍"이라
# (https://www.high1.com/www/contents.do?key=1979) 삼척은 애초에 도계읍만 가맹 자격이 있고,
# merchants.json 의 삼척 가맹점 129곳도 전부 도계읍 주소다(실측). P4 상가 수집도 도계읍만 한다.
PROGRAM_AREA_NOTE = (
    "'삼척시' 컬럼은 하이원포인트 지역가맹 대상지역인 **삼척시 도계읍** 분이다 "
    "(가맹점 129곳 전부 도계읍 주소 — 실측). 시 전역이 아니다"
)

# 실측 확정 컬럼 매핑 (발표 "실제 CSV 열어봤나" 증거 — docs/plan/06 P1)
COLMAP = {
    "가맹점 영업일자": "date",
    "업종": "category",
    "고한읍 건수": "고한읍",
    "사북읍 건수": "사북읍",
    "정선군 건수": "정선군",
    "태백시 건수": "태백시",
    "영월군 건수": "영월군",
    "삼척시 건수": "삼척시",
}


def load_usage() -> pd.DataFrame:
    path = RAW_DIR / "highone_point_usage.csv"
    try:
        df = pd.read_csv(path, encoding="cp949")
    except UnicodeDecodeError:
        df = pd.read_csv(path, encoding="utf-8-sig")
    missing = set(COLMAP) - set(df.columns)
    if missing:
        raise SystemExit(f"P1 실패: 예상 컬럼 누락 {missing} — COLMAP과 원본 헤더를 대조할 것")
    df = df.rename(columns=COLMAP)
    df["month"] = df["date"].str[:7]
    df[REGIONS] = df[REGIONS].fillna(0).astype(int)
    return df


def check_region_overlap(df: pd.DataFrame) -> str:
    """'정선군' 컬럼이 고한읍·사북읍을 포함하는지 실데이터로 판정 (06 P1 필수 확인).

    포함이라면 모든 행에서 정선군 >= 고한읍+사북읍 이어야 한다. 반례가 나오면 배타(잔여 지역)로 결론.
    """
    violations = int((df["정선군"] < df["고한읍"] + df["사북읍"]).sum())
    total = len(df)
    if violations > 0:
        return (
            f"정선군 컬럼은 고한읍·사북읍을 제외한 잔여 지역 (반례 {violations}/{total}행: "
            "정선군 < 고한+사북 — 포함 관계라면 불가능). 6개 컬럼 합산에 이중집계 없음"
        )
    return f"주의: 반례 0/{total}행 — 포함 관계 가능성 있음, 수동 확인 필요"


def build_daily(df: pd.DataFrame, region_note: str) -> dict:
    """일·요일 축 집계 — 요일 축은 표시 6분류로 사전 롤업한다 (05 §6, 소비처가 전부 6분류 단위).

    정수 누적만 싣는다 — 요일별 하루 평균은 소비처(FE 패널·AI 근거)가 `weekday_days`를 분모로
    계산한다. 반올림값을 실으면 재계산·검증이 안 되기 때문.
    """
    d = df.copy()
    dt = pd.to_datetime(d["date"], format="%Y-%m-%d")
    d["dow"] = dt.dt.dayofweek
    d["display"] = d["category"].map(display_of_highone)

    dates = sorted(d["date"].unique())
    weekday_days = (
        pd.to_datetime(pd.Series(dates)).dt.dayofweek
        .value_counts().reindex(range(7), fill_value=0).sort_index().tolist()
    )

    by_dow = d.groupby(["dow", "display"])[REGIONS].sum()
    weekday_category: dict[str, dict[str, list[int]]] = {}
    for region in [*REGIONS, "전체"]:
        weekday_category[region] = {
            cat: [
                int(by_dow.loc[(dow, cat)][REGIONS].sum() if region == "전체"
                    else by_dow.loc[(dow, cat)][region])
                if (dow, cat) in by_dow.index else 0
                for dow in range(7)
            ]
            for cat in DISPLAY_CATEGORIES
        }

    by_date = d.groupby("date")[REGIONS].sum().reindex(dates, fill_value=0)
    daily_total = {
        region: [[date, int(by_date.loc[date, region])] for date in dates]
        for region in REGIONS
    }
    daily_total["전체"] = [[date, int(by_date.loc[date].sum())] for date in dates]

    return {
        "source": "data/raw/highone_point_usage.csv",
        "period": {"start": dates[0], "end": dates[-1], "days": len(dates)},
        "region_note": region_note,
        "weekday_labels": WEEKDAY_LABELS,
        "weekday_days": weekday_days,
        "weekday_category": weekday_category,
        "daily_total": daily_total,
    }


def main():
    df = load_usage()
    region_note = f"{check_region_overlap(df)}. {PROGRAM_AREA_NOTE}"

    monthly = df.groupby(["month", "category"], as_index=False)[REGIONS].sum()
    months = sorted(df["month"].unique())
    out = {
        "source": "data/raw/highone_point_usage.csv",
        "base_month": months[-1],
        "months": months,
        "categories": sorted(df["category"].unique()),
        "region_note": region_note,
        "usage": monthly.to_dict(orient="records"),
        "visitors_monthly": None,  # P2(카지노 입장객 API)가 병합 — 승인 후
    }
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    path = PROCESSED_DIR / "usage_monthly.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    daily = build_daily(df, region_note)
    daily_path = PROCESSED_DIR / "usage_daily.json"
    daily_path.write_text(json.dumps(daily, ensure_ascii=False, indent=2), encoding="utf-8")

    total = int(df[REGIONS].to_numpy().sum())
    print(f"P1 완료: {path}")
    print(f"  월 {len(months)}개 ({months[0]}~{months[-1]}), 업종 {len(out['categories'])}종, 총 {total:,}건")
    print(f"  지역 컬럼 판정: {region_note}")
    daily_sum = sum(v for _, v in daily["daily_total"]["전체"])
    print(f"P1 일별 확장: {daily_path}")
    print(f"  일 {daily['period']['days']}개 ({daily['period']['start']}~{daily['period']['end']}), "
          f"요일 일수 {daily['weekday_days']}, 전체 일합계 {daily_sum:,}건 "
          f"({'월 집계와 일치' if daily_sum == total else '⚠ 월 집계와 불일치'})")


if __name__ == "__main__":
    main()
