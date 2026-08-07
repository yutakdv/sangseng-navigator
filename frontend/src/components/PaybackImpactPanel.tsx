import { AssumptionNote } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { num } from "@/lib/format";
import type { PaybackRate, Scenario } from "@/types";

/**
 * 페이백률별 "재원 부담 대비 효과" 비교 패널 (ScenarioTable 하단).
 *
 * 금액·ROI는 산출하지 않는다 — 원천 데이터에 금액 필드가 없다는 결정(13 §2-13)을 지키면서,
 * 실데이터로 계산 가능한 두 축만 대비한다:
 * - 효과: 예상 추가 지역 사용 건수/월 = 최근 3개월 평균 입장 연인원 × 개선폭(%p) ÷ 100
 *   (지역 전환율의 정의(건수÷연인원)를 그대로 뒤집은 값 — 새 가정을 더하지 않는다)
 * - 부담: 페이백률 자체(지역 결제액 100원당 r원 리워드) + budget_note 정성 표기
 * 여기에 "페이백 1%당 개선폭"을 병기해 세 시나리오의 효율을 같은 자로 비교하게 한다.
 *
 * ScenarioTable(클라이언트) 안에서 렌더되므로 라디오 선택(activeRate)을 실시간 강조한다.
 */
const loOf = (s: Scenario): number => s.delta_pp[0] ?? 0;
const hiOf = (s: Scenario): number => s.delta_pp[s.delta_pp.length - 1] ?? 0;

export function PaybackImpactPanel({
  scenarios,
  activeRate,
  avgVisitors,
  visitorsBasis,
}: {
  scenarios: Scenario[];
  /** 표에서 현재 선택(또는 확정)된 페이백률 — 해당 시나리오를 강조한다 */
  activeRate: PaybackRate | null;
  /** 최근 3개월 평균 입장 연인원(교대 합산) — 0 이하면 패널을 그리지 않는다 */
  avgVisitors: number;
  /** 평균의 근거 기간 라벨 (예: "2025-10~12") */
  visitorsBasis: string;
}) {
  if (!scenarios.length || !(avgVisitors > 0)) return null;
  const maxExtra = Math.max(...scenarios.map((s) => (avgVisitors * hiOf(s)) / 100), 1);

  return (
    <div className="mt-4 rounded-xl border border-admin-border bg-admin-surface p-4">
      <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-admin-text">
        <Icon name="scale" size={15} className="text-admin-primary" />
        재원 부담 대비 효과 전망
      </h4>
      <p className="u-note mt-1">
        효과는 개선폭을 월 사용 건수로 환산한 값이고, 부담은 지역 결제액 100원당 리워드
        지급액이다. 금액 원천 데이터가 없어 예산 액수 대신 구조로 비교한다.
      </p>

      <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {scenarios.map((s) => {
          const on = activeRate === s.rate;
          const extraLo = Math.round((avgVisitors * loOf(s)) / 100);
          const extraHi = Math.round((avgVisitors * hiOf(s)) / 100);
          return (
            <li
              key={s.rate}
              className={`rounded-xl p-3 ${
                on
                  ? "bg-admin-primary-soft ring-1 ring-inset ring-admin-primary-line"
                  : "bg-admin-surface-sunken"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-lg font-bold tabular-nums ${on ? "text-admin-primary" : "text-admin-text"}`}
                >
                  {s.rate}%
                </span>
                <span className="text-[11px] text-admin-text-muted">{s.budget_note}</span>
              </div>

              <p className="mt-2 text-[11px] font-semibold text-admin-text-muted">
                예상 추가 지역 사용
              </p>
              <p className="mt-0.5 text-[13px] font-bold tabular-nums text-admin-text">
                +{num(extraLo)}~{num(extraHi)}건<span className="font-medium text-admin-text-muted">/월</span>
              </p>
              {/* 범위 막대: 옅은 막대 = 상한, 진한 막대 = 하한 (단색 + 값 병기, 13 §5) */}
              <span className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-admin-surface ring-1 ring-inset ring-admin-border">
                <span
                  className="block h-full rounded-l-full bg-admin-primary"
                  style={{ width: `${Math.min(100, ((avgVisitors * loOf(s)) / 100 / maxExtra) * 100)}%` }}
                />
                <span
                  className="block h-full rounded-r-full bg-admin-primary/35"
                  style={{
                    width: `${Math.min(100, ((avgVisitors * (hiOf(s) - loOf(s))) / 100 / maxExtra) * 100)}%`,
                  }}
                />
              </span>

              <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-admin-border pt-2 text-[11px] text-admin-text-muted">
                <span>페이백 1%당 개선폭</span>
                <DeltaValue
                  value={[loOf(s) / s.rate, hiOf(s) / s.rate]}
                  unit="%p"
                  digits={2}
                  variant="text"
                  className="font-semibold"
                />
              </div>
              <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">
                지역 결제액 100원당 {s.rate}원 리워드 지급
              </p>
            </li>
          );
        })}
      </ul>

      <p className="u-note mt-3">
        계산식: 최근 3개월({visitorsBasis}) 평균 입장 연인원(교대 합산) {num(Math.round(avgVisitors))}
        명 × 개선폭(%p) ÷ 100. 개선폭 범위는 AI 시나리오의 가정값이다.
      </p>
      <AssumptionNote className="mt-1.5" />
    </div>
  );
}
