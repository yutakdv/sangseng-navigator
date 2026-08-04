import type { CardProgress, CardStatus } from "@/types";

const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5";

const STATUS_LABEL: Record<CardStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
  held: "보류",
};

const STATUS_TONE: Record<CardStatus, string> = {
  pending: "bg-admin-primary-soft text-admin-primary",
  approved: "bg-state-good-bg text-state-good",
  rejected: "bg-state-bad-bg text-state-bad",
  held: "bg-state-notice-bg text-state-notice",
};

/** 승인 상태 칩 — pending/approved/rejected/held (05 §2) */
export function StatusChip({ status }: { status: CardStatus }) {
  return <span className={`${base} ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const PROGRESS_TONE: Record<CardProgress, string> = {
  검토중: "bg-state-notice-bg text-state-notice",
  추진중: "bg-admin-primary-soft text-admin-primary",
  보류: "bg-state-warn-bg text-state-warn",
  완료: "bg-state-good-bg text-state-good",
};

/** 추진 상태 칩 4단계 — 승인된 카드에만 존재 (05 §2) */
export function ProgressChip({ progress }: { progress: CardProgress }) {
  return <span className={`${base} ${PROGRESS_TONE[progress]}`}>{progress}</span>;
}
