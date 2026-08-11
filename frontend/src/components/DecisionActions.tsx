"use client";

import { useState, useTransition } from "react";
import { decideAction } from "@/app/actions";
import {
  DecisionReasonPanel,
  emptyDecisionReason,
  toDecisionFields,
  type DecisionReason,
} from "@/components/DecisionReasonPanel";
import { DecisionSafetyReview } from "@/components/DecisionSafetyReview";
import { decisionPrimaryLabel, decisionReasonRequired } from "@/lib/cardWorkflow";
import { operator } from "@/lib/operator";
import { isDemoReadOnly } from "@/lib/runtime";
import type { Card, CardStatus, CardType, PaybackRate } from "@/types";

/**
 * 승인/반려/보류 버튼 묶음 (docs/plan/08 F3·F6).
 *
 * AI 출력은 제안일 뿐이고, 이 버튼을 거쳐야 카드가 확정된다 (절대 규칙 4).
 * 변경은 서버 액션(`app/actions.ts`)으로만 한다 — `lib/api.ts`는 정적 JSON을 import 해서
 * 클라이언트에서 부를 수 없기 때문이다. 성공하면 액션의 revalidate가 화면을 갱신하므로
 * 여기서 카드 상태를 따로 들고 있지 않는다.
 *
 * 결정은 2단계다. 반려·보류는 사유를, 승인은 안전 검토 확인(저신뢰면 확인 근거도)을 받은 뒤
 * 확정한다. 서버도 같은 조건을 검사해 UI를 우회한 승인 요청을 422로 거부한다.
 */
const DECISIONS: { value: CardStatus; label: string; tone: string }[] = [
  {
    value: "approved",
    label: "승인",
    tone: "bg-admin-primary text-white hover:bg-admin-primary-strong",
  },
  {
    value: "rejected",
    label: "반려",
    tone: "border border-admin-border bg-admin-surface text-admin-text hover:bg-admin-surface-sunken",
  },
  {
    value: "held",
    label: "보류",
    tone: "border border-admin-border bg-admin-surface text-admin-text hover:bg-admin-surface-sunken",
  },
];

