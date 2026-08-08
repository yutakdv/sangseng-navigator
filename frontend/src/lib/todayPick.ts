import { CATEGORIES } from "@/lib/constants";
import { isValidWeekday, round1 } from "@/lib/regionAnalysis";
import type { Nowcast } from "@/lib/weather";
import type { DisplayCategory, Region, UsageDaily } from "@/types";

/**
 * 방문객 위젯 "오늘의 추천" — 요일 실측(usage_daily)과 기상청 실황을 문구 한 장으로 만드는 순수 함수.
 *
 * lib/regionAnalysis.ts(담당자 드릴다운 파생)와 나눠 둔 이유: ① 출력이 화면 문구·필터 링크라
 * 표시 계층이고 ② 지역 축이 `Region`이 아니라 "전체"를 포함하며 ③ 위젯 한 화면에서만 쓴다.
 * 요일 인덱스 계약(0=월)과 `weekday_days` 분모는 regionAnalysis.ts와 동일하다.
 *
 * 정직성(심사 방어):
 * - 사실 문장은 2025년 실측 집계에서만 나온다. LLM을 쓰지 않는다.
 * - **날씨는 상황 설명일 뿐 추천 업종·순서를 바꾸지 않는다** — 2025년 ASOS 대조에서 우천 영향은
 *   업종별 ±4% 이내(편의점 -4.1%·음식점 +1.6%)로, 요일 효과(토요일 +19.5%)보다 훨씬 작다.
 * - 영업시간·영업 상태 데이터가 없으므로 "지금 문 열었어요" 류 문장은 만들지 않는다.
 */

/** 롤업 잔여 버킷이라 방문객에게 권할 업종이 아니다 — 자동 선정에서만 뺀다(직접 고르면 그대로 말한다) */
const AUTO_PICK_EXCLUDED: DisplayCategory[] = ["기타"];

/**
 * 하루 평균이 이보다 얇으면 요일 최대치가 우연일 수 있다 (예: 태백시 숙박업 월요일 4.3건).
 * 비교는 **반올림 전 원값**으로 한다 — 삼척시 편의점 일요일이 4.98건(표시하면 5.0건)이라
 * 어느 쪽으로 재느냐로 결과가 갈리는데, 표본이 얇을 때 걸러 내자는 게 이 상수의 목적이므로
 * 표시용 반올림이 판정을 뒤집게 두지 않는다. (그 결과 일요일 삼척시는 top 음식점 34.0건이 된다)
 */
const MIN_AUTO_PICK_AVG = 5;

/** "…은/는" 조사를 피할 수 없는 자리만 표로 둔다 — 표시 6분류는 고정 집합이라 판별 로직이 필요 없다 */
const COPULA: Record<DisplayCategory, string> = {
  카페: "예요",
  음식점: "이에요",
  편의점: "이에요",
  숙박업: "이에요",
  소매점: "이에요",
  기타: "예요",
};

/* 요일 인덱스 계약(0=월)과 분모(weekday_days)는 담당자 드릴다운과 같은 정의를 써야 한다 —
   두 화면이 같은 산출물을 다르게 읽으면 "요일별 최대"가 갈린다. 복제하지 않고 재사용한다. */

/** 요일 축은 6지역 외에 파이프라인이 만든 "전체" 키를 함께 갖는다 (usage_daily.weekday_category) */
export type WeekdayScope = Region | "전체";

export interface WeekdayFact {
  /**
   * peak  = 오늘이 그 업종의 요일 최대치 (자동 선정·업종 고정 모두 가능)
   * top   = 자동 선정이며 오늘 가장 많이 쓰이는 업종 (요일 최대치는 아님)
   * level = 방문객이 고른 업종이고 오늘이 그 업종의 최대 요일이 아님
   */
  kind: "peak" | "top" | "level";
  category: DisplayCategory;
  /** "금" */
  weekdayLabel: string;
  /** 2025년 그 요일 하루 평균 건수 (소수 1자리) */
  todayAvg: number;
  /** 그 업종 주간 하루 평균 대비 증감률(%) — 정수 반올림 */
  vsWeekPct: number;
  /** 그 업종이 가장 많은 요일 라벨과 그 하루 평균 (level 문장의 재료) */
  maxLabel: string;
  maxAvg: number;
}

