import Link from "next/link";
import { AssumptionNote } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import type { Card, Scenario } from "@/types";

/**
 * 페이백 시나리오 비교 (docs/plan/13 §2-6·§2-13 · 05 §2).
 *
 * 목업 image-1의 시뮬레이션 패널은 "추천 조합 예산 2.8억원 / 예상 사용 증가액 +8.2억원 /
 * ROI 5.8배"를 싣는데, 사용현황 데이터에 **금액 필드가 없어** 셋 다 산출할 원천이 없다.
 * 13 §2-13이 정한 대체 표기를 그대로 따른다 — 시나리오별 `delta_pp` 범위 +
 * `budget_note`(재원 부담 낮음/중간/높음) 정성 표기, 금액·ROI 타일은 두지 않는다.
 *
 * 목업의 "지역별 5%→10% 차등 상향"도 쓰지 않는다: 기획 원칙이 **전 지역 공통 적용 우선**이고
 * 계약도 3/5/7% 공통 시나리오다 (13 §2-6).
 *
 * 개선 후 값(20.5% → 21.5~22.5%)은 헤드라인 전환율에 `delta_pp`를 더한 것뿐이라 계산 과정이
 * 화면에 그대로 보인다. 지역 전환율이 보이는 자리이므로 `근사 지표` 배지가 함께 간다 (절대 규칙 2).
 * 어느 시나리오도 "권장"으로 미리 고르지 않는다 — 확정은 담당자 승인이다 (절대 규칙 4).
 */
export function ScenarioLadder({
  card,
  headlineRate,
}: {
  card: Card;
  /** dashboard.conversion.headline_rate — 개선 후 값의 기준점 */
  headlineRate: number;
}) {
  const scenarios = card.scenarios ?? [];
  if (!scenarios.length) return null;

  // 모든 시나리오가 같은 축을 공유해야 폭 차이가 곧 효과 차이로 읽힌다
  const axisMax = Math.max(...scenarios.map((s) => s.delta_pp[s.delta_pp.length - 1])) * 1.15;

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {scenarios.map((s, i) => (
          <ScenarioCard
            key={s.rate}
            scenario={s}
            axisMax={axisMax}
            headlineRate={headlineRate}
            confirmed={card.selected_rate === s.rate}
            delay={i * 80}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-admin-border pt-4">
        <div className="min-w-0 flex-1 basis-72">
          <AssumptionNote />
          {card.assumption_note ? (
            <p className="u-note mt-1 pl-[18px]">{card.assumption_note}</p>
          ) : null}
        </div>
        <Link
          href="/incentive"
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-admin-primary-strong"
        >
          시나리오 비교하고 승인하기
          <Icon name="arrowRight" size={16} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}

/** 재원 부담은 금액이 아니라 3단 등급이다 — 색과 함께 등급 문구가 항상 붙는다 (13 §4) */
const BUDGET_TONE: Record<string, string> = {
  "재원 부담 낮음": "bg-state-good-bg text-state-good ring-state-good-line",
  "재원 부담 중간": "bg-state-notice-bg text-state-notice ring-state-notice-line",
  "재원 부담 높음": "bg-state-warn-bg text-state-warn ring-state-warn-line",
};

function ScenarioCard({
  scenario,
  axisMax,
  headlineRate,
  confirmed,
  delay,
}: {
  scenario: Scenario;
  axisMax: number;
  headlineRate: number;
  confirmed: boolean;
  delay: number;
}) {
  const [lo, hi] = [scenario.delta_pp[0], scenario.delta_pp[scenario.delta_pp.length - 1]];
  const left = (lo / axisMax) * 100;
  const width = Math.max(4, ((hi - lo) / axisMax) * 100);

  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-rise group relative flex min-w-0 flex-col rounded-2xl bg-admin-surface p-5 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lift ${
        confirmed
          ? "shadow-card ring-2 ring-inset ring-admin-primary"
          : "shadow-card ring-1 ring-inset ring-admin-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-admin-text-muted">
          페이백률
        </span>
        {confirmed ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-admin-primary px-2 py-0.5 text-[11px] font-bold text-white">
            <Icon name="check" size={11} strokeWidth={2.4} />
            담당자 확정
          </span>
        ) : null}
      </div>

      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-[32px] font-bold leading-none tracking-[-0.03em] tabular-nums text-admin-text">
          {scenario.rate}
        </span>
        <span className="text-base font-bold text-admin-text-muted">%</span>
      </p>

      <div className="mt-4 border-t border-admin-border pt-3.5">
        <p className="text-[11px] font-semibold text-admin-text-muted">지역 전환율 개선폭</p>
        <p className="mt-1">
          <DeltaValue
            value={scenario.delta_pp}
            unit="%p"
            variant="text"
            className="text-[19px] font-bold leading-6"
          />
        </p>

        {/* 공유 축 위의 범위 막대 — 단정 값이 아니라 구간이라는 사실이 형태로 읽힌다 */}
        <div className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-admin-surface-sunken">
          <span
            style={{ left: `${left}%`, width: `${width}%`, animationDelay: `${delay + 260}ms` }}
            className="absolute inset-y-0 origin-left animate-grow rounded-full bg-admin-primary"
          />
        </div>

        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-admin-text-muted">
          <span className="tabular-nums">{headlineRate.toFixed(1)}%</span>
          <Icon name="arrowRight" size={12} strokeWidth={2} className="translate-y-px" />
          <span className="font-bold tabular-nums text-admin-text">
            {(headlineRate + lo).toFixed(1)}~{(headlineRate + hi).toFixed(1)}%
          </span>
          <span className="text-[11px]">예상</span>
        </p>
      </div>

      <p className="mt-4 flex items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            BUDGET_TONE[scenario.budget_note] ??
            "bg-state-notice-bg text-state-notice ring-state-notice-line"
          }`}
        >
          <Icon name="wallet" size={12} strokeWidth={2} />
          {scenario.budget_note}
        </span>
      </p>
    </div>
  );
}
