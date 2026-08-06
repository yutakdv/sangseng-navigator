import { AssumptionBadge, AssumptionNote, ProxyBadge } from "@/components/Badge";
import { CategoryShareBars } from "@/components/CategoryShareBars";
import { Act, Panel, PanelLink } from "@/components/Panel";
import { PolicyOutcomeGuide } from "@/components/PolicyOutcomeGuide";
import { ScenarioLadder } from "@/components/ScenarioLadder";
import { RegionTrend } from "@/components/charts/RegionTrend";
import { REGIONS } from "@/lib/constants";
import type { EvidenceView } from "@/lib/dashboardView";
import type { Card, Dashboard } from "@/types";

/**
 * 상세 페이지의 근거(01)·전망(02) 막 — 허브의 02·03막을 **이동**한 것이다 (복사 아님).
 * 허브는 이 내용의 텍스트 요약(insight 문장 + 원 Score 한 줄)만 미리보기로 갖는다.
 *
 * 서버 컴포넌트 — 차트(RegionTrend)만 "use client"로 내려간다.
 */
export function EvidenceSections({
  card,
  dashboard,
  evidence,
}: {
  card: Card;
  dashboard: Dashboard;
  evidence: EvidenceView;
}) {
  const isExpansion = card.type === "EXPANSION";

  return (
    <>
      <Act
        no="01"
        phase="근거"
        question="이 제안을 뒷받침하는 신호"
        title="근거를 좁혀 봅니다"
        action={<PanelLink href="/dashboard">분석 전체 보기</PanelLink>}
      >
        <div className="grid grid-cols-4 gap-4 sm:grid-cols-8 xl:grid-cols-12">
          <Panel
            className="col-span-4 sm:col-span-8 xl:col-span-8"
            icon="trend"
            title="지역별 월 사용 건수 추이"
            desc="색상과 함께 최신 월 순위·건수 텍스트를 제공합니다."
            insight={evidence.regionInsight}
            action={
              isExpansion ? <PanelLink href={`/cards/${card.id}#location`}>반경 500m 지도</PanelLink> : undefined
            }
          >
            {evidence.regionTrend.length ? (
              <RegionTrend
                data={evidence.regionTrend}
                regions={REGIONS}
                targetRegion={evidence.targetRegion}
                latestByRegion={evidence.latestByRegion}
                latestMonth={evidence.latestMonth}
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
            insight={evidence.categoryInsight}
          >
            <CategoryShareBars data={dashboard.category_share ?? []} targetCategory={evidence.targetCategory} />
            <div className="mt-4 border-t border-admin-border pt-4">
              <p className="text-xs font-bold text-admin-text-muted">원 정량 Score 상위</p>
              <ol className="mt-2 divide-y divide-admin-border border-y border-admin-border">
                {evidence.ranking.slice(0, 3).map((row) => (
                  <li key={row.eup} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="font-medium text-admin-text">
                      {row.rank}. {row.eup}
                    </span>
                    <span className="tabular-nums text-admin-text-muted">Score {row.score.toFixed(2)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Panel>
        </div>
      </Act>

      <Act
        no="02"
        phase="전망"
        question="결정하면 무엇이 달라지는가"
        title={card.scenarios?.length ? "정책 옵션을 나란히 봅니다" : "전환 시 예상 효과를 봅니다"}
        action={
          card.scenarios?.length ? (
            <PanelLink href="/incentive">인센티브 정책 보기</PanelLink>
          ) : (
            <PanelLink href={`/cards/${card.id}#location`}>정밀 시뮬레이션</PanelLink>
          )
        }
      >
        {card.scenarios?.length ? (
          <Panel
            icon="layers"
            title="지역 결제 페이백 3 · 5 · 7% 비교"
            badge={dashboard.conversion.is_proxy ? <ProxyBadge note={dashboard.conversion.proxy_note} /> : null}
            desc="실측 결과가 아니라 팀 설정 가정에 기반한 전망이며, 예상 효과와 실제 효과를 분리합니다."
            insight={scenarioInsight(card)}
          >
            <ScenarioLadder card={card} headlineRate={dashboard.conversion.headline_rate} />
            <PolicyOutcomeGuide card={card} headlineRate={dashboard.conversion.headline_rate} />
          </Panel>
        ) : (
          <Panel
            icon="trend"
            title="가맹 전환 시 예상 효과"
            badge={<AssumptionBadge />}
            desc="지금 수치가 아니라 전환을 가정한 전망입니다. 반경·후보 전제는 지도 화면에서 확인합니다."
          >
            <p className="break-keep text-sm leading-7 text-admin-text-soft">{card.ai.expected_effect}</p>
            <AssumptionNote className="mt-4 border-t border-admin-border pt-3" />
          </Panel>
        )}
      </Act>
    </>
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
