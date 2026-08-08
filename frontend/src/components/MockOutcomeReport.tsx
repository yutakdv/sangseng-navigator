import { Icon, type IconName } from "@/components/Icon";
import { num } from "@/lib/format";
import type { Card, Dashboard } from "@/types";

type Metric = {
  icon: IconName;
  label: string;
  before: string;
  after: string;
  change: string;
  verdict: string;
  note: string;
  tone: "up" | "down" | "neutral";
};

/**
 * 실제 성과 데이터가 연결되기 전 보고서 형태를 검증하기 위한 결정론적 목 데이터다.
 * 같은 카드 id는 항상 같은 값을 보여 주므로 화면을 새로 고쳐도 데모 수치가 흔들리지 않는다.
 */
export function MockOutcomeReport({ card, dashboard }: { card: Card; dashboard: Dashboard }) {
  const seed = [...card.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  const totalUses = dashboard.region_share.reduce((sum, row) => sum + row.count, 0);
  const regionUses = card.target
    ? dashboard.region_share.find((row) => row.region === card.target?.eup)?.count ?? totalUses
    : totalUses;
  const selectedScenario = card.scenarios?.find((scenario) => scenario.rate === card.selected_rate);
  const scenarioDelta = selectedScenario?.delta_pp;
  const incentiveLift = Array.isArray(scenarioDelta) && scenarioDelta.length >= 2
    ? (Number(scenarioDelta[0]) + Number(scenarioDelta[1])) / 2
    : null;
  const usageLiftPct = card.type === "INCENTIVE" ? 3.8 + seed * 0.25 : 4.2 + seed * 0.3;
  const projectedUses = Math.round(regionUses * (1 + usageLiftPct / 100));
  const concentrationDrop = card.type === "EXPANSION" ? 0.6 + seed * 0.1 : 0.3 + seed * 0.05;
  const conversionLift = incentiveLift ?? (0.5 + seed * 0.1);
  const metrics: Metric[] = [
    {
      icon: "receipt",
      label: "하이원포인트 지역 사용 건수",
      before: `${num(regionUses)}건`,
      after: `${num(projectedUses)}건`,
      change: `+${usageLiftPct.toFixed(1)}%`,
      verdict: "증가",
      note: card.target ? `${card.target.eup} 기준` : "전체 지역 기준",
      tone: "up",
    },
    {
      icon: "target",
      label: "지역 소비 집중도",
      before: `${dashboard.concentration.index.toFixed(1)}점`,
      after: `${Math.max(0, dashboard.concentration.index - concentrationDrop).toFixed(1)}점`,
      change: `-${concentrationDrop.toFixed(1)}점`,
      verdict: "감소 · 쏠림 완화",
      note: "낮아질수록 지역 분산 개선",
      tone: "down",
    },
    {
      icon: "trend",
      label: "지역 전환 선호 신호",
      before: `${dashboard.conversion.headline_rate.toFixed(1)}%`,
      after: `${(dashboard.conversion.headline_rate + conversionLift).toFixed(1)}%`,
      change: `+${conversionLift.toFixed(1)}%p`,
      verdict: "증가",
      note: "지역 사용 건수 기반 근사 지표",
      tone: "up",
    },
  ];

  return (
    <section aria-labelledby={`mock-report-${card.id}`} className="overflow-hidden rounded-panel border border-admin-border bg-admin-surface shadow-card">
      <header className="flex flex-col gap-3 border-b border-admin-border bg-admin-surface-sunken px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`mock-report-${card.id}`} className="text-base font-bold text-admin-text">정책 성과 리포트</h2>
            <span className="rounded-full bg-state-warn-bg px-2.5 py-1 text-[10px] font-bold text-state-warn ring-1 ring-inset ring-state-warn-line">
              목 데이터 · 실제 성과 아님
            </span>
          </div>
          <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">
            {card.id} · {card.title}
          </p>
        </div>
        <div className="rounded-xl bg-admin-primary-soft px-3 py-2 text-right ring-1 ring-inset ring-admin-primary-line">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-admin-primary">관측 기간 가정</p>
          <p className="mt-0.5 text-xs font-semibold text-admin-text">정책 적용 전 → 3개월 후</p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:p-5">
        {metrics.map((metric) => (
          <OutcomeMetric key={metric.label} metric={metric} />
        ))}
      </div>

      <footer className="flex items-start gap-2 border-t border-admin-border px-4 py-3 text-[11px] leading-5 text-admin-text-muted sm:px-5">
        <Icon name="info" size={13} className="mt-1 shrink-0 text-admin-primary" />
        <p>
          현재는 실제 완료 후 측정 데이터가 없어 기준값에 정책 효과 가정을 적용한 시연용 결과입니다.
          운영 단계에서는 같은 위치에 실측 전·후 값, 측정 기간, 데이터 출처를 연결합니다.
        </p>
      </footer>
    </section>
  );
}

function OutcomeMetric({ metric }: { metric: Metric }) {
  const tone = metric.tone === "down"
    ? "bg-admin-primary-soft text-admin-primary ring-admin-primary-line"
    : metric.tone === "up"
      ? "bg-state-good-bg text-state-good ring-state-good-line"
      : "bg-admin-surface-sunken text-admin-text-muted ring-admin-border";

  return (
    <article className="rounded-card bg-admin-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary">
          <Icon name={metric.icon} size={17} />
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${tone}`}>{metric.verdict}</span>
      </div>
      <h3 className="mt-4 break-keep text-xs font-bold text-admin-text">{metric.label}</h3>
      <div className="mt-2 flex flex-wrap items-baseline gap-2 tabular-nums">
        <span className="text-sm text-admin-text-muted line-through decoration-admin-border">{metric.before}</span>
        <Icon name="arrowRight" size={13} className="text-admin-text-muted" />
        <strong className="text-xl tracking-[-0.03em] text-admin-text">{metric.after}</strong>
      </div>
      <p className="mt-2 text-sm font-bold text-admin-primary">{metric.change}</p>
      <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">{metric.note}</p>
    </article>
  );
}
