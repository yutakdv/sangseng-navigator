"use client";

import { useState } from "react";
import { DecisionActions } from "@/components/DecisionActions";
import type { PaybackRate } from "@/types";

const RATES: PaybackRate[] = [3, 5, 7];

/**
 * 카드 상세(`/cards/[id]`)의 INCENTIVE 결정 묶음 — 페이백률 칩 + 승인·반려·보류 (05 §2 · 절대 규칙 4).
 *
 * `DecisionActions`는 서버 컴포넌트에서도 쓰이도록 `selectedRate`를 props로만 받는다. 그래서
 * 요율 상태를 들고 있을 얇은 클라이언트 껍데기가 따로 필요하다 — 이 파일이 그것이고, 요청은
 * 그대로 `DecisionActions`의 서버 액션 경로로만 나간다. 이 껍데기가 없던 동안 카드 상세의
 * INCENTIVE 승인 버튼은 `selectedRate`가 영원히 null이라 눌리지 않았다.
 *
 * 칩 규격은 `/proposals`의 `DecisionBar`와 같다 — 같은 조작이 두 화면에서 다르게 보이면
 * 담당자가 다른 기능으로 읽는다. 그쪽은 하단 고정 바라 여백만 다르다.
 */
export function IncentiveDecision({
  cardId,
  /** 이미 확정된 페이백률(승인 후) 또는 null */
  initialRate,
}: {
  cardId: string;
  initialRate: PaybackRate | null;
}) {
  const [rate, setRate] = useState<PaybackRate | null>(initialRate);

  return (
    <div>
      <div
        className="mb-3 flex flex-wrap items-center gap-1.5"
        role="radiogroup"
        aria-label="페이백률 선택"
      >
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

      {/* requireRate는 켜 둔다 — 미선택 승인은 서버가 400으로 막고(05 §2), 힌트 문구도
          DecisionActions가 이미 갖고 있다. 읽기 전용 데모 처리도 그쪽에 있으므로 여기서
          다시 하지 않는다 (칩은 눌려도 승인 버튼이 막혀 상태는 바뀌지 않는다) */}
      <DecisionActions cardId={cardId} cardType="INCENTIVE" requireRate selectedRate={rate} />
    </div>
  );
}
