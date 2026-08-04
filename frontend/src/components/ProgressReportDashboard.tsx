import Link from "next/link";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon, type IconName } from "@/components/Icon";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { ProgressChip } from "@/components/StatusChip";
import { ratioPct } from "@/lib/format";
import type {
  CardProgress,
  ProgressMetricChange,
  ProgressMetricKey,
  ProgressReport,
} from "@/types";

const STATUS_ORDER: CardProgress[] = [
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "검토중",
  "추진중",
  "보류",
  "완료",
];

const METRICS: {
  key: ProgressMetricKey;
  label: string;
  icon: IconName;
  valueUnit: string;
  digits: number;
}[] = [
  { key: "usage_count", label: "지역 사용 건수", icon: "receipt", valueUnit: "건", digits: 0 },
  {
    key: "conversion_rate_pct",
    label: "지역 전환율",
    icon: "trend",
    valueUnit: "%",
    digits: 2,
  },
  {
    key: "active_merchant_count",
    label: "활성 가맹점 수",
    icon: "store",
    valueUnit: "곳",
    digits: 0,
  },
  { key: "spend_krw", label: "지역 사용액", icon: "wallet", valueUnit: "원", digits: 0 },
  {
    key: "concentration_index",
    label: "소비 집중도",
    icon: "scatter",
    valueUnit: "점",
    digits: 2,
  },
];

