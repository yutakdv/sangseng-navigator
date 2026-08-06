import Link from "next/link";
import type { ReactNode } from "react";
import { AssumptionBadge, AssumptionNote } from "@/components/Badge";
import { Icon, type IconName } from "@/components/Icon";
import { RankTrace } from "@/components/RankTrace";
import { WorkflowChip } from "@/components/StatusChip";
import { eligibilityStatus, workflowLabel } from "@/lib/cardWorkflow";
import type { Card } from "@/types";

/**
 * 허브 목록용 Action Card 1장 (docs/plan/08 F2 · 13 §9).
 *
 * 서버 컴포넌트다 — 승인/반려/보류 버튼은 `children` 자리에 `DecisionActions`(클라이언트)를 넣는다.
 * `Score N위 → AI 제안 1위` 병기는 감사 가능성 원칙이라 조정 여부와 무관하게 항상 보이고,
 * 조정이 있었던 카드만 강조한다 — 원 순위를 시각적으로 숨기지 않는다 (절대 규칙 5).
 *
 * 목록에서 카드 한 장이 "제목 14px + 나머지 전부 12px 회색"이면 훑을 때 걸리는 게 없다.
 * ① 종류 아이콘 → ② 16px 제목 → ③ 메타 칩(대상·신뢰도) → ④ 순위 병기 → ⑤ 근거 요약 →
 * ⑥ 결정 버튼 순서로 무게를 나눴다.
 */
export function CardItem({ card, children }: { card: Card; children?: ReactNode }) {
  // INCENTIVE는 순위 개념이 없어(target·score_rank·ai_rank가 null) 이 블록을 숨긴다 (05 §2)
  const showRank = card.type === "EXPANSION" && card.score_rank !== null && card.ai_rank !== null;
  const isExpansion = card.type === "EXPANSION";
  const nextAction = getNextAction(card);

  return (
    <article className="u-panel relative transition-shadow hover:shadow-card-hover">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          {/* 종류 아이콘 — 공급 측(확충)/수요 측(인센티브)을 한 눈에 가른다. 의미는 아래 라벨이 진다 */}
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
              isExpansion
                ? "bg-admin-primary-soft text-admin-primary ring-admin-primary-line"
                : "bg-visitor-primary-soft text-visitor-primary ring-visitor-primary/20"
            }`}
          >
            <Icon name={isExpansion ? "store" : "gift"} size={18} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-md bg-admin-surface-sunken px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-admin-text-muted">
                {card.id}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                {isExpansion ? "가맹점 확충" : "페이백 인센티브"}
              </span>
              <WorkflowChip card={card} />
            </div>

            {/* 카드 면 전체 클릭 → 상세 (stretched link). 버튼·토글은 relative z-10으로 위에 둔다 */}
            <h3 className="mt-1.5 break-keep text-base font-bold leading-6 text-admin-text">
              <Link href={`/proposals/${card.id}`} className="after:absolute after:inset-0 after:content-['']">
                {card.title}
              </Link>
            </h3>

            <dl className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
              <Meta icon="pin" label="대상">
                {card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통"}
              </Meta>
              <Meta icon="shield" label="신뢰도">
                {card.confidence}
              </Meta>
              <Meta icon="clock" label="생성">
                {card.created_at.length >= 16
                  ? `${card.created_at.slice(5, 10)} ${card.created_at.slice(11, 16)}`
                  : "—"}
              </Meta>
              {/* 확정 rate는 담당자가 승인할 때 고른 값만 존재한다 (05 §2) */}
              {card.selected_rate ? (
                <Meta icon="gift" label="확정 페이백률">
                  {card.selected_rate}%
                </Meta>
              ) : null}
            </dl>
          </div>
        </div>

        <div
          aria-label="담당자 다음 행동"
          className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl px-3 py-2.5 ring-1 ring-inset ${nextAction.tone}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Icon name={nextAction.icon} size={15} strokeWidth={2} />
            <span className="text-[11px] font-bold uppercase tracking-[0.1em]">다음 행동</span>
            <span className="break-keep text-[13px] font-bold">{nextAction.label}</span>
          </div>
          <span className="text-[11px] font-medium text-current/70">{nextAction.detail}</span>
        </div>

        {showRank ? (
          <div className="relative z-10">
            <RankTrace card={card} />
          </div>
        ) : null}

        {card.ai.comparison ? (
          <div className="rounded-xl bg-admin-surface-sunken p-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
              <Icon name="sparkle" size={12} strokeWidth={2} />
              AI 후보 비교 요약
            </p>
            <p className="line-clamp-2 break-keep text-[13px] leading-[1.65] text-admin-text-soft">
              {card.ai.comparison}
            </p>
            {/* 시나리오를 가진 카드(INCENTIVE)의 비교문에는 페이백률별 예상 개선폭(%p)이 섞여 있다.
                전망 수치가 보이는 블록에는 목록에서도 배지·고지 문구를 붙인다 (절대 규칙 3, 13 §9) */}
            {card.scenarios?.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <AssumptionBadge />
                <AssumptionNote />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-admin-border px-4 py-3 sm:items-center sm:px-5">
        <Link
          href={`/proposals/${card.id}`}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-admin-primary underline-offset-4 hover:underline"
        >
          상세에서 보기
          <Icon name="arrowRight" size={14} strokeWidth={2} />
        </Link>
        {children ? <div className="w-full sm:ml-auto sm:w-auto">{children}</div> : null}
      </div>
    </article>
  );
}

function Meta({
  icon,
  label,
  children,
}: {
  icon: "pin" | "shield" | "gift" | "clock";
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon name={icon} size={14} className="text-admin-text-muted" />
      <dt className="text-admin-text-muted">{label}</dt>
      <dd className="font-semibold text-admin-text">{children}</dd>
    </div>
  );
}

function getNextAction(card: Card): {
  icon: IconName;
  label: string;
  detail: string;
  tone: string;
} {
  if (card.status === "pending") {
    return card.type === "INCENTIVE"
      ? {
          icon: "gift",
          label: "페이백률 선택 후 승인 검토",
          detail: "결정 전",
          tone: "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
        }
      : {
          icon: "sparkle",
          label: "근거 확인 후 후보 접촉·검토 시작 여부 결정",
          detail: "결정 전",
          tone: "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
        };
  }

  if (card.status === "approved") {
    if (card.type === "EXPANSION" && eligibilityStatus(card) !== "verified") {
      return {
        icon: "shield",
        label: eligibilityStatus(card) === "ineligible" ? "부적격 사유 확인" : "필수 적격성 5개 항목 확인",
        detail: workflowLabel(card),
        tone: "bg-state-warn-bg text-state-warn ring-state-warn-line",
      };
    }
    return card.progress === "완료"
      ? {
          icon: "check",
          label: "방문객 위젯 반영 확인",
          detail: "실행 완료",
          tone: "bg-state-good-bg text-state-good ring-state-good-line",
        }
      : {
          icon: "workflow",
          label: "추진 상태 기록",
          detail: workflowLabel(card),
          tone: "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
        };
  }

  if (card.status === "rejected") {
    return {
      icon: "warn",
      label: "반려 완료 · 재검토 시 새 카드 생성",
      detail: "결정 완료",
      tone: "bg-admin-surface-sunken text-admin-text-muted ring-admin-border",
    };
  }

  return {
    icon: "clock",
    label: "보류 사유와 재검토 일정 확인",
    detail: "결정 완료",
    tone: "bg-state-notice-bg text-state-notice ring-state-notice-line",
  };
}
