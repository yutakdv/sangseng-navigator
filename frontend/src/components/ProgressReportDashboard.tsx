import Link from "next/link";
import { ProxyBadge } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { StageTrack } from "@/components/StageTrack";
import { PROXY_NOTE } from "@/lib/constants";
import { pctNum, pctUnit, ratioNum } from "@/lib/format";
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
        {/* KPI 타일의 `%`는 값이 아니라 `unit` 슬롯으로 넘긴다 — 값 문자열에 넣으면 32px로 커져
            한 행 안에서 같은 퍼센트인데 크기가 달라 보인다 (pctNum/ratioNum/pctUnit 짝) */}
        <KpiCard
          accent
          icon="trend"
          label="평균 진행률"
          value={pctNum(report.average_progress_pct.value)}
          unit={pctUnit(report.average_progress_pct.value)}
          sub={`기간 내 카드별 최신 진행률 · 표본 ${report.average_progress_pct.sample_size}건`}
        />
        <KpiCard
          icon="check"
          label="완료율"
          value={ratioNum(report.completion.rate)}
          unit={pctUnit(report.completion.rate)}
          sub={`기간 종료일까지 최신 기록 기준 · 완료 ${report.completion.completed_count} / 기록 카드 ${report.completion.sample_size}건`}
        />
        {/* 목표일(due_at)은 선택 입력이라 표본 0이 정상 상태다 — 값은 05 §8의 "분모 0 → null → —"
            규칙대로 —로 두고, 왜 비었는지와 채우는 방법만 sub가 말한다 (0%로 채우면 거짓말이 된다) */}
        <KpiCard
          icon="calendar"
          label="목표일 내 완료율"
          value={ratioNum(report.on_time.rate)}
          unit={pctUnit(report.on_time.rate)}
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
        // 줄바꿈은 문장 끝에만 둔다 — 상자 폭에 맡기면 "…중복 단계로 / 세지 않습니다"처럼
        // 뜻과 상관없는 자리에서 끊긴다 (이 파일의 다른 desc도 같은 규칙)
        desc={
          <>
            리포트 종료일({report.period.to})까지 카드별 최신 경과 기록을 기준으로 집계하며,
            단계 정의가 다른 가맹점 확충과 페이백 인센티브를 나눠 봅니다.
            <br />
            유형별 합계는 기록 카드 {report.recorded_card_count}건입니다.
            기록이 없는 승인 카드는 분포에서 제외합니다.
          </>
        }
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
            className="mt-4 scroll-mt-28 rounded-xl bg-state-notice-bg px-3.5 py-3"
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

      {/* 두 블록의 폭이 다른 이유: 정체 점검은 카드 몇 장을 세로로 쌓는 목록이라 좁아도 되고,
          단계별 소요는 전이 이름 + 막대 비교라 가로가 길수록 읽힌다. 5:7로 나눈다 —
          예전 1:1에서는 소요 표가 잘려 가로 스크롤을 해야 보였다. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Section
          id="stale"
          icon="clock"
          title={`정체 점검 · ${report.stale.count}건`}
          desc={`완료되지 않은 카드 중 ${report.stale.threshold_days}일 이상 새 기록이 없는 항목입니다.`}
        >
          {report.stale.items.length ? (
            /* 상자를 씌우지 않는다 — 항목마다 틴트 면 + 좌측 주의색 레일을 두르면 패널 안에
               또 패널이 생겨(테두리 두 겹) 목록 몇 줄이 경고 더미처럼 보인다. 이 레포의
               목록 문법대로 가는 실선으로만 나눈다(바로 아래 미기록 목록과 같은 모양).
               상태는 이 줄의 주어가 아니라 부연이라 칩을 쓰지 않고 메타 줄의 글자로 내린다 —
               칩의 점까지 붙으면 제목보다 배지가 먼저 읽힌다. */
            <ul className="divide-y divide-admin-border border-y border-admin-border">
              {report.stale.items.map((item) => (
                <li key={item.card_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                  <p className="min-w-0 flex-1 basis-56 break-keep text-[13px] font-semibold leading-5 text-admin-text">
                    {item.title}
                  </p>
                  {/* 며칠째 멈췄는지가 이 목록의 정렬 기준 — 수치는 오른쪽 열에 세로로 맞춰
                      여러 줄일 때 눈이 한 열만 훑으면 되게 한다 */}
                  <span className="shrink-0 text-[15px] font-bold tabular-nums text-state-warn">
                    {item.days_since_update}일째
                  </span>
                  <p className="w-full text-[11px] leading-5 text-admin-text-muted">
                    {item.progress} · {item.card_id} · 마지막 기록 {kstDateTime(item.last_recorded_at)}
                    <Link
                      href={`/tracking/new?card_id=${encodeURIComponent(item.card_id)}`}
                      className="float-right font-semibold text-admin-primary underline-offset-4 hover:underline"
                    >
                      경과 기록 →
                    </Link>
                  </p>
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
          desc={
            <>
              기간 내 같은 카드의 서로 다른 연속 상태 기록 사이 시간을 계산합니다.
              같은 상태의 추가 메모는 중복 단계로 세지 않습니다.
              관측된 전이가 한 줄로 이어지면 그 순서대로 잇고, 갈라지거나 끊기면 구간을 따로
              나열합니다.
            </>
          }
        >
          {report.stage_durations.length ? (
            <StageDurations rows={report.stage_durations} />
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
        title="담당자 입력 관측값 변화"
        desc="카드별 기간 내 첫 관측값과 마지막 관측값을 비교한 평균입니다. 담당자가 입력한 값이며 같은 기간의 다른 요인과 분리하지 않으므로 정책의 인과 효과가 아닙니다. 방향색은 증가 빨강·감소 파랑이며, 개선 여부는 지표 의미를 따로 반영합니다. 지역 소비 집중도는 감소가 개선입니다."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {PROGRESS_METRICS.map((meta) => (
            <MetricChangeCard key={meta.key} meta={meta} change={report.metric_changes[meta.key]} />
          ))}
        </div>

        {/* 위 타일은 카드 평균 한 쌍(기초·최신)만 보여 준다 — 어느 카드가 얼마나 움직였는지는
            여기서 카드별로 펼쳐 본다. 스파크라인은 걷어냈다: 관측 간격이 카드마다 제각각이라
            선의 기울기가 속도처럼 읽히는데 실제로는 그런 뜻이 아니었고, 26px 선 위의 점 두세 개가
            숫자보다 덜 말했다. 지금은 기초값 → 최신값 + 변화량 숫자만 남긴다. */}
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
                            className="grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-lg bg-admin-surface-sunken px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                          >
                            <span
                              className="min-w-0 truncate text-xs font-semibold text-admin-text"
                              title={card.title}
                            >
                              {card.title}
                            </span>
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
              한 줄이 카드 한 장의 기초값 → 최신값입니다.
              <br />
              값을 두 번 이상 입력한 카드만 표시합니다.
              <br />
              지역 소비 집중도는 값이 낮아질수록(▼) 분산이 개선된 것입니다.
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
/**
 * 지표 하나의 관측 변화 타일.
 *
 * 예전에는 상자 안에 상자가 세 겹이었다 — 틴트 카드(테두리) 안에 점선 빈 상태 상자,
 * 그리고 `성과 판정 · 개선`이 링 두른 초록 막대로 가로를 다 먹었다. 라벨도 다섯 개
 * (기초 평균·최신 평균·관측 변화·성과 판정·표본)가 숫자 셋을 둘러싸고 있어, 정작
 * 무엇이 주인공인지 보이지 않았다.
 *
 * 이 섹션의 이름이 `실제 관측 성과 변화`이므로 **변화량이 주인공**이다. 변화량 하나를
 * 크게 세우고 나머지는 그 아래 조용한 보조선으로 내린다:
 *   ▲ 104건            ← 22px, 방향색
 *   개선 · 기초 대비 +13.2%
 *   ────────────────
 *   791건 → 895건 · 표본 2개 카드
 *
 * 판정은 색 막대가 아니라 **점 + 글자**로 말한다. 막대는 카드마다 초록 띠를 만들어
 * "전부 좋음"이라는 인상을 먼저 주는데, 그건 판정이 아니라 장식이다 (13 §4 색은 신호일 때만).
 * 테두리도 걷었다 — 패널 안의 중첩 블록은 면 한 단(surface-sunken)으로 충분히 갈린다.
 */
function MetricChangeCard({ meta, change }: { meta: ProgressMetricMeta; change: ProgressMetricChange }) {
  const { label, icon, unit: valueUnit, deltaUnit, digits } = meta;
  const verdict = improvementVerdict(change.improvement);
  const comparable = change.sample_size > 0 && change.delta !== null;

  return (
    <article className="flex min-w-0 flex-col rounded-xl bg-admin-surface-sunken p-4">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon name={icon} size={13} className="shrink-0 text-admin-text-muted" />
        <h3 className="min-w-0 break-keep text-[12px] font-semibold text-admin-text-muted">
          {label}
        </h3>
        {/* 절대 규칙 2 — 지역 전환율이 보이는 모든 화면에 근사 지표 배지 병기 */}
        {meta.key === PROXY_METRIC_KEY ? <ProxyBadge note={PROXY_NOTE} /> : null}
      </div>

      {comparable ? (
        <>
          {/*
            BE `delta_unit`(count·KRW·%p·point)은 계약값이라 그대로 두고, 화면 단위는
            PROGRESS_METRICS의 `deltaUnit` 한 표에서만 가져온다 — 예전처럼 계약값을 그대로
            붙이면 집중도가 "0.60point"로 영문이 새고, 같은 화면 아래 흐름 섹션의 "0.60점"과
            단위가 갈린다.
          */}
          <div className="mt-2.5">
            <DeltaValue
              value={change.delta}
              unit={deltaUnit}
              digits={digits}
              variant="text"
              className="text-[22px] font-bold leading-none tracking-[-0.02em]"
            />
          </div>

          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-4">
            <span className={`inline-flex items-center gap-1 font-semibold ${verdict.text}`}>
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${verdict.dot}`} />
              {verdict.label}
            </span>
            {change.relative_change_pct !== null ? (
              <>
                <span aria-hidden className="text-admin-text-muted">·</span>
                <span className="tabular-nums text-admin-text-muted">
                  기초 대비 {change.relative_change_pct > 0 ? "+" : ""}
                  {change.relative_change_pct.toFixed(1)}%
                </span>
              </>
            ) : null}
          </p>

          {/* 기초→최신과 표본을 한 줄에 `·`로 잇지 않는다 — 좁은 칸에서 줄이 바뀌면
              가운뎃점만 앞 줄 끝에 홀로 남는다. 두 줄로 고정해 다섯 칸의 높이도 맞춘다 */}
          <div className="mt-auto border-t border-admin-border pt-2.5 text-[11px] leading-4 text-admin-text-muted">
            <p className="flex flex-wrap items-center gap-x-1.5">
              <span className="tabular-nums">
                {metricValue(change.baseline_average, valueUnit, digits)}
              </span>
              <Icon name="arrowRight" size={10} strokeWidth={2} className="shrink-0" />
              <span className="font-semibold tabular-nums text-admin-text">
                {metricValue(change.latest_average, valueUnit, digits)}
              </span>
            </p>
            <p className="mt-0.5 tabular-nums">표본 {change.sample_size}개 카드</p>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2.5 text-[15px] font-bold leading-none text-admin-text-muted">비교 전</p>
          <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
            {/* 원천 공개 데이터에 금액 필드가 없어 시드가 지어내지 않는다 (13 §2-13) — 의도된 공백임을 밝힌다 */}
            {meta.key === "spend_krw"
              ? "원천 공개 데이터에 금액 필드가 없어, 담당자 실측 입력 전까지 비워 둡니다."
              : "같은 카드의 실측값을 두 번 이상 입력해야 합니다."}
          </p>
          <p className="mt-auto border-t border-admin-border pt-2.5 text-[11px] tabular-nums leading-4 text-admin-text-muted">
            표본 {change.sample_size}개 카드
          </p>
        </>
      )}
    </article>
  );
}

/** 유형 한 층(확충·인센티브)의 단계 분포 — 그림 규칙은 공용 StageTrack이 진다 */
function DistributionLayer({ layer }: { layer: WorkflowLayer }) {
  return (
    <StageTrack
      title={layer.title}
      stages={layer.stages}
      counts={layer.counts}
      meta={
        <>
          기록 <span className="font-semibold tabular-nums text-admin-text">{layer.total}</span>건
        </>
      }
    />
  );
}

type StageDurationRow = ProgressReport["stage_durations"][number];

/**
 * 관측된 전이들이 **한 줄로 이어지는 사슬인지** 판정하고, 맞으면 순서대로 정렬해 돌려준다.
 *
 * 사슬을 코드가 **데이터에서 유도한다** — 워크플로 정의(후보 접촉→적격성→…)를 그대로 믿고
 * 그리지 않는다. 이유는 `stage_durations`에 카드 유형 정보가 없기 때문이다: 확충(5단계)과
 * 인센티브(3단계)의 전이가 한 배열에 섞여 오고, `추진중 → 완료`처럼 두 워크플로에 모두
 * 있는 구간은 어느 쪽인지 구분되지 않는다(위 분포 블록이 카드별 최신 기록에서 유형을 다시
 * 파는 것과 같은 한계다). 그래서 "관측된 것만" 이어 보고, 갈라지거나 끊기면 사슬로 그리지
 * 않는다 — 없는 순서를 지어내지 않기 위한 판정이다.
 *
 * 사슬 조건: ① 시작점(다른 전이의 도착지가 아닌 출발지)이 정확히 하나, ② 같은 출발지에서
 * 두 갈래로 갈라지지 않음, ③ 한 번 걸어서 모든 전이를 소진. 하나라도 어긋나면 null.
 */
function chainOf(rows: StageDurationRow[]): StageDurationRow[] | null {
  if (!rows.length) return null;
  const byFrom = new Map<string, StageDurationRow>();
  for (const row of rows) {
    if (byFrom.has(row.from_progress)) return null; // 같은 출발지에서 분기 → 한 줄이 아니다
    byFrom.set(row.from_progress, row);
  }
  const arrivals = new Set(rows.map((r) => r.to_progress));
  const starts = rows.filter((r) => !arrivals.has(r.from_progress));
  if (starts.length !== 1) return null;

  const chain: StageDurationRow[] = [];
  const seen = new Set<string>();
  let cur: StageDurationRow | undefined = starts[0];
  while (cur && !seen.has(cur.from_progress)) {
    seen.add(cur.from_progress);
    chain.push(cur);
    cur = byFrom.get(cur.to_progress);
  }
  return chain.length === rows.length ? chain : null;
}

/**
 * 단계별 평균 소요 — 표가 아니라 **파이프라인 사슬**.
 *
 * 예전에는 4열 표(상태 전이 / 평균 / 중앙값 / 표본)였는데, 첫 열에 상태 칩 두 개와 화살표가
 * 들어가 열 하나가 200px를 먹어 표 최소 폭이 560px이 됐고, 옆 블록과 나눠 쓰는 자리에서는
 * 늘 잘려 가로 스크롤을 해야 숫자가 보였다.
 *
 * 그 다음엔 막대 비교 목록(오래 걸린 순)으로 바꿨는데, 이 전이들이 사실은 **끊긴 네 항목이
 * 아니라 한 줄로 이어지는 여정**(후보 접촉 → 적격성 → 가맹 심사 → 추진중 → 완료)이라는 게
 * 화면에서 사라졌다. 그래서 세로 사슬로 다시 세운다 — 위 `추진 상태 분포` 트랙과 같은 흐름을
 * 같은 문법으로 말한다. 구간 막대는 남긴다: 어디가 병목인지는 여전히 길이가 답한다.
 *
 * 사슬로 못 세우는 경우(유형이 섞여 분기·단절이 생긴 경우)에는 순서를 지어내지 않고
 * 구간 목록으로 물러난다 — `chainOf`가 그 판정을 한다.
 */
function StageDurations({ rows }: { rows: StageDurationRow[] }) {
  const chain = chainOf(rows);
  const legs = chain ?? [...rows].sort((a, b) => (b.average_hours ?? 0) - (a.average_hours ?? 0));
  const longest = Math.max(...legs.map((r) => r.average_hours ?? 0), 0);
  // 구간 평균을 더한 값이다 — 한 카드가 처음부터 끝까지 걸린 시간을 관측한 값이 아니라서
  // 라벨도 "구간 평균의 합"으로 적는다. 구간 하나라도 평균이 없으면 합계를 내지 않는다.
  const totalHours = chain?.every((r) => r.average_hours !== null)
    ? chain.reduce((sum, r) => sum + (r.average_hours ?? 0), 0)
    : null;

  const bar = (row: StageDurationRow) => {
    // 평균이 null이면 막대를 그리지 않는다 — 0%짜리 막대는 "0일"이라는 거짓말이 된다
    const ratio = longest > 0 && row.average_hours !== null ? row.average_hours / longest : null;
    return (
      <div className="flex items-center gap-2.5">
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-admin-surface-sunken">
          {ratio === null ? null : (
            <span
              className="block h-full rounded-full bg-admin-primary"
              style={{ width: `${Math.max(ratio * 100, 4)}%` }}
            />
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-admin-text-muted">
          중앙값 {durationLabel(row.median_hours)} · 표본 {row.sample_size}건
        </span>
      </div>
    );
  };

  // 사슬이 아니면 예전처럼 구간을 따로 나열한다 (순서를 만들어 내지 않는다)
  if (!chain) {
    return (
      <ol className="flex flex-col gap-3.5">
        {legs.map((row) => (
          <li key={`${row.from_progress}-${row.to_progress}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="flex min-w-0 items-center gap-1.5 break-keep text-[13px] font-semibold text-admin-text">
                {row.from_progress}
                <Icon name="arrowRight" size={12} className="shrink-0 text-admin-text-muted" />
                {row.to_progress}
              </span>
              <span className="text-[15px] font-bold tabular-nums text-admin-text">
                {durationLabel(row.average_hours)}
              </span>
            </div>
            <div className="mt-1.5">{bar(row)}</div>
          </li>
        ))}
      </ol>
    );
  }

  const nodes = [chain[0].from_progress, ...chain.map((r) => r.to_progress)];

  return (
    <>
      <ol className="flex flex-col">
        {nodes.map((node, i) => {
          const leg = chain[i]; // 이 노드에서 다음 노드로 가는 구간 (마지막 노드면 undefined)
          const isLast = i === nodes.length - 1;
          return (
            <li key={node}>
              {/* 단계 — 점 + 이름. 마지막(도착) 단계만 상태색(완료 초록)을 갖는다 */}
              <div className="flex items-center gap-3">
                <span className="flex w-2.5 shrink-0 justify-center">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isLast && node === "완료" ? "bg-state-good" : "bg-admin-primary"
                    }`}
                  />
                </span>
                <span className="break-keep text-[13px] font-semibold text-admin-text">{node}</span>
              </div>

              {/* 구간 — 세로 연결선 오른쪽에 소요 시간과 막대를 건다 */}
              {leg ? (
                <div className="flex gap-3">
                  <span aria-hidden className="flex w-2.5 shrink-0 justify-center">
                    <span className="w-px flex-1 bg-admin-border" />
                  </span>
                  <div className="min-w-0 flex-1 py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] text-admin-text-muted">이 구간 평균</span>
                      <span className="text-[15px] font-bold tabular-nums text-admin-text">
                        {durationLabel(leg.average_hours)}
                      </span>
                    </div>
                    <div className="mt-1.5">{bar(leg)}</div>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {totalHours !== null ? (
        <p className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-admin-border pt-3">
          <span className="text-[11px] text-admin-text-muted">
            구간 평균의 합 — 한 카드가 처음부터 끝까지 걸린 시간을 관측한 값이 아닙니다
          </span>
          <span className="text-[15px] font-bold tabular-nums text-admin-text">
            {durationLabel(totalHours)}
          </span>
        </p>
      ) : null}
    </>
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

/**
 * 개선 판정 — 채움 막대가 아니라 점 + 글자로 말한다.
 * 방향(▲▼)과 판정(개선·악화)은 다른 축이다: 지역 소비 집중도는 값이 내려가야 개선이라
 * `▼`인데 `개선`이다. 그래서 delta의 방향색과 이 색을 따로 둔다.
 */
const improvementVerdict = (
  improvement: number | null,
): { label: string; text: string; dot: string } => {
  if (improvement === null) {
    return { label: "판정 불가", text: "text-admin-text-muted", dot: "bg-admin-text-muted" };
  }
  if (improvement > 0) {
    return { label: "개선", text: "text-state-good", dot: "bg-state-good" };
  }
  if (improvement < 0) {
    return { label: "악화", text: "text-state-warn", dot: "bg-state-warn" };
  }
  return { label: "변화 없음", text: "text-admin-text-muted", dot: "bg-admin-text-muted" };
};
