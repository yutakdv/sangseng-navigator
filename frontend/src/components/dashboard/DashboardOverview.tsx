import Link from "next/link";
import { AssumptionBadge, ProxyBadge } from "@/components/Badge";
import { CardTypeTabs } from "@/components/CardTypeTabs";
import { DeltaValue } from "@/components/DeltaValue";
import { GenerateCardButton } from "@/components/GenerateCardButton";
import { Icon, type IconName } from "@/components/Icon";
import { WorkflowChip } from "@/components/StatusChip";
import { dataFreshness } from "@/lib/dataFreshness";
import { sampleQuality } from "@/lib/cardWorkflow";
import { isMockMode } from "@/lib/api";
import { num, ratioPct } from "@/lib/format";
import type { Card, CardType, Dashboard, EupScore, Kpi } from "@/types";

type PendingCounts = { all: number; EXPANSION: number; INCENTIVE: number };

export function DashboardOverview({
  dashboard,
  kpi,
  hero,
  ranking,
  activeType,
  generateType,
  pendingCounts,
  guidedCardId,
}: {
  dashboard: Dashboard;
  kpi: Kpi;
  hero?: Card;
  ranking: EupScore[];
  activeType: CardType | null;
  generateType: CardType;
  pendingCounts: PendingCounts;
  guidedCardId?: string;
}) {
  const totalUses = (dashboard.region_share ?? []).reduce((sum, row) => sum + row.count, 0);
  const largestUsage = [...(dashboard.region_share ?? [])].sort((a, b) => b.count - a.count)[0];
  const targetRank = hero?.target ? ranking.find((row) => row.eup === hero.target?.eup) : undefined;
  const targetShare = hero?.target
    ? dashboard.region_share.find((row) => row.region === hero.target?.eup)
    : undefined;
  const freshness = dataFreshness(dashboard.period_note);
  const quality = sampleQuality(kpi.counts.decided);
  const qualityLabel = quality === "demo" ? "데모 표본" : quality === "limited" ? "표본 보강 필요" : "운영 표본";

  return (
    <section aria-labelledby="dashboard-title" className="flex flex-col gap-5">
      <header className="relative overflow-hidden rounded-hero bg-admin-sidebar px-5 py-5 text-white shadow-hero sm:px-7 sm:py-6 xl:px-8">
        <div aria-hidden className="absolute -right-20 -top-32 h-96 w-96 rounded-full bg-[#f2a86f]/20 blur-3xl" />
        <div aria-hidden className="absolute bottom-0 right-8 hidden h-40 w-64 rounded-t-full border border-white/10 bg-white/[0.035] lg:block" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#f2a86f] px-3 py-1 text-[10px] font-extrabold tracking-[0.16em] text-admin-sidebar-deep">
                POLICY COMPASS
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[10px] font-semibold text-white/70">
                {isMockMode ? "데모 운영" : "실시간 운영"}
              </span>
            </div>
            <h1 id="dashboard-title" className="mt-3 break-keep text-[27px] font-bold leading-tight tracking-[-0.04em] sm:text-[34px] xl:text-[38px]">
              근거를 확인하고, 오늘의 결정을 이어가세요.
            </h1>
            <p className="mt-2 max-w-2xl break-keep text-sm leading-6 text-white/70 sm:text-[15px]">
              AI 제안은 결론이 아닙니다. 정량 순위·지도·예상 효과를 상세에서 확인한 뒤 결정하고 실행으로 넘깁니다.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center xl:flex-col xl:items-end">
            <CardTypeTabs active={activeType} pendingCounts={pendingCounts} />
            <GenerateCardButton
              type={generateType}
              label={generateType === "INCENTIVE" ? "실시간 인센티브 제안 생성" : "실시간 확충 제안 생성"}
            />
            <p className="text-[11px] text-white/60">대표 사례와 별도로 현재 데이터에서 새 제안을 만듭니다.</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="핵심 KPI">
        <KpiCell
          icon="trend"
          label="지역 전환 신호"
          value={`${dashboard.conversion.headline_rate.toFixed(1)}%`}
          delta={
            <DeltaValue
              value={dashboard.growth?.qoq_pp}
              unit="%p"
              note="전분기 대비"
            />
          }
          note="지역 사용 건수 ÷ 입장 연인원"
          badge={dashboard.conversion.is_proxy ? <ProxyBadge note={dashboard.conversion.proxy_note} /> : null}
        />
        <KpiCell
          icon="target"
          label="소비 집중도"
          value={`${num(dashboard.concentration.index)}`}
          unit="/ 100"
          delta={`${dashboard.concentration.grade} · ${largestUsage?.region ?? "지역 없음"}`}
          note={largestUsage ? `최대 비중 ${Math.round(largestUsage.share * 100)}%` : "비교 데이터 없음"}
        />
        <KpiCell
          icon="receipt"
          label="지역 사용"
          value={num(totalUses)}
          unit="건"
          delta={
            <DeltaValue
              value={dashboard.growth?.mom_pct}
              unit="%"
              note="전월 대비"
            />
          }
          note="공개 최신 기간 누적"
        />
        <KpiCell
          icon="check"
          label="정책 채택률"
          value={ratioPct(kpi.adoption_rate)}
          delta={`승인 ${kpi.counts.approved} / 결정 ${kpi.counts.decided}`}
          note={`실행 전환 ${ratioPct(kpi.execution_rate)}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <article className="relative overflow-hidden rounded-hero border border-admin-primary-line bg-admin-primary-soft p-5 shadow-float sm:p-7 xl:col-span-8">
          <div aria-hidden className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full border-[44px] border-white/30" />
          {hero ? (
            <div className="relative">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-admin-primary px-3 py-1 text-[10px] font-bold tracking-[0.12em] text-white">오늘 검토 1순위</span>
                  <WorkflowChip card={hero} />
                </div>
                <span className="text-xs font-semibold tabular-nums text-admin-text-muted">{hero.id}</span>
              </div>

              <p className="mt-6 text-xs font-bold text-admin-primary">{hero.type === "EXPANSION" ? "가맹점 확충 제안" : "인센티브 정책 제안"}</p>
              <h2 className="mt-2 max-w-3xl break-keep text-[26px] font-bold leading-[1.28] tracking-[-0.035em] text-admin-text sm:text-[34px]">
                {hero.title}
              </h2>
              <p className="mt-3 max-w-3xl break-keep text-sm leading-7 text-admin-text-soft">
                {hero.ai.comparison}
              </p>

              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <MiniFact label="지역 근거" value={targetRank ? `${targetRank.eup} 진단 ${targetRank.rank}위` : "6개 지역 공통"} />
                <MiniFact label="현재 비중" value={targetShare ? `${Math.round(targetShare.share * 100)}% · ${num(targetShare.count)}건` : "정량 비교 필요"} />
                <MiniFact
                  label="추천 순위 안정도"
                  value={
                    (dashboard.ranking_stability ?? dashboard.ai_stability) === null ||
                    (dashboard.ranking_stability ?? dashboard.ai_stability) === undefined
                      ? "산출 전"
                      : `${dashboard.ranking_stability ?? dashboard.ai_stability}%`
                  }
                />
              </div>

              <div className="mt-6 grid gap-5 border-t border-admin-primary-line pt-5 lg:grid-cols-2">
                <DecisionList title="판단 근거" icon="check" items={hero.ai.reasons.slice(0, 2)} />
                <DecisionList title="확인할 리스크" icon="warn" items={hero.ai.risks.slice(0, 2)} />
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-admin-surface/80 p-4 ring-1 ring-inset ring-admin-primary-line">
                <div className="min-w-0 flex-1 basis-80">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold text-admin-text-muted">상세에서 확인할 내용</p>
                    <AssumptionBadge />
                  </div>
                  <p className="mt-1 break-keep text-sm font-semibold leading-6 text-admin-text">
                    원 Score 순위 → 반경 500m 지도 → 전환 시뮬레이션 → 담당자 결정
                  </p>
                </div>
                {hero.type === "INCENTIVE" ? (
                  <Link href="/incentive" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-admin-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-admin-primary-strong">
                    옵션 비교하기 <Icon name="arrowRight" size={15} />
                  </Link>
                ) : (
                  <Link href={`/cards/${hero.id}#diagnosis`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-admin-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-admin-primary-strong">
                    근거·지도 검토하기 <Icon name="arrowRight" size={15} />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="relative flex min-h-[420px] flex-col items-center justify-center text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-admin-primary text-white"><Icon name="sparkle" size={24} /></span>
              <h2 className="mt-5 text-2xl font-bold text-admin-text">결정 대기 제안이 없습니다</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-admin-text-muted">새 제안을 만들면 근거, 리스크, 예상 변화가 한 장에 정리됩니다.</p>
            </div>
          )}
        </article>

        <aside id="decision-panel" className="flex flex-col gap-4 xl:col-span-4" aria-label="오늘의 업무와 데이터 상태">
          <section className="rounded-panel border border-admin-border bg-admin-surface p-5 shadow-card sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold tracking-[0.14em] text-admin-primary">TODAY&apos;S QUEUE</p>
                <h2 className="mt-1 text-lg font-bold text-admin-text">오늘 이어갈 업무</h2>
              </div>
              <span className="rounded-full bg-[#fff0e6] px-2.5 py-1 text-[10px] font-bold text-state-warn">{qualityLabel}</span>
            </div>
            <div className="mt-5 space-y-2.5">
              <TaskLink href={hero ? `/cards/${hero.id}${hero.type === "EXPANSION" ? "#diagnosis" : "#evidence"}` : "/"} icon="check" label={`결정 대기 ${pendingCounts.all}건`} note="진단·근거·지도·시뮬레이션 검토" />
              <TaskLink href="/tracking" icon="workflow" label={`실행 관리 ${kpi.counts.approved}건`} note="적격성·심사·추진 상태 기록" />
              <TaskLink href="/widget" icon="phone" label="방문객 반영 확인" note="완료된 정책만 추천·혜택에 노출" />
            </div>
            {guidedCardId ? (
              <Link href={`/cards/${guidedCardId}#diagnosis`} className="mt-4 flex items-center justify-between rounded-xl border border-admin-primary-line bg-admin-primary-soft px-3.5 py-3 text-xs font-bold text-admin-primary hover:bg-white">
                <span>
                  <span className="block text-[10px] font-semibold text-admin-text-muted">대표 업무 흐름</span>
                  조정 사례 {guidedCardId} 검토하기
                </span>
                <Icon name="arrowRight" size={15} />
              </Link>
            ) : null}
          </section>

          <section className="rounded-panel border border-admin-border bg-admin-surface p-5 shadow-card sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary"><Icon name="database" size={18} /></span>
              <div>
                <p className="text-[10px] font-bold tracking-[0.14em] text-admin-primary">SOURCE STATUS</p>
                <h2 className="text-base font-bold text-admin-text">데이터 원천</h2>
              </div>
            </div>
            <div className="mt-4 divide-y divide-admin-border border-y border-admin-border">
              <SourceRow label="하이원포인트 사용" value={freshness.label} href="https://www.data.go.kr/data/15106402/fileData.do" />
              <SourceRow label="하이원포인트 가맹점" value="실시간 API 갱신" href="https://www.data.go.kr/data/15133571/openapi.do" />
              <SourceRow label="상권 후보 원천" value="기준월 · 2026.06" />
            </div>
            <p className="mt-3 text-[11px] leading-5 text-admin-text-muted">산출 {dashboard.updated_at} · 상세 출처와 원본 후보는 지역 소비 분석에서 확인합니다.</p>
          </section>
        </aside>
      </div>

      {hero ? (
        <Link href={`/cards/${hero.id}${hero.type === "EXPANSION" ? "#diagnosis" : "#evidence"}`} className="fixed inset-x-3 bottom-3 z-40 flex min-h-12 items-center justify-between rounded-2xl bg-admin-sidebar px-4 text-sm font-bold text-white shadow-hero md:hidden">
          <span className="text-white/60">다음 단계</span>
          <span>근거·지도 검토하기 →</span>
        </Link>
      ) : null}
    </section>
  );
}

