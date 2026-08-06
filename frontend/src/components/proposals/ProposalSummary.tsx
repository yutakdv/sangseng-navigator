import Link from "next/link";
import { AssumptionBadge, AssumptionNote } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { RankTrace } from "@/components/RankTrace";
import { WorkflowChip } from "@/components/StatusChip";
import { num } from "@/lib/format";
import type { Card, Dashboard, EupScore } from "@/types";

/**
 * 제안 요약 코어 — 허브 좌측 미리보기와 상세(/proposals/[id]) 헤더가 공유한다.
 *
 * **공통 뼈대**(배지·카드 ID·종류 라벨·제목·AI 비교문·판단 근거·리스크)는 여기서 한 번만
 * 그리고, 가운데 사실 블록만 카드 종류로 갈린다. 두 종류의 성격이 다르기 때문이다:
 *
 *   EXPANSION — 대상이 특정 (읍×업종) 지점이다. 지역 근거·현재 비중·순위 안정도 세 지표와
 *               원 정량 Score 병기(절대 규칙 5)가 판단의 핵심이다.
 *   INCENTIVE — 대상 지점이 없다(전 지역 공통). 대신 3·5·7% 시나리오의 예상 개선폭과
 *               재원 부담이 판단의 핵심이라, 읍×업종·지도 항목을 억지로 채우지 않는다.
 *
 * `titleHref`를 주면 제목이 stretched link가 되어 카드 면 전체가 클릭 대상이 된다 —
 * 이때 카드 안의 다른 인터랙션 요소는 `relative z-10`으로 올려야 한다.
 */
export function ProposalSummary({
  card,
  ranking,
  dashboard,
  leadBadge,
  titleHref,
}: {
  card: Card;
  ranking: EupScore[];
  dashboard: Dashboard;
  /** 좌상단 첫 배지 자리 — 허브는 "오늘 검토 1순위", 상세는 "AI 제안 · 승인 전 검토 대상" */
  leadBadge?: React.ReactNode;
  titleHref?: string;
}) {
  const isExpansion = card.type === "EXPANSION";

  const title = (
    <h2 className="mt-2 max-w-3xl break-keep text-[24px] font-bold leading-[1.3] tracking-[-0.03em] text-lavender-950 sm:text-[30px]">
      {titleHref ? (
        <Link href={titleHref} className="after:absolute after:inset-0 after:content-['']">
          {card.title}
        </Link>
      ) : (
        card.title
      )}
    </h2>
  );

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {leadBadge}
          <WorkflowChip card={card} />
        </div>
        <span className="text-xs font-semibold tabular-nums text-admin-text-muted">{card.id}</span>
      </div>

      <p className="mt-6 text-xs font-bold tracking-[0.06em] text-lavender-600">
        {isExpansion ? "가맹점 확충 제안" : "인센티브 정책 제안"}
      </p>
      {title}
      <p className="mt-3 max-w-3xl break-keep text-sm leading-7 text-admin-text-soft">
        {card.ai.comparison}
      </p>

      {isExpansion ? (
        <ExpansionFacts card={card} ranking={ranking} dashboard={dashboard} />
      ) : (
        <IncentiveFacts card={card} />
      )}

      <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <DecisionList title="판단 근거" icon="check" items={card.ai.reasons.slice(0, 2)} />
        <DecisionList title="확인할 리스크" icon="warn" items={card.ai.risks.slice(0, 2)} />
      </div>
    </div>
  );
}

