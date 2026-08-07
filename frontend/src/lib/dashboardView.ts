import { normalizedProgress } from "@/lib/cardWorkflow";
import { REGIONS } from "@/lib/constants";
import { monthLabel, num } from "@/lib/format";
import type { Card, CardType, CandidatesResponse, Dashboard, Kpi } from "@/types";

export type DashboardView = ReturnType<typeof composeDashboardView>;
export type EvidenceView = ReturnType<typeof composeEvidence>;

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
  candidates: CandidatesResponse,
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

  const ranking = candidates.eup_ranking ?? [];
  const targetCategory = card?.target?.category ?? null;
  const category = (dashboard.category_share ?? []).find((row) => row.category === targetCategory);
  const categoryInsight = category
    ? `${category.category}은 전체 사용의 ${Math.round(category.share * 100)}%입니다. AI 제안 업종의 실제 사용 규모를 함께 확인하세요.`
    : "업종별 사용 비중을 비교해 제안 대상의 현재 규모를 확인합니다.";
  /** 허브 미리보기용 한 줄 — 원 정량 Score 상위 3곳 (절대 규칙 5의 텍스트 병기) */
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
    targetCategory,
    categoryInsight,
    scoreTopLine,
  };
}

export function composeDashboardView(
  dashboard: Dashboard,
  cards: Card[],
  candidates: CandidatesResponse,
  kpi: Kpi,
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
