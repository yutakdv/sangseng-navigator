"use client";

import { useState, useTransition } from "react";
import { decideAction } from "@/app/actions";
import {
  DecisionReasonPanel,
  emptyDecisionReason,
  toDecisionFields,
  type DecisionReason,
} from "@/components/DecisionReasonPanel";
import { StatusChip } from "@/components/StatusChip";
import { decisionPrimaryLabel, decisionReasonRequired } from "@/lib/cardWorkflow";
import { operator } from "@/lib/operator";
import { isDemoReadOnly } from "@/lib/runtime";
import type { Card, CardStatus, CardType, PaybackRate } from "@/types";

const RATES: PaybackRate[] = [3, 5, 7];

/**
 * 하단 고정 결정 바 — 상세 페이지(/proposals/[id])의 존재 이유 (08 F3 · 절대 규칙 4).
 *
 * 스크롤 위치와 무관하게 승인·반려·보류가 항상 보인다. AI 제안은 이 바를 거쳐야만 확정된다.
 * 색은 상태색을 쓴다: 승인=그린 · 반려=레드 · 보류=앰버 (라벤더는 브랜드·강조 전용이라 금지).
 *
 * 변경은 서버 액션(decideAction)으로만 하고, 성공 시 액션의 revalidate가 페이지를 다시
 * 그리므로 여기서 카드 상태를 따로 들고 있지 않는다. INCENTIVE 승인은 페이백률 선택이
 * 필수라(05 §2) 바 안에 3·5·7% 선택 칩을 함께 둔다.
 *
 * **사유 칸은 접어 둔다.** 반려·보류(또는 신뢰도 `하` 카드의 승인)를 누른 뒤에만 펼쳐지고,
 * 확정·취소로 다시 접힌다 — 늘 펼쳐 두면 고정 바가 높아져 본문과 가이드 투어 카드를 덮는다.
 */
