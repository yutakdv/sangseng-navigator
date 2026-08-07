import { CATEGORIES } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import type { DisplayCategory, Region, UsageMonthlyRow } from "@/types";

/**
 * 지역 드릴다운 파생 계산 — 지역×업종×월 원장(usage_monthly)을 화면용으로 집계하는 순수 함수 모음.
 * 서버 컴포넌트에서만 호출한다 (원장은 lib/api.ts의 정적 import — 클라이언트 번들 금지).
 */

/**
 * 하이원 18종 → 표시 6분류 롤업. **정본은 pipeline/category_map.py `HIGHONE_TO_DISPLAY`** —
 * FE는 정적 산출물만 받으므로 같은 표를 복제한다. 파이프라인 쪽 표가 바뀌면 여기도 함께 고칠 것.
 * 키는 원본 CSV 표기 그대로다("자동자 세차업" 오타·"이ㆍ미용업" U+318D 포함 — 리터럴 수정 금지).
 */
const HIGHONE_TO_DISPLAY: Record<string, DisplayCategory> = {
  커피전문점: "카페",
  일반음식점업: "음식점",
  휴게음식점업: "음식점",
  일반주점업: "음식점",
  슈퍼마켓: "편의점",
  식품판매업: "소매점",
  소매업: "소매점",
  숙박업: "숙박업",
  "주유소·LPG충전소": "기타",
  "자동차 전문수리업": "기타",
  "자동자 세차업": "기타",
  세탁업: "기타",
  "이ㆍ미용업": "기타",
  기타미용업: "기타",
  목욕장업: "기타",
  "당구장 운영업": "기타",
  "실내 스크린 골프업": "기타",
  기타: "기타",
};

export const rollupCategory = (raw: string): DisplayCategory =>
  HIGHONE_TO_DISPLAY[raw] ?? "기타";

/** region_note의 화면용 요약 — 원문은 감사 반례까지 담은 내부 기록이라 그대로 노출하지 않는다 */
export const USAGE_REGION_FOOTNOTE =
  "정선군은 고한읍·사북읍을 제외한 잔여 지역 기준이며, 삼척시는 도계읍(하이원포인트 지역가맹 대상지역) 기준이다.";

const regionValue = (row: UsageMonthlyRow, region: Region): number => {
  const v = row[region];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/** 선택 지역의 전 기간 누적 사용 건수를 표시 6분류로 집계 — 도넛(CategoryDonut) 입력 형식 */
export function regionCategoryShare(
  usage: UsageMonthlyRow[],
  region: Region,
): { category: DisplayCategory; count: number; share: number }[] {
  const totals = new Map<DisplayCategory, number>(CATEGORIES.map((c) => [c, 0]));
  for (const row of usage) {
    const display = rollupCategory(row.category);
    totals.set(display, (totals.get(display) ?? 0) + regionValue(row, region));
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  // 항목 순서는 CATEGORIES 고정(색 고정 원칙, 13 §5) — 0건 항목만 제외한다
  return CATEGORIES.map((category) => ({
    category,
    count: totals.get(category) ?? 0,
    share: total ? (totals.get(category) ?? 0) / total : 0,
  })).filter((d) => d.count > 0);
}

/** 선택 지역의 월별 사용 건수 합계 — 추이 라인(LineTrend) 입력 형식 */
export function regionMonthlyTrend(
  usage: UsageMonthlyRow[],
  months: string[],
  region: Region,
): { label: string; value: number }[] {
  const byMonth = new Map<string, number>(months.map((m) => [m, 0]));
  for (const row of usage) {
    if (!byMonth.has(row.month)) continue;
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + regionValue(row, region));
  }
  return months.map((m) => ({ label: monthLabel(m), value: byMonth.get(m) ?? 0 }));
}

export interface CategoryShift {
  /** 원 업종 18종 표기 그대로 — 세부 업종을 봐야 확충 대상 판단에 쓸 수 있다 */
  category: string;
  count: number;
  share: number;
  recent: number;
  previous: number;
  /** 최근 3개월 합의 직전 3개월 대비 증감률(%). 비교 창이 안 만들어지면 null */
  changePct: number | null;
}

/**
 * 증감 비교 창의 화면 라벨 — topCategoryShifts와 같은 slice 정의를 쓴다.
 * 원장이 6개월 미만이면 직전 창이 최근 창보다 짧아져 비교 자체가 성립하지 않는다 → null
 * (이때 topCategoryShifts의 changePct도 전부 null이 된다).
 */
export function shiftWindowLabel(months: string[]): string | null {
  if (months.length < 6) return null;
  const recent = months.slice(-3);
  const previous = months.slice(-6, -3);
  return `${monthLabel(recent[0])}~${monthLabel(recent[2])} 합을 ${monthLabel(previous[0])}~${monthLabel(previous[2])} 합과 비교`;
}

/** 선택 지역의 누적 상위 업종(원 18종)과 최근 3개월 증감 — 상세 표 입력 형식 */
export function topCategoryShifts(
  usage: UsageMonthlyRow[],
  months: string[],
  region: Region,
  limit = 8,
): CategoryShift[] {
  // 6개월 미만이면 직전 3개월 창이 1~2개월로 쪼그라들어 증감률이 부풀려진다 — 비교하지 않는다
  const comparable = months.length >= 6;
  const recentMonths = new Set(months.slice(-3));
  const previousMonths = new Set(months.slice(-6, -3));
  const acc = new Map<string, { count: number; recent: number; previous: number }>();
  for (const row of usage) {
    const value = regionValue(row, region);
    const entry = acc.get(row.category) ?? { count: 0, recent: 0, previous: 0 };
    entry.count += value;
    if (recentMonths.has(row.month)) entry.recent += value;
    if (previousMonths.has(row.month)) entry.previous += value;
    acc.set(row.category, entry);
  }
  const total = [...acc.values()].reduce((a, b) => a + b.count, 0);
  return [...acc.entries()]
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([category, v]) => ({
      category,
      count: v.count,
      share: total ? v.count / total : 0,
      recent: v.recent,
      previous: v.previous,
      changePct: comparable && v.previous > 0 ? ((v.recent - v.previous) / v.previous) * 100 : null,
    }));
}
