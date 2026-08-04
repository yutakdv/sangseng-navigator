export interface DataFreshness {
  sourceMonth: string | null;
  ageMonths: number | null;
  isStale: boolean;
  isLatestPublished: boolean;
  label: string;
}

/** 2026-08-05 공공데이터포털에서 확인한 하이원포인트 사용현황 최신 공개분. */
export const LATEST_PUBLISHED_USAGE_MONTH = "2025-12";

/**
 * period_note의 YYYY-MM를 기준으로 데이터 지연을 계산한다.
 * 분기 의사결정 도구이므로 4개월 이상 지난 데이터는 '갱신 필요'로 본다.
 */
export function dataFreshness(periodNote: string, now = new Date()): DataFreshness {
  const match = periodNote.match(/(20\d{2})-(0[1-9]|1[0-2])/);
  if (!match) {
    return {
      sourceMonth: null,
      ageMonths: null,
      isStale: true,
      isLatestPublished: false,
      label: "기준월 확인 필요",
    };
  }
  const sourceYear = Number(match[1]);
  const sourceMonthIndex = Number(match[2]) - 1;
  const ageMonths = Math.max(0, now.getUTCFullYear() * 12 + now.getUTCMonth() - (sourceYear * 12 + sourceMonthIndex));
  const sourceMonth = `${match[1]}-${match[2]}`;
  const isLatestPublished = sourceMonth === LATEST_PUBLISHED_USAGE_MONTH;
  return {
    sourceMonth,
    ageMonths,
    isStale: !isLatestPublished && ageMonths >= 4,
    isLatestPublished,
    label: isLatestPublished
      ? `공개 최신본 · ${sourceMonth.replace("-", ".")}`
      : ageMonths >= 4
        ? `기준 데이터 ${ageMonths}개월 경과 · 갱신 필요`
        : `기준 데이터 ${ageMonths}개월 경과`,
  };
}