export function ProgressReportDashboard({ report }: { report: ProgressReport }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="추진 경과 핵심 지표">
        <KpiCard
          icon="report"
          label="기간 내 경과 기록"
          value={report.record_count.toLocaleString("ko-KR")}
          unit="건"
          sub={`${periodLabel(report)} · 기록 카드 ${report.recorded_card_count}건 · 미기록 ${report.cards_without_records}건`}
        />
        <KpiCard
          accent
          icon="trend"
          label="평균 진행률"
          value={
            report.average_progress_pct.value === null
              ? "—"
              : report.average_progress_pct.value.toFixed(1)
          }
          unit={report.average_progress_pct.value === null ? undefined : "%"}
          sub={`기간 내 카드별 최신 진행률 · 표본 ${report.average_progress_pct.sample_size}건`}
        />
        <KpiCard
          icon="check"
          label="완료율"
          value={ratioPct(report.completion.rate)}
          sub={`기간 종료일까지 최신 기록 기준 · 완료 ${report.completion.completed_count} / 기록 카드 ${report.completion.sample_size}건`}
        />
        <KpiCard
          icon="calendar"
          label="목표일 내 완료율"
          value={ratioPct(report.on_time.rate)}
          sub={`목표일과 완료 기록이 모두 있는 표본 · 기한 내 ${report.on_time.on_time_count} / ${report.on_time.sample_size}건`}
        />
      </div>

      <Section
        icon="workflow"
        title="현재 추진 상태 분포"
        desc={`리포트 종료일(${report.period.to})까지 카드별 최신 경과 기록을 기준으로 집계합니다. 기록이 없는 승인 카드는 상태 분포에서 제외합니다.`}
        right={
          <Link
            href="/tracking/new"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-admin-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-admin-primary-strong"
          >
            기록 입력
            <Icon name="arrowRight" size={13} />
          </Link>
        }
      >
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {STATUS_ORDER.map((progress) => (
            <li
              key={progress}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-admin-border bg-admin-surface-sunken px-3 py-2.5"
            >
              <ProgressChip progress={progress} />
              <span className="text-base font-bold tabular-nums text-admin-text">
                {report.status_distribution[progress] ?? 0}
                <span className="ml-0.5 text-xs font-medium text-admin-text-muted">건</span>
              </span>
            </li>
          ))}
        </ul>
        {report.cards_without_records > 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-state-notice-bg px-3.5 py-3 text-xs leading-5 text-state-notice ring-1 ring-inset ring-state-notice-line">
            <Icon name="info" size={14} className="mt-0.5" />
            승인 카드 {report.cards_without_records}건은 아직 경과 기록이 없어 분포·완료율에 포함되지 않았습니다.
          </p>
        ) : null}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          icon="clock"
          title={`정체 점검 · ${report.stale.count}건`}
          desc={`완료되지 않은 카드 중 ${report.stale.threshold_days}일 이상 새 기록이 없는 항목입니다.`}
        >
          {report.stale.items.length ? (
            <ul className="divide-y divide-admin-border border-y border-admin-border">
              {report.stale.items.map((item) => (
                <li key={item.card_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProgressChip progress={item.progress} />
                      <span className="text-xs font-semibold tabular-nums text-admin-text-muted">
                        {item.card_id}
                      </span>
                    </div>
                    <p className="mt-1.5 break-keep text-[13px] font-semibold leading-5 text-admin-text">
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-admin-text-muted">
                      마지막 기록 {kstDateTime(item.last_recorded_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold tabular-nums text-state-warn">
                      {item.days_since_update}일
                    </p>
                    <Link
                      href={`/tracking/new?card_id=${encodeURIComponent(item.card_id)}`}
                      className="text-xs font-semibold text-admin-primary underline-offset-4 hover:underline"
                    >
                      경과 기록
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyReport
              title={report.recorded_card_count ? "정체 카드가 없습니다" : "정체 여부를 산출할 기록이 없습니다"}
              body={
                report.recorded_card_count
                  ? `${report.stale.threshold_days}일 이상 미갱신된 미완료 카드가 없습니다.`
                  : "첫 경과 기록을 입력하면 최신 기록일을 기준으로 정체 여부를 점검합니다."
              }
            />
          )}
        </Section>

        <Section
          icon="layers"
          title="단계별 평균 소요"
          desc="기간 내 같은 카드의 서로 다른 연속 상태 기록 사이 시간을 계산합니다. 같은 상태의 추가 메모는 중복 단계로 세지 않습니다."
        >
          {report.stage_durations.length ? (
            <div className="u-scroll-x">
              <table className="u-table min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col">상태 전이</th>
                    <th scope="col" className="text-right">평균</th>
                    <th scope="col" className="text-right">중앙값</th>
                    <th scope="col" className="text-right">표본</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stage_durations.map((row) => (
                    <tr key={`${row.from_progress}-${row.to_progress}`}>
                      <td>
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <ProgressChip progress={row.from_progress} />
                          <Icon name="arrowRight" size={13} className="text-admin-text-muted" />
                          <ProgressChip progress={row.to_progress} />
                        </div>
                      </td>
                      <td className="text-right font-semibold tabular-nums">
                        {durationLabel(row.average_hours)}
                      </td>
                      <td className="text-right tabular-nums text-admin-text-muted">
                        {durationLabel(row.median_hours)}
                      </td>
                      <td className="text-right tabular-nums text-admin-text-muted">{row.sample_size}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyReport
              title="단계 전이 표본이 없습니다"
              body="같은 카드에 서로 다른 상태의 경과 기록이 두 번 이상 쌓이면 단계별 소요 시간을 표시합니다."
            />
          )}
        </Section>
      </div>

      <Section
        icon="chart"
        title="실제 관측 성과 변화"
        desc="카드별 기간 내 첫 관측값과 마지막 관측값을 비교한 평균입니다. 방향색은 증가 빨강·감소 파랑이며, 개선 여부는 지표 의미를 따로 반영합니다. 소비 집중도는 감소가 개선입니다."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {METRICS.map((metric) => (
            <MetricChangeCard
              key={metric.key}
              label={metric.label}
              icon={metric.icon}
              valueUnit={metric.valueUnit}
              digits={metric.digits}
              change={report.metric_changes[metric.key]}
            />
          ))}
        </div>
        <p className="u-note mt-3 border-t border-admin-border pt-3">
          표본은 해당 지표를 같은 카드에서 두 번 이상 실제 입력한 카드 수입니다. 기초값이 없으면 변화량을 만들지 않고 —로 둡니다.
        </p>
      </Section>
    </div>
  );
}

function MetricChangeCard({
  label,
  icon,
  valueUnit,
  digits,
  change,
}: {
  label: string;
  icon: IconName;
  valueUnit: string;
  digits: number;
  change: ProgressMetricChange;
}) {
  const verdict = improvementVerdict(change.improvement);
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-admin-border bg-admin-surface-sunken p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-admin-surface text-admin-text-muted shadow-card">
          <Icon name={icon} size={14} />
        </span>
        <h3 className="break-keep text-[13px] font-bold text-admin-text">{label}</h3>
      </div>

      {change.sample_size > 0 && change.delta !== null ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-admin-text-muted">기초 평균</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-admin-text">
                {metricValue(change.baseline_average, valueUnit, digits)}
              </dd>
            </div>
            <div>
              <dt className="text-admin-text-muted">최신 평균</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-admin-text">
                {metricValue(change.latest_average, valueUnit, digits)}
              </dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-admin-border pt-3">
            <p className="mb-1 text-[11px] font-semibold text-admin-text-muted">관측 변화</p>
            <DeltaValue
              value={change.delta}
              unit={change.delta_unit === "KRW" ? "원" : change.delta_unit === "count" ? valueUnit : change.delta_unit}
              digits={digits}
            />
            {change.relative_change_pct !== null ? (
              <p className="mt-1 text-[11px] tabular-nums text-admin-text-muted">
                기초 평균 대비 {change.relative_change_pct > 0 ? "+" : ""}{change.relative_change_pct.toFixed(1)}%
              </p>
            ) : null}
          </div>
          <p className={`mt-3 rounded-lg px-2.5 py-2 text-xs font-bold ring-1 ring-inset ${verdict.tone}`}>
            성과 판정 · {verdict.label}
          </p>
        </>
      ) : (
        <div className="mt-3 flex flex-1 flex-col justify-center rounded-lg border border-dashed border-admin-border bg-admin-surface px-3 py-5 text-center">
          <p className="text-[13px] font-semibold text-admin-text">비교 전</p>
          <p className="mt-1 break-keep text-[11px] leading-4 text-admin-text-muted">
            같은 카드의 실측값을 두 번 이상 입력해야 합니다.
          </p>
        </div>
      )}
      <p className="mt-2 text-[11px] tabular-nums text-admin-text-muted">표본 {change.sample_size}개 카드</p>
    </article>
  );
}

function EmptyReport({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken px-4 py-8 text-center">
      <p className="text-[13px] font-semibold text-admin-text">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md break-keep text-xs leading-5 text-admin-text-muted">{body}</p>
    </div>
  );
}

const periodLabel = (report: ProgressReport): string =>
  `${report.period.from} ~ ${report.period.to} · ${report.period.days}일 · KST`;

const kstDateTime = (iso: string): string => {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ms);
};

const durationLabel = (hours: number | null): string => {
  if (hours === null) return "—";
  if (hours < 48) return `${hours.toFixed(1)}시간`;
  return `${(hours / 24).toFixed(1)}일`;
};

const metricValue = (value: number | null, unit: string, digits: number): string => {
  if (value === null) return "—";
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unit}`;
};

const improvementVerdict = (
  improvement: number | null,
): { label: string; tone: string } => {
  if (improvement === null) {
    return { label: "판정 불가", tone: "bg-state-notice-bg text-state-notice ring-state-notice-line" };
  }
  if (improvement > 0) {
    return { label: "개선", tone: "bg-state-good-bg text-state-good ring-state-good-line" };
  }
  if (improvement < 0) {
    return { label: "악화", tone: "bg-state-warn-bg text-state-warn ring-state-warn-line" };
  }
  return { label: "변화 없음", tone: "bg-state-notice-bg text-state-notice ring-state-notice-line" };
};
