import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { Card } from "@/types";

/**
 * AI 정책 브리핑 (docs/plan/13 §3 — 목업 image-1의 "AI 정책 브리핑" 패널).
 *
 * 히어로가 "무엇을 결정할 것인가"라면 이 패널은 **"왜 그 판단인가"** 다. 근거·리스크가
 * 카드 상세에는 문단으로 실려 있는데, 허브에서 문단을 그대로 옮기면 담당자가 결정 직전에
 * 읽어야 할 항목이 눈에 들어오지 않는다 — 그래서 목업대로 **체크리스트 형태**로 낸다.
 *
 * 근거와 리스크를 같은 패널에 둔 이유: 승인 버튼 바로 옆에서 둘을 함께 봐야 "AI가 좋다고 한
 * 이유"와 "그럼에도 남는 위험"이 한 번에 저울질된다. 리스크를 접거나 아래로 밀면 브리핑이
 * 설득 자료가 되어 버린다 (절대 규칙 4 — AI는 제안까지).
 *
 * 문장은 카드가 들고 있는 값을 **자르지 않고** 싣는다. 길다고 요약하면 근거의 단서(수치·조건)가
 * 먼저 떨어져 나간다.
 */
export function BriefingPanel({ card, className = "" }: { card: Card; className?: string }) {
  const reasons = card.ai.reasons ?? [];
  const risks = card.ai.risks ?? [];

  return (
    <section
      style={{ animationDelay: "120ms" }}
      className={`u-float animate-rise flex flex-col overflow-hidden ${className}`}
      aria-label="AI 정책 브리핑"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-admin-border bg-gradient-to-r from-admin-primary-soft to-admin-surface px-5 py-4 2xl:px-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-primary text-white shadow-[0_6px_16px_-6px_rgb(79_70_229)]">
          <Icon name="sparkle" size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h3 className="u-panel-title">AI 정책 브리핑</h3>
          <p className="text-xs leading-4 text-admin-text-muted">{card.id} · 오늘의 핵심 요약</p>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col gap-5 px-5 py-5 2xl:px-6">
        <ChecklistGroup
          tone="good"
          icon="check"
          title="왜 이 제안인가"
          count={reasons.length}
          items={reasons}
        />
        <ChecklistGroup
          tone="warn"
          icon="warn"
          title="남는 리스크"
          count={risks.length}
          items={risks}
        />

      </div>

      <div className="mt-auto border-t border-admin-border px-5 py-4 2xl:px-6">
        <Link
          href={`/cards/${card.id}`}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-admin-surface px-4 py-2.5 text-sm font-bold text-admin-primary ring-1 ring-inset ring-admin-primary-line transition-colors hover:bg-admin-primary-soft"
        >
          브리핑 전문 보기
          <Icon name="arrowRight" size={15} strokeWidth={2} />
        </Link>
        <p className="u-note mt-2.5">
          근거 {reasons.length}건 · 리스크 {risks.length}건 · 출처 {card.sources.join(" · ")}
        </p>
      </div>
    </section>
  );
}

function ChecklistGroup({
  tone,
  icon,
  title,
  count,
  items,
}: {
  tone: "good" | "warn";
  icon: "check" | "warn";
  title: string;
  count: number;
  items: string[];
}) {
  if (!items.length) return null;

  // 색만으로 근거/리스크를 가르지 않는다 (13 §4) — 제목과 아이콘 모양이 함께 진다
  const mark =
    tone === "good"
      ? "bg-state-good-bg text-state-good ring-state-good-line"
      : "bg-state-warn-bg text-state-warn ring-state-warn-line";

  return (
    <div className="min-w-0">
      <h4 className="flex items-center gap-2 text-[13px] font-bold text-admin-text">
        {title}
        <span className="rounded-full bg-admin-surface-sunken px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-admin-text-muted">
          {count}
        </span>
      </h4>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {items.map((text, i) => (
          <li
            key={i}
            style={{ animationDelay: `${200 + i * 70}ms` }}
            className="animate-fade-up flex min-w-0 items-start gap-2.5"
          >
            <span
              className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${mark}`}
            >
              <Icon name={icon} size={12} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 break-keep text-[13px] leading-[1.65] text-admin-text-soft">
              {text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
