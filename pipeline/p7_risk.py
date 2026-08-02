"""P7: 국세청 사업자현황(존속연수별) → 시군구별 "운영 2년 미만 사업자 비중" (risk_signal.json).

입력 실측 (docs/plan/04 §2·06 P7): utf-8 BOM, 5·6번째 컬럼 헤더 오염(괄호 미닫힘) → 위치 기반 매핑.
존속연수는 배타적 9구간 — "2년 미만" = 6개월 미만 + 6개월 이상 + 1년 이상.
산식(발표 슬라이드 명시용): under2y_ratio = Σ(전체)당월[2년 미만 구간] / Σ(전체)당월[전체 9구간]
"""
import json

import pandas as pd

from common import PROCESSED_DIR, RAW_DIR, SIDO_LITERAL, SIGUNGUS

# 위치 기반 컬럼 인덱스 (헤더 문자열 신뢰 금지 — 06 P7)
COL_SIDO, COL_SIGUNGU, COL_DURATION, COL_TOTAL_CUR = 1, 2, 3, 4

UNDER_2Y = {"6개월 미만", "6개월 이상", "1년 이상"}
ALL_BUCKETS = UNDER_2Y | {"2년 이상", "3년 이상", "5년 이상", "10년 이상", "20년 이상", "30년 이상"}


def main():
    df = pd.read_csv(RAW_DIR / "nts_biz_duration.csv", encoding="utf-8-sig")
    df = df.iloc[:, [COL_SIDO, COL_SIGUNGU, COL_DURATION, COL_TOTAL_CUR]]
    df.columns = ["sido", "sigungu", "duration", "count"]
    df["duration"] = df["duration"].str.strip()

    buckets = set(df["duration"].unique())
    if buckets != ALL_BUCKETS:
        raise SystemExit(f"P7 실패: 존속연수 구간이 실측(9구간)과 다름 — {sorted(buckets)}")

    gw = df[(df["sido"] == SIDO_LITERAL) & (df["sigungu"].isin(SIGUNGUS))].copy()
    gw["count"] = pd.to_numeric(gw["count"], errors="coerce").fillna(0).astype(int)

    out = []
    for sigungu in SIGUNGUS:  # 고정 순서 유지
        sub = gw[gw["sigungu"] == sigungu]
        total = int(sub["count"].sum())
        under = int(sub[sub["duration"].isin(UNDER_2Y)]["count"].sum())
        if total == 0:
            raise SystemExit(f"P7 실패: {sigungu} 전체 사업자 수 0 — 필터 리터럴 확인")
        out.append({"sigungu": sigungu, "under2y_ratio": round(under / total, 4)})

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    path = PROCESSED_DIR / "risk_signal.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"P7 완료: {path}")
    for row in out:
        assert 0.0 <= row["under2y_ratio"] <= 1.0
        print(f"  {row['sigungu']}: 2년 미만 비중 {row['under2y_ratio']:.1%}")


if __name__ == "__main__":
    main()
