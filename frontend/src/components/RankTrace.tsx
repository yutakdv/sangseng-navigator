import { Icon } from "@/components/Icon";
import type { Card, SelectionReason } from "@/types";

/** 선택 사유 코드 → 배지 문구 (05 §2). 코드가 없으면 순위로 추론한다. */
const REASON_LABEL: Record<SelectionReason, string> = {
  top_score: "정량 1순위 선택",
  exclude_in_progress: "진행 중인 건 제외하고 선택",
  region_quota: "지역 배분 몫에서 선택",
};

/**
 * 사유를 단정할 수 있을 때만 배지를 만든다.
 *
 * 예전에는 `adjusted` 하나로 두 문구를 갈랐는데, 그러면 정량 4·5위 카드에도 "정량 1순위 선택"이
 * 붙어 같은 화면의 순위 표시·근거문과 정면으로 모순된다. 사유를 알 수 없으면 아무 말도 하지 않는
 * 편이 낫다 — 틀린 근거를 적는 것이 이 장치가 막으려는 오류 그 자체다.
 */
function badgeLabel(card: Card, selectionRank: number): string | null {
  const reason = card.ai.selection_reason;
  if (reason) return REASON_LABEL[reason] ?? null;
  if (card.score_rank === 1 && selectionRank === 1) return REASON_LABEL.top_score;
  if (card.ai.adjusted && selectionRank === 1) return REASON_LABEL.exclude_in_progress;
  return null;
}

/**
 * `후보 스코어 N위 → 선택 가능한 후보 M위` 병기 — 진행 중인 업무 중복 제외를 숨기지 않는다.
 *
 * 허브 목록·트래킹·카드 상세 세 곳에서 같은 표기를 쓰는데, 세 곳 모두 회색 알약 안에 12px
 * 한 줄로 눌려 있어서 심사에서 가장 중요한 "감사 가능성" 장치가 화면에서 가장 안 보였다.
 * 두 값을 각각의 상자에 나눠 넣고 화살표로 이어 놓아, 무엇이 정량 순위이고 무엇이 서버 선택인지
 * 라벨과 함께 읽히게 한다. 제외 여부는 색이 아니라 **문구**가 진다 (13 §4).
 *
 * 왼쪽 값은 **2단계 후보 스코어**(`card.score_rank`)다 — 1단계 읍·시 스코어와 층위가 달라
 * 둘 다 "정량 Score"로 부르면 같은 화면(/proposals/[id])에서 같은 값처럼 읽힌다.
 */
export function RankTrace({ card, size = "sm" }: { card: Card; size?: "sm" | "md" }) {
  if (card.score_rank === null || card.ai_rank === null) return null;

  const md = size === "md";
  const adjusted = card.ai.adjusted;
  const selectionRank = card.selection_rank ?? card.ai_rank;
  const label = badgeLabel(card, selectionRank);

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 ring-1 ring-inset ${
        adjusted
          ? "bg-admin-primary-soft ring-admin-primary-line"
          : "bg-admin-surface-sunken ring-admin-border"
      }`}
    >
      <RankBox
        label="후보 스코어"
        rank={card.score_rank}
        md={md}
        tone="text-admin-text-muted"
      />
      <Icon
        name="arrowRight"
        size={md ? 18 : 16}
        strokeWidth={2}
        className={adjusted ? "text-admin-primary" : "text-admin-text-muted"}
      />
      <RankBox
        label="선택 가능한 후보"
        rank={selectionRank}
        md={md}
        tone={adjusted ? "text-admin-primary" : "text-admin-text"}
      />
      {label ? (
        <span
          className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            adjusted
              ? "bg-admin-surface text-admin-primary ring-admin-primary-line"
              : "bg-admin-surface text-admin-text-muted ring-admin-border"
          }`}
        >
          {adjusted ? <Icon name="workflow" size={12} strokeWidth={2} /> : null}
          {label}
        </span>
      ) : null}
    </div>
  );
}

function RankBox({
  label,
  rank,
  md,
  tone,
}: {
  label: string;
  rank: number;
  md: boolean;
  tone: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-admin-text-muted">
        {label}
      </p>
      <p className={`font-bold tabular-nums ${md ? "text-xl" : "text-base"} leading-6 ${tone}`}>
        {rank}위
      </p>
    </div>
  );
}
