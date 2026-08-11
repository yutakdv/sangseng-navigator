import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { DissentList, hasDissent } from "@/components/DissentList";
import { Icon } from "@/components/Icon";
import { Act, Panel } from "@/components/Panel";
import { DecisionBar } from "@/components/proposals/DecisionBar";
import { EvidenceSections } from "@/components/proposals/EvidenceSections";
import { ProposalSummary } from "@/components/proposals/ProposalSummary";
import { api } from "@/lib/api";
import { eventActorLabel, eventLabel, hasGeneratedEvent } from "@/lib/cardEvents";
import { composeEvidence } from "@/lib/dashboardView";
import { ApiError } from "@/lib/errors";
import type { Card, CardEvent } from "@/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  /**
   * 없는 카드는 여기서 걸러야 **응답 코드까지** 404가 된다 — 본문에서 notFound()를 부르면
   * loading.tsx가 이미 200으로 셸을 흘려보낸 뒤라 상태 코드를 바꿀 수 없고, 제목도
   * "AC-999 제안 검토"로 남아 없는 카드가 있는 것처럼 읽힌다.
   * BE 장애(404 외 오류)는 여기서 판단하지 않고 본문의 에러 경계로 넘긴다.
   */
  if (!(await getCard(id))) notFound();
  return { title: `${id} 제안 검토 · 상생 나침반` };
}

/** 카드 한 장 — generateMetadata와 본문이 같은 요청 안에서 한 번만 부르도록 캐시한다 */
const getCard = cache(async (id: string) =>
  api
    .card(id)
    .then((r) => r.card)
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404) return undefined;
      throw error;
    }),
);

/**
 * 제안 상세 — GitHub PR 패턴의 "상세" 쪽 (허브 카드는 미리보기, 여기가 전문이다).
 *
 * 위에서 아래로: ① 제안 요약(허브 카드와 같은 정보) → ② 근거(허브 02막 이동) →
 * ③ 전망(허브 03막 이동) → ⑤ 변경 이력. ④ 결정 바는 본문 흐름이 아니라 하단 고정 —
 * 스크롤 어디서든 승인·반려·보류가 보이는 것이 이 페이지의 존재 이유다 (절대 규칙 4).
 *
 * 서버 컴포넌트. 차트(RegionTrend)와 결정 바(버튼 인터랙션)만 "use client"다.
 * 지도·후보 정밀 검토는 기존 /cards/[id]가 맡고, 근거 막에서 링크로 잇는다.
 */
