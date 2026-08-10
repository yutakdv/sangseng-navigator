import { CATEGORIES } from "@/lib/constants";
import { monthLabel } from "@/lib/format";
import type { Dashboard, DisplayCategory, Region, UsageDaily, UsageMonthlyRow } from "@/types";

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

/**
 * 원장 한 칸의 값. **null은 0이 아니라 "비공개(모르는 값)"다** — 파이프라인 P10이 가맹점 5곳
 * 미만인 (지역×업종) 셀의 건수를 비운다. 예전에는 이 자리에서 null을 0으로 치환했는데, 그러면
 * 억제된 지역의 소비가 화면에서만 낮아진다(실측: 2025-12 영월군 실제 1,552건 → 화면 1,223건, -21%).
 * 백엔드 시뮬레이션도 같은 이유로 억제 셀을 0으로 두지 않고 명시적으로 거부한다.
 */
const regionValue = (row: UsageMonthlyRow, region: Region): number | null => {
  const v = row[region];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export interface RegionCategoryShare {
  /** 값이 공개된 업종만 — 도넛(CategoryDonut) 입력 형식 */
  shares: { category: DisplayCategory; count: number; share: number }[];
  /** 소표본 억제 셀이 하나라도 섞인 업종. 부분 합계는 거짓 저값이라 도넛에서 빼고 문장으로 밝힌다 */
  suppressed: DisplayCategory[];
}

/** 선택 지역의 전 기간 누적 사용 건수를 표시 6분류로 집계 */
export function regionCategoryShare(
  usage: UsageMonthlyRow[],
  region: Region,
): RegionCategoryShare {
  const totals = new Map<DisplayCategory, number>(CATEGORIES.map((c) => [c, 0]));
  const hidden = new Set<DisplayCategory>();
  for (const row of usage) {
    const display = rollupCategory(row.category);
    const value = regionValue(row, region);
    // 한 달이라도 비공개면 그 업종의 누적은 이미 실제보다 작다 — 부분 합계를 그리지 않는다
    if (value === null) hidden.add(display);
    else totals.set(display, (totals.get(display) ?? 0) + value);
  }
  const open = CATEGORIES.filter((c) => !hidden.has(c));
  const total = open.reduce((a, c) => a + (totals.get(c) ?? 0), 0);
  // 항목 순서는 CATEGORIES 고정(색 고정 원칙, 13 §5) — 0건 항목과 비공개 업종을 뺀다
  return {
    shares: open
      .map((category) => ({
        category,
        count: totals.get(category) ?? 0,
        share: total ? (totals.get(category) ?? 0) / total : 0,
      }))
      .filter((d) => d.count > 0),
    suppressed: CATEGORIES.filter((c) => hidden.has(c)),
  };
}

export interface RegionTrend {
  points: { label: string; value: number }[];
  /**
   * 값의 출처. `dashboard`면 억제 전 원값 기준 지역 합계(영향받는 지역만 100단위 반올림 발행값),
   * `ledger`면 원장 셀 합산(비공개 셀은 빠져 있어 억제 지역에서는 실제보다 낮다).
   */
  basis: "dashboard" | "ledger";
}

/**
 * 선택 지역의 월별 사용 건수 합계 — 추이 라인(LineTrend) 입력 형식.
 *
 * 원장 셀을 더하면 비공개 셀만큼 합계가 비는데, dashboard의 monthly_by_region은 **억제 전 원값**을
 * 지역 단위로 싣는다(영향받는 지역만 100단위 반올림). 그래서 그쪽을 1순위로 읽는다 —
 * 백엔드 시뮬레이션이 기준월 지역 분포를 고를 때 내린 것과 같은 판단이다.
 * 기준 월이 하나라도 비면 원장 합산으로 떨어지고, 그때는 화면이 낮게 잡힌 이유를 밝힌다.
 */
export function regionMonthlyTrend(
  usage: UsageMonthlyRow[],
  months: string[],
  region: Region,
  monthlyByRegion: Dashboard["monthly_by_region"] = [],
): RegionTrend {
  const published = new Map<string, number>();
  for (const row of monthlyByRegion) {
    const v = row[region];
    if (typeof v === "number" && Number.isFinite(v)) published.set(String(row.month), v);
  }
  if (months.length > 0 && months.every((m) => published.has(m))) {
    return {
      points: months.map((m) => ({ label: monthLabel(m), value: published.get(m) as number })),
      basis: "dashboard",
    };
  }
  const byMonth = new Map<string, number>(months.map((m) => [m, 0]));
  for (const row of usage) {
    if (!byMonth.has(row.month)) continue;
    const value = regionValue(row, region);
    if (value === null) continue;
    byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + value);
  }
  return {
    points: months.map((m) => ({ label: monthLabel(m), value: byMonth.get(m) ?? 0 })),
    basis: "ledger",
  };
}

