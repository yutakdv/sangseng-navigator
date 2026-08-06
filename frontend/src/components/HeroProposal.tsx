import type { ReactNode } from "react";
import Link from "next/link";
import { AssumptionBadge, AssumptionNote, ProxyBadge } from "@/components/Badge";
import { DecisionActions } from "@/components/DecisionActions";
import { Icon } from "@/components/Icon";
import { RankTrace } from "@/components/RankTrace";
import { RegionDiagnosticMap } from "@/components/RegionDiagnosticMap";
import { StatusChip } from "@/components/StatusChip";
import type { Card, EupScore } from "@/types";

/**
 * Image-1의 핵심 구조를 현재 Action Card 데이터에 맞춰 재현한 홈 히어로.
 * 왼쪽은 담당자가 결정할 제안, 오른쪽은 6개 지역의 사용 비중 맵이다.
 */
export function HeroProposal({
  card,
  proxyNote,
  ranking,
  selectedEups,
  shares,
}: {
  card: Card;
  proxyNote?: string;
  ranking: EupScore[];
  selectedEups: string[];
  shares: Record<string, number>;
}) {
  const isExpansion = card.type === "EXPANSION";
  const target = card.target ? ranking.find((row) => row.eup === card.target?.eup) : undefined;
  const targetShare = target ? Math.round((shares[target.eup] ?? 0) * 100) : null;
  const proxyBadge = !isExpansion && proxyNote ? <ProxyBadge note={proxyNote} /> : null;

  return (
    <section
      aria-label="이번 분기 핵심 제안"
      className="animate-rise relative isolate overflow-hidden rounded-[28px] bg-lavender-50 shadow-float ring-1 ring-inset ring-lavender-100 lg:col-span-8"
    >

      <div className="grid grid-cols-1 gap-6 p-5 sm:p-7 2xl:p-8 lg:grid-cols-12 lg:gap-7">
        <div className="flex min-w-0 flex-col lg:col-span-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-primary px-3 py-1 text-xs font-bold text-white shadow-[0_6px_16px_-6px_rgb(79_70_229)]">
              <Icon name="sparkle" size={13} strokeWidth={2} />
              이번 분기 핵심 제안
            </span>
            <StatusChip status={card.status} />
          </div>

          <p className="mt-5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-admin-primary">
            <Icon name={isExpansion ? "store" : "gift"} size={13} strokeWidth={2} />
            {isExpansion ? "지역 가맹점 확충 액션카드" : "지역 소비 인센티브 액션카드"}
          </p>
          <h2 className="u-hero-title mt-2 text-admin-text">{card.title}</h2>

          <p className="mt-3 break-keep text-[14px] leading-6 text-admin-text-soft">
            {target
              ? `${target.eup}은 1단계 지역 진단 ${target.rank}순위이며, 현재 하이원포인트 사용 비중은 ${targetShare}%입니다. 맵에서 6개 지역의 소비 규모와 진단 점수를 함께 비교할 수 있습니다.`
              : "특정 지역 하나가 아니라 6개 지역 공통으로 적용되는 수요 측 정책입니다. 맵에서는 지역별 사용 비중을 비교하고, 시나리오 효과는 별도 정책 카드에서 확인합니다."}
          </p>

          <dl className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-white">
            <HeroMeta icon="pin" label="대상">
              {card.target?.eup ?? "전 지역"}
            </HeroMeta>
            <HeroMeta icon="shield" label="신뢰도">
              {card.confidence}
            </HeroMeta>
            <HeroMeta icon="database" label="근거">
              {card.sources.length}종
            </HeroMeta>
          </dl>

          <div className="mt-4">
            <RankTrace card={card} size="sm" />
          </div>

          {card.ai.expected_effect ? (
            <div className="mt-4 rounded-2xl bg-white/80 p-4 shadow-card ring-1 ring-inset ring-admin-primary-line">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-admin-primary">
                  <Icon name="bolt" size={13} strokeWidth={2} />
                  따르면 어떻게 되는가
                </h3>
                <AssumptionBadge />
                {proxyBadge}
              </div>
              <p className="mt-2 break-keep text-[14px] font-medium leading-6 text-admin-text">
                {card.ai.expected_effect}
              </p>
              <AssumptionNote className="mt-2" />
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-admin-primary-line pt-4">
            {isExpansion ? (
              <DecisionActions cardId={card.id} />
            ) : (
              <Link
                href="/incentive"
                className="inline-flex items-center gap-1.5 rounded-xl bg-admin-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-8px_rgb(79_70_229)] transition-colors hover:bg-admin-primary-strong"
              >
                페이백률 고르고 승인하기
                <Icon name="arrowRight" size={16} strokeWidth={2} />
              </Link>
            )}
            <Link
              href={`/cards/${card.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-4 py-2.5 text-sm font-bold text-admin-primary ring-1 ring-inset ring-admin-primary-line transition-colors hover:bg-admin-primary-soft"
            >
              AI 제안 상세 보기
              <Icon name="arrowRight" size={16} strokeWidth={2} />
            </Link>
          </div>
          <p className="u-note mt-2.5 flex items-start gap-1.5">
            <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
            <span>AI는 후보 비교와 근거까지만 제시하며, 카드는 담당자 승인 후 확정됩니다.</span>
          </p>
        </div>

        <div className="flex min-w-0 flex-col lg:col-span-7">
          <div className="flex items-start justify-between gap-3 px-1">
            <div>
              <h3 className="flex items-center gap-2 text-[16px] font-bold text-admin-text">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-admin-primary shadow-card">
                  <Icon name="map" size={17} strokeWidth={2} />
                </span>
                지역별 소비 맵
              </h3>
              <p className="mt-1 text-[12px] text-admin-text-muted">
                분할된 3D 소비 지형도로 6개 지역의 사용 비중과 진단 흐름을 비교합니다.
              </p>
            </div>
            <span className="hidden rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line sm:inline-flex">
              3D 소비 지형도
            </span>
          </div>

          <div className="mt-3 min-w-0 flex-1">
            <RegionDiagnosticMap
              ranking={ranking}
              selectedEups={selectedEups}
              targetEup={card.target?.eup ?? null}
              shares={shares}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMeta({
  icon,
  label,
  children,
}: {
  icon: "pin" | "shield" | "database";
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[10px] text-admin-text-muted">
        <Icon name={icon} size={12} />
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-[12px] font-bold text-admin-text">{children}</dd>
    </div>
  );
}
