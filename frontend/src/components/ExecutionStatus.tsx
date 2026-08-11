import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { ProgressChip } from "@/components/StatusChip";
import { normalizedProgress, sampleQuality } from "@/lib/cardWorkflow";
import { dash, pctUnit, ratioNum } from "@/lib/format";
import type { Card, CardProgress, Kpi } from "@/types";

/**
 * 실행 현황 + 정책 성과 (docs/plan/13 §3 — 목업 image-1의 "정책 성과 요약").
 *
 * 목업의 "정책 효과 기여도 0.71"은 효과 귀속(대조군) 방법론이 없어 산출 불가라 13 §2-8이
 * **지역 균형지수**로 대체하도록 정했다. "기여도"라는 단어는 쓰지 않는다.
 * 목업의 금액 지표(경제적 파급효과)도 금액 필드가 없어 자리를 만들지 않고, 대신 상태값으로
 * 계산되는 **실행 전환율**을 넣는다 — 전부 Action Card 상태에서 나오는 값이라 승인·상태 변경이
 * 일어나면 즉시 바뀐다 (05 §3).
 */
const STAGES: CardProgress[] = [
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "추진중",
  "보류",
  "완료",
];

export function ExecutionStatus({
  approved,
  kpi,
  className = "",
}: {
  approved: Card[];
  /** null이면 KPI 호출 실패 — 아래 성과 지표 4칸을 0·"—"로 채우지 않고 불러오지 못했다고 밝힌다 */
  kpi: Kpi | null;
  className?: string;
}) {
  const count = (p: CardProgress) => approved.filter((card) => normalizedProgress(card) === p).length;
  const total = approved.length;
  const quality = kpi ? sampleQuality(kpi.counts.decided) : null;
  const sampleNote = quality === "demo" ? "예시 데이터" : quality === "limited" ? "표본 부족" : null;
  /**
   * 지역 균형지수는 표본이 다르다 — 집계 6지역 안에 타깃이 있는 승인 확충 카드만 센다.
   * 결정 총계로 품질을 판정하면 인센티브까지 포함한 수로 "운영 표본"이라 말하게 된다 (05 §3).
   */
  const balanceSample = kpi?.balance_sample_count ?? 0;
  const balanceQuality = kpi ? sampleQuality(balanceSample) : null;
  const balanceNote =
    balanceQuality === "demo" ? "예시 데이터" : balanceQuality === "limited" ? "표본 부족" : null;

  return (
    <section
      style={{ animationDelay: "80ms" }}
      className={`animate-rise flex min-w-0 flex-col overflow-hidden rounded-card bg-admin-surface shadow-card ${className}`}
      aria-label="실행 현황과 정책 성과"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-5 pb-4 2xl:p-6 2xl:pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Icon name="report" size={16} className="shrink-0 text-admin-primary" />
            <h3 className="u-panel-title">실행 현황 · 정책 성과</h3>
          </div>
          <p className="mt-1.5 break-keep text-[13px] leading-[1.65] text-admin-text-muted">
            담당자가 검토를 시작한 업무 항목의 단계와 의사결정 표본을 함께 봅니다.
          </p>
        </div>
      </div>

      <div className="min-w-0 px-5 2xl:px-6">
        {/* ── 추진 단계 ────────────────────────────────────────── */}
        {total === 0 ? (
          <p className="rounded-2xl bg-admin-surface-sunken px-4 py-5 text-center text-[13px] leading-6 text-admin-text-muted">
            검토를 시작한 카드가 아직 없습니다. 후보 접촉·검토를 시작하면 단계가 쌓입니다.
          </p>
        ) : (
          <>
            <div
              aria-hidden
              className="flex h-2.5 gap-1 overflow-hidden rounded-full bg-admin-surface-sunken"
            >
              {STAGES.map((s, i) => {
                const n = count(s);
                if (!n) return null;
                return (
                  <span
                    key={s}
                    style={{ width: `${(n / total) * 100}%`, animationDelay: `${160 + i * 90}ms` }}
                    className={`origin-left animate-grow rounded-full ${STAGE_BAR[s]}`}
                  />
                );
              })}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {STAGES.map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <ProgressChip progress={s} />
                  <span className="text-[13px] font-bold tabular-nums text-admin-text">
                    {count(s)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── 성과 지표 ────────────────────────────────────────── */}
        {kpi ? (
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-admin-border pt-5">
            <Stat
              icon="check"
              label="채택률"
              value={ratioNum(kpi.adoption_rate)}
              unit={pctUnit(kpi.adoption_rate)}
              note={`승인 ${kpi.counts.approved} / 결정 ${kpi.counts.decided}건${sampleNote ? ` · ${sampleNote}` : ""}`}
            />
            <Stat
              icon="trend"
              label="실행 전환율"
              value={ratioNum(kpi.execution_rate)}
              unit={pctUnit(kpi.execution_rate)}
              /* "결정"이 아니라 "승인"이다 — routes/kpi.py의 execution_rate 분모가 approved라
                 반려·보류는 들어가지 않는다. /dashboard의 같은 지표 설명과도 이 표기가 맞는다 */
              note={`승인 카드 ${kpi.counts.approved}건 중 추진중·완료 비중${sampleNote ? ` · ${sampleNote}` : ""}`}
            />
            <Stat
              icon="clock"
              label="평균 의사결정 소요"
              value={dash(kpi.avg_decision_hours)}
              unit={kpi.avg_decision_hours === null ? undefined : "시간"}
              /* 이 값은 created_at → decided_at 경과 시간이라 승인·반려·보류 **결정 시각**이 기준이다.
                 progress의 "후보 접촉·검토 시작"과는 다른 축이라 라벨에서 갈라 놓는다 */
              note="승인·반려·보류까지 걸린 시간"
            />
            <Stat
              icon="scale"
              label="지역 균형지수"
              value={dash(kpi.regional_balance_index)}
              unit={kpi.regional_balance_index === null ? undefined : "/ 100"}
              /* 지수만 크게 띄우고 그것이 카드 몇 장에서 나온 값인지 감추지 않는다 (05 §3) */
              note={`승인 확충 카드 ${balanceSample}건의 지역 분포${balanceNote ? ` · ${balanceNote}` : ""}`}
            />
          </dl>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-state-warn-line bg-state-warn-bg px-4 py-5 text-center text-[13px] leading-6 text-state-warn">
            성과 지표를 불러오지 못했습니다 — 위 추진 단계는 그대로 이용할 수 있습니다.
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-admin-border px-5 py-4 2xl:px-6">
        <Link
          href="/tracking"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-admin-surface px-4 py-2.5 text-sm font-bold text-admin-primary ring-1 ring-inset ring-admin-primary-line transition-colors hover:bg-admin-primary-soft"
        >
          추진 상태 기록하기
          <Icon name="arrowRight" size={15} strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}

const STAGE_BAR: Record<CardProgress, string> = {
  검토중: "bg-state-notice",
  "후보 접촉·검토 시작": "bg-admin-primary/55",
  "적격성 확인": "bg-admin-primary/70",
  "가맹 심사": "bg-admin-primary/85",
  추진중: "bg-admin-primary",
  보류: "bg-state-warn",
  완료: "bg-state-good",
};

function Stat({
  icon,
  label,
  value,
  unit,
  note,
}: {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  note: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[12px] font-semibold text-admin-text-muted">
        <Icon name={icon} size={13} />
        <span className="min-w-0 break-keep">{label}</span>
      </dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className="text-[22px] font-bold leading-7 tracking-[-0.02em] tabular-nums text-admin-text">
          {value}
        </span>
        {unit ? <span className="text-[11px] font-semibold text-admin-text-muted">{unit}</span> : null}
      </dd>
      <p className="mt-0.5 break-keep text-[11px] leading-4 text-admin-text-muted">{note}</p>
    </div>
  );
}