export default async function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [dashboard, candidates, card] = await Promise.all([
    api.dashboard(),
    api.candidates(),
    getCard(id),
  ]);

  if (!card) notFound();

  const evidence = composeEvidence(dashboard, candidates, card);
  const showDissent = hasDissent(card);
  // 반대 관점 막을 끼워 넣으면 뒤따르는 이력 막 번호가 밀린다 — 없는 카드에서는 그대로 03을 쓴다
  const historyActNo = showDissent ? "04" : "03";

  return (
    <AdminShell dashboard={dashboard}>
      {/* 하단 고정 결정 바에 가리지 않도록 본문에 바 높이만큼 바닥 여백을 준다 */}
      <div className="mx-auto flex max-w-5xl flex-col gap-8 pb-32">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-admin-text-muted underline-offset-4 hover:text-admin-primary hover:underline"
        >
          <Icon name="chevronRight" size={14} strokeWidth={2} className="rotate-180" />
          허브로
        </Link>

        {/* ── ① 제안 요약 — 허브 카드와 같은 정보. 그림자를 갖는 유일한 면 ── */}
        <header className="rounded-panel bg-admin-surface p-5 shadow-lift sm:p-7">
          <ProposalSummary
            card={card}
            ranking={evidence.ranking}
            dashboard={dashboard}
            leadBadge={
              /* 결정 후에는 "승인 전 검토 대상"이 옆의 상태 칩과 모순된다 — 결정 종류(승인·반려·보류)는
                 상태 칩이 말하므로 여기는 AI 제안 출처만 중립적으로 남긴다 */
              <span className="rounded-md bg-admin-primary px-2.5 py-1 text-xs font-bold text-white">
                {card.status === "pending" ? "AI 제안 · 승인 전 검토 대상" : "AI 제안 · 담당자 결정 완료"}
              </span>
            }
          />
        </header>

        {/* ── ② 근거 · ③ 전망 — 허브 02·03막의 이동 ── */}
        <EvidenceSections card={card} dashboard={dashboard} evidence={evidence} />

        {/* ── 반대 관점 — 하단 고정 결정 바를 누르기 전 마지막 본문 막 (v4.1 C3 · 절대 규칙 4) ── */}
        {showDissent ? (
          <Act
            no="03"
            phase="반론"
            question="이 제안이 틀릴 수 있는 이유는?"
            title="반대 관점을 확인합니다"
          >
            <Panel
              id="dissent"
              icon="warn"
              title="반대 관점"
              desc="이 제안이 틀릴 수 있는 이유입니다 — 승인 전에 확인하세요."
            >
              <DissentList card={card} />
            </Panel>
          </Act>
        ) : null}

        {/* ── ⑤ 변경 이력 ── */}
        <Act no={historyActNo} phase="이력" question="이 카드에 무슨 일이 있었나" title="결정·상태 변경 기록" last>
          <Panel
            icon="clock"
            title="변경 기록"
            desc="생성·결정·상태 변경이 시간순으로 남습니다. 추진 경과 메모는 정책 트래킹에서 기록합니다."
          >
            <HistoryList
              createdAt={card.created_at}
              decidedAt={card.decided_at}
              events={card.events ?? []}
              decision={card.decision}
            />
          </Panel>
        </Act>
      </div>

      {/* ── ④ 결정 바 — 하단 고정 (그린/레드/앰버 상태색) ── */}
      <DecisionBar
        cardId={card.id}
        cardType={card.type}
        status={card.status}
        initialRate={card.selected_rate ?? null}
        confidence={card.confidence}
        version={card.version}
      />
    </AdminShell>
  );
}

/** 변경 이력 목록 — 생성 시각은 카드에 항상 있으므로 첫 행으로 합성한다 */
function HistoryList({
  createdAt,
  decidedAt,
  events,
  decision,
}: {
  createdAt: string;
  decidedAt: string | null;
  events: CardEvent[];
  /** 결정 기록 — 신원 미검증 표기의 근거다 (05 §2) */
  decision?: Card["decision"];
}) {
  // 서버가 `generated` 이벤트를 주면 합성하지 않는다 — 같은 시각의 생성 행이 두 줄로 겹친다.
  // 내부 문자열(`generated`·`progress:추진중`)을 그대로 찍지 않도록 전부 eventLabel을 거친다.
  const rows = [
    ...(hasGeneratedEvent(events)
      ? []
      : [{ at: createdAt, action: "제안 카드 생성 — 담당자 검토 대기", actor: null, reason: null }]),
    ...events.map((event) => ({
      at: event.at,
      action: eventLabel(event),
      actor: eventActorLabel(event, decision),
      reason: event.reason ?? null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div>
      <ol className="divide-y divide-admin-border border-y border-admin-border">
        {rows.map((row, index) => (
          <li key={`${row.at}-${index}`} className="flex items-start gap-3 py-3">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-admin-primary" />
            <div className="min-w-0 flex-1">
              <p className="break-keep text-[13px] font-semibold leading-6 text-admin-text">{row.action}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-admin-text-muted">
                <span className="tabular-nums">{stamp(row.at)}</span>
                {/* 누가 결정했는지를 지우지 않는다 — 계정 체계가 없다는 사실도 함께 적는다 */}
                {row.actor ? <span>{row.actor}</span> : null}
              </p>
              {row.reason ? (
                <p className="mt-1 break-keep text-xs leading-5 text-admin-text-soft">
                  사유 {row.reason}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {rows.length === 1 && !decidedAt ? (
        <p className="mt-3 break-keep text-xs leading-5 text-admin-text-muted">
          아직 결정 기록이 없습니다. 아래 결정 바에서 승인·반려·보류하면 여기에 기록됩니다.
        </p>
      ) : null}
    </div>
  );
}

const stamp = (iso: string): string =>
  iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
