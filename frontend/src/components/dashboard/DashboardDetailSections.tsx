import Link from "next/link";
import { ProxyBadge } from "@/components/Badge";
import { CardItem } from "@/components/CardItem";
import { DecisionActions } from "@/components/DecisionActions";
import { ExecutionStatus } from "@/components/ExecutionStatus";
import { ActHeading, Panel, PanelLink } from "@/components/Panel";
import { PolicyFlow } from "@/components/PolicyFlow";
import { PolicyOutcomeGuide } from "@/components/PolicyOutcomeGuide";
import { ScenarioLadder } from "@/components/ScenarioLadder";
import { CategoryShareBars } from "@/components/CategoryShareBars";
import { RegionTrend } from "@/components/charts/RegionTrend";
import { REGIONS } from "@/lib/constants";
import type { DashboardView } from "@/lib/dashboardView";
import type { Card } from "@/types";

export function DashboardDetailSections({ view }: { view: DashboardView }) {
  const {
    dashboard,
    kpi,
    hero,
    heroRegion,
    regionTrend,
    latestByRegion,
    latestMonth,
    regionInsight,
    ranking,
    rest,
    decided,
    approved,
    incentive,
    candidates,
  } = view;
  const targetCategory = hero?.target?.category ?? null;
  const category = (dashboard.category_share ?? []).find((row) => row.category === targetCategory);
  const categoryInsight = category
    ? `${category.category}은 전체 사용의 ${Math.round(category.share * 100)}%입니다. AI 제안 업종의 실제 사용 규모를 함께 확인하세요.`
    : "업종별 사용 비중을 비교해 제안 대상의 현재 규모를 확인합니다.";

  return (
    <div className="flex flex-col gap-6 pb-4">
      <ActHeading
        step="02 · 근거"
        question="이 제안을 뒷받침하는 신호"
        title="근거를 좁혀 봅니다"
        action={<PanelLink href="/dashboard">분석 전체 보기</PanelLink>}
      />
      <div className="grid grid-cols-4 gap-4 sm:grid-cols-8 xl:grid-cols-12">
        <Panel
          className="col-span-4 sm:col-span-8 xl:col-span-8"
          icon="trend"
          title="지역별 월 사용 건수 추이"
          desc="색상과 함께 최신 월 순위·건수 텍스트를 제공합니다."
          insight={regionInsight}
        >
          {regionTrend.length ? (
            <RegionTrend
              data={regionTrend}
              regions={REGIONS}
              targetRegion={heroRegion}
              latestByRegion={latestByRegion}
              latestMonth={latestMonth}
            />
          ) : (
            <EmptyState>표시할 월별 데이터가 없습니다.</EmptyState>
          )}
        </Panel>

        <Panel
          className="col-span-4 sm:col-span-8 xl:col-span-4"
          icon="scatter"
          title="업종·정량 순위 비교"
          desc="제안 업종의 사용 비중과 원 Score 순위를 함께 봅니다."
          insight={categoryInsight}
        >
          <CategoryShareBars data={dashboard.category_share ?? []} targetCategory={targetCategory} />
          <div className="mt-4 border-t border-admin-border pt-4">
            <p className="text-xs font-bold text-admin-text-muted">원 정량 Score 상위</p>
            <ol className="mt-2 divide-y divide-admin-border border-y border-admin-border">
              {ranking.slice(0, 3).map((row) => (
                <li key={row.eup} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="font-medium text-admin-text">{row.rank}. {row.eup}</span>
                  <span className="tabular-nums text-admin-text-muted">Score {row.score.toFixed(2)}</span>
                </li>
              ))}
            </ol>
          </div>
        </Panel>
      </div>

      {incentive ? (
        <>
          <ActHeading
            step="03 · 전망"
            question="결정하면 무엇이 달라지는가"
            title="정책 옵션을 나란히 봅니다"
            action={<PanelLink href="/incentive">인센티브 정책 보기</PanelLink>}
          />
          <Panel
            icon="layers"
            title="지역 결제 페이백 3 · 5 · 7% 비교"
            badge={dashboard.conversion.is_proxy ? <ProxyBadge note={dashboard.conversion.proxy_note} /> : null}
            desc="실측 결과가 아니라 팀 설정 가정에 기반한 전망이며, 예상 효과와 실제 효과를 분리합니다."
            insight={scenarioInsight(incentive)}
          >
            <ScenarioLadder card={incentive} headlineRate={dashboard.conversion.headline_rate} />
            <PolicyOutcomeGuide card={incentive} headlineRate={dashboard.conversion.headline_rate} />
          </Panel>
        </>
      ) : null}

      <ActHeading
        step="04 · 실행"
        question="담당자가 지금 이어갈 일"
        title="결정 큐를 실행으로 넘깁니다"
        action={<PanelLink href="/tracking">정책 카드 관리</PanelLink>}
      />
      <div className="grid grid-cols-4 gap-4 sm:grid-cols-8 xl:grid-cols-12">
        <div className="col-span-4 flex min-w-0 flex-col gap-4 sm:col-span-8 xl:col-span-8">
          <Panel
            id="decision-queue"
            icon="cards"
            title={`나머지 결정 대기 ${rest.length}건`}
            desc="최우선 제안은 위 결정 준비 패널에서 처리합니다. 확충 카드의 담당자 결정은 가맹 확정이 아니라 후보 접촉·검토 시작입니다."
          >
            {rest.length ? (
              <ul className="flex flex-col gap-3">
                {rest.map((card) => (
                  <li key={card.id}>
                    <CardItem card={card}>
                      {card.type === "INCENTIVE" ? (
                        <Link href="/incentive" className="text-[13px] font-semibold text-admin-primary hover:underline">
                          페이백률 비교·결정 →
                        </Link>
                      ) : (
                        <DecisionActions cardId={card.id} cardType={card.type} />
                      )}
                    </CardItem>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>추가 결정 대기 카드가 없습니다.</EmptyState>
            )}
          </Panel>

          {decided.length ? (
            <Panel
              icon="check"
              title={`최근 결정 ${decided.length}건`}
              desc="결정 이후에는 적격성·가맹 심사·추진 상태를 별도로 기록합니다."
            >
              <ul className="flex flex-col gap-3">
                {decided.map((card) => (
                  <li key={card.id}>
                    <CardItem card={card}>
                      <span className="text-xs tabular-nums text-admin-text-muted">결정 {stamp(card.decided_at)}</span>
                    </CardItem>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <ExecutionStatus
          approved={approved}
          kpi={kpi}
          className="col-span-4 sm:col-span-8 xl:col-span-4 xl:sticky xl:top-6 xl:self-start"
        />
      </div>

      <Panel
        icon="workflow"
        title="진단에서 방문객 반영까지"
        desc="AI는 후보 비교와 근거까지만 담당하고, 담당자가 검토·적격성·가맹 심사·실행을 기록합니다."
      >
        <PolicyFlow
          counts={{
            cards: kpi.counts.total,
            pending: kpi.counts.pending,
            approved: kpi.counts.approved,
            inProgress: approved.filter((card) => card.progress === "추진중").length,
            done: kpi.counts.done,
          }}
        />
        <p className="u-note mt-4 border-t border-admin-border pt-3">
          후보 데이터 {candidates.candidates.length}건 · 데이터 기준 {dashboard.period_note} · 실제 성과는 완료 후 운영 기록에 별도로 입력합니다.
        </p>
      </Panel>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-32 items-center justify-center border border-dashed border-admin-border bg-admin-surface-sunken px-4 text-center text-sm text-admin-text-muted">
      {children}
    </div>
  );
}

function scenarioInsight(card: Card): string | undefined {
  const scenarios = card.scenarios ?? [];
  if (scenarios.length < 2) return undefined;
  const low = scenarios[0];
  const high = scenarios.at(-1)!;
  return `${low.rate}%의 예상 개선폭 ${low.delta_pp[0].toFixed(1)}~${low.delta_pp.at(-1)?.toFixed(1)}%p부터 ${high.rate}%의 ${high.delta_pp[0].toFixed(1)}~${high.delta_pp.at(-1)?.toFixed(1)}%p까지이며 재원 부담도 함께 커집니다.`;
}

const stamp = (iso: string | null): string =>
  iso && iso.length >= 16 ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : "—";