function KpiCell({
  icon,
  label,
  value,
  unit,
  delta,
  note,
  badge,
}: {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  delta: React.ReactNode;
  note: string;
  badge?: React.ReactNode;
}) {
  return (
    <article className="min-w-0 rounded-panel border border-admin-border bg-admin-surface p-4 shadow-card sm:p-5">
      <div className="flex min-h-8 items-start justify-between gap-2">
        <p className="text-xs font-semibold text-admin-text-muted">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary"><Icon name={icon} size={15} /></span>
      </div>
      <div className="mt-4 flex min-w-0 items-baseline gap-1.5">
        <p className="truncate text-[28px] font-bold leading-none tracking-[-0.04em] tabular-nums text-admin-text sm:text-[32px]">{value}</p>
        {unit ? <span className="text-xs font-bold text-admin-text-muted">{unit}</span> : null}
      </div>
      <p className="mt-4 text-xs font-bold text-admin-text">{delta}</p>
      <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5 text-[11px] leading-5 text-admin-text-muted">
        <span>{note}</span>{badge}
      </div>
    </article>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-admin-surface/75 px-4 py-3 ring-1 ring-inset ring-admin-primary-line">
      <p className="text-[10px] font-bold tracking-wide text-admin-text-muted">{label}</p>
      <p className="mt-1 text-sm font-bold text-admin-text">{value}</p>
    </div>
  );
}

