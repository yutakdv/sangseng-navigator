import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { FailedChart } from "@/components/EmptyChart";
import { Icon } from "@/components/Icon";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { PeriodFilter } from "@/components/PeriodFilter";
import { ProgressRecordTimeline } from "@/components/ProgressRecordTimeline";
import { ProgressReportDashboard } from "@/components/ProgressReportDashboard";
import { ProgressSelect } from "@/components/ProgressSelect";
import { RankTrace } from "@/components/RankTrace";
import { Section } from "@/components/Section";
import { ProgressChip, WorkflowChip } from "@/components/StatusChip";
import { api } from "@/lib/api";
import { eventLabel } from "@/lib/cardEvents";
import { eligibilityStatus, workflowLabel } from "@/lib/cardWorkflow";
import { REGIONS } from "@/lib/constants";
import { dash, pctUnit, ratioNum } from "@/lib/format";
import { ApiError } from "@/lib/errors";
import {
  kstToday,
  presetIdFor,
  resolvePeriod,
  workflowLayers,
  type CardRecordsResult,
} from "@/lib/progressReportView";
import type { Card, ProgressReport } from "@/types";

export const metadata: Metadata = { title: "추진 경과 리포트 · 상생 나침반" };

// 상태를 바꾸면 KPI·완료 안내가 곧바로 달라져야 한다 (데모 6→7단계) — 캐시하지 않는다
export const dynamic = "force-dynamic";

/**
 * 카드 한 장당 경과 기록을 한 번 더 읽는다 — 목록에서 "왜 정체지?"를 화면을 떠나지 않고 답하기 위함이다.
 *
 * 상한을 두는 이유: 승인 카드가 늘면 이 페이지 한 번에 GET이 카드 수만큼 병렬로 나간다
 * (force-dynamic이라 캐시도 없다). 데모 규모(한 자릿수)에서는 무해하고, 40장을 넘으면
 * 그 사실을 화면에 밝히고 카드 상세로 넘긴다 — 조용히 잘라내면 아래 파생값(상태 분포·미기록 목록)이
 * 이유 없이 줄어든다.
 */
const RECORD_FETCH_LIMIT = 40;

/**
 * ⑥ 실행 상태 트래킹 (docs/plan/08 F8 · 13 §3 "정책 카드 관리").
 *
 * 서버 컴포넌트다 — mock JSON은 서버에서만 읽히고, 상태 변경만 `ProgressSelect`(클라이언트)가
 * 서버 액션으로 호출한다. 칸반 열이 아니라 **행 + 셀렉트**인 이유는 ProgressSelect 주석 참고.
 *
 * 이 화면이 데모의 방아쇠다: 카드를 `완료`로 바꾸면 방문객 위젯 추천에 `이번 분기 확충 업종` 배지가 붙는다(05 §4).
 * 그 인과가 화면에서 읽히도록 완료 행마다 위젯 링크와 한 줄 설명을 둔다.
 */
