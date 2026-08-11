import { normalizedProgress } from "@/lib/cardWorkflow";
import { REGIONS } from "@/lib/constants";
import { monthLabel, num } from "@/lib/format";
import { josa } from "@/lib/korean";
import type { Card, CardType, CandidatesResponse, Dashboard, Kpi } from "@/types";

export type DashboardView = ReturnType<typeof composeDashboardView>;
export type EvidenceView = ReturnType<typeof composeEvidence>;

/**
 * 화면이 "지역 사용 건수"로 말하는 **총계 하나** — 반올림을 타지 않는 정본을 쓴다.
 *
 * 공개 배열의 `count`를 더하면 총계가 배열마다 달라진다. 소표본 보호가 영향받는 합계만
 * 100 단위로 반올림해 발행하기 때문이고, 실측으로 지역 배열은 정본보다 +25, 업종 배열은 −42
 * 어긋난다 — 같은 화면 안에서 서로 다른 총계가 나오는 원인이었다.
 *
 * 폴백 순서는 정본(`canonical_total`) → 임팩트 근거의 연간 사용 건수(정의상 같은 값) →
 * 마지막으로 배열 합. 앞의 둘이 없는 구형 응답에서까지 화면을 비우지는 않되, 그 경우에만
 * 반올림된 합을 쓴다.
 */
export function canonicalTotalUses(dashboard: Dashboard): number {
  const canonical = dashboard.privacy_meta?.canonical_total;
  if (typeof canonical === "number") return canonical;
  const fromImpact = dashboard.impact_meta?.annual_local_uses;
  if (typeof fromImpact === "number") return fromImpact;
  return (dashboard.region_share ?? []).reduce((sum, row) => sum + row.count, 0);
}

/**
 * 공개 배열 합이 정본 총계와 얼마나 벌어지는지 — 반올림이 만든 차이를 화면이 설명할 때 쓴다.
 * 값이 없으면(구형 응답) `null`이고, 그때는 차이를 수치로 말하지 않는다.
 */
export function roundingGap(
  dashboard: Dashboard,
  array: "region_share" | "category_share" | "monthly_by_region",
): number | null {
  const adjustment = dashboard.privacy_meta?.privacy_rounding_adjustment;
  return adjustment ? adjustment[array] : null;
}

