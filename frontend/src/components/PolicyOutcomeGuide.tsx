import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import type { Card, Scenario } from "@/types";

const statusLabel: Record<Card["status"], string> = {
  pending: "승인 대기",
  approved: "승인됨",
  rejected: "반려됨",
  held: "보류됨",
};

function RateImpact({ scenario, headlineRate, selected }: { scenario: Scenario; headlineRate: number; selected: boolean }) {
  const [lo, hi] = [scenario.delta_pp[0], scenario.delta_pp[scenario.delta_pp.length - 1]];

  return (
    <li
      className={`rounded-xl px-3 py-2.5 ${
        selected
          ? "bg-admin-primary-soft ring-1 ring-inset ring-admin-primary-line"
          : "bg-admin-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold tabular-nums text-admin-text">{scenario.rate}%</span>
        {selected ? (
          <span className="rounded-full bg-admin-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
            현재 확정
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-admin-text-muted">전환율 {headlineRate.toFixed(1)}% →</span>
        <span className="font-semibold tabular-nums text-admin-primary">
          {(headlineRate + lo).toFixed(1)}~{(headlineRate + hi).toFixed(1)}%
        </span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-admin-text-muted">
        <span>개선폭</span>
        <DeltaValue
          value={scenario.delta_pp}
          unit="%p"
          variant="text"
          className="font-semibold"
        />
        <span>· {scenario.budget_note}</span>
      </p>
    </li>
  );
}

/** 승인 이후의 실제 상태 전이와 페이백률 트레이드오프를 한 번에 설명한다. */
export function PolicyOutcomeGuide({ card, headlineRate }: { card: Card; headlineRate: number }) {
  const isIncentive = card.type === "INCENTIVE";
  const scenarios = card.scenarios ?? [];
  const selectedRate = card.selected_rate ?? null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2" aria-label="정책 영향 안내">
      <section className="rounded-card bg-admin-surface-sunken p-4 ring-1 ring-inset ring-admin-border">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-admin-primary text-white">
            <Icon name="workflow" size={15} />
          </span>
          <div>
            <h4 className="text-[13px] font-bold text-admin-text">
              {isIncentive ? "정책안을 승인하면" : "후보 검토를 시작하면"}
            </h4>
            <p className="text-[11px] text-admin-text-muted">AI 제안이 담당자 결정과 실행 기록으로 이어집니다.</p>
          </div>
        </div>

        <ol className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <li className="rounded-card bg-admin-surface p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-admin-primary">01 · 결정</p>
            <p className="mt-1.5 text-[12px] font-semibold text-admin-text">{statusLabel[card.status]}</p>
            <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">
              {isIncentive
                ? selectedRate
                  ? `${selectedRate}% 페이백률이 고정됩니다.`
                  : "3·5·7% 중 하나를 고른 뒤 승인합니다."
                : "후보 접촉·검토 Work Item이 시작되며 가맹은 확정되지 않습니다."}
            </p>
          </li>
          <li className="rounded-card bg-admin-surface p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-admin-primary">02 · 실행</p>
            <p className="mt-1.5 text-[12px] font-semibold text-admin-text">정책 트래킹으로 이동</p>
            <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">
              {isIncentive
                ? "승인된 정책안만 검토중·추진중·보류·완료를 기록합니다."
                : "필수 적격성 5항목 확인 후 가맹 심사·추진·완료를 기록합니다."}
            </p>
          </li>
          <li className="rounded-card bg-admin-surface p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-admin-primary">03 · 반영</p>
            <p className="mt-1.5 text-[12px] font-semibold text-admin-text">완료 후 방문객 위젯 반영</p>
            <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">
              완료된 확충·인센티브 카드가 추천 가맹점과 페이백 배지에 연결됩니다.
            </p>
          </li>
        </ol>
      </section>

      {isIncentive && scenarios.length ? (
        <section className="rounded-card bg-admin-primary-soft p-4 ring-1 ring-inset ring-admin-primary-line">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-admin-surface text-admin-primary ring-1 ring-admin-primary-line">
              <Icon name="gift" size={15} />
            </span>
            <div>
              <h4 className="text-[13px] font-bold text-admin-text">페이백률을 올리면</h4>
              <p className="text-[11px] text-admin-text-muted">효과 전망과 재원 부담이 함께 커지는 구조입니다.</p>
            </div>
          </div>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {scenarios.map((scenario) => (
              <RateImpact
                key={scenario.rate}
                scenario={scenario}
                headlineRate={headlineRate}
                selected={selectedRate === scenario.rate}
              />
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-admin-text-muted">
            <Icon name="info" size={12} className="mt-0.5 shrink-0" />
            <span>적립률·콤프 발행액은 그대로이며, 이미 적립된 포인트의 지역 사용 단계 리워드만 바뀝니다.</span>
          </p>
        </section>
      ) : null}
    </div>
  );
}
