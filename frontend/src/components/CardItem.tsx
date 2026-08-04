import Link from "next/link";
import type { ReactNode } from "react";
import { AssumptionBadge, AssumptionNote } from "@/components/Badge";
import { ProgressChip, StatusChip } from "@/components/StatusChip";
import type { Card } from "@/types";

/**
 * 허브 목록용 Action Card 1장 (docs/plan/08 F2 · 13 §9).
 *
 * 서버 컴포넌트다 — 승인/반려/보류 버튼은 `children` 자리에 `DecisionActions`(클라이언트)를 넣는다.
 * `Score N위 → AI 제안 1위` 병기는 감사 가능성 원칙이라 조정 여부와 무관하게 항상 보이고,
 * 조정이 있었던 카드만 강조한다 — 원 순위를 시각적으로 숨기지 않는다 (절대 규칙 5).
 */
export function CardItem({ card, children }: { card: Card; children?: ReactNode }) {
  // INCENTIVE는 순위 개념이 없어(target·score_rank·ai_rank가 null) 이 블록을 숨긴다 (05 §2)
  const showRank =
    card.type === "EXPANSION" && card.score_rank !== null && card.ai_rank !== null;

  return (
    <article className="rounded-card border border-black/5 bg-admin-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs tabular-nums text-admin-text-muted">{card.id}</span>
        <h3 className="min-w-0 break-keep text-sm font-semibold text-admin-text">{card.title}</h3>
        <StatusChip status={card.status} />
        {card.progress ? <ProgressChip progress={card.progress} /> : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-text-muted">
        {card.target ? (
          <span>
            대상{" "}
            <span className="font-medium text-admin-text">
              {card.target.eup} · {card.target.category}
            </span>
          </span>
        ) : (
          <span>대상 전 지역 공통</span>
        )}
        <span>
          신뢰도 <span className="font-medium text-admin-text">{card.confidence}</span>
        </span>
        {/* 확정 rate는 담당자가 승인할 때 고른 값만 존재한다 (05 §2) */}
        {card.selected_rate ? (
          <span>
            확정 페이백률 <span className="font-medium text-admin-text">{card.selected_rate}%</span>
          </span>
        ) : null}
      </div>

      {showRank ? (
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
          {/* 색만으로 의미를 전달하지 않는다 (13 §4) — 조정 여부는 텍스트로도 적는다 */}
          {card.ai.adjusted ? (
            <span className="inline-flex items-center rounded-full bg-state-notice-bg px-2 py-0.5 text-[11px] font-medium text-state-notice">
              AI 조정 제안
            </span>
          ) : (
            <span className="text-[11px] text-admin-text-muted">정량 1순위와 동일</span>
          )}
        </div>
      ) : null}

      {card.ai.comparison ? (
        <>
          <p className="mt-2 line-clamp-2 break-keep text-xs leading-5 text-admin-text-muted">
            {card.ai.comparison}
          </p>
          {/* 시나리오를 가진 카드(INCENTIVE)의 비교문에는 페이백률별 예상 개선폭(%p)이 섞여 있다.
              전망 수치가 보이는 블록에는 목록에서도 배지·고지 문구를 붙인다 (절대 규칙 3, 13 §9) */}
          {card.scenarios?.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <AssumptionBadge />
              <AssumptionNote />
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          href={`/cards/${card.id}`}
          className="text-xs font-medium text-admin-primary underline-offset-2 hover:underline"
        >
          제안 근거 전문 보기 →
        </Link>
        {children ? <div className="ml-auto">{children}</div> : null}
      </div>
    </article>
  );
}
