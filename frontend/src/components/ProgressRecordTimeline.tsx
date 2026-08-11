import Link from "next/link";
import { ProxyBadge } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { ProgressChip } from "@/components/StatusChip";
import { PROXY_NOTE } from "@/lib/constants";
import {
  PROGRESS_METRICS,
  formatMetric,
  measurementOf,
  metricIsProxy,
  metricUnit,
} from "@/lib/progressMetrics";
import type { ProgressMetricKey, ProgressRecord } from "@/types";

export function ProgressRecordTimeline({
  records,
  cardId,
  hasMore = false,
}: {
  records: ProgressRecord[];
  cardId: string;
  /** 서버 페이지네이션으로 잘린 이전 기록이 더 있는지(next_cursor 존재) — "첫 관측" 오표기 방지 */
  hasMore?: boolean;
}) {
  if (!records.length) {
    return (
      <div className="rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken px-4 py-9 text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-admin-surface text-admin-text-muted shadow-card">
          <Icon name="report" size={18} />
        </span>
        <p className="mt-3 text-[13px] font-semibold text-admin-text">아직 추진 경과 기록이 없습니다</p>
        <p className="mx-auto mt-1 max-w-md break-keep text-xs leading-5 text-admin-text-muted">
          근거 메모와 다음 행동을 입력하면 이곳에 최신 기록부터 쌓입니다.
        </p>
        <Link
          href={`/tracking/new?card_id=${encodeURIComponent(cardId)}`}
          className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-admin-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-admin-primary-strong"
        >
          첫 기록 입력
          <Icon name="arrowRight" size={13} />
        </Link>
      </div>
    );
  }

  // 기록별 "직전 대비" 변화 표기용. records는 서버가 최신순(동시각은 record_id 타이브레이커)으로
  // 정렬해 준 배열이다 — 여기서 다시 정렬하면 동시각 기록에서 서버와 다른 이웃을 골라
  // 델타 부호가 뒤집힐 수 있어 받은 순서를 그대로 쓴다. 오래된 것부터 한 번 훑으며
  // "그 시점까지의 마지막 관측값" 스냅샷을 기록마다 남긴다 (O(기록 수 × 지표 수)).
  const previousMetrics = new Map<string, Partial<Record<ProgressMetricKey, number>>>();
  const lastSeen: Partial<Record<ProgressMetricKey, number>> = {};
  for (let i = records.length - 1; i >= 0; i--) {
    previousMetrics.set(records[i].record_id, { ...lastSeen });
    for (const { key } of PROGRESS_METRICS) {
      const observed = measurementOf(records[i].metrics, key);
      if (observed) lastSeen[key] = observed.value;
    }
  }

  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:bottom-5 before:left-[11px] before:top-5 before:w-px before:bg-admin-border sm:before:left-[15px]">
      {records.map((record) => {
        // 관측값은 이제 값 하나가 아니라 측정 기간·출처·범위를 함께 지닌 객체다 —
        // 그 메타가 있어야 나중에 무엇을 잰 값인지 되짚을 수 있어 화면에도 함께 남긴다.
        const observed = PROGRESS_METRICS.flatMap((meta) => {
          const measurement = measurementOf(record.metrics, meta.key);
          return measurement ? [{ meta, measurement }] : [];
        });
        const quick = record.source === "quick_status" || record.source === "빠른 상태 변경";
        return (
          <li key={record.record_id} className="relative pl-8 sm:pl-10">
            <span
              aria-hidden
              className="absolute left-[7px] top-5 h-2.5 w-2.5 rounded-full bg-admin-primary ring-4 ring-admin-surface sm:left-[11px]"
            />
            <article className="rounded-xl border border-admin-border bg-admin-surface p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProgressChip progress={record.progress} />
                    {record.progress_changed && record.previous_progress ? (
                      <span className="text-[11px] text-admin-text-muted">
                        {record.previous_progress}에서 변경
                      </span>
                    ) : (
                      <span className="text-[11px] text-admin-text-muted">상태 유지 기록</span>
                    )}
                    {record.progress_pct !== null ? (
                      <span className="rounded-full bg-admin-surface-sunken px-2 py-0.5 text-[11px] font-bold tabular-nums text-admin-text">
                        진행률 {record.progress_pct.toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                  <p className={`mt-3 break-keep text-sm leading-6 ${record.note ? "font-medium text-admin-text" : "text-admin-text-muted"}`}>
                    {record.note ?? (quick ? "빠른 상태 변경 · 메모 없음" : "메모 없음")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <time
                    dateTime={record.recorded_at}
                    className="block text-xs font-semibold tabular-nums text-admin-text"
                  >
                    {kstDateTime(record.recorded_at)}
                  </time>
                  <span className="mt-0.5 block text-[10px] text-admin-text-muted">{sourceLabel(record.source)}</span>
                </div>
              </div>

              {record.blocker || record.next_action ? (
                <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                  {record.blocker ? (
                    <div className="rounded-lg bg-state-warn-bg px-3 py-2.5">
                      <dt className="flex items-center gap-1 text-[11px] font-bold text-state-warn">
                        <Icon name="warn" size={12} /> 장애 요인
                      </dt>
                      <dd className="mt-1 break-keep text-xs leading-5 text-admin-text">{record.blocker}</dd>
                    </div>
                  ) : null}
                  {record.next_action ? (
                    <div className="rounded-lg bg-admin-primary-soft px-3 py-2.5">
                      <dt className="flex items-center gap-1 text-[11px] font-bold text-admin-primary">
                        <Icon name="arrowRight" size={12} /> 다음 행동
                      </dt>
                      <dd className="mt-1 break-keep text-xs leading-5 text-admin-text">{record.next_action}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {record.owner || record.due_at ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-admin-border pt-3 text-xs text-admin-text-muted">
                  {record.owner ? (
                    <span className="flex items-center gap-1.5">
                      <Icon name="user" size={13} /> 담당 {record.owner}
                    </span>
                  ) : null}
                  {record.due_at ? (
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <Icon name="calendar" size={13} /> 목표일 {record.due_at}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {observed.length ? (
                <div className="mt-3 border-t border-admin-border pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[11px] font-bold text-admin-text-muted">실제 관측 성과</p>
                    {/* 절대 규칙 2 — 이 블록에 지역 전환율이 보이면 근사 지표 배지를 반드시 병기한다 */}
                    {observed.some(({ meta, measurement }) => metricIsProxy(meta.key, measurement)) ? (
                      <ProxyBadge note={PROXY_NOTE} />
                    ) : null}
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {observed.map(({ meta, measurement }) => {
                      const prev = previousMetrics.get(record.record_id)?.[meta.key];
                      return (
                        <div key={meta.key} className="rounded-lg bg-admin-surface-sunken px-2.5 py-2">
                          {/* 좁은 셀이라 shortLabel — 리포트 타일의 긴 라벨과 같은 지표다 */}
                          <dt className="text-[10px] leading-4 text-admin-text-muted">{meta.shortLabel}</dt>
                          <dd className="mt-0.5 text-xs font-bold tabular-nums text-admin-text">
                            {/* 단위는 서버가 지표 정의에서 채운 값을 우선한다 */}
                            {formatMetric(measurement.value, meta.digits)}
                            {metricUnit(meta.key, measurement)}
                          </dd>
                          <dd className="mt-1 text-[10px] leading-4">
                            {prev === undefined ? (
                              // 더 이전 페이지가 있으면 이 페이지의 첫 값일 뿐, 최초 관측이라 단정할 수 없다
                              <span className="text-admin-text-muted">
                                {hasMore ? "표시 범위 첫 값" : "첫 관측"}
                              </span>
                            ) : measurement.value === prev ? (
                              <span className="text-admin-text-muted">직전과 동일</span>
                            ) : (
                              <DeltaValue
                                value={measurement.value - prev}
                                unit={meta.deltaUnit}
                                digits={meta.digits}
                                variant="text"
                                className="text-[10px] font-semibold"
                                note="직전 대비"
                              />
                            )}
                          </dd>
                          {/* 기간·출처·범위가 없으면 무엇을 잰 값인지 되짚을 수 없다 — 값과 함께
                              남긴다. 개정 이전 기록에는 이 메타가 없으므로 그때는 줄 자체를 그리지
                              않는다(빈 값을 있는 것처럼 보여 주지 않는다) */}
                          {measurement.measured_from && measurement.measured_to ? (
                            <dd className="mt-1.5 flex flex-col gap-0.5 text-[10px] leading-4 text-admin-text-muted">
                              <span className="tabular-nums">
                                {measurement.measured_from} ~ {measurement.measured_to}
                              </span>
                              {measurement.scope || measurement.source ? (
                                <span className="break-keep">
                                  {[measurement.scope, measurement.source].filter(Boolean).join(" · ")}
                                </span>
                              ) : null}
                            </dd>
                          ) : null}
                        </div>
                      );
                    })}
                  </dl>
                  {/* 방향색은 값의 증감만 뜻한다 — 집중도는 의미가 반대라 문장으로 못 박는다 */}
                  {observed.some(({ meta }) => meta.key === "concentration_index") ? (
                    <p className="mt-2 text-[10px] leading-4 text-admin-text-muted">
                      지역 소비 집중도는 값이 낮아질수록(▼) 분산이 개선된 것입니다.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

const sourceLabel = (source: string): string => {
  if (source === "quick_status") return "빠른 상태 변경";
  if (source === "manual") return "담당자 입력";
  return source;
};

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