/**
 * KST 요일 인덱스 (0=월, 파이프라인 계약과 동일).
 * 서버 타임존이 UTC라(node:20-alpine·Vercel) 로컬 요일을 그대로 쓰면 한국 시간 00~09시에
 * 하루가 어긋난다 — +9h 이동한 시각의 UTC 필드가 곧 KST다 (lib/dataFreshness.ts와 같은 관용구).
 */
export function kstWeekdayIndex(now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return (kst.getUTCDay() + 6) % 7; // getUTCDay는 0=일 → 0=월로 옮긴다
}

interface CategoryStat {
  category: DisplayCategory;
  /** 요일별 하루 평균(반올림 전) */
  avgs: number[];
  /** 그 업종 전체 기간의 하루 평균 */
  weekAvg: number;
  /** 하루 평균이 가장 큰 요일 인덱스 */
  maxIndex: number;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * 오늘 요일에 대해 화면에 적을 "사실" 한 줄. 만들 수 없으면 null이고 그때 카드는 렌더하지 않는다.
 *
 * 자동 선정 규칙은 2025년 산출물 전수 계산으로 확정한 것이다 — 두 필터(기타 제외·하루 평균
 * 5건 미만 제외)를 빼면 월요일 고한읍·정선군이 "기타"로, 월요일 태백시가 "숙박업 4.3건"으로
 * 뽑혀 지름길 칩이 방문객에게 쓸모없어진다.
 */
export function weekdayFact(
  daily: UsageDaily,
  scope: WeekdayScope,
  weekdayIndex: number,
  opts?: {
    /** 방문객이 이미 업종 필터를 골랐으면 그 업종으로 고정한다 — 사용자 의도를 뒤집지 않는다 */
    only?: DisplayCategory;
    /** 가맹점이 0곳인 업종은 자동 선정하지 않는다 — 지름길 칩이 빈 목록으로 이어지지 않게 */
    isAvailable?: (c: DisplayCategory) => boolean;
  },
): WeekdayFact | null {
  if (!isValidWeekday(daily)) return null;
  const byCat = daily.weekday_category[scope];
  if (!byCat) return null;

  const stats: CategoryStat[] = CATEGORIES.flatMap((category) => {
    const counts = byCat[category];
    // 실적이 0인 조합(예: 영월군 카페)은 할 말이 없다 — 아예 후보에서 뺀다
    if (!counts || counts.length !== 7 || sum(counts) === 0) return [];
    const avgs = counts.map((c, i) => c / daily.weekday_days[i]);
    return [{
      category,
      avgs,
      weekAvg: sum(counts) / sum(daily.weekday_days),
      maxIndex: avgs.indexOf(Math.max(...avgs)),
    }];
  });

  const build = (stat: CategoryStat, kind: WeekdayFact["kind"]): WeekdayFact => ({
    kind,
    category: stat.category,
    weekdayLabel: daily.weekday_labels[weekdayIndex],
    todayAvg: round1(stat.avgs[weekdayIndex]),
    vsWeekPct: Math.round((stat.avgs[weekdayIndex] / stat.weekAvg - 1) * 100),
    maxLabel: daily.weekday_labels[stat.maxIndex],
    maxAvg: round1(stat.avgs[stat.maxIndex]),
  });

  if (opts?.only) {
    // 고정 업종은 "기타 제외"·"최소 평균" 규칙을 적용하지 않는다 — 방문객이 직접 고른 필터다
    const picked = stats.find((s) => s.category === opts.only);
    if (!picked) return null;
    return build(picked, picked.maxIndex === weekdayIndex ? "peak" : "level");
  }

  const pool = stats.filter(
    (s) =>
      !AUTO_PICK_EXCLUDED.includes(s.category) && (opts?.isAvailable?.(s.category) ?? true),
  );
  if (!pool.length) return null;
  const biggestToday = (xs: CategoryStat[]) =>
    xs.reduce((a, b) => (b.avgs[weekdayIndex] > a.avgs[weekdayIndex] ? b : a));
  // 오늘이 요일 최대치인 업종이 있으면 그중 가장 두꺼운 것 — 없으면 오늘 가장 많이 쓰이는 업종
  const peaks = pool.filter(
    (s) => s.maxIndex === weekdayIndex && s.avgs[weekdayIndex] >= MIN_AUTO_PICK_AVG,
  );
  return peaks.length ? build(biggestToday(peaks), "peak") : build(biggestToday(pool), "top");
}

export interface TodayPickCopy {
  headline: string;
  evidence: string;
  /** 기상청 실황을 못 받았으면 null — 카드는 요일 문구만으로 그대로 뜬다 */
  weatherLine: string | null;
  chipLabel: string;
  footnote: string;
}

/**
 * 사실 → 화면 문구. LLM을 쓰지 않는 결정론 템플릿이다.
 * 조사 변형을 피하려고 "…에서"·"이용은" 구조를 골랐다(지역·업종 이름이 받침 유무로 갈리기 때문).
 */
export function todayPickCopy(
  fact: WeekdayFact,
  /** 선택 지역. 없으면 "전체 지역"으로 말한다 */
  regionLabel: string | null,
  weather: Nowcast | null,
): TodayPickCopy {
  const where = regionLabel ?? "전체 지역";
  const w = fact.weekdayLabel;
  const c = fact.category;
  const headline =
    fact.kind === "peak"
      ? `오늘 ${w}요일, ${where}에서 ${c} 이용이 한 주 중 가장 많은 날이에요`
      : fact.kind === "top"
        ? `오늘 ${w}요일, ${where}에서 가장 많이 쓰이는 업종은 ${c}${COPULA[c]}`
        : `오늘 ${w}요일, ${where} ${c} 이용이 가장 많은 요일은 ${fact.maxLabel}요일이에요`;
  const evidence =
    fact.kind === "peak"
      ? `2025년 ${w}요일 하루 평균 ${fact.todayAvg}건 · 이 업종 주간 하루 평균보다 ${fact.vsWeekPct}% 많아요`
      : fact.kind === "top"
        ? `2025년 ${w}요일 하루 평균 ${fact.todayAvg}건 기준이에요`
        : `2025년 ${w}요일 하루 평균 ${fact.todayAvg}건 · ${fact.maxLabel}요일은 ${fact.maxAvg}건이에요`;
  /**
   * 관측 사실만 적는다 — 초단기실황에 하늘상태(SKY)가 없으므로 "맑음"이라 쓰지 않고,
   * "우산 챙기세요" 같은 일반 안내도 넣지 않는다(데이터 근거가 없는 문장은 만들지 않는다).
   * 기준 시각을 병기해 신선도를 과장하지 않는다.
   */
  const weatherLine = weather
    ? `지금 ${weather.spotLabel} ${weather.tempC}°C` +
      (weather.precipitationLabel ? ` · ${weather.precipitationLabel}` : "") +
      (weather.rainMm ? ` ${weather.rainMm}mm` : "") +
      ` (${weather.observedLabel} 실황)`
    : null;
  return {
    headline,
    evidence,
    weatherLine,
    chipLabel: `${regionLabel ? `${regionLabel} ` : ""}${c} 보기`,
    // 날씨를 못 받았으면 각주에서도 기상청을 빼야 한다 — 쓰지 않은 출처를 적지 않는다
    footnote: weather
      ? "2025년 요일별 이용 패턴(하이원포인트 사용현황)·기상청 초단기실황 기준 · 추천 업종은 요일 실측 패턴으로만 정해요"
      : "2025년 요일별 이용 패턴(하이원포인트 사용현황) 기준",
  };
}
