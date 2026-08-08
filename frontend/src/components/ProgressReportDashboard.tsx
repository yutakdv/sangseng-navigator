import Link from "next/link";
import { ProxyBadge } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { Sparkline } from "@/components/Sparkline";
import { ProgressChip } from "@/components/StatusChip";
import { PROXY_NOTE } from "@/lib/constants";
import { ratioPct } from "@/lib/format";
import {
  PROGRESS_METRICS,
  PROXY_METRIC_KEY,
  formatMetric,
  metricMeta,
  type ProgressMetricMeta,
} from "@/lib/progressMetrics";
import {
  approvedAsOf,
  distributionLayers,
  metricSeries,
  unrecordedCards,
  type CardRecordsResult,
  type WorkflowLayer,
} from "@/lib/progressReportView";
import type { ProgressMetricChange, ProgressReport } from "@/types";

/**
 * 추진 경과 리포트 본문 (05 §8 GET /api/progress-report).
 *
 * 리포트 응답만으로는 답할 수 없는 층위 — 유형별 상태 분포·카드별 관측값 흐름·미기록 카드 목록 —
 * 은 승인 카드별 경과 기록(`cardRecords`)에서 화면이 직접 판다. BE 계약은 건드리지 않는다.
 *
 * **모든 파생은 `report.period`(요청 기간이 아니라 응답 기간)를 기준으로 한다** — 그래야
 * BE 집계와 화면 목록이 같은 창을 본다.
 */
