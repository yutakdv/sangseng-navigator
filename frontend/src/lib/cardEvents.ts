import type { Card, CardEvent } from "@/types";

/**
 * `card.events[]` → 사람이 읽는 이력 한 줄 (05 §7 — `approved` · `progress:완료` 형태).
 *
 * 같은 매핑이 카드 상세·트래킹에 각각 복제돼 있었고 제안 상세(/proposals/[id])에는 아예 없어서
 * 그 화면에만 `generated`·`progress:추진중` 같은 내부 문자열이 그대로 노출됐다. 세 화면이 이
 * 파일 하나를 쓴다 — 계약에 새 action이 생겨도 한 곳만 고치면 된다.
 *
 * 이벤트는 시각·동작만이 아니라 **결정자와 사유**도 싣는다. 그 둘이 화면에서 빠지면
 * "누가 왜 그렇게 결정했는지"가 기록에서 사라져 감사 기록으로서 의미가 없다.
 *
 * 폭이 좁은 자리(트래킹 행)는 `compact`로 짧은 문구를 쓴다. 표현만 다르고 의미는 같아야 한다.
 */
const FULL: Record<string, string> = {
  // "AI 제안 카드 생성"이라 쓰지 않는다 — 고정 시드 카드(규칙 기반)에도 이 이벤트가 붙어 있어
  // "AI가 방금 만든 카드"로 오독된다 (검토 §0-3 #1). 고정·실시간 양쪽에 참인 서술만.
  generated: "제안 카드 생성",
  approved: "담당자 승인",
  rejected: "담당자 반려",
  held: "담당자 보류",
};

const COMPACT: Record<string, string> = {
  generated: "카드 생성",
  approved: "승인",
  rejected: "반려",
  held: "보류",
};

const PROGRESS_PREFIX = "progress:";

/** 결정 이벤트 — 이 셋에만 카드의 `decision` 감사 기록이 대응한다 */
const DECISION_ACTIONS = new Set(["approved", "rejected", "held"]);

/**
 * 신원이 검증되지 않았다는 표기.
 *
 * 담당자 계정 체계가 없어 `actor_id`는 화면이 보낸 자기신고 값이고 인증은 공유 토큰 하나다.
 * **화면이 이 사실을 감추지 않는다** — 다만 과하게 크게 말할 일도 아니라 이름 옆 작은 표기로만 둔다.
 */
export const UNVERIFIED_ACTOR_NOTE = "신원 미검증";

export function eventLabel(event: CardEvent, opts: { compact?: boolean } = {}): string {
  const { action } = event;
  if (action.startsWith(PROGRESS_PREFIX)) {
    const stage = action.slice(PROGRESS_PREFIX.length);
    return opts.compact ? `추진 상태 → ${stage}` : `추진 상태 변경 → ${stage}`;
  }
  // 계약에 없는 action은 원문 그대로 둔다 — 모르는 이벤트를 아는 척 번역하지 않는다
  return (opts.compact ? COMPACT : FULL)[action] ?? action;
}

/**
 * 이력에 표시할 결정자 — 이름이 있으면 이름을, 없으면 자기신고 식별자를 쓴다.
 * 결정 이벤트이면서 카드의 결정 기록이 미검증이면 그 사실을 이름 옆에 함께 남긴다.
 */
export function eventActorLabel(event: CardEvent, decision?: Card["decision"]): string | null {
  const name = (event.actor_name ?? event.actor_id ?? "").trim();
  if (!name) return null;
  const unverified = DECISION_ACTIONS.has(event.action) && decision?.verified === false;
  return unverified ? `${name} · ${UNVERIFIED_ACTOR_NOTE}` : name;
}

/** 카드 생성 이벤트가 이미 있는지 — 있으면 화면이 생성 행을 따로 합성하면 안 된다(중복 행) */
export const hasGeneratedEvent = (events: { action: string }[]): boolean =>
  events.some((event) => event.action === "generated");
