import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { StageTrack } from "@/components/StageTrack";
import {
  EXPANSION_PROGRESS,
  INCENTIVE_PROGRESS,
  normalizedProgress,
  sampleQuality,
} from "@/lib/cardWorkflow";
import { dash, pctUnit, ratioNum } from "@/lib/format";
import type { Card, CardProgress, CardType, Kpi } from "@/types";

/**
 * 실행 현황 + 정책 성과 (docs/plan/13 §3 — 목업 image-1의 "정책 성과 요약").
 *
 * 목업의 "정책 효과 기여도 0.71"은 효과 귀속(대조군) 방법론이 없어 산출 불가라 13 §2-8이
 * **지역 균형지수**로 대체하도록 정했다. "기여도"라는 단어는 쓰지 않는다.
 * 목업의 금액 지표(경제적 파급효과)도 금액 필드가 없어 자리를 만들지 않고, 대신 상태값으로
 * 계산되는 **실행 전환율**을 넣는다 — 전부 Action Card 상태에서 나오는 값이라 승인·상태 변경이
 * 일어나면 즉시 바뀐다 (05 §3).
 */
/**
 * 유형별 단계는 정본 배열에서 파생한다 — 여기서 손으로 다시 적으면 하나 빠졌을 때
 * 그 상태의 카드가 어느 칸에도 안 잡혀 헤더 건수와 트랙 합계가 조용히 어긋난다.
 * 보류는 흐름의 중간이 아니라 이탈이라 자리만 맨 뒤로 옮긴다 (트랙이 흐름 밖으로 떼어 그린다).
 */
const orderedStages = (stages: CardProgress[]): CardProgress[] => [
  ...stages.filter((stage) => stage !== "보류"),
  ...stages.filter((stage) => stage === "보류"),
];
const LAYERS: { type: CardType; title: string; stages: CardProgress[] }[] = [
  { type: "EXPANSION", title: "가맹점 확충", stages: orderedStages(EXPANSION_PROGRESS) },
  { type: "INCENTIVE", title: "페이백 인센티브", stages: orderedStages(INCENTIVE_PROGRESS) },
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
  const count = (type: CardType, stage: CardProgress) =>
    approved.filter((card) => card.type === type && normalizedProgress(card) === stage).length;
  const layerTotal = (type: CardType) => approved.filter((card) => card.type === type).length;
  /**
   * 균형지수는 승인된 **확충** 카드의 6지역 분포만 본다 (backend/app/routes/kpi.py) —
   * "승인 카드"로만 적으면 인센티브까지 포함된 표본으로 읽힌다. 소표본에서는 한 장만 들어와도
   * 0점이 되므로 3건 미만은 참고값으로 못박는다.
   */
  const balanceBase = approved.filter((card) => card.type === "EXPANSION").length;
  const balanceNote =
    `확충 승인 ${balanceBase}건의 6개 지역 분포 기준 · 인센티브 제외` +
    (balanceBase < 3 ? " · 표본 3건 미만 참고값" : "");
  const total = approved.length;
  const quality = kpi ? sampleQuality(kpi.counts.decided) : null;
  const sampleNote = quality === "demo" ? "예시 데이터" : quality === "limited" ? "표본 부족" : null;

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
          /* 추진 경과 리포트와 같은 트랙으로 그린다 — 같은 단계 데이터를 두 화면이 다른 그림으로
             그리면 담당자가 다른 지표로 읽는다. 다만 이쪽 모집단은 "승인 카드의 현재 상태"라
             리포트(기간 내 경과 기록)와 다르므로 meta에 무엇을 센 값인지 적는다 */
          <div className="flex flex-col gap-2">
            {LAYERS.filter((layer) => layerTotal(layer.type) > 0).map((layer) => (
              <StageTrack
                key={layer.type}
                title={layer.title}
                stages={layer.stages}
                counts={Object.fromEntries(layer.stages.map((stage) => [stage, count(layer.type, stage)]))}
                compact
                meta={
                  <>
                    승인 카드{" "}
                    <span className="font-semibold tabular-nums text-admin-text">
                      {layerTotal(layer.type)}
                    </span>
                    장의 현재 상태
                  </>
                }
              />
            ))}
          </div>
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
              note={balanceNote}
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