export function ProgressReportDashboard({
  report,
  cardRecords,
  truncated = 0,
}: {
  report: ProgressReport;
  /** 승인 카드별 경과 기록 — 리포트에 없는 층위를 여기서 파생한다 */
  cardRecords: CardRecordsResult[];
  /** 목록 상한 때문에 기록을 읽지 않은 카드 수 — 파생값이 왜 적을 수 있는지 화면에 밝힌다 */
  truncated?: number;
}) {
  // 모집단을 BE와 맞춘다 — 기간 종료일 시점에 이미 승인돼 있던 카드만 센다 (05 §8 `_approved_as_of`).
  // 이 한 줄이 빠지면 과거 기간 조회에서 "미기록 0건" 헤더 아래 카드가 1~2장 뜬다.
  const scoped = approvedAsOf(cardRecords, report.period.to);
  const dist = distributionLayers(scoped, report.period.to);
  // 리포트 합계가 정본 — 파생이 못 따라간 만큼(기록 상한·개별 요청 실패)은 `미분류`로 흡수해
  // 두 층의 합이 항상 `기록 카드 N건`과 같게 만든다.
  const distGap = Math.max(0, report.recorded_card_count - dist.total) + dist.unclassified;
  const unrecorded = unrecordedCards(scoped, report.period.to);
  const series = metricSeries(scoped, report.period.from, report.period.to);

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
        {/* 목표일(due_at)은 선택 입력이라 표본 0이 정상 상태다 — 값은 05 §8의 "분모 0 → null → —"
            규칙대로 —로 두고, 왜 비었는지와 채우는 방법만 sub가 말한다 (0%로 채우면 거짓말이 된다) */}
        <KpiCard
          icon="calendar"
          label="목표일 내 완료율"
          value={ratioPct(report.on_time.rate)}
          sub={
            report.on_time.sample_size === 0 ? (
              <>
                아직 집계할 표본이 없습니다 — 기록을 남길 때{" "}
                <b className="font-semibold text-admin-text">목표일</b>을 함께 입력하고 그 카드가
                완료되면 여기에 집계됩니다.{" "}
                <Link
                  href="/tracking/new"
                  className="font-semibold text-admin-primary underline-offset-4 hover:underline"
                >
                  추진 기록 입력
                </Link>
              </>
            ) : (
              `목표일과 완료 기록이 모두 있는 표본 · 기한 내 ${report.on_time.on_time_count} / ${report.on_time.sample_size}건`
            )
          }
        />
      </div>

      <Section
        icon="workflow"
        title="현재 추진 상태 분포"
        desc={`리포트 종료일(${report.period.to})까지 카드별 최신 경과 기록을 기준으로 집계하며, 단계 정의가 다른 가맹점 확충과 페이백 인센티브를 나눠 봅니다. 유형별 합계는 기록 카드 ${report.recorded_card_count}건입니다. 기록이 없는 승인 카드는 분포에서 제외합니다.`}
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
        {/* 확충과 인센티브는 단계 정의가 다르다 — 한 줄에 섞으면 인센티브 전용 `검토중`이
            확충 4단계 사이에 설명 없이 끼어 두 워크플로가 하나처럼 읽힌다 (05 §2).
            리포트의 status_distribution에는 유형 정보가 없어 카드별 최신 기록에서 다시 판다. */}
        <div className="flex flex-col gap-2.5">
          {/* 승인 카드가 한 장도 없는 유형의 층은 감춘다 — 값이 전부 0인 워크플로를 띄워 두면
              "이 흐름도 지금 돌아가는 중"으로 잘못 읽힌다. 감춘 층의 합계는 0이라 아래 정합식은 그대로다.
              업무 목록(app/tracking/page.tsx)의 층 표시 조건과 같은 규칙이다. */}
          {dist.layers
            .filter(
              (layer) =>
                layer.total > 0 || scoped.some((entry) => entry.card.type === layer.type),
            )
            .map((layer) => (
              <DistributionLayer key={layer.type} layer={layer} />
            ))}
          {distGap > 0 ? (
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken px-3 py-2.5">
              <span className="text-[13px] font-semibold text-admin-text-muted">미분류</span>
              <span className="text-base font-bold tabular-nums text-admin-text-muted">
                {distGap}
                <span className="ml-0.5 text-xs font-medium">건</span>
              </span>
            </div>
          ) : null}
        </div>

        {truncated > 0 ? (
          <p className="u-note mt-3">
            승인 카드 {truncated}장은 목록 상한 때문에 기록을 읽지 않아 이 분포에 반영되지 않았습니다.
          </p>
        ) : null}

        {/* T-H 요약줄이 이 목록으로 내려온다 — 앵커 id는 /tracking의 "조치 필요" 줄과 짝이다 */}
        {report.cards_without_records > 0 || unrecorded.length > 0 ? (
          <div
            id="unrecorded"
            className="mt-4 scroll-mt-28 rounded-xl bg-state-notice-bg px-3.5 py-3 ring-1 ring-inset ring-state-notice-line"
          >
            <p className="flex items-start gap-2 text-xs font-bold leading-5 text-state-notice">
              <Icon name="info" size={14} className="mt-0.5" />
              경과 기록이 없어 분포·완료율에서 빠진 승인 카드 {report.cards_without_records}건
            </p>
            {unrecorded.length ? (
              <ul className="mt-2.5 divide-y divide-state-notice-line">
                {unrecorded.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="rounded-md bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-admin-text-muted">
                      {card.id}
                    </span>
                    <span className="min-w-0 flex-1 basis-48 break-keep text-[13px] font-semibold leading-5 text-admin-text">
                      {card.title}
                    </span>
                    <Link
                      href={`/tracking/new?card_id=${encodeURIComponent(card.id)}`}
                      className="text-xs font-semibold text-admin-primary underline-offset-4 hover:underline"
                    >
                      첫 기록 입력
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {unrecorded.length !== report.cards_without_records ? (
              <p className="mt-2 text-[11px] leading-4 text-state-notice">
                목록에는 {unrecorded.length}건만 표시했습니다 — 나머지는 기록을 읽지 못했거나 표시
                범위를 벗어난 이전 기록이 있어 여기서 판별하지 못했습니다.
              </p>
            ) : null}
          </div>
        ) : null}
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          id="stale"
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
        desc="카드별 기간 내 첫 관측값과 마지막 관측값을 비교한 평균입니다. 방향색은 증가 빨강·감소 파랑이며, 개선 여부는 지표 의미를 따로 반영합니다. 지역 소비 집중도는 감소가 개선입니다."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {PROGRESS_METRICS.map((meta) => (
            <MetricChangeCard key={meta.key} meta={meta} change={report.metric_changes[meta.key]} />
          ))}
        </div>

        {/* 위 타일은 카드 평균 한 쌍(기초·최신)만 보여 준다 — 그 사이에 값이 어떻게 움직였는지는
            카드별로 펼쳐 봐야 답이 된다. 카드마다 관측 시점이 달라 여러 카드를 한 선으로 평균 내면
            없는 추세를 만들어 내므로 **카드 1장 = 선 1개**로만 그린다 (metricSeries 주석). */}
        {series.length ? (
          <details className="mt-3 border-t border-admin-border pt-3">
            <summary className="u-disclosure">기간 내 관측값 흐름 보기 · 지표 {series.length}종</summary>
            <div className="mt-3 flex flex-col gap-4">
              {series.map((entry) => {
                const meta = metricMeta(entry.key);
                return (
                  <div key={entry.key}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-[13px] font-bold text-admin-text">{meta.label}</h4>
                      {/* 절대 규칙 2 — 지역 전환율이 보이는 모든 위치에 근사 지표 배지 */}
                      {entry.key === PROXY_METRIC_KEY ? <ProxyBadge note={PROXY_NOTE} /> : null}
                    </div>
                    <ul className="mt-2 flex flex-col gap-2">
                      {entry.cards.map((card) => {
                        const first = card.values[0];
                        const last = card.values[card.values.length - 1];
                        return (
                          <li
                            key={card.cardId}
                            className="grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-lg bg-admin-surface-sunken px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_110px_auto] sm:items-center"
                          >
                            <span
                              className="min-w-0 truncate text-xs font-semibold text-admin-text"
                              title={card.title}
                            >
                              {card.title}
                            </span>
                            <Sparkline
                              data={card.values}
                              id={`${card.cardId}-${entry.key}`}
                              height={26}
                              bare
                            />
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums text-admin-text-muted">
                              {formatMetric(first, meta.digits)}
                              {meta.unit}
                              <Icon name="arrowRight" size={11} />
                              <b className="font-bold text-admin-text">
                                {formatMetric(last, meta.digits)}
                                {meta.unit}
                              </b>
                              <DeltaValue
                                value={last - first}
                                unit={meta.deltaUnit}
                                digits={meta.digits}
                                variant="text"
                                className="text-[11px] font-semibold"
                                note={`관측 ${card.values.length}회`}
                              />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
            <p className="u-note mt-3">
              선 하나가 카드 한 장의 관측 순서입니다 — 관측 간격이 일정하지 않으므로 기울기를 속도로
              읽지 않습니다. 값을 두 번 이상 입력한 카드만 표시합니다. 지역 소비 집중도는 값이
              낮아질수록(▼) 분산이 개선된 것입니다.
            </p>
          </details>
        ) : null}

        <p className="u-note mt-3 border-t border-admin-border pt-3">
          표본은 해당 지표를 같은 카드에서 두 번 이상 실제 입력한 카드 수입니다. 기초값이 없으면 변화량을 만들지 않고 —로 둡니다.
        </p>
      </Section>
    </div>
  );
}

/**
 * 지표 메타를 통째로 받는다 — 라벨·아이콘·단위·소수 자리를 호출부에서 하나씩 넘기던 시절엔
 * 같은 표가 화면마다 조금씩 달라졌다. 정본은 lib/progressMetrics의 PROGRESS_METRICS 하나다.
 */
function MetricChangeCard({ meta, change }: { meta: ProgressMetricMeta; change: ProgressMetricChange }) {
  const { label, icon, unit: valueUnit, deltaUnit, digits } = meta;
  const verdict = improvementVerdict(change.improvement);
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-admin-border bg-admin-surface-sunken p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-admin-surface text-admin-text-muted shadow-card">
          <Icon name={icon} size={14} />
        </span>
        <h3 className="break-keep text-[13px] font-bold text-admin-text">{label}</h3>
        {/* 절대 규칙 2 — 지역 전환율이 보이는 모든 화면에 근사 지표 배지 병기 */}
        {meta.key === PROXY_METRIC_KEY ? <ProxyBadge note={PROXY_NOTE} /> : null}
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
            {/*
              BE `delta_unit`(count·KRW·%p·point)은 계약값이라 그대로 두고, 화면 단위는
              PROGRESS_METRICS의 `deltaUnit` 한 표에서만 가져온다 — 예전처럼 계약값을 그대로
              붙이면 집중도가 "0.60point"로 영문이 새고, 같은 화면 아래 흐름 섹션의 "0.60점"과
              단위가 갈린다.
            */}
            <DeltaValue value={change.delta} unit={deltaUnit} digits={digits} />
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
            {/* 원천 공개 데이터에 금액 필드가 없어 시드가 지어내지 않는다 (13 §2-13) — 의도된 공백임을 밝힌다 */}
            {meta.key === "spend_krw"
              ? "원천 공개 데이터에 금액 필드가 없어, 담당자 실측 입력 전까지 비워 둡니다."
              : "같은 카드의 실측값을 두 번 이상 입력해야 합니다."}
          </p>
        </div>
      )}
      <p className="mt-2 text-[11px] tabular-nums text-admin-text-muted">표본 {change.sample_size}개 카드</p>
    </article>
  );
}

/**
 * 유형 한 층의 단계 칩 묶음. 값이 0인 단계도 지운 자리 없이 그대로 둔다 —
 * 칩이 사라지면 흐름이 몇 단계였는지 화면에서 읽히지 않고, 층 합계와 눈으로 맞춰 볼 수도 없다.
 */
function DistributionLayer({ layer }: { layer: WorkflowLayer }) {
  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface-sunken p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-bold text-admin-text">
          {layer.title}{" "}
          <span className="font-semibold tabular-nums text-admin-text-muted">{layer.total}건</span>
        </h3>
        <span className="text-[11px] text-admin-text-muted">{layer.flowLabel}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {layer.stages.map((stage) => (
          <span
            key={stage}
            className="inline-flex min-w-0 items-center justify-between gap-2 rounded-full border border-admin-border bg-admin-surface py-1 pl-1 pr-3"
          >
            <ProgressChip progress={stage} />
            <span className="text-[13px] font-semibold tabular-nums text-admin-text">
              {layer.counts[stage] ?? 0}건
            </span>
          </span>
        ))}
      </div>
    </div>
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