/** 확충 제안의 사실 블록 — 대상 지점이 있는 카드만 갖는 지표와 원 순위 병기 */
function ExpansionFacts({
  card,
  ranking,
  dashboard,
}: {
  card: Card;
  ranking: EupScore[];
  dashboard: Dashboard;
}) {
  const targetRank = card.target ? ranking.find((row) => row.eup === card.target?.eup) : undefined;
  const targetShare = card.target
    ? dashboard.region_share.find((row) => row.region === card.target?.eup)
    : undefined;
  const stability = dashboard.ranking_stability ?? dashboard.ai_stability;
  const showRank = card.score_rank !== null && card.ai_rank !== null;

  return (
    <>
      <div className="mt-6 grid grid-cols-1 divide-y divide-lavender-100 border-y border-lavender-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <MiniFact
          label="지역 근거"
          value={targetRank ? `${targetRank.eup} 진단 ${targetRank.rank}위` : "6개 지역 공통"}
        />
        <MiniFact
          label="현재 비중"
          value={targetShare ? `${Math.round(targetShare.share * 100)}% · ${num(targetShare.count)}건` : "정량 비교 필요"}
        />
        <MiniFact
          label="추천 순위 안정도"
          value={stability === null || stability === undefined ? "산출 전" : `${stability}%`}
        />
      </div>

      {/* 원 Score 순위 병기 — 조정 여부와 무관하게 항상 노출 (절대 규칙 5) */}
      {showRank ? (
        <div className="relative z-10 mt-4">
          <RankTrace card={card} />
        </div>
      ) : null}
    </>
  );
}

/**
 * 인센티브 제안의 사실 블록 — 대상 지점이 없으므로 읍×업종·지도 자리를 만들지 않는다.
 * 대신 3·5·7% 시나리오의 예상 개선폭과 재원 부담을 나란히 놓아 옵션 비교가 바로 되게 한다.
 * 전망 수치가 보이는 블록이므로 `가정 기반 전망` 배지와 고지 문구를 함께 싣는다 (절대 규칙 3).
 */
function IncentiveFacts({ card }: { card: Card }) {
  const scenarios = card.scenarios ?? [];

  return (
    <div className="mt-6 border-y border-lavender-100 py-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs font-semibold text-admin-text-muted">적용 대상</p>
        <p className="text-sm font-bold text-admin-text">전 지역 공통 · 발행액 증액 없음</p>
      </div>

      {scenarios.length ? (
        <>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-semibold text-admin-text-muted">페이백률별 예상 개선폭</p>
            <AssumptionBadge />
          </div>
          <ul className="mt-2 grid grid-cols-1 divide-y divide-lavender-100 border-t border-lavender-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:border-t-0">
            {scenarios.map((scenario) => (
              <li key={scenario.rate} className="py-2.5 sm:px-4 sm:py-0 sm:first:pl-0 sm:last:pr-0">
                <p className="text-[15px] font-bold tabular-nums text-admin-text">{scenario.rate}%</p>
                <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-admin-text-soft">
                  +{scenario.delta_pp[0].toFixed(1)}~{scenario.delta_pp.at(-1)?.toFixed(1)}%p
                </p>
                <p className="mt-0.5 break-keep text-xs text-admin-text-muted">{scenario.budget_note}</p>
              </li>
            ))}
          </ul>
          <AssumptionNote className="mt-3" />
        </>
      ) : (
        <p className="mt-3 text-[13px] text-admin-text-muted">시나리오가 아직 산출되지 않았습니다.</p>
      )}
    </div>
  );
}

/** 사실 확인 3열 — 알약 대신 괘선으로 나눈 문서식 표기 */
function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-3 sm:px-5 sm:py-3.5 sm:first:pl-0 sm:last:pr-0">
      <p className="text-xs font-semibold text-admin-text-muted">{label}</p>
      <p className="mt-1 break-keep text-sm font-bold text-admin-text">{value}</p>
    </div>
  );
}

function DecisionList({ title, icon, items }: { title: string; icon: "check" | "warn"; items: string[] }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-xs font-bold text-admin-text">
        <Icon name={icon} size={15} />
        {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2.5 break-keep text-[13px] leading-6 text-admin-text-soft">
            <span aria-hidden className="mt-[11px] h-px w-3.5 shrink-0 bg-lavender-400" />
            <span className="line-clamp-2 min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