export interface CategoryShift {
  /** 원 업종 18종 표기 그대로 — 세부 업종을 봐야 확충 대상 판단에 쓸 수 있다 */
  category: string;
  /** 소표본 억제 업종이면 null — 화면은 숫자 대신 "표본 보호로 비공개"를 찍는다 */
  count: number | null;
  share: number | null;
  recent: number | null;
  previous: number | null;
  /** 최근 3개월 합의 직전 3개월 대비 증감률(%). 비교 창이 안 만들어지면 null */
  changePct: number | null;
  /** 이 지역에서 값이 비공개인 업종인지 */
  suppressed: boolean;
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

/**
 * 선택 지역의 누적 상위 업종(원 18종)과 최근 3개월 증감 — 상세 표 입력 형식.
 *
 * 비공개(억제) 업종은 목록에서 조용히 빠지지 않는다: 0건으로 뭉쳐 걸러내면 "그 지역에 그 업종
 * 소비가 없다"로 읽히기 때문이다. 상위 `limit`개 뒤에 **행을 남기고** 값 자리를 비워 돌려주며,
 * 화면이 "표본 보호로 비공개"를 찍는다. 비중(share)의 분모는 값이 공개된 업종의 합이다.
 */
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
  const acc = new Map<string, { count: number; recent: number; previous: number; hidden: boolean }>();
  for (const row of usage) {
    const value = regionValue(row, region);
    const entry = acc.get(row.category) ?? { count: 0, recent: 0, previous: 0, hidden: false };
    if (value === null) {
      entry.hidden = true;
    } else {
      entry.count += value;
      if (recentMonths.has(row.month)) entry.recent += value;
      if (previousMonths.has(row.month)) entry.previous += value;
    }
    acc.set(row.category, entry);
  }
  const entries = [...acc.entries()];
  const total = entries.reduce((a, [, v]) => a + (v.hidden ? 0 : v.count), 0);
  const open = entries
    .filter(([, v]) => !v.hidden && v.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([category, v]) => ({
      category,
      count: v.count,
      share: total ? v.count / total : 0,
      recent: v.recent,
      previous: v.previous,
      changePct: comparable && v.previous > 0 ? ((v.recent - v.previous) / v.previous) * 100 : null,
      suppressed: false,
    }));
  // 원장에 나온 순서를 유지한다 — 값이 없어 정렬할 기준 자체가 없다
  const hidden = entries
    .filter(([, v]) => v.hidden)
    .map(([category]) => ({
      category,
      count: null,
      share: null,
      recent: null,
      previous: null,
      changePct: null,
      suppressed: true,
    }));
  return [...open, ...hidden];
}

/* ── 일·요일 축 (usage_daily, 05 §6 — 피드백 ⑦) ─────────────────────────── */

export const round1 = (x: number): number => Math.round(x * 10) / 10;

/** 요일 인덱스 계약: 0=월(pandas dayofweek). 0~4 주중, 5~6 주말. */
export const isValidWeekday = (daily: UsageDaily): boolean =>
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
  /** 최저 요일 라벨 — 전 지역 기준선에서만 채운다 */
  minLabel?: string;
  /** 최대 요일이 최저 요일보다 몇 % 많은가 — 전 지역 기준선에서만 채운다 */
  maxVsMinPct?: number | null;
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

/**
 * 전 지역 합계의 요일 패턴 — 지역 요일 차트 옆에 **비교 기준선**으로 병기한다.
 *
 * 지역별 리듬이 다르다는 주장은 기준이 함께 보일 때만 성립한다. 이 값이 없으면 발표에서
 * "전체는 토요일이 가장 많은데"라고 말하는 근거가 화면 어디에도 없다(데모 대본 9단계).
 * 파이프라인이 `weekday_category`에 이미 '전체' 키를 만들어 두므로 추가 데이터가 필요 없다.
 */
export function overallWeekdayInsight(daily: UsageDaily): WeekdayInsight | null {
  const byCat = daily.weekday_category?.["전체"];
  if (!byCat || !isValidWeekday(daily)) return null;
  const totals = daily.weekday_labels.map((_, i) =>
    CATEGORIES.reduce((sum, c) => sum + (byCat[c]?.[i] ?? 0), 0),
  );
  if (totals.every((t) => t === 0)) return null;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avgs = totals.map((t, i) => t / daily.weekday_days[i]);
  const maxIdx = avgs.indexOf(Math.max(...avgs));
  const minIdx = avgs.indexOf(Math.min(...avgs));
  const weekdayAvg = sum(totals.slice(0, 5)) / sum(daily.weekday_days.slice(0, 5));
  const weekendAvg = sum(totals.slice(5)) / sum(daily.weekday_days.slice(5));
  return {
    maxLabel: daily.weekday_labels[maxIdx],
    maxAvg: round1(avgs[maxIdx]),
    minLabel: daily.weekday_labels[minIdx],
    maxVsMinPct: avgs[minIdx] > 0 ? round1((avgs[maxIdx] / avgs[minIdx] - 1) * 100) : null,
    weekdayAvg: round1(weekdayAvg),
    weekendAvg: round1(weekendAvg),
    weekendVsWeekdayPct:
      weekdayAvg > 0 ? round1(((weekendAvg - weekdayAvg) / weekdayAvg) * 100) : null,
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

/**
 * 선택 지역의 일별 사용 건수 + 7일 이동평균 — DailyTrend 차트 입력 형식.
 * 이동평균 창은 달력 7일이 아니라 **행 7개**다 — 원장이 연속 일자(현 산출물 365일 무결)라는
 * 전제이며, 날짜에 구멍이 있는 산출물이 오면 창이 조용히 더 긴 기간을 덮는다.
 */
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