export function DecisionBar({
  cardId,
  cardType,
  status,
  initialRate,
  confidence = "중",
  version,
}: {
  cardId: string;
  cardType: CardType;
  status: CardStatus;
  /** 이미 확정된 페이백률(승인 후) 또는 null */
  initialRate: PaybackRate | null;
  /** 신뢰도 `하` 카드의 승인에는 확인 근거가 필수다 (05 §2) */
  confidence?: Card["confidence"];
  /** 낙관적 잠금 — 화면이 읽은 카드의 version */
  version?: number;
}) {
  const [rate, setRate] = useState<PaybackRate | null>(initialRate);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<CardStatus | null>(null);
  const [draft, setDraft] = useState<DecisionReason>(emptyDecisionReason);

  const decided = status !== "pending";
  const requireRate = cardType === "INCENTIVE";
  const rateMissing = requireRate && !rate;
  const working = pending || busy !== null;
  const armedRequiresReason = armed !== null && decisionReasonRequired(armed, confidence);
  const reasonMissing = armedRequiresReason && !draft.reason.trim();

  const submit = (decision: CardStatus) => {
    setError(null);
    setBusy(decision);
    const fields = toDecisionFields(draft, decision);
    startTransition(() => {
      decideAction(cardId, {
        decision,
        rate: rate ?? undefined,
        reason: fields.reason,
        version,
        cooldownDays: fields.cooldownDays,
        recheckCondition: fields.recheckCondition,
      })
        .then((res) => {
          if (!res.ok) {
            setError(res.detail);
            return;
          }
          setArmed(null);
          setDraft(emptyDecisionReason());
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(null));
    });
  };

  const press = (decision: CardStatus) => {
    setError(null);
    if (!decisionReasonRequired(decision, confidence)) {
      setArmed(null);
      submit(decision);
      return;
    }
    // 같은 버튼을 다시 누르면 접는다 — 고정 바에서 잘못 편 칸을 닫을 길이 있어야 한다
    setArmed((current) => (current === decision ? null : decision));
  };

  const buttonBase =
    "min-h-11 rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-45";

  return (
    <div
      data-tour="decision"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-admin-border bg-admin-surface shadow-header lg:left-[272px]"
    >
      <div
        role="group"
        aria-label="담당자 결정"
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <StatusChip status={status} />
          <span className="text-xs font-semibold tabular-nums text-admin-text-muted">{cardId}</span>
          <span className="hidden text-xs text-admin-text-muted md:inline">
            AI 제안은 이 결정을 거쳐야 확정됩니다
          </span>
          {/* 신원 미검증 고지는 사유 패널을 열기 전에도 보여야 한다 — 결정을 누르기 전에 알아야
              할 사실이고, 다른 결정 화면(DecisionActions)은 상시 노출한다. 패널 안에만 두면
              같은 조치가 화면마다 다르게 보인다. */}
          {!decided ? (
            <span className="hidden text-xs text-admin-text-muted lg:inline">
              · {operator.name} 이름으로 기록 · 신원 미검증
            </span>
          ) : null}
        </div>

        {requireRate && !decided ? (
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="페이백률 선택">
            <span className="text-xs font-semibold text-admin-text-muted">페이백률</span>
            {RATES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={rate === r}
                onClick={() => setRate(r)}
                className={`min-h-9 rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums transition-colors ${
                  rate === r
                    ? "bg-admin-primary text-white"
                    : "border border-admin-border bg-admin-surface text-admin-text-soft hover:bg-admin-surface-sunken"
                }`}
              >
                {r}%
              </button>
            ))}
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => press("approved")}
            disabled={decided || isDemoReadOnly || working || rateMissing}
            aria-busy={busy === "approved"}
            aria-expanded={armed === "approved" || undefined}
            className={`${buttonBase} bg-state-good text-white hover:bg-[#166534]`}
          >
            {busy === "approved" ? "처리 중…" : decisionPrimaryLabel(cardType)}
          </button>
          <button
            type="button"
            onClick={() => press("rejected")}
            disabled={decided || isDemoReadOnly || working}
            aria-busy={busy === "rejected"}
            aria-expanded={armed === "rejected" || undefined}
            className={`${buttonBase} border border-state-danger-line bg-admin-surface text-state-danger hover:bg-state-danger-bg`}
          >
            {busy === "rejected" ? "처리 중…" : "반려"}
          </button>
          <button
            type="button"
            onClick={() => press("held")}
            disabled={decided || isDemoReadOnly || working}
            aria-busy={busy === "held"}
            aria-expanded={armed === "held" || undefined}
            className={`${buttonBase} border border-state-warn-line bg-admin-surface text-state-warn hover:bg-state-warn-bg`}
          >
            {busy === "held" ? "처리 중…" : "보류"}
          </button>
        </div>

        {armed && !decided ? (
          <div className="w-full">
            <DecisionReasonPanel
              idPrefix={`decision-bar-${cardId}`}
              decision={armed}
              required={armedRequiresReason}
              value={draft}
              onChange={setDraft}
              disabled={working}
              compact
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submit(armed)}
                disabled={working || reasonMissing}
                aria-busy={busy === armed}
                className={`${buttonBase} bg-admin-primary text-white hover:bg-admin-primary-strong`}
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
                }}
                disabled={working}
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-admin-text-muted transition-colors hover:bg-admin-surface-sunken disabled:cursor-not-allowed disabled:opacity-45"
              >
                취소
              </button>
              <span className="text-xs leading-5 text-admin-text-muted">
                {reasonMissing
                  ? armed === "approved"
                    ? "신뢰도가 낮은 카드라 확인 근거를 적어야 승인할 수 있습니다."
                    : "사유를 적어야 확정할 수 있습니다."
                  : `${operator.name} 이름으로 기록됩니다 · 계정 체계 도입 전이라 신원은 검증되지 않습니다.`}
              </span>
            </div>
          </div>
        ) : null}

        {rateMissing && !decided ? (
          <p className="w-full text-xs leading-5 text-admin-text-muted">
            승인하려면 페이백률(3·5·7%)을 먼저 선택하세요 — 확정 페이백률은 담당자가 고른 값만 저장됩니다.
          </p>
        ) : null}
        {decided ? (
          <p className="w-full text-xs leading-5 text-admin-text-muted">
            이미 결정된 카드입니다 — 재검토가 필요하면 새 제안을 생성하세요. 추진 상태는 정책 트래킹에서 기록합니다.
          </p>
        ) : null}
        {isDemoReadOnly && !decided ? (
          <p className="w-full text-xs leading-5 text-admin-text-muted">공개 데모 읽기 전용 · 상태 변경이 잠겨 있습니다.</p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="w-full break-keep rounded-lg bg-state-bad-bg px-2.5 py-2 text-xs font-medium leading-5 text-state-bad"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
