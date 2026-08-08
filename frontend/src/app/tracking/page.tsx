import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { ProgressReportDashboard } from "@/components/ProgressReportDashboard";
import { ProgressSelect } from "@/components/ProgressSelect";
import { RankTrace } from "@/components/RankTrace";
import { Section } from "@/components/Section";
import { ProgressChip, WorkflowChip } from "@/components/StatusChip";
import { api } from "@/lib/api";
import { eligibilityStatus, normalizedProgress, workflowLabel } from "@/lib/cardWorkflow";
import { REGIONS } from "@/lib/constants";
import type { Card, CardProgress } from "@/types";

export const metadata: Metadata = { title: "추진 경과 리포트 · 상생 나침반" };

// 상태를 바꾸면 KPI·완료 안내가 곧바로 달라져야 한다 (데모 6→7단계) — 캐시하지 않는다
export const dynamic = "force-dynamic";

/**
 * 단계 칩 순서 — 확충 흐름 순서 뒤에 인센티브 전용 `검토중`을 둔다.
 * 빠뜨리면 인센티브 승인 카드가 목록에는 있는데 어느 칩에도 안 잡혀
 * 헤더의 "N건"과 칩 합계가 어긋난다 (normalizedProgress는 EXPANSION의 검토중만 재작성한다).
 */
const STAGES: CardProgress[] = [
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "검토중",
  "추진중",
  "보류",
  "완료",
];

/**
 * ⑥ 실행 상태 트래킹 (docs/plan/08 F8 · 13 §3 "정책 카드 관리").
 *
 * 서버 컴포넌트다 — mock JSON은 서버에서만 읽히고, 상태 변경만 `ProgressSelect`(클라이언트)가
 * 서버 액션으로 호출한다. 칸반 열이 아니라 **행 + 셀렉트**인 이유는 ProgressSelect 주석 참고.
 *
 * 이 화면이 데모의 방아쇠다: 카드를 `완료`로 바꾸면 방문객 위젯 추천에 `이번 분기 확충 업종` 배지가 붙는다(05 §4).
 * 그 인과가 화면에서 읽히도록 완료 행마다 위젯 링크와 한 줄 설명을 둔다.
 */
export default async function TrackingPage() {
  const [dashboard, { cards }, kpi, report] = await Promise.all([
    api.dashboard(),
    api.cards({ status: "approved" }),
    api.kpi(),
    api.progressReport(),
  ]);

  // 최근에 승인한 카드가 맨 위 — 허브에서 막 승인하고 넘어온 카드를 바로 조작할 수 있게 한다.
  // 타임스탬프는 전부 KST 오프셋(+09:00)이라 문자열 비교로 시간순이 나온다 (05 §8).
  const rows = [...cards].sort((a, b) =>
    (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at),
  );
  const stageCount = (p: CardProgress) => rows.filter((card) => normalizedProgress(card) === p).length;
  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="cards"
          eyebrow="운영"
          title="추진 경과 리포트"
          lede="담당자가 남긴 실제 경과 기록으로 상태 분포, 정체 항목, 목표일 준수와 관측 성과 변화를 확인합니다. 예상값은 실제 성과에 섞지 않습니다."
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

        <ProgressReportDashboard report={report} />

        <Section
          icon="cards"
          title={`진행 중인 업무 항목 ${rows.length}건`}
          desc="확충 카드는 후보 접촉·검토 시작 → 적격성 확인 → 가맹 심사 → 추진중 → 완료 순서로 기록합니다. 필수 적격성 5개 항목 확인 전에는 가맹 심사·추진·완료로 이동할 수 없습니다."
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
                {kpi.counts.pending > 0 ? ` 현재 승인 대기 ${kpi.counts.pending}건.` : ""}
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
              {/* 단계별 집계 — 목업의 "정책 실행 흐름"을 칸반 없이 요약한다 (13 §3) */}
              <div className="mb-4 flex flex-wrap gap-2">
                {STAGES.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-2 rounded-full border border-admin-border bg-admin-surface-sunken py-1 pl-1 pr-3"
                  >
                    <ProgressChip progress={s} />
                    <span className="text-[13px] font-semibold tabular-nums text-admin-text">
                      {stageCount(s)}건
                    </span>
                  </span>
                ))}
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
                          <span className="break-keep text-[13px] font-bold">
                            {card.progress === "완료"
                              ? "방문객 위젯 반영 확인"
                              : card.type === "EXPANSION" && eligibilityStatus(card) !== "verified"
                                ? "필수 적격성 5개 항목 확인"
                                : "추진 상태 업데이트"}
                          </span>
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
                        <Link
                          href={`/cards/${card.id}`}
                          className="inline-flex items-center gap-1 text-[13px] font-semibold text-admin-primary underline-offset-4 hover:underline"
                        >
                          제안 근거 전문 보기
                          <Icon name="arrowRight" size={14} strokeWidth={2} />
                        </Link>

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
                                  <span className="text-admin-text">{eventLabel(e.action)}</span>
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
      </div>
    </AdminShell>
  );
}

/**
 * 완료 행의 위젯 연결 — 데모 6→7단계의 인과를 화면에서 읽히게 하는 블록 (08 F8).
 *
 * 링크는 **업종 없이 지역만** 건다: 위젯은 완료 카드와 매칭되는 가맹점을 먼저 정렬하므로(05 §4)
 * 지역만 걸어도 `신규` 배지가 상단에 오고, 확충 대상이 가맹점 공백 업종이라 업종까지 걸면
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

const EVENT_LABEL: Record<string, string> = {
  generated: "카드 생성",
  approved: "승인",
  rejected: "반려",
  held: "보류",
};

/** `progress:완료` 같은 접두 형식을 사람이 읽는 문구로 (05 §7) */
const eventLabel = (action: string): string =>
  action.startsWith("progress:")
    ? `추진 상태 → ${action.slice("progress:".length)}`
    : (EVENT_LABEL[action] ?? action);

/**
 * "2026-08-03T12:00:00+09:00" → "2026.08.03 12:00".
 * 저장값이 이미 KST(+09:00)라 Date로 파싱하지 않는다 — 파싱하면 브라우저 타임존에 따라
 * 서버 렌더와 클라이언트 렌더가 어긋난다 (05 §8 시각 표기 규칙).
 */
const stamp = (iso: string | null): string =>
  iso && iso.length >= 16 ? `${iso.slice(0, 10).replace(/-/g, ".")} ${iso.slice(11, 16)}` : "—";
