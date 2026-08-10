import { AdminShell } from "@/components/AdminShell";
import { DashboardDetailSections } from "@/components/dashboard/DashboardDetailSections";
import { DashboardOverview } from "@/components/dashboard/DashboardOverview";
import { api } from "@/lib/api";
import { composeDashboardView, composeEvidence } from "@/lib/dashboardView";
import type { CardType } from "@/types";

export const dynamic = "force-dynamic";

type Search = { type?: string; selected?: string };

const isCardType = (value: string | undefined): value is CardType =>
  value === "EXPANSION" || value === "INCENTIVE";

/**
 * 담당자 의사결정 허브.
 *
 * 이 서버 컴포넌트는 데이터 호출과 뷰 모델 조합만 맡는다. 첫 viewport 표현은
 * DashboardOverview, 상세 근거·실행 표현은 DashboardDetailSections로 분리해
 * 상태 전이 규칙이나 해석 문장이 JSX 곳곳에 중복되지 않게 한다.
 *
 * **좌측 미리보기는 `?selected=<카드 id>`가 정한다** (마스터-디테일). 선택 상태를 URL에 두면
 * 새로고침·링크 공유에서 그대로 살아나고, 미리보기 자체는 서버가 그리므로 카드 데이터를
 * 브라우저 번들로 내려보내지 않아도 된다. 쿼리가 없거나 목록에 없는 id면 1순위로 되돌린다.
 */
export default async function HubPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const activeType = isCardType(params.type) ? params.type : null;
  // 핵심 데이터는 dashboard(진단)와 cards(이 허브의 존재 이유인 Action Card 목록) 둘뿐이다 —
  // 둘 중 하나라도 실패하면 에러 경계로 보내는 것이 정직하다. candidates(후보 목록·읍·시 스코어)와
  // kpi(품질 배지·분기 진단 패널)는 보조 데이터라 실패해도 결정 흐름 자체는 살아야 한다.
  // null은 composeEvidence/composeDashboardView·DashboardOverview가 "0건"이 아니라 "불러오지
  // 못함"으로 구분해 표시한다(candidates는 rankingUnavailable 플래그로 전달).
  const [dashboard, { cards }, candidates, kpi] = await Promise.all([
    api.dashboard(),
    api.cards(),
    api.candidates().catch(() => null),
    api.kpi().catch(() => null),
  ]);
  const view = composeDashboardView(dashboard, cards, candidates, kpi, activeType);

  // 선택 대상은 우측 세 목록에 실제로 떠 있는 카드로 한정한다 — 목록에 없는 id를 쿼리로
  // 넣어도 화면에 선택 표시가 없는 카드가 좌측에 뜨는 어긋남이 생기지 않는다.
  const selectable = [...view.pending, ...view.inProgress, ...view.completed];
  const selected = selectable.find((card) => card.id === params.selected) ?? view.hero;
  // 판독 문장은 선택된 카드 기준으로 다시 뽑는다 (hero 고정이면 다른 카드를 골랐을 때 어긋난다)
  const evidence = composeEvidence(dashboard, candidates, selected);

  return (
    <AdminShell dashboard={dashboard} hideSummary hideFreshnessBanner>
      {/* 3층을 DashboardOverview의 children으로 넣는다 — sticky 상태 바가 페이지 끝까지
          붙어 있으려면 1·2·3층이 그 바와 같은 부모 박스 안에 있어야 한다 */}
      <div className="mx-auto max-w-[1500px]">
        <DashboardOverview
          dashboard={dashboard}
          kpi={kpi}
          selected={selected}
          heroId={view.hero?.id}
          queue={view.pending}
          inProgress={view.inProgress}
          completed={view.completed}
          ranking={evidence.ranking}
          rankingUnavailable={evidence.rankingUnavailable}
          regionInsight={evidence.regionInsight}
          scoreTopLine={evidence.scoreTopLine}
          activeType={activeType}
          generateType={view.generateType}
          statusCounts={view.statusCounts}
        >
          <DashboardDetailSections view={view} />
        </DashboardOverview>
      </div>
    </AdminShell>
  );
}
