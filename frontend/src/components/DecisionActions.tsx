"use client";

import { useState, useTransition } from "react";
import { decideAction } from "@/app/actions";
import { decisionPrimaryLabel } from "@/lib/cardWorkflow";
import { isDemoReadOnly } from "@/lib/runtime";
import type { CardStatus, CardType, PaybackRate } from "@/types";

/**
 * 승인/반려/보류 버튼 묶음 (docs/plan/08 F3·F6).
 *
 * AI 출력은 제안일 뿐이고, 이 버튼을 거쳐야 카드가 확정된다 (절대 규칙 4).
 * 변경은 서버 액션(`app/actions.ts`)으로만 한다 — `lib/api.ts`는 mock JSON을 정적 import 해서
 * 클라이언트에서 부를 수 없기 때문이다. 성공하면 액션의 revalidate가 화면을 갱신하므로
 * 여기서 카드 상태를 따로 들고 있지 않는다.
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
}: {
  cardId: string;
  disabled?: boolean;
  /** INCENTIVE에서 담당자가 고른 페이백률 — 승인 body의 selected_rate로 나간다 (05 §2) */
  selectedRate?: PaybackRate | null;
  /** INCENTIVE 승인은 페이백률 선택이 필수 — 미선택이면 승인 버튼 비활성 (08 F6) */
  requireRate?: boolean;
  cardType?: CardType;
  /** 서버 컴포넌트에서 함수를 props로 넘길 수 없다 — 갱신은 액션의 revalidate가 맡는다 */
  onDone?: never;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rateMissing = requireRate && !selectedRate;
  const working = pending || busy !== null;
  const readOnly = isDemoReadOnly;
  const hintId = `decision-hint-${cardId}`;

  const run = (decision: CardStatus) => {
    setError(null);
    setBusy(decision);
    // React 18의 startTransition은 async 스코프를 기다리지 않는다 — "처리 중" 표시는 busy로 따로
    // 잡고, 트랜지션은 액션이 revalidate한 화면을 논블로킹으로 커밋하는 용도로만 쓴다.
    startTransition(() => {
      decideAction(cardId, decision, selectedRate ?? undefined)
        .then((res) => {
          // 409(이미 결정된 카드)·400(rate 누락)은 장애가 아니라 도메인 신호다 — 문구로 읽힌다
          if (!res.ok) setError(res.detail);
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(null));
    });
  };

  return (
    <div aria-label="카드 결정" role="group">
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map((d) => {
          const blocked = disabled || readOnly || working || (d.value === "approved" && rateMissing);
          const label = d.value === "approved" ? decisionPrimaryLabel(requireRate ? "INCENTIVE" : cardType) : d.label;
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => run(d.value)}
              disabled={blocked}
              aria-busy={busy === d.value}
              aria-describedby={d.value === "approved" && rateMissing ? hintId : undefined}
              className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${d.tone}`}
            >
              {busy === d.value ? "처리 중…" : label}
            </button>
          );
        })}
      </div>

      {rateMissing ? (
        <p id={hintId} className="u-note mt-2">
          승인하려면 페이백률(3·5·7%)을 먼저 선택하세요 — 확정 페이백률은 담당자가 고른 값만 저장됩니다.
        </p>
      ) : null}

      {readOnly ? (
        <p className="u-note mt-2">공개 데모 읽기 전용 · 상태 변경이 잠겨 있습니다.</p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-2 break-keep rounded-lg bg-state-bad-bg px-2.5 py-2 text-xs font-medium leading-5 text-state-bad ring-1 ring-inset ring-state-bad-line"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