/** 부호를 붙인 표기 — 공개값이 정본보다 큰지 작은지를 감추지 않는다 */
export const signedCount = (value: number): string =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${num(Math.abs(value))}`;

const byPendingOrder = (a: Card, b: Card): number =>
  Number(b.ai.adjusted) - Number(a.ai.adjusted) || a.created_at.localeCompare(b.created_at);

const byDecidedDesc = (a: Card, b: Card): number =>
  (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at);

/**
 * 한 카드를 뒷받침하는 근거 뷰 — 허브의 텍스트 미리보기와 상세(/proposals/[id])의
 * 차트 섹션이 **같은 조합 함수**를 쓴다. 판독 문장이 두 화면에서 갈라지면 안 되기 때문.
 */
export function composeEvidence(
  dashboard: Dashboard,
  // 허브(app/page.tsx)는 candidates를 보조 데이터로 보고 `.catch(() => null)`로 감싼다 — 이
  // 함수가 그 null을 "0건"으로 조용히 삼키면 확충 카드의 "지역 근거"가 "6개 지역 공통"(원래는
  // 대상 지역이 없는 인센티브 카드용 문구)으로 잘못 읽힌다. 그래서 `rankingUnavailable`을 함께
  // 반환해 호출부가 "산출된 값이 없다"와 "불러오지 못했다"를 구분해 표시하게 한다.
  candidates: CandidatesResponse | null,
  card: Card | undefined,
) {
  const monthlyRows = dashboard.monthly_by_region ?? [];
  const regionTrend = monthlyRows.map((row) => ({
    label: monthLabel(String(row.month)),
    ...Object.fromEntries(REGIONS.map((region) => [region, Number(row[region] ?? 0)])),
  }));
  const lastRow = monthlyRows[monthlyRows.length - 1];
  const latestMonth = lastRow ? monthLabel(String(lastRow.month)) : "";
  const latestByRegion = lastRow
    ? REGIONS.map((region) => ({ region, value: Number(lastRow[region] ?? 0) })).sort((a, b) => b.value - a.value)
    : [];
  const targetRegion = card?.target?.eup ?? null;
  const targetLatest = latestByRegion.find((row) => row.region === targetRegion);
  const topLatest = latestByRegion[0];
  const targetRank = latestByRegion.findIndex((row) => row.region === targetRegion) + 1;
  const regionInsight =
    targetLatest && topLatest && targetLatest.value > 0
      ? // 타깃이 곧 1위면 "1위 사북읍의 약 1분의 1" 같은 자기 비교 문장이 되므로 비율 절은 뺀다
        `${latestMonth} ${targetLatest.region} ${num(targetLatest.value)}건 · 6개 지역 중 ${targetRank}위${
          targetRank > 1
            ? ` · 1위 ${topLatest.region}의 약 ${Math.round(topLatest.value / targetLatest.value)}분의 1`
            : ""
        }`
      : latestByRegion.length
        ? `${latestMonth} 1위 ${topLatest.region} ${num(topLatest.value)}건 · 최하위 ${latestByRegion.at(-1)?.region} ${num(latestByRegion.at(-1)?.value ?? 0)}건`
        : "월별 지역 데이터가 없습니다";

  const ranking = candidates?.eup_ranking ?? [];
  const rankingUnavailable = candidates === null;
  const targetCategory = card?.target?.category ?? null;
  const category = (dashboard.category_share ?? []).find((row) => row.category === targetCategory);
  const categoryInsight = category
    ? `${josa(category.category, "은/는")} 전체 사용의 ${Math.round(category.share * 100)}%입니다. AI 제안 업종의 실제 사용 규모를 함께 확인하세요.`
    : "업종별 사용 비중을 비교해 제안 대상의 현재 규모를 확인합니다.";
  /**
   * 허브 미리보기용 한 줄 — **1단계 읍·시 스코어** 상위 3곳 (절대 규칙 5의 텍스트 병기).
   * 원천은 `candidates.eup_ranking`(영월군 0.84대)이라 카드 상세의 2단계 후보 스코어(0.49대)와
   * 층위가 다르다. 두 값을 다 "원 Score"로 부르면 한 화면에서 같은 이름의 다른 숫자가 되므로
   * 표시 텍스트는 "읍·시 스코어"로 고정한다 (변수명·로직은 그대로 둔다).
   */
  const scoreTopLine = ranking
    .slice(0, 3)
    .map((row) => `${row.eup} ${row.score.toFixed(2)}`)
    .join(" · ");

  return {
    regionTrend,
    latestMonth,
    latestByRegion,
    targetRegion,
    regionInsight,
    ranking,
    rankingUnavailable,
    targetCategory,
    categoryInsight,
    scoreTopLine,
  };
}

export function composeDashboardView(
  dashboard: Dashboard,
  cards: Card[],
  candidates: CandidatesResponse | null,
  kpi: Kpi | null,
  activeType: CardType | null,
) {
  const visible = activeType ? cards.filter((card) => card.type === activeType) : cards;
  const pending = visible.filter((card) => card.status === "pending").sort(byPendingOrder);
  const decided = visible.filter((card) => card.status !== "pending").sort(byDecidedDesc);
  const approved = cards.filter((card) => card.status === "approved");
  const [hero] = pending;

  /**
   * 허브 우측 작업 열의 세 단계 — 결정 → 실행 → 완료.
   *
   * 세 블록 모두 **목록이 먼저이고 숫자는 그 길이**다. 상단 띠의 숫자를 따로 세면
   * 필터·정렬이 바뀔 때 숫자와 줄 수가 어긋난다 (4라운드 이전의 "결정 대기 2건 →
   * 카드 1장" 결함이 그것이었다). 그래서 `statusCounts`는 전부 배열의 `.length`다.
   *
   * 기준은 `visible`(= 종류 탭 필터 적용 후)이라 필터를 걸어도 숫자와 목록이 함께 움직이고,
   * 필터가 없으면 kpi.counts와 일치한다.
   */
  const inProgress = visible
    .filter((card) => card.status === "approved" && normalizedProgress(card) !== "완료")
    .sort(byDecidedDesc);
  const completed = visible
    .filter((card) => card.status === "approved" && normalizedProgress(card) === "완료")
    .sort(byDecidedDesc);

  const statusCounts = {
    waiting: pending.length,
    running: inProgress.length,
    done: completed.length,
    held: visible.filter((card) => card.status === "held").length,
    rejected: visible.filter((card) => card.status === "rejected").length,
  };

  // 근거 판독(composeEvidence)은 여기서 만들지 않는다 — 허브(app/page.tsx)가 "선택된 카드"
  // 기준으로 직접 호출한다. hero 기준으로 미리 만들어 두면 선택 카드와 판독 문장이 갈라진다.
  return {
    dashboard,
    candidates,
    kpi,
    generateType: activeType ?? ("EXPANSION" as const),
    statusCounts,
    pending,
    inProgress,
    completed,
    decided,
    approved,
    hero,
  };
}
