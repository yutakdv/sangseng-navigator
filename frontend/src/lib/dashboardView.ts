import { REGIONS } from "@/lib/constants";
import { monthLabel, num } from "@/lib/format";
import type { Card, CardType, CandidatesResponse, Dashboard, Kpi } from "@/types";

export type DashboardView = ReturnType<typeof composeDashboardView>;

const byPendingOrder = (a: Card, b: Card): number =>
  Number(b.ai.adjusted) - Number(a.ai.adjusted) || a.created_at.localeCompare(b.created_at);

const byDecidedDesc = (a: Card, b: Card): number =>
  (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at);

export function composeDashboardView(
  dashboard: Dashboard,
  cards: Card[],
  candidates: CandidatesResponse,
  kpi: Kpi,
  activeType: CardType | null,
) {
  const pendingAll = cards.filter((card) => card.status === "pending");
  const pendingCounts = {
    all: pendingAll.length,
    EXPANSION: pendingAll.filter((card) => card.type === "EXPANSION").length,
    INCENTIVE: pendingAll.filter((card) => card.type === "INCENTIVE").length,
  };
  const visible = activeType ? cards.filter((card) => card.type === activeType) : cards;
  const pending = visible.filter((card) => card.status === "pending").sort(byPendingOrder);
  const decided = visible.filter((card) => card.status !== "pending").sort(byDecidedDesc);
  const approved = cards.filter((card) => card.status === "approved");
  const [hero, ...rest] = pending;
  const incentive =
    visible.find((card) => card.type === "INCENTIVE" && card.status === "pending" && card.scenarios?.length) ??
    visible.find((card) => card.type === "INCENTIVE" && card.scenarios?.length) ??
    null;

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
  const heroRegion = hero?.target?.eup ?? null;
  const heroLatest = latestByRegion.find((row) => row.region === heroRegion);
  const topLatest = latestByRegion[0];
  const regionInsight =
    heroLatest && topLatest && heroLatest.value > 0
      ? `${latestMonth} ${heroLatest.region} ${num(heroLatest.value)}건 · 6개 지역 중 ${latestByRegion.findIndex((row) => row.region === heroRegion) + 1}위 · 1위 ${topLatest.region}의 약 ${Math.round(topLatest.value / heroLatest.value)}분의 1`
      : latestByRegion.length
        ? `${latestMonth} 1위 ${topLatest.region} ${num(topLatest.value)}건 · 최하위 ${latestByRegion.at(-1)?.region} ${num(latestByRegion.at(-1)?.value ?? 0)}건`
        : "월별 지역 데이터가 없습니다";

  const ranking = candidates.eup_ranking ?? [];
  const shares = Object.fromEntries((dashboard.region_share ?? []).map((row) => [row.region, row.share]));
  const counts = Object.fromEntries((dashboard.region_share ?? []).map((row) => [row.region, row.count]));

  return {
    dashboard,
    candidates,
    kpi,
    activeType,
    generateType: activeType ?? ("EXPANSION" as const),
    pendingCounts,
    pending,
    decided,
    approved,
    hero,
    rest,
    incentive,
    heroRegion,
    regionTrend,
    latestMonth,
    latestByRegion,
    regionInsight,
    ranking,
    shares,
    counts,
  };
}
