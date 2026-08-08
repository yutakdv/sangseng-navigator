/**
 * `card.events[].action` → 사람이 읽는 문구 (05 §7 — `approved` · `progress:완료` 형태).
 *
 * 같은 매핑이 카드 상세·트래킹에 각각 복제돼 있었고 제안 상세(/proposals/[id])에는 아예 없어서
 * 그 화면에만 `generated`·`progress:추진중` 같은 내부 문자열이 그대로 노출됐다. 세 화면이 이
 * 파일 하나를 쓴다 — 계약에 새 action이 생겨도 한 곳만 고치면 된다.
 *
 * 폭이 좁은 자리(트래킹 행)는 `compact`로 짧은 문구를 쓴다. 표현만 다르고 의미는 같아야 한다.
 */
const FULL: Record<string, string> = {
  generated: "AI 제안 카드 생성",
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

export function eventLabel(action: string, opts: { compact?: boolean } = {}): string {
  if (action.startsWith(PROGRESS_PREFIX)) {
    const stage = action.slice(PROGRESS_PREFIX.length);
    return opts.compact ? `추진 상태 → ${stage}` : `추진 상태 변경 → ${stage}`;
  }
  // 계약에 없는 action은 원문 그대로 둔다 — 모르는 이벤트를 아는 척 번역하지 않는다
  return (opts.compact ? COMPACT : FULL)[action] ?? action;
}

/** 카드 생성 이벤트가 이미 있는지 — 있으면 화면이 생성 행을 따로 합성하면 안 된다(중복 행) */
export const hasGeneratedEvent = (events: { action: string }[]): boolean =>
  events.some((event) => event.action === "generated");
