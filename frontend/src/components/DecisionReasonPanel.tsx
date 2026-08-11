"use client";

import { DEFAULT_COOLDOWN_DAYS, MAX_COOLDOWN_DAYS, isBlockingDecision } from "@/lib/cardWorkflow";
import type { CardStatus } from "@/types";

/**
 * 결정 사유 입력 — 승인·반려·보류 버튼 두 벌(`DecisionActions`·`DecisionBar`)이 공유한다.
 *
 * 두 화면에 각각 만들면 필수 판정과 문구가 갈려, 한쪽에서만 422를 보게 된다. 여기 한 곳에서
 * 필드와 라벨을 정하고 버튼 묶음은 배치만 맡는다.
 *
 * **항상 펼쳐 두지 않는다.** 사유가 필요한 결정을 고른 뒤에만 열려야 한다 —
 * 하단 고정 바(`DecisionBar`)에서 늘 펼쳐 두면 바가 높아져 본문을 덮는다.
 */
export interface DecisionReason {
  reason: string;
  /** 반려·보류 전용 — 같은 타깃을 며칠 동안 다시 제안하지 않을지 */
  cooldownDays: string;
  /** 반려·보류 전용 — 무엇이 바뀌면 다시 볼지 */
  recheckCondition: string;
}

export const emptyDecisionReason = (): DecisionReason => ({
  reason: "",
  cooldownDays: String(DEFAULT_COOLDOWN_DAYS),
  recheckCondition: "",
});

/** 사유 입력값을 서버가 받을 형태로 — 빈 값은 아예 싣지 않는다 */
export function toDecisionFields(draft: DecisionReason, decision: CardStatus) {
  const days = Number(draft.cooldownDays);
  const blocking = isBlockingDecision(decision);
  return {
    reason: draft.reason.trim() || undefined,
    cooldownDays:
      blocking && Number.isInteger(days) && days >= 0 && days <= MAX_COOLDOWN_DAYS
        ? days
        : undefined,
    recheckCondition: blocking ? draft.recheckCondition.trim() || undefined : undefined,
  };
}

const FIELD =
  "mt-1.5 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-[13px] text-admin-text transition-colors placeholder:text-admin-text-muted/70 focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/20 disabled:cursor-not-allowed disabled:opacity-55";

export function DecisionReasonPanel({
  idPrefix,
  decision,
  required,
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  idPrefix: string;
  /** 지금 확정하려는 결정 — 사유 라벨과 재제안 항목 노출이 여기서 갈린다 */
  decision: CardStatus;
  /** 필수면 라벨에 표시하고 확정 버튼을 잠근다 (판정은 cardWorkflow가 한다) */
  required: boolean;
  value: DecisionReason;
  onChange: (next: DecisionReason) => void;
  disabled?: boolean;
  /**
   * 하단 고정 바처럼 높이가 곧 본문을 덮는 자리 — 입력 줄과 설명 문장을 줄인다.
   * 필드 구성은 같다(줄이는 것은 여백뿐이며, 사유·쿨다운·재검토 조건을 빼지 않는다).
   */
  compact?: boolean;
}) {
  const blocking = isBlockingDecision(decision);
  const reasonId = `${idPrefix}-reason`;
  const cooldownId = `${idPrefix}-cooldown`;
  const recheckId = `${idPrefix}-recheck`;
  const set = (patch: Partial<DecisionReason>) => onChange({ ...value, ...patch });

  return (
    <div className={`rounded-xl bg-admin-surface-sunken ${compact ? "p-3" : "p-3.5"}`}>
      <label htmlFor={reasonId} className="block text-[13px] font-semibold text-admin-text">
        {blocking ? "결정 사유" : "승인 확인 근거"}
        {required ? <span className="ml-1 text-state-warn">필수</span> : null}
      </label>
      <textarea
        id={reasonId}
        value={value.reason}
        onChange={(event) => set({ reason: event.target.value })}
        disabled={disabled}
        maxLength={1000}
        rows={compact ? 2 : 3}
        placeholder={
          blocking
            ? "다음 분기에 같은 대상을 다시 볼 때 이 판단의 근거가 됩니다."
            : "신뢰도가 낮은 후보라 무엇을 따로 확인했는지 적어 주세요."
        }
        className={`${FIELD} resize-y leading-6`}
      />

      {blocking ? (
        <div className={`grid gap-3 sm:grid-cols-[9rem_1fr] ${compact ? "mt-2" : "mt-3"}`}>
          <div>
            <label htmlFor={cooldownId} className="block text-[13px] font-semibold text-admin-text">
              재제안 보류 기간
            </label>
            <span className="relative mt-1.5 block">
              <input
                id={cooldownId}
                type="number"
                min={0}
                max={MAX_COOLDOWN_DAYS}
                step={1}
                value={value.cooldownDays}
                onChange={(event) => set({ cooldownDays: event.target.value })}
                disabled={disabled}
                className={`${FIELD} mt-0 pr-8 tabular-nums`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-admin-text-muted">
                일
              </span>
            </span>
          </div>
          <div>
            <label htmlFor={recheckId} className="block text-[13px] font-semibold text-admin-text">
              재검토 조건
              <span className="ml-1 font-medium text-admin-text-muted">선택</span>
            </label>
            <input
              id={recheckId}
              value={value.recheckCondition}
              onChange={(event) => set({ recheckCondition: event.target.value })}
              disabled={disabled}
              maxLength={500}
              placeholder="예: 다음 분기 예산 확정 후 재검토"
              className={FIELD}
            />
          </div>
        </div>
      ) : null}

      <p className="mt-2 break-keep text-[11px] leading-5 text-admin-text-muted">
        {blocking
          ? compact
            ? "이 기간 동안 같은 대상은 다시 제안되지 않습니다."
            : "이 기간 동안 같은 대상은 새 카드로 다시 제안되지 않습니다. 사유와 재검토 조건은 카드 이력에 그대로 남습니다."
          : "확인 근거는 카드 이력에 그대로 남습니다."}
      </p>
    </div>
  );
}