export function DecisionActions({
  cardId,
  disabled = false,
  selectedRate = null,
  requireRate = false,
  cardType = "EXPANSION",
  confidence = "중",
  version,
}: {
  cardId: string;
  disabled?: boolean;
  /** INCENTIVE에서 담당자가 고른 페이백률 — 승인 body의 selected_rate로 나간다 (05 §2) */
  selectedRate?: PaybackRate | null;
  /** INCENTIVE 승인은 페이백률 선택이 필수 — 미선택이면 승인 버튼 비활성 (08 F6) */
  requireRate?: boolean;
  cardType?: CardType;
  /** 신뢰도 `하` 카드의 승인에는 확인 근거가 필수라 사유 칸이 열린다 (05 §2) */
  confidence?: Card["confidence"];
  /** 낙관적 잠금 — 화면이 읽은 카드의 version. 그 사이 카드가 바뀌면 서버가 409로 막는다 */
  version?: number;
  /** 서버 컴포넌트에서 함수를 props로 넘길 수 없다 — 갱신은 액션의 revalidate가 맡는다 */
  onDone?: never;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 사유를 받는 중인 결정 — null이면 사유 칸이 접혀 있다 */
  const [armed, setArmed] = useState<CardStatus | null>(null);
  const [draft, setDraft] = useState<DecisionReason>(emptyDecisionReason);
  const [safetyReviewed, setSafetyReviewed] = useState(false);

  const rateMissing = requireRate && !selectedRate;
  const working = pending || busy !== null;
  const readOnly = isDemoReadOnly;
  const hintId = `decision-hint-${cardId}`;
  const armedRequiresReason = armed !== null && decisionReasonRequired(armed, confidence);
  const reasonMissing = armedRequiresReason && !draft.reason.trim();
  const reviewMissing = armed === "approved" && !safetyReviewed;

  const submit = (decision: CardStatus) => {
    setError(null);
    setBusy(decision);
    const fields = toDecisionFields(draft, decision);
    // React 18의 startTransition은 async 스코프를 기다리지 않는다 — "처리 중" 표시는 busy로 따로
    // 잡고, 트랜지션은 액션이 revalidate한 화면을 논블로킹으로 커밋하는 용도로만 쓴다.
    startTransition(() => {
      decideAction(cardId, {
        decision,
        rate: selectedRate ?? undefined,
        reason: fields.reason,
        version,
        cooldownDays: fields.cooldownDays,
        recheckCondition: fields.recheckCondition,
        safetyReviewed: decision === "approved" ? safetyReviewed : undefined,
      })
        .then((res) => {
          // 409(이미 결정됨·버전 불일치)·422(사유 누락)는 장애가 아니라 도메인 신호다 — 문구로 읽힌다
          if (!res.ok) {
            setError(res.detail);
            return;
          }
          setArmed(null);
          setDraft(emptyDecisionReason());
          setSafetyReviewed(false);
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(null));
    });
  };

  const press = (decision: CardStatus) => {
    setError(null);
    if (decision === "approved") {
      setSafetyReviewed(false);
      setArmed((current) => (current === decision ? null : decision));
      return;
    }
    // 승인 외 결정은 기존 사유 규칙을 따른다.
    if (!decisionReasonRequired(decision, confidence)) {
      setArmed(null);
      submit(decision);
      return;
    }
    setArmed(decision);
  };

  return (
    <div aria-label="카드 결정" role="group">
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map((d) => {
          const blocked = disabled || readOnly || working || (d.value === "approved" && rateMissing);
          const label =
            d.value === "approved"
              ? decisionPrimaryLabel(requireRate ? "INCENTIVE" : cardType)
              : d.label;
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => press(d.value)}
              disabled={blocked}
              aria-busy={busy === d.value}
              aria-expanded={armed === d.value || undefined}
              aria-describedby={d.value === "approved" && rateMissing ? hintId : undefined}
              className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${d.tone}`}
            >
              {busy === d.value ? "처리 중…" : label}
            </button>
          );
        })}
      </div>

      {armed ? (
        <div className="mt-3">
          {armed !== "approved" || armedRequiresReason ? (
            <DecisionReasonPanel
              idPrefix={`decision-${cardId}`}
              decision={armed}
              required={armedRequiresReason}
              value={draft}
              onChange={setDraft}
              disabled={working}
            />
          ) : null}
          {armed === "approved" ? (
            <div className={armedRequiresReason ? "mt-2" : ""}>
              <DecisionSafetyReview
                id={`decision-${cardId}-safety`}
                checked={safetyReviewed}
                onChange={setSafetyReviewed}
                disabled={working}
              />
            </div>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => submit(armed)}
              disabled={working || reasonMissing || reviewMissing}
              aria-busy={busy === armed}
              className="min-h-10 rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-admin-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === armed
                ? "처리 중…"
                : armed === "rejected"
                  ? "반려 확정"
                  : armed === "held"
                    ? "보류 확정"
                    : "승인 확정"}
            </button>
            <button
              type="button"
              onClick={() => {
                setArmed(null);
                setError(null);
                setSafetyReviewed(false);
              }}
              disabled={working}
              className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-admin-text-muted transition-colors hover:bg-admin-surface-sunken disabled:cursor-not-allowed disabled:opacity-50"
            >
              취소
            </button>
            {reviewMissing ? (
              <span className="text-xs leading-5 text-admin-text-muted">
                데이터 보호 범위·서버 검증 근거·AI 비교·반대 관점을 확인해야 승인할 수 있습니다.
              </span>
            ) : reasonMissing ? (
              <span className="text-xs leading-5 text-admin-text-muted">
                {armed === "approved"
                  ? "신뢰도가 낮은 카드라 확인 근거를 적어야 승인할 수 있습니다."
                  : "사유를 적어야 확정할 수 있습니다."}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {rateMissing ? (
        <p id={hintId} className="u-note mt-2">
          승인하려면 페이백률(3·5·7%)을 먼저 선택하세요 — 확정 페이백률은 담당자가 고른 값만 저장됩니다.
        </p>
      ) : null}

      {/* 신원이 검증되지 않았다는 사실을 감추지 않는다 — 담당자 계정 체계가 아직 없다 (05 §2) */}
      <p className="u-note mt-2">
        {operator.name} 이름으로 기록됩니다 · 계정 체계 도입 전이라 신원은 검증되지 않습니다.
      </p>

      {readOnly ? (
        <p className="u-note mt-2">공개 데모 읽기 전용 · 상태 변경이 잠겨 있습니다.</p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-2 break-keep rounded-lg bg-state-bad-bg px-2.5 py-2 text-xs font-medium leading-5 text-state-bad"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
