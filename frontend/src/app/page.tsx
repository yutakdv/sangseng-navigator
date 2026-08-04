import { AdminShell } from "@/components/AdminShell";
import { DashboardDetailSections } from "@/components/dashboard/DashboardDetailSections";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { api } from "@/lib/api";
import { composeDashboardView } from "@/lib/dashboardView";
import type { CardType } from "@/types";

export const dynamic = "force-dynamic";

type Search = { type?: string };

const isCardType = (value: string | undefined): value is CardType =>
  value === "EXPANSION" || value === "INCENTIVE";

/**
 * 담당자 의사결정 허브.
 *
 * 이 서버 컴포넌트는 데이터 호출과 뷰 모델 조합만 맡는다. 첫 viewport 표현은
 * DashboardOverview, 상세 근거·실행 표현은 DashboardDetailSections로 분리해
 * 상태 전이 규칙이나 해석 문장이 JSX 곳곳에 중복되지 않게 한다.
 */
export default async function HubPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const activeType = isCardType(params.type) ? params.type : null;
  const [dashboard, { cards }, candidates, kpi] = await Promise.all([
    api.dashboard(),
    api.cards(),
    api.candidates(),
    api.kpi(),
  ]);
  const view = composeDashboardView(dashboard, cards, candidates, kpi, activeType);
  const guidedCard = cards.find((card) => card.id === "AC-002") ?? cards.find((card) => card.ai.adjusted);

  return (
    <AdminShell dashboard={dashboard} hideSummary hideFreshnessBanner>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-7">
        <div id="proposal" className="scroll-mt-20">
          <DashboardOverview
            dashboard={dashboard}
            kpi={kpi}
            hero={view.hero}
            ranking={view.ranking}
            activeType={activeType}
            generateType={view.generateType}
            pendingCounts={view.pendingCounts}
            guidedCardId={guidedCard?.id}
          />
        </div>
        <DashboardDetailSections view={view} />
      </div>
    </AdminShell>
  );
}