export default async function TrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  // Next 15+ 에서 searchParams는 Promise다 — await 없이 접근하면 런타임 에러가 난다.
  // resolvePeriod가 형식·달력 유효성·BE의 400 조건 3개를 미리 검사해 벗어나면 기본 90일로 되돌린다.
  const requested = resolvePeriod(await searchParams);
  const today = kstToday();

  /**
   * 정규화로 계약 범위는 이미 맞췄지만, 자정 경계처럼 FE·BE의 "오늘"이 갈리는 순간에도
   * 화면이 통째로 에러 바운더리(app/error.tsx)로 떨어지면 안 된다 — 400이면 기본 90일로 한 번만 되돌린다.
   * 폴백 여부는 바깥 변수에 대입하지 않고 결과에 실어 나른다(렌더 중 변수 재대입 금지 규칙).
   */
  const reportRequest = api
    .progressReport(requested.query)
    .then((value) => ({ report: value as ProgressReport | null, fellBack: false }))
    .catch((error: unknown) => {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        (requested.query.from || requested.query.to)
      ) {
        return api
          .progressReport()
          .then((value) => ({ report: value as ProgressReport | null, fellBack: true }));
      }
      // 401 = 내부 토큰 미설정(배포 시 `API_MUTATION_TOKEN` 누락), 503 = BE 쪽 토큰 미설정
      // (DEMO_READ_ONLY=true + MUTATION_API_TOKEN 공란 조합 — deploy 가드를 조용히 통과한다).
      // 어느 쪽이든 페이지 전체를 에러 바운더리로 떨어뜨리면 심사 동선(11 대본 6단계)이 통째로
      // 막힌다 — 리포트만 접고 업무 목록은 살린다. 왜 비었는지는 아래 안내 배너가 밝힌다.
      if (error instanceof ApiError && (error.status === 401 || error.status === 503)) {
        return { report: null as ProgressReport | null, fellBack: false };
      }
      throw error;
    });

  const [dashboard, { cards }, kpi, { report, fellBack: periodFellBack }] = await Promise.all([
    api.dashboard(),
    api.cards({ status: "approved" }),
    api.kpi().catch(() => null),
    reportRequest,
  ]);

  /**
   * 표시용 기간의 정본은 **응답의 report.period**다(요청값이 아니라).
   * 폴백이 일어난 뒤 요청값을 그리면 화면이 실제로 집계한 구간과 다른 말을 하게 된다.
   */
  const period = report
    ? {
        from: report.period.from,
        to: report.period.to,
        days: report.period.days,
        activePresetId: presetIdFor(report.period.from, report.period.to),
        invalid: requested.invalid || periodFellBack,
      }
    : // 리포트를 못 읽었으면 표시할 "집계한 구간" 자체가 없다 — 요청값을 그대로 보여 준다
      {
        from: requested.from,
        to: requested.to,
        days: requested.days,
        activePresetId: requested.activePresetId,
        invalid: requested.invalid,
      };

  // 최근에 승인한 카드가 맨 위 — 허브에서 막 승인하고 넘어온 카드를 바로 조작할 수 있게 한다.
  // 타임스탬프는 전부 KST 오프셋(+09:00)이라 문자열 비교로 시간순이 나온다 (05 §8).
  const rows = [...cards].sort((a, b) =>
    (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at),
  );

  /**
   * 카드별 경과 기록 병렬 로딩. `Promise.all`에 reject가 하나라도 섞이면 리포트까지 사라지므로
   * 요청마다 성공/실패 콜백을 붙여 **카드 한 장만** 접는다 — 404(경합 삭제)·401(내부 토큰 미설정)·503 모두 같은 경로다.
   */
  const fetchTargets = rows.slice(0, RECORD_FETCH_LIMIT);
  const cardRecords: CardRecordsResult[] = await Promise.all(
    fetchTargets.map((card) =>
      api.progressRecords(card.id).then(
        (res): CardRecordsResult => ({
          card,
          records: res.records,
          hasMore: Boolean(res.next_cursor),
          failed: false,
        }),
        (): CardRecordsResult => ({ card, records: [], hasMore: false, failed: true }),
      ),
    ),
  );
  const recordsById = new Map(cardRecords.map((entry) => [entry.card.id, entry]));
  const truncated = rows.length - fetchTargets.length;

  // 기록이 0건이면 리포트는 빈 지표의 벽이 된다 — 실제로 조작할 대상(업무 목록)을 위로 올리고
  // 리포트는 "구조는 볼 수 있게" 접어 둔다 (아래 details).
  const hasRecords = report !== null && (report.record_count > 0 || report.recorded_card_count > 0);
  const actionNeeded = report ? report.stale.count + report.cards_without_records : 0;

  const { layers, unclassified } = workflowLayers(rows);

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="cards"
          eyebrow="운영"
          title="추진 경과 리포트"
          lede={
            <>
              담당자가 남긴 실제 경과 기록으로 상태 분포, 정체 항목, 목표일 준수와 관측 성과
              변화를 확인합니다. 예상값은 실제 성과에 섞지 않습니다.
              {/* 데모 표본 고지는 앞 문장(이 화면이 무엇을 보여주는가)과 층이 달라 줄을 나눈다 */}
              <br />
              현재 기록은 데모용 시연 표본입니다.
            </>
          }
          actions={
            <Link
              href="/tracking/new"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-admin-primary px-4 py-2 text-sm font-bold text-white shadow-card transition-colors hover:bg-admin-primary-strong"
            >
              <Icon name="workflow" size={15} />
              추진 기록 입력
            </Link>
          }
        />

        <section aria-label="리포트 기간" className="animate-rise">
          <PeriodFilter {...period} today={today} />
        </section>

        {/* 리포트를 끝까지 읽지 않아도 "지금 손댈 것"이 한 줄로 보이게 한다.
            기록이 0건일 때는 아래 빈 상태 안내가 같은 말을 더 자세히 하므로 중복해서 띄우지 않는다.
            앵커는 ProgressReportDashboard의 `#stale`(정체 점검 Section)·`#unrecorded`(미기록 목록)와 짝이다. */}
        {report === null ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-state-notice-bg px-3.5 py-2.5 text-[13px] font-semibold leading-5 text-state-notice ring-1 ring-inset ring-state-notice-line">
            <Icon name="warn" size={14} />
            추진 경과 리포트를 불러오지 못했습니다 — 담당자 화면 전용 데이터라 내부 조회 권한이
            필요합니다. 아래 업무 목록과 기록 입력은 그대로 사용할 수 있습니다.
          </p>
        ) : null}

        {report && hasRecords && actionNeeded > 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-state-notice-bg px-3.5 py-2.5 text-[13px] font-semibold leading-5 text-state-notice ring-1 ring-inset ring-state-notice-line">
            <span className="flex items-center gap-1.5">
              <Icon name="warn" size={14} />
              조치 필요
            </span>
            {/* 0건인 쪽은 링크를 만들지 않는다 — `#unrecorded` 블록은 미기록이 있을 때만 렌더되므로
                건수가 0인데 링크를 두면 아무 데도 가지 않는 죽은 앵커가 된다 */}
            {report.stale.count > 0 ? (
              <a href="#stale" className="underline underline-offset-4 hover:no-underline">
                정체 {report.stale.count}건
              </a>
            ) : null}
            {report.stale.count > 0 && report.cards_without_records > 0 ? (
              <span aria-hidden className="text-state-notice/50">
                ·
              </span>
            ) : null}
            {report.cards_without_records > 0 ? (
              <a href="#unrecorded" className="underline underline-offset-4 hover:no-underline">
                미기록 {report.cards_without_records}건
              </a>
            ) : null}
            <span className="text-[11px] font-medium text-state-notice/80">
              {report.stale.threshold_days}일 이상 새 기록이 없거나, 승인 후 경과 기록이 한 번도 없는
              카드입니다.
            </span>
          </p>
        ) : null}

        {/* ⚠ ProgressReportDashboard는 여기와 아래 접힌 details 중 **한 곳에서만** 렌더한다 —
            양쪽에 두면 같은 KPI 타일이 화면에 두 번 나온다. */}
        {hasRecords && report ? (
          <ProgressReportDashboard report={report} cardRecords={cardRecords} truncated={truncated} />
        ) : report === null ? null : (
          <div className="rounded-panel border border-dashed border-admin-border bg-admin-surface px-5 py-6 text-center shadow-card">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-admin-surface-sunken text-admin-text-muted">
              <Icon name="report" size={20} />
            </span>
            <p className="mt-3 text-[15px] font-semibold text-admin-text">
              이 기간에는 경과 기록이 0건입니다
            </p>
            <p className="mx-auto mt-1.5 max-w-xl break-keep text-[13px] leading-6 text-admin-text-muted">
              리포트 지표는 담당자가 남긴 실제 기록에서만 계산합니다. 아래 업무 목록에서 카드를 골라 첫
              기록을 남기면 상태 분포·정체 점검·단계별 소요·관측 성과가 차례로 채워집니다.
            </p>
            {rows.length ? (
              <Link
                href={`/tracking/new?card_id=${encodeURIComponent(rows[0].id)}`}
                className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-admin-primary px-4 py-2 text-sm font-bold text-white shadow-card transition-colors hover:bg-admin-primary-strong"
              >
                첫 기록 입력
                <Icon name="arrowRight" size={15} strokeWidth={2} />
              </Link>
            ) : null}
          </div>
        )}

        <Section
          icon="cards"
          title={`진행 중인 업무 항목 ${rows.length}건`}
          desc="가맹점 확충은 후보 접촉·검토 시작 → 적격성 확인 → 가맹 심사 → 추진중 → 완료, 페이백 인센티브는 검토중 → 추진중 → 완료 순서로 기록합니다(양쪽 모두 보류로 빠질 수 있습니다). 확충 카드는 필수 적격성 5개 항목 확인 전에는 가맹 심사·추진·완료로 이동할 수 없습니다."
        >
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken px-4 py-10 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-admin-surface text-admin-text-muted shadow-card">
                <Icon name="cards" size={20} />
              </span>
              <p className="mt-3 text-[15px] font-semibold text-admin-text">
                승인된 카드가 아직 없습니다
              </p>
              {/* 승인 카드만 progress를 가진다 — approved가 아닌 카드에 progress를 보내면 409 (05 §8) */}
              <p className="mx-auto mt-1.5 max-w-md break-keep text-[13px] leading-6 text-admin-text-muted">
                허브에서 카드를 승인해 주세요 — 승인한 카드만 추진 상태를 기록할 수 있습니다.
                {kpi && kpi.counts.pending > 0 ? ` 현재 승인 대기 ${kpi.counts.pending}건.` : ""}
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-admin-primary-strong"
              >
                Action Card 허브로 이동
                <Icon name="arrowRight" size={15} strokeWidth={2} />
              </Link>
            </div>
          ) : (
            <>
              {/* 단계별 집계 — 목업의 "정책 실행 흐름"을 칸반 없이 요약한다 (13 §3).
                  확충과 인센티브는 단계 정의가 다르다 — 한 줄에 섞으면 인센티브 전용 `검토중`이
                  확충 4단계 사이에 설명 없이 끼어 두 워크플로가 하나처럼 읽힌다 (05 §2).
                  두 층의 합 + 분류 외 = 헤더의 N건이어야 한다 (workflowLayers 불변식). */}
              <div className="mb-4 flex flex-col gap-2.5">
                {layers
                  .filter((layer) => layer.total > 0 || rows.some((card) => card.type === layer.type))
                  .map((layer) => (
                    <div
                      key={layer.type}
                      className="rounded-xl border border-admin-border bg-admin-surface-sunken p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="text-[13px] font-bold text-admin-text">
                          {layer.title}{" "}
                          <span className="font-semibold tabular-nums text-admin-text-muted">
                            {layer.total}건
                          </span>
                        </h3>
                        <span className="text-[11px] text-admin-text-muted">{layer.flowLabel}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {layer.stages.map((stage) => (
                          <span
                            key={stage}
                            className="inline-flex items-center gap-2 rounded-full border border-admin-border bg-admin-surface py-1 pl-1 pr-3"
                          >
                            <ProgressChip progress={stage} />
                            <span className="text-[13px] font-semibold tabular-nums text-admin-text">
                              {layer.counts[stage] ?? 0}건
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                {unclassified > 0 ? (
                  <p className="u-note">
                    분류 외 {unclassified}건 — 카드 유형의 단계 목록에 없는 상태값입니다.
                  </p>
                ) : null}
              </div>

              <ul className="flex flex-col gap-3">
                {rows.map((card) => (
                  <li
                    key={card.id}
                    className="flex flex-col gap-4 rounded-xl border border-admin-border p-4 sm:flex-row sm:items-start"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded-md bg-admin-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-admin-text-muted">
                          {card.id}
                        </span>
                        <WorkflowChip card={card} />
                      </div>

                      <h3 className="mt-1.5 break-keep text-[15px] font-bold leading-6 text-admin-text">
                        {card.title}
                      </h3>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-admin-text-muted">
                        <span className="flex items-center gap-1.5">
                          <Icon name="pin" size={14} />
                          대상{" "}
                          <b className="font-semibold text-admin-text">
                            {card.target
                              ? `${card.target.eup} · ${card.target.category}`
                              : "전 지역 공통"}
                          </b>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Icon name="clock" size={14} />
                          {card.type === "EXPANSION" ? "검토 시작" : "승인"}{" "}
                          <span className="tabular-nums">{stamp(card.decided_at)}</span>
                        </span>
                        {/* 확정 rate는 담당자가 승인할 때 고른 값만 존재한다 (05 §2) */}
                        {card.selected_rate ? (
                          <span className="flex items-center gap-1.5">
                            <Icon name="gift" size={14} />
                            확정 페이백률{" "}
                            <b className="font-semibold text-admin-text">{card.selected_rate}%</b>
                          </span>
                        ) : null}
                      </div>

                      <div
                        aria-label="담당자 다음 행동"
                        className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl bg-admin-primary-soft px-3 py-2.5 text-admin-primary ring-1 ring-inset ring-admin-primary-line"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon
                            name={card.progress === "완료" ? "check" : "workflow"}
                            size={15}
                            strokeWidth={2}
                          />
                          <span className="text-[11px] font-bold uppercase tracking-[0.1em]">
                            다음 행동
                          </span>
                          {(() => {
                            const action = nextAction(card);
                            return action.href ? (
                              <Link
                                href={action.href}
                                className="inline-flex items-center gap-1 break-keep text-[13px] font-bold underline underline-offset-4"
                              >
                                {action.label}
                                <Icon name="arrowRight" size={13} strokeWidth={2} />
                              </Link>
                            ) : (
                              <span className="break-keep text-[13px] font-bold">{action.label}</span>
                            );
                          })()}
                        </div>
                        <span className="text-[11px] font-medium text-admin-primary/70">
                          현재 {workflowLabel(card)}
                        </span>
                      </div>

                      {/* 정량 순위 병기 — AI가 순위를 조정해도 원 Score 순위를 감추지 않는다 (절대 규칙 5) */}
                      {card.score_rank !== null && card.ai_rank !== null ? (
                        <div className="mt-3">
                          <RankTrace card={card} />
                        </div>
                      ) : null}

                      {card.progress === "완료" ? <DoneNote card={card} /> : null}

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Link
                          href={`/tracking/new?card_id=${encodeURIComponent(card.id)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-admin-primary-soft px-2.5 py-1.5 text-[13px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line hover:bg-admin-surface"
                        >
                          상세 경과 입력
                          <Icon name="arrowRight" size={14} strokeWidth={2} />
                        </Link>
                        {/* `?from=tracking` — 카드 상세의 되돌아가기가 어디서 왔는지 알아야
                            데모 중 허브로 튕기지 않는다 (11 §1 D4). 값은 화이트리스트로만 해석된다 */}
                        <Link
                          href={`/cards/${card.id}?from=tracking`}
                          className="inline-flex items-center gap-1 text-[13px] font-semibold text-admin-primary underline-offset-4 hover:underline"
                        >
                          제안 근거 전문 보기
                          <Icon name="arrowRight" size={14} strokeWidth={2} />
                        </Link>

                        {/* 인라인 경과 기록 — "왜 정체지?"를 화면을 떠나지 않고 답하게 한다.
                            가장 자주 펼칠 블록이므로 변경 이력·정량 순위보다 앞에 둔다. */}
                        {(() => {
                          const entry = recordsById.get(card.id);
                          return (
                            <details className="min-w-0 basis-full">
                              <summary className="u-disclosure">
                                {entry
                                  ? entry.failed
                                    ? "경과 기록 불러오지 못함"
                                    : `경과 기록 ${entry.records.length}건`
                                  : "경과 기록 (카드 상세에서 확인)"}
                              </summary>
                              {/* 타임라인의 점은 ring-4 ring-admin-surface로 세로선을 끊는다 —
                                  배경이 sunken이면 그 링이 떠 보이므로 surface 위에 얹는다 */}
                              <div className="mt-2 rounded-xl border border-admin-border bg-admin-surface p-3">
                                {entry && !entry.failed ? (
                                  <ProgressRecordTimeline
                                    records={entry.records}
                                    cardId={card.id}
                                    hasMore={entry.hasMore}
                                  />
                                ) : (
                                  <p className="u-note">
                                    {entry
                                      ? "이 카드의 경과 기록을 불러오지 못했습니다."
                                      : `승인 카드가 많아 이 목록에서는 최근 ${RECORD_FETCH_LIMIT}장만 기록을 불러옵니다.`}{" "}
                                    <Link
                                      href={`/cards/${card.id}?from=tracking#progress-history`}
                                      className="font-semibold text-admin-primary underline-offset-4 hover:underline"
                                    >
                                      카드 상세에서 확인
                                    </Link>
                                  </p>
                                )}
                              </div>
                            </details>
                          );
                        })()}

                        {/* 감사 가능성 — 언제 무엇이 바뀌었는지 (05 §7 events). 접어 두고 필요할 때만 편다 */}
                        {card.events?.length ? (
                          <details className="min-w-0 basis-full">
                            <summary className="u-disclosure">
                              변경 이력 {card.events.length}건
                            </summary>
                            <ol className="mt-2 flex flex-col gap-1 rounded-lg bg-admin-surface-sunken px-3 py-2">
                              {card.events.map((e, i) => (
                                <li
                                  key={`${e.at}-${i}`}
                                  className="flex flex-wrap gap-x-2 text-xs leading-5"
                                >
                                  <span className="tabular-nums text-admin-text-muted">
                                    {stamp(e.at)}
                                  </span>
                                  <span className="text-admin-text">{eventLabel(e.action, { compact: true })}</span>
                                </li>
                              ))}
                            </ol>
                          </details>
                        ) : null}

                        {/* 조정 카드는 원 Score 순위 전체도 이 화면에서 펼쳐볼 수 있어야 한다 (절대 규칙 5) */}
                        {card.ai.adjusted && card.ai.original_ranking?.length ? (
                          <details className="min-w-0 basis-full">
                            <summary className="u-disclosure">
                              정량 순위 원본 {card.ai.original_ranking.length}건
                            </summary>
                            <ol className="mt-2 flex flex-col gap-1 rounded-lg bg-admin-surface-sunken px-3 py-2">
                              {card.ai.original_ranking.map((r) => (
                                <li
                                  key={r.rank}
                                  className="flex flex-wrap gap-x-2 text-xs leading-5 text-admin-text-muted"
                                >
                                  <span className="tabular-nums">{r.rank}위</span>
                                  <span className="text-admin-text">{r.candidate}</span>
                                  <span className="tabular-nums">Score {r.score.toFixed(2)}</span>
                                </li>
                              ))}
                            </ol>
                          </details>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 rounded-xl bg-admin-surface-sunken p-3 ring-1 ring-inset ring-admin-border sm:w-52">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-admin-primary">
                        <Icon name="workflow" size={13} /> 실행 기록
                      </p>
                      <ProgressSelect
                        cardId={card.id}
                        cardType={card.type}
                        progress={card.progress}
                        verificationStatus={card.candidate_verification?.status}
                      />
                      <p className="mt-2 text-[10px] leading-4 text-admin-text-muted">빠른 변경도 경과 이력과 리포트에 기록됩니다.</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {/* 기록 0건이면 리포트는 위가 아니라 여기 — 심사위원이 "지표가 어떤 구조인지"는 볼 수 있게
            지우지 않고 접어 둔다. 위쪽 분기와 배타적이라 KPI가 두 번 나오지 않는다. */}
        {!hasRecords && report ? (
          <details className="u-panel px-4 py-3.5 sm:px-5">
            <summary className="u-disclosure">기록이 쌓이면 채워지는 리포트 지표 미리 보기</summary>
            <div className="mt-4">
              <ProgressReportDashboard
                report={report}
                cardRecords={cardRecords}
                truncated={truncated}
              />
            </div>
          </details>
        ) : null}

        {/* ── 정책 운영 KPI — 지역 소비 분석에서 옮겨 왔다(존 재편). 카드 상태값 기반의
            운영 성과라 소비 데이터 진단 화면이 아니라 이 화면의 주제다.
            경과 기록 기반의 위 리포트와 달리 **기간 필터와 무관한 현재 스냅샷**이므로,
            기간 문맥이 닿지 않는 페이지 꼬리에 요약으로 둔다 ── */}
        <Section
          id="kpi"
          icon="report"
          title="정책 운영 KPI"
          desc="Action Card 상태값으로 계산한 지표다. 위 기간 필터와 무관한 전 기간 현재 스냅샷이며, 승인·상태 변경이 일어나면 즉시 바뀐다."
        >
          {kpi === null ? (
            // 값을 0·"—"로 채우면 "채택률 0%"처럼 실제 성과로 오독된다 — 아예 못 불러왔다고 밝힌다
            <FailedChart />
          ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon="check"
              label="채택률"
              value={ratioNum(kpi.adoption_rate)}
              unit={pctUnit(kpi.adoption_rate)}
              sub={`승인 ${kpi.counts.approved} / 결정 ${kpi.counts.decided}장`}
            />
            <KpiCard
              icon="trend"
              label="실행 전환율"
              value={ratioNum(kpi.execution_rate)}
              unit={pctUnit(kpi.execution_rate)}
              sub="승인 카드 중 추진중·완료 비중"
            />
            <KpiCard
              icon="clock"
              label="평균 의사결정 소요"
              value={dash(kpi.avg_decision_hours)}
              unit={kpi.avg_decision_hours === null ? undefined : "시간"}
              sub="승인·반려·보류까지 걸린 시간의 평균"
            />
            <KpiCard
              icon="scale"
              label="지역 균형지수"
              value={dash(kpi.regional_balance_index)}
              unit={kpi.regional_balance_index === null ? undefined : "/ 100"}
              sub={`승인 카드가 여러 지역에 고루 쌓일수록 상승 (현재 승인 ${kpi.counts.approved}건)`}
            />
          </div>
          )}
        </Section>

        {kpi ? (
        <p className="u-note">
          승인 대기 {kpi.counts.pending}건 · 반려 {kpi.counts.rejected}건 · 보류 {kpi.counts.held}
          건은 이 목록에 없습니다 —{" "}
          <Link
            href="/"
            className="font-semibold text-admin-primary underline-offset-4 hover:underline"
          >
            Action Card 허브
          </Link>
          에서 확인합니다.
        </p>
        ) : null}
      </div>
    </AdminShell>
  );
}

/**
 * `다음 행동`은 지금까지 문구뿐이라, 특히 "필수 적격성 5개 항목 확인"이 막다른 길이었다 —
 * 체크리스트는 /cards/[id]에만 있고 이 화면에서는 어디로 가야 하는지 알 수 없었다.
 * 갈 곳이 있는 행동은 링크로 연다.
 *
 * `#verification` 앵커는 카드 상세에서 `EXPANSION && status !== "pending"`일 때만 렌더된다.
 * 이 목록은 승인 카드만 담고 링크 조건도 EXPANSION이라 죽은 앵커로 보내는 경우는 없다.
 * 완료 행은 링크를 만들지 않는다 — 바로 아래 DoneNote가 위젯 필터 조건까지 따져 더 나은 링크를 준다.
 */
const nextAction = (card: Card): { label: string; href?: string } => {
  if (card.progress === "완료") return { label: "방문객 위젯 반영 확인" };
  if (card.type === "EXPANSION" && eligibilityStatus(card) !== "verified") {
    return { label: "필수 적격성 5개 항목 확인", href: `/cards/${card.id}?from=tracking#verification` };
  }
  return {
    label: "추진 상태 업데이트",
    href: `/tracking/new?card_id=${encodeURIComponent(card.id)}`,
  };
};

/**
 * 완료 행의 위젯 연결 — 데모 6→7단계의 인과를 화면에서 읽히게 하는 블록 (08 F8).
 *
 * 링크는 **업종 없이 지역만** 건다: 위젯은 완료 카드와 매칭되는 가맹점을 먼저 정렬하므로(05 §4)
 * 지역만 걸어도 `이번 분기 확충 업종` 배지가 상단에 오고, 확충 대상이 가맹점 공백 업종이라 업종까지 걸면
 * 매칭 가맹점이 0곳인 경우 빈 상태로 떨어질 수 있다.
 */
function DoneNote({ card }: { card: Card }) {
  const eup = card.target?.eup;
  // 위젯 필터는 6지역·표시 6분류만 받는다 — 그 밖의 값이면 필터 없이 위젯을 연다
  const region = eup && REGIONS.some((r) => r === eup) ? eup : undefined;
  const href = region ? `/widget?${new URLSearchParams({ region })}` : "/widget";

  return (
    <div className="mt-3 rounded-xl bg-state-good-bg px-3.5 py-3 ring-1 ring-inset ring-state-good-line">
      <p className="flex items-start gap-2 break-keep text-[13px] leading-5 text-admin-text">
        <Icon name="check" size={15} strokeWidth={2} className="mt-0.5 text-state-good" />
        <span>
          {card.type === "INCENTIVE"
            ? card.selected_rate
              ? `완료 — 방문객 위젯 추천에 "지금 여기서 쓰면 ${card.selected_rate}% 페이백" 배지가 전 지역 공통으로 붙습니다.`
              : "완료 — 페이백률이 확정되지 않아 위젯 배지는 붙지 않습니다."
            : card.target
              ? `완료 — 방문객 위젯에서 ${card.target.eup} ${card.target.category} 업종이 확충 업종 배지와 함께 추천 상단에 노출됩니다.`
              : "완료 — 방문객 위젯 추천에 반영됩니다."}
        </span>
      </p>
      <Link
        href={href}
        className="mt-1.5 inline-flex items-center gap-1 pl-[23px] text-[13px] font-semibold text-state-good underline-offset-4 hover:underline"
      >
        방문객 위젯에서 확인
        <Icon name="arrowRight" size={14} strokeWidth={2} />
      </Link>
    </div>
  );
}

/**
 * "2026-08-03T12:00:00+09:00" → "2026.08.03 12:00".
 * 저장값이 이미 KST(+09:00)라 Date로 파싱하지 않는다 — 파싱하면 브라우저 타임존에 따라
 * 서버 렌더와 클라이언트 렌더가 어긋난다 (05 §8 시각 표기 규칙).
 */
const stamp = (iso: string | null): string =>
  iso && iso.length >= 16 ? `${iso.slice(0, 10).replace(/-/g, ".")} ${iso.slice(11, 16)}` : "—";
