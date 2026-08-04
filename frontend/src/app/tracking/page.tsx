import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { KpiCard } from "@/components/KpiCard";
import { ProgressSelect } from "@/components/ProgressSelect";
import { Section } from "@/components/Section";
import { ProgressChip, StatusChip } from "@/components/StatusChip";
import { api } from "@/lib/api";
import { REGIONS } from "@/lib/constants";
import { dash, ratioPct } from "@/lib/format";
import type { Card, CardProgress } from "@/types";

export const metadata: Metadata = { title: "정책 카드 관리 · 상생 나침반" };

// 상태를 바꾸면 KPI·완료 안내가 곧바로 달라져야 한다 (데모 6→7단계) — 캐시하지 않는다
export const dynamic = "force-dynamic";

/** 4단계 고정 순서 — 05 §2. 단계별 집계 칩의 나열 순서이기도 하다 */
const STAGES: CardProgress[] = ["검토중", "추진중", "보류", "완료"];

/**
 * ⑥ 실행 상태 트래킹 (docs/plan/08 F8 · 13 §3 "정책 카드 관리").
 *
 * 서버 컴포넌트다 — mock JSON은 서버에서만 읽히고, 상태 변경만 `ProgressSelect`(클라이언트)가
 * 서버 액션으로 호출한다. 칸반 열이 아니라 **행 + 셀렉트**인 이유는 ProgressSelect 주석 참고.
 *
 * 이 화면이 데모의 방아쇠다: 카드를 `완료`로 바꾸면 방문객 위젯 추천에 `신규` 배지가 붙는다(05 §4).
 * 그 인과가 화면에서 읽히도록 완료 행마다 위젯 링크와 한 줄 설명을 둔다.
 */
