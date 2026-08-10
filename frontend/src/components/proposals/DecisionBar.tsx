"use client";

import { useState, useTransition } from "react";
import { decideAction } from "@/app/actions";
import { StatusChip } from "@/components/StatusChip";
import { decisionPrimaryLabel } from "@/lib/cardWorkflow";
import { isDemoReadOnly } from "@/lib/runtime";
import type { CardStatus, CardType, PaybackRate } from "@/types";

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
 */
export function DecisionBar({
  cardId,
  cardType,
  status,
  initialRate,
}: {
  cardId: string;
  cardType: CardType;
  status: CardStatus;
  /** 이미 확정된 페이백률(승인 후) 또는 null */
  initialRate: PaybackRate | null;
}) {
  const [rate, setRate] = useState<PaybackRate | null>(initialRate);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decided = status !== "pending";
  const requireRate = cardType === "INCENTIVE";
  const rateMissing = requireRate && !rate;
  const working = pending || busy !== null;

  const run = (decision: CardStatus) => {
    setError(null);
    setBusy(decision);
    startTransition(() => {
      decideAction(cardId, decision, rate ?? undefined)
        .then((res) => {
          if (!res.ok) setError(res.detail);
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(null));
    });
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
            onClick={() => run("approved")}
            disabled={decided || isDemoReadOnly || working || rateMissing}
            aria-busy={busy === "approved"}
            className={`${buttonBase} bg-state-good text-white hover:bg-[#166534]`}
          >
            {busy === "approved" ? "처리 중…" : decisionPrimaryLabel(cardType)}
          </button>
          <button
            type="button"
            onClick={() => run("rejected")}
            disabled={decided || isDemoReadOnly || working}
            aria-busy={busy === "rejected"}
            className={`${buttonBase} border border-state-danger-line bg-admin-surface text-state-danger hover:bg-state-danger-bg`}
          >
            {busy === "rejected" ? "처리 중…" : "반려"}
          </button>
          <button
            type="button"
            onClick={() => run("held")}
            disabled={decided || isDemoReadOnly || working}
            aria-busy={busy === "held"}
            className={`${buttonBase} border border-state-warn-line bg-admin-surface text-state-warn hover:bg-state-warn-bg`}
          >
            {busy === "held" ? "처리 중…" : "보류"}
          </button>
        </div>

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
            className="w-full break-keep rounded-lg bg-state-bad-bg px-2.5 py-2 text-xs font-medium leading-5 text-state-bad ring-1 ring-inset ring-state-bad-line"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