function DecisionList({ title, icon, items }: { title: string; icon: "check" | "warn"; items: string[] }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-xs font-bold text-admin-text"><Icon name={icon} size={15} />{title}</h3>
      <ul className="mt-3 space-y-2">
        {items.map((item, index) => <li key={`${title}-${index}`} className="line-clamp-2 break-keep text-[13px] leading-6 text-admin-text-soft">{item}</li>)}
      </ul>
    </section>
  );
}

function TaskLink({ href, icon, label, note }: { href: string; icon: IconName; label: string; note: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-xl bg-admin-surface-sunken/70 px-3 py-3 hover:bg-admin-primary-soft">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-admin-surface text-admin-primary ring-1 ring-inset ring-admin-border group-hover:border-admin-primary-line">
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-admin-text">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-admin-text-muted">{note}</span></span>
      <Icon name="chevronRight" size={14} className="text-admin-text-muted group-hover:text-admin-primary" />
    </Link>
  );
}

function SourceRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = <><span className="text-xs text-admin-text-muted">{label}</span><span className="ml-auto text-right text-xs font-bold text-admin-text">{value}</span>{href ? <Icon name="arrowUpRight" size={13} className="text-admin-primary" /> : null}</>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 py-2 hover:text-admin-primary">{body}</a>
  ) : (
    <div className="flex min-h-11 items-center gap-2 py-2">{body}</div>
  );
}
