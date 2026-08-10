import { workflowLabel } from "@/lib/cardWorkflow";
import type { Card, CardProgress, CardStatus } from "@/types";

/**
 * 승인 상태·추진 상태 칩 (05 §2).
 *
 * 11px 연한 알약이 나란히 붙어 있으면 목록에서 어떤 카드가 어떤 상태인지 훑어지지 않는다.
 * 12px + 앞머리 점으로 올렸다. 점은 장식이고 의미는 항상 텍스트가 진다 (13 §4).
 *
 * 테두리(ring)는 두르지 않는다 — 칩은 늘 카드·패널 안에 들어가는데 링까지 있으면 상자가
 * 한 겹 더 생긴다. 채움 면만으로 구분하므로 **어떤 톤도 흰 면을 쓰지 않는다**:
 * 흰 칩은 흰 패널 위에서 링 없이는 사라진다(중립 톤은 surface-sunken을 쓴다).
 */
const base =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold leading-5 whitespace-nowrap";

const DOT = "h-1.5 w-1.5 shrink-0 rounded-full bg-current";

const STATUS_LABEL: Record<CardStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
  held: "보류",
};

const STATUS_TONE: Record<CardStatus, string> = {
  pending: "bg-admin-primary-soft text-admin-primary",
  approved: "bg-state-good-bg text-state-good",
  rejected: "bg-admin-surface-sunken text-admin-text-muted",
  held: "bg-state-notice-bg text-state-notice",
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
  검토중: "bg-state-notice-bg text-state-notice",
  "후보 접촉·검토 시작": "bg-admin-primary-soft text-admin-primary",
  "적격성 확인": "bg-state-notice-bg text-state-notice",
  "가맹 심사": "bg-admin-primary-soft text-admin-primary",
  추진중: "bg-admin-primary-soft text-admin-primary",
  보류: "bg-state-warn-bg text-state-warn",
  완료: "bg-state-good-bg text-state-good",
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
      ? "bg-state-good-bg text-state-good"
      : label === "보류"
        ? "bg-state-warn-bg text-state-warn"
        : label.includes("부적격") || label.includes("반려")
          ? "bg-admin-surface-sunken text-admin-text-muted"
          : "bg-admin-primary-soft text-admin-primary";
  return (
    <span className={`${base} ${tone}`}>
      <span aria-hidden className={DOT} />
      {label}
    </span>
  );
}
