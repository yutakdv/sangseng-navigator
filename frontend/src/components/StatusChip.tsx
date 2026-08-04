import { workflowLabel } from "@/lib/cardWorkflow";
import type { Card, CardProgress, CardStatus } from "@/types";

/**
 * 승인 상태·추진 상태 칩 (05 §2).
 *
 * 11px 연한 알약이 나란히 붙어 있으면 목록에서 어떤 카드가 어떤 상태인지 훑어지지 않는다.
 * 12px + 얇은 테두리 + 앞머리 점으로 올렸다. 점은 장식이고 의미는 항상 텍스트가 진다 (13 §4).
 */
const base =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap ring-1 ring-inset";

const DOT = "h-1.5 w-1.5 shrink-0 rounded-full bg-current";

const STATUS_LABEL: Record<CardStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
  held: "보류",
};

const STATUS_TONE: Record<CardStatus, string> = {
  pending: "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
  approved: "bg-state-good-bg text-state-good ring-state-good-line",
  rejected: "bg-admin-surface text-admin-text-muted ring-admin-border",
  held: "bg-state-notice-bg text-state-notice ring-state-notice-line",
};

/** 승인 상태 칩 — pending/approved/rejected/held (05 §2) */
export function StatusChip({ status }: { status: CardStatus }) {
  return (
    <span className={`${base} ${STATUS_TONE[status]}`}>
      <span aria-hidden className={DOT} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const PROGRESS_TONE: Record<CardProgress, string> = {
  검토중: "bg-state-notice-bg text-state-notice ring-state-notice-line",
  "후보 접촉·검토 시작": "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
  "적격성 확인": "bg-state-notice-bg text-state-notice ring-state-notice-line",
  "가맹 심사": "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
  추진중: "bg-admin-primary-soft text-admin-primary ring-admin-primary-line",
  보류: "bg-state-warn-bg text-state-warn ring-state-warn-line",
  완료: "bg-state-good-bg text-state-good ring-state-good-line",
};

/** 추진 상태 칩 4단계 — 승인된 카드에만 존재 (05 §2) */
export function ProgressChip({ progress }: { progress: CardProgress }) {
  return (
    <span className={`${base} ${PROGRESS_TONE[progress]}`}>
      <span aria-hidden className={DOT} />
      {progress}
    </span>
  );
}

/** 카드 유형과 적격성을 반영한 실제 업무 상태. EXPANSION의 approved를 가맹 확정으로 보이지 않게 한다. */
export function WorkflowChip({ card }: { card: Card }) {
  const label = workflowLabel(card);
  const tone =
    label === "완료"
      ? "bg-state-good-bg text-state-good ring-state-good-line"
      : label === "보류"
        ? "bg-state-warn-bg text-state-warn ring-state-warn-line"
        : label.includes("부적격") || label.includes("반려")
          ? "bg-admin-surface text-admin-text-muted ring-admin-border"
          : "bg-admin-primary-soft text-admin-primary ring-admin-primary-line";
  return (
    <span className={`${base} ${tone}`}>
      <span aria-hidden className={DOT} />
      {label}
    </span>
  );
}
