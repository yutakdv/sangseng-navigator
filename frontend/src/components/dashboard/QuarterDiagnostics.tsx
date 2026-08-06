import type { ReactNode } from "react";
import { ProxyBadge } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { PanelLink } from "@/components/Panel";
import { num, ratioPct } from "@/lib/format";
import type { Dashboard, Kpi } from "@/types";

/**
 * 분기 진단 — 상태 바에서 펼치는 **압축 뷰**.
 *
 * 이 네 지표는 pipeline 배치로 분기에 한 번 바뀌는 배경 맥락이라, 허브에서는 "슬쩍 확인"만
 * 하면 된다. 풀사이즈 지표 카드는 `/dashboard`(지역 소비 분석)의 역할이고 여기서는 한 줄씩
 * 네 개만 싣는다.
 *
 * `근사 지표` 배지는 **지역 전환 신호 옆 한 곳**에만 붙인다 (절대 규칙 2). 예전에는 토글 요약·
 * 카드 안·카드 하단에 반복돼서 무엇을 경고하는 배지인지 되레 흐려졌다. 배지를 줄인 게 아니라
 * 전환율 수치가 나오는 자리와 1:1로 맞춘 것이다 — 수치가 안 보이면 배지도 안 보이고,
 * 수치가 보이면 배지가 반드시 함께 보인다.
 *
 * 증감은 상태색(trend.*)을 그대로 쓴다 — lavender로 칠하지 않는다.
 */
export function QuarterDiagnostics({
  dashboard,
  kpi,
  totalUses,
}: {
  dashboard: Dashboard;
  kpi: Kpi;
  totalUses: number;
}) {
  return (
    <div>
      <div
        className="grid gap-x-6 gap-y-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        <Metric
          label="지역 전환 신호"
          badge={dashboard.conversion.is_proxy ? <ProxyBadge note={dashboard.conversion.proxy_note} /> : null}
          value={`${dashboard.conversion.headline_rate.toFixed(1)}%`}
          delta={<DeltaValue value={dashboard.growth?.qoq_pp} unit="%p" variant="text" className="text-xs" />}
          note="전분기"
        />
        <Metric
          label="소비 집중도"
          value={`${num(dashboard.concentration.index)}/100`}
          note={dashboard.concentration.grade}
        />
        <Metric
          label="지역 사용"
          value={num(totalUses)}
          delta={<DeltaValue value={dashboard.growth?.mom_pct} unit="%" variant="text" className="text-xs" />}
          note="전월"
        />
        <Metric
          label="정책 채택률"
          value={ratioPct(kpi.adoption_rate)}
          note={`승인 ${kpi.counts.approved}/결정 ${kpi.counts.decided}`}
        />
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-admin-border pt-3 text-xs text-admin-text-muted">
        <span className="tabular-nums">산출 {dashboard.updated_at}</span>
        <PanelLink href="/dashboard">지역 소비 분석 전체 보기</PanelLink>
      </p>
    </div>
  );
}

/** 한 줄 지표 — 라벨(12px 보조색) · 값(17px) · 증감/부연(작게) */
function Metric({
  label,
  badge,
  value,
  delta,
  note,
}: {
  label: string;
  badge?: ReactNode;
  value: string;
  delta?: ReactNode;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-admin-text-muted">
        {label}
        {badge}
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[17px] font-bold leading-6 tracking-[-0.02em] tabular-nums text-admin-text">
          {value}
        </span>
        {delta}
        {note ? <span className="text-xs text-admin-text-muted">{note}</span> : null}
      </p>
    </div>
  );
}