export default async function TrackingPage() {
  const [dashboard, { cards }, kpi] = await Promise.all([
    api.dashboard(),
    api.cards({ status: "approved" }),
    api.kpi(),
  ]);

  // 최근에 승인한 카드가 맨 위 — 허브에서 막 승인하고 넘어온 카드를 바로 조작할 수 있게 한다.
  // 타임스탬프는 전부 KST 오프셋(+09:00)이라 문자열 비교로 시간순이 나온다 (05 §8).
  const rows = [...cards].sort((a, b) =>
    (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at),
  );
  const stageCount = (p: CardProgress) => rows.filter((c) => (c.progress ?? "검토중") === p).length;

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-admin-text">정책 카드 관리</h2>
          <p className="mt-0.5 break-keep text-sm text-admin-text-muted">
            승인된 카드의 추진 상태를 담당자가 기록하는 화면입니다. AI 제안은 승인 시점에 확정됐고,
            여기서 바뀌는 것은 담당자가 남기는 추진 기록입니다.
          </p>
        </div>

        {/* ── 운영 KPI — 상태를 바꾸면 실행 전환율이 즉시 움직인다 (05 §3) ── */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="채택률"
            value={ratioPct(kpi.adoption_rate)}
            sub={`승인 ${kpi.counts.approved} / 전체 ${kpi.counts.total}장`}
          />
          <KpiCard
            label="실행 전환율"
            value={ratioPct(kpi.execution_rate)}
            sub="승인 카드 중 추진중·완료 비중 — 검토중·보류를 추진중으로 바꾸면 즉시 올라갑니다"
          />
          <KpiCard
            label="평균 의사결정 소요"
            value={dash(kpi.avg_approval_hours)}
            unit={kpi.avg_approval_hours === null ? undefined : "시간"}
            sub="승인·반려·보류까지 걸린 시간의 평균"
          />
          <KpiCard
            label="지역 균형지수"
            value={dash(kpi.regional_balance_index)}
            unit={kpi.regional_balance_index === null ? undefined : "/ 100"}
            sub={`승인 카드가 여러 지역에 고루 쌓일수록 상승 (현재 승인 ${kpi.counts.approved}건)`}
          />
        </div>

        <Section
          title={`승인 카드 ${rows.length}건`}
          desc="추진 상태는 검토중·추진중·보류·완료 4단계로 기록합니다. 완료로 바꾸면 그 카드의 (읍×업종)과 매칭되는 가맹점이 방문객 위젯에서 신규 배지와 함께 추천 상단에 노출됩니다."
        >
          {rows.length === 0 ? (
            <div className="rounded-lg bg-admin-bg px-4 py-8 text-center">
              <p className="text-sm font-medium text-admin-text">승인된 카드가 아직 없습니다</p>
              {/* 승인 카드만 progress를 가진다 — approved가 아닌 카드에 progress를 보내면 409 (05 §8) */}
              <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">
                허브에서 카드를 승인해 주세요 — 승인한 카드만 추진 상태를 기록할 수 있습니다.
                {kpi.counts.pending > 0 ? ` 현재 승인 대기 ${kpi.counts.pending}건.` : ""}
              </p>
              <Link
                href="/"
                className="mt-3 inline-block rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-admin-sidebar-active"
              >
                Action Card 허브로 이동
              </Link>
            </div>
          ) : (
            <>
              {/* 단계별 집계 — 목업의 "정책 실행 흐름"을 칸반 없이 요약한다 (13 §3) */}
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {STAGES.map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <ProgressChip progress={s} />
                    <span className="text-xs tabular-nums text-admin-text-muted">
                      {stageCount(s)}건
                    </span>
                  </span>
                ))}
              </div>

              <ul className="flex flex-col">
                {rows.map((card) => (
                  <li
                    key={card.id}
                    className="flex flex-col gap-3 border-t border-black/5 py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs tabular-nums text-admin-text-muted">{card.id}</span>
                        <h3 className="min-w-0 break-keep text-sm font-semibold text-admin-text">
                          {card.title}
                        </h3>
                        <StatusChip status={card.status} />
                        {card.progress ? <ProgressChip progress={card.progress} /> : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-text-muted">
                        <span>
                          대상{" "}
                          <span className="font-medium text-admin-text">
                            {card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통"}
                          </span>
                        </span>
                        <span>
                          승인 <span className="tabular-nums">{stamp(card.decided_at)}</span>
                        </span>
                        {/* 확정 rate는 담당자가 승인할 때 고른 값만 존재한다 (05 §2) */}
                        {card.selected_rate ? (
                          <span>
                            확정 페이백률{" "}
                            <span className="font-medium text-admin-text">{card.selected_rate}%</span>
                          </span>
                        ) : null}
                      </div>

                      {/* 정량 순위 병기 — AI가 순위를 조정해도 원 Score 순위를 감추지 않는다 (절대 규칙 5) */}
                      {card.score_rank !== null && card.ai_rank !== null ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center rounded-lg px-2 py-1 text-xs tabular-nums ${
                              card.ai.adjusted
                                ? "bg-admin-primary-soft font-semibold text-admin-primary"
                                : "bg-admin-bg text-admin-text-muted"
                            }`}
                          >
                            Score {card.score_rank}위 → AI 제안 {card.ai_rank}위
                          </span>
                          {/* 색만으로 의미를 전달하지 않는다 (13 §4) */}
                          <span className="text-[11px] text-admin-text-muted">
                            {card.ai.adjusted ? "AI 조정 제안" : "정량 1순위와 동일"}
                          </span>
                        </div>
                      ) : null}

                      {card.progress === "완료" ? <DoneNote card={card} /> : null}

                      <div className="mt-2">
                        <Link
                          href={`/cards/${card.id}`}
                          className="text-xs font-medium text-admin-primary underline-offset-2 hover:underline"
                        >
                          제안 근거 전문 보기 →
                        </Link>
                      </div>

                      {/* 감사 가능성 — 언제 무엇이 바뀌었는지 (05 §7 events). 접어 두고 필요할 때만 편다 */}
                      {card.events?.length ? (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs text-admin-text-muted underline-offset-2 hover:underline">
                            변경 이력 {card.events.length}건
                          </summary>
                          <ol className="mt-1.5 flex flex-col gap-1">
                            {card.events.map((e, i) => (
                              <li
                                key={`${e.at}-${i}`}
                                className="flex flex-wrap gap-x-2 text-[11px] leading-4"
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
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs text-admin-text-muted underline-offset-2 hover:underline">
                            정량 순위 원본 {card.ai.original_ranking.length}건
                          </summary>
                          <ol className="mt-1.5 flex flex-col gap-1">
                            {card.ai.original_ranking.map((r) => (
                              <li
                                key={r.rank}
                                className="flex flex-wrap gap-x-2 text-[11px] leading-4 text-admin-text-muted"
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

                    <div className="shrink-0 sm:w-40">
                      <ProgressSelect cardId={card.id} progress={card.progress} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <p className="break-keep text-xs leading-5 text-admin-text-muted">
          승인 대기 {kpi.counts.pending}건 · 반려 {kpi.counts.rejected}건 · 보류 {kpi.counts.held}건은
          이 목록에 없습니다 —{" "}
          <Link href="/" className="text-admin-primary underline-offset-2 hover:underline">
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
    <div className="mt-2 rounded-lg bg-state-good-bg px-3 py-2">
      <p className="break-keep text-[11px] leading-4 text-admin-text">
        {card.type === "INCENTIVE"
          ? card.selected_rate
            ? `완료 — 방문객 위젯 추천에 "지금 여기서 쓰면 ${card.selected_rate}% 페이백" 배지가 전 지역 공통으로 붙습니다.`
            : "완료 — 페이백률이 확정되지 않아 위젯 배지는 붙지 않습니다."
          : card.target
            ? `완료 — 방문객 위젯에서 ${card.target.eup} ${card.target.category} 가맹점에 신규 배지가 붙고 추천 상단에 노출됩니다.`
            : "완료 — 방문객 위젯 추천에 반영됩니다."}
      </p>
      <Link
        href={href}
        className="mt-1 inline-block text-[11px] font-medium text-state-good underline-offset-2 hover:underline"
      >
        방문객 위젯에서 확인 →
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
