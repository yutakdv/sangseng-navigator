import { Icon } from "@/components/Icon";
import type { Card } from "@/types";

/**
 * `정량 Score N위 → AI 제안 M위` 병기 — **절대 규칙 5(정량 순위 병기)의 화면 구현**.
 *
 * 허브 목록·트래킹·카드 상세 세 곳에서 같은 표기를 쓰는데, 세 곳 모두 회색 알약 안에 12px
 * 한 줄로 눌려 있어서 심사에서 가장 중요한 "감사 가능성" 장치가 화면에서 가장 안 보였다.
 * 두 값을 각각의 상자에 나눠 넣고 화살표로 이어 놓아, 무엇이 정량 순위이고 무엇이 AI 제안인지
 * 라벨과 함께 읽히게 한다. 조정 여부는 색이 아니라 **문구**가 진다 (13 §4).
 */
export function RankTrace({ card, size = "sm" }: { card: Card; size?: "sm" | "md" }) {
  if (card.score_rank === null || card.ai_rank === null) return null;

  const md = size === "md";
  const adjusted = card.ai.adjusted;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 ring-1 ring-inset ${
        adjusted
          ? "bg-admin-primary-soft ring-admin-primary-line"
          : "bg-admin-surface-sunken ring-admin-border"
      }`}
    >
      <RankBox
        label="정량 Score"
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
        label="AI 제안"
        rank={card.ai_rank}
        md={md}
        tone={adjusted ? "text-admin-primary" : "text-admin-text"}
      />
      <span
        className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
          adjusted
            ? "bg-admin-surface text-admin-primary ring-admin-primary-line"
            : "bg-admin-surface text-admin-text-muted ring-admin-border"
        }`}
      >
        {adjusted ? <Icon name="sparkle" size={12} strokeWidth={2} /> : null}
        {adjusted ? "AI 조정 제안" : "정량 1순위와 동일"}
      </span>
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
