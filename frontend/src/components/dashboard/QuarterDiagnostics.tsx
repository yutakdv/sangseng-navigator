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
 * `근사 지표` 배지는 **전환율 수치가 찍히는 자리마다 1:1로** 붙인다 (절대 규칙 2). 배지 개수를
 * 줄이는 게 원칙이 아니라 수치와 짝을 맞추는 게 원칙이다 — 수치가 안 보이면 배지도 안 보이고,
 * 수치가 보이면 배지가 반드시 함께 보인다. 그래서 상태 바 요약줄(StatusBar `headline`)과
 * 이 패널의 "지역 전환율"이 각각 배지를 갖는다. 예전에 지적됐던 중복은 *같은 수치 하나에*
 * 배지가 셋 붙어 있던 경우다.
 *
 * 요약줄은 값만, 이 패널은 **전분기 대비 증감까지** 싣는다 — 같은 수치를 두 번 적는 게 아니라
 * 접힘/펼침의 정보량 차이다.
 *
 * 증감은 상태색(trend.*)을 그대로 쓴다 — lavender로 칠하지 않는다.
 */
export function QuarterDiagnostics({
  dashboard,
  kpi,
  totalUses,
}: {
  dashboard: Dashboard;
  /** null이면 KPI 호출 실패 — "정책 채택률" 칸을 0%로 그리지 않고 불러오지 못했다고 밝힌다 */
  kpi: Kpi | null;
  totalUses: number;
}) {
  return (
    <div>
      <div
        className="grid gap-x-6 gap-y-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        <Metric
          label="지역 전환율"
          badge={dashboard.conversion.is_proxy ? <ProxyBadge note={dashboard.conversion.proxy_note} /> : null}
          value={`${dashboard.conversion.headline_rate.toFixed(1)}%`}
          delta={<DeltaValue value={dashboard.growth?.qoq_pp} unit="%p" variant="text" className="text-xs" />}
          note="전분기"
        />
        <Metric
          label="지역 소비 집중도"
          value={`${num(dashboard.concentration.index)}/100`}
          note={dashboard.concentration.grade}
        />
        <Metric
          label="지역 사용"
          value={num(totalUses)}
          delta={<DeltaValue value={dashboard.growth?.mom_pct} unit="%" variant="text" className="text-xs" />}
          note="전월 일평균"
        />
        {kpi ? (
          <Metric
            label="정책 채택률"
            value={ratioPct(kpi.adoption_rate)}
            note={`승인 ${kpi.counts.approved}/결정 ${kpi.counts.decided}`}
          />
        ) : (
          <Metric label="정책 채택률" value="—" note="불러오지 못함" />
        )}
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
