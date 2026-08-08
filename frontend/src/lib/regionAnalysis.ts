import { CATEGORIES } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import type { DisplayCategory, Region, UsageDaily, UsageMonthlyRow } from "@/types";

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

/* ── 일·요일 축 (usage_daily, 05 §6 — 피드백 ⑦) ─────────────────────────── */

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 요일 인덱스 계약: 0=월(pandas dayofweek). 0~4 주중, 5~6 주말. */
const isValidWeekday = (daily: UsageDaily): boolean =>
  daily.weekday_labels.length === 7 &&
  daily.weekday_days.length === 7 &&
  daily.weekday_days.every((d) => d > 0);

/** 선택 지역의 요일별 하루 평균 건수(전 업종 합) — 막대(BarRank) 입력 형식 */
export function regionWeekdayAverages(
  daily: UsageDaily,
  region: Region,
): { label: string; value: number; note?: string }[] {
  const byCat = daily.weekday_category[region];
  if (!byCat || !isValidWeekday(daily)) return [];
  const totals = daily.weekday_labels.map((_, i) =>
    CATEGORIES.reduce((sum, c) => sum + (byCat[c]?.[i] ?? 0), 0),
  );
  if (totals.every((t) => t === 0)) return [];
  const avgs = totals.map((t, i) => round1(t / daily.weekday_days[i]));
  const max = Math.max(...avgs);
  return daily.weekday_labels.map((label, i) => ({
    label,
    value: avgs[i],
    ...(avgs[i] === max ? { note: "요일 최대" } : {}),
  }));
}

export interface WeekdayInsight {
  maxLabel: string;
  maxAvg: number;
  weekdayAvg: number;
  weekendAvg: number;
  /** 주말 하루 평균이 주중 대비 몇 % 높은가(음수면 낮음). 주중 실적 0이면 null */
  weekendVsWeekdayPct: number | null;
}

/** 요일 패턴 인사이트 한 줄 — "토요일 하루 평균 N건, 주중 대비 +M%" 문장의 재료 */
export function regionWeekdayInsight(daily: UsageDaily, region: Region): WeekdayInsight | null {
  const bars = regionWeekdayAverages(daily, region);
  if (!bars.length) return null;
  const byCat = daily.weekday_category[region];
  const totals = daily.weekday_labels.map((_, i) =>
    CATEGORIES.reduce((sum, c) => sum + (byCat[c]?.[i] ?? 0), 0),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const weekdayAvg = sum(totals.slice(0, 5)) / sum(daily.weekday_days.slice(0, 5));
  const weekendAvg = sum(totals.slice(5)) / sum(daily.weekday_days.slice(5));
  const max = bars.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    maxLabel: max.label,
    maxAvg: max.value,
    weekdayAvg: round1(weekdayAvg),
    weekendAvg: round1(weekendAvg),
    weekendVsWeekdayPct: weekdayAvg > 0 ? round1(((weekendAvg - weekdayAvg) / weekdayAvg) * 100) : null,
  };
}

export interface CategoryWeekdayRow {
  category: DisplayCategory;
  maxLabel: string;
  weekdayAvg: number;
  weekendAvg: number;
  /** 주말 하루 평균의 주중 대비 증감률(%). 주중 실적 0이면 null */
  weekendVsWeekdayPct: number | null;
}

/** 선택 지역의 표시 6분류별 요일 패턴 — 실적 있는 업종만, CATEGORIES 고정 순서(13 §5) */
export function regionCategoryWeekdays(daily: UsageDaily, region: Region): CategoryWeekdayRow[] {
  const byCat = daily.weekday_category[region];
  if (!byCat || !isValidWeekday(daily)) return [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return CATEGORIES.flatMap((category) => {
    const counts = byCat[category];
    if (!counts || counts.length !== 7 || sum(counts) === 0) return [];
    const avgs = counts.map((c, i) => c / daily.weekday_days[i]);
    const maxIdx = avgs.indexOf(Math.max(...avgs));
    const weekdayAvg = sum(counts.slice(0, 5)) / sum(daily.weekday_days.slice(0, 5));
    const weekendAvg = sum(counts.slice(5)) / sum(daily.weekday_days.slice(5));
    return [{
      category,
      maxLabel: daily.weekday_labels[maxIdx],
      weekdayAvg: round1(weekdayAvg),
      weekendAvg: round1(weekendAvg),
      weekendVsWeekdayPct:
        weekdayAvg > 0 ? round1(((weekendAvg - weekdayAvg) / weekdayAvg) * 100) : null,
    }];
  });
}

export interface DailyTrendPoint {
  date: string;
  /** 툴팁 라벨 — "1월 3일 (금)" (서버에서 만들어 클라이언트 날짜 파싱을 없앤다) */
  tooltipLabel: string;
  value: number;
  /** 7일 이동평균(뒤쪽 창). 처음 6일은 가용 구간 평균 — 라인이 7일째부터 시작하지 않게 */
  avg7: number;
}

/** 선택 지역의 일별 사용 건수 + 7일 이동평균 — DailyTrend 차트 입력 형식 */
export function regionDailySeries(daily: UsageDaily, region: Region): DailyTrendPoint[] {
  const rows = daily.daily_total[region];
  if (!rows?.length || !isValidWeekday(daily)) return [];
  if (rows.every(([, v]) => v === 0)) return [];
  let windowSum = 0;
  return rows.map(([date, value], i) => {
    windowSum += value;
    if (i >= 7) windowSum -= rows[i - 7][1];
    const span = Math.min(i + 1, 7);
    // 요일은 파이프라인 계약(0=월)과 같은 값을 UTC 산술로 얻는다 — 2025-01-01(수)=dayofweek 2
    const dow = (Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000) + 3) % 7;
    return {
      date,
      tooltipLabel: `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${daily.weekday_labels[dow]})`,
      value,
      avg7: round1(windowSum / span),
    };
  });
}
