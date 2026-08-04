"use client";

import { useState, useTransition } from "react";
import { simulateAction } from "@/app/actions";
import { AssumptionBadge, AssumptionNote } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { range } from "@/lib/format";
import type { Simulation } from "@/types";

/**
 * "이 후보가 가맹 전환하면?" — 가맹 전환 시 예상 효과 (docs/plan/08 F4 · 05 §2).
 *
 * 표시 라벨은 "가맹 전환 시 예상 효과"로 고정한다. 가맹점은 강원랜드가 지정하는 것이 아니라
 * 사업자가 신청해 심사를 거치는 구조라 "확보"라는 표현을 쓰지 않는다 (05 §2).
 *
 * 결과는 이 컴포넌트 아래에 렌더한다 — 출력 블록마다 `가정 기반 전망` 배지 + 고지 문구가
 * 함께 붙어야 하기 때문이다 (절대 규칙 3). 상태를 바꾸지 않는 호출이라 revalidate도 없다.
 * EXPANSION 전용이며, INCENTIVE 카드에서는 호출부가 버튼 자체를 렌더하지 않는다 (05 §8: 400).
 */
export function SimulateButton({ cardId }: { cardId: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const working = pending || busy;

  const run = () => {
    setError(null);
    setBusy(true);
    // DecisionActions와 같은 이유로 "처리 중" 표시는 busy로 따로 잡는다
    // (React 18의 startTransition은 async 스코프를 기다리지 않는다)
    startTransition(() => {
      simulateAction(cardId)
        .then((res) => {
          if (res.ok) setResult(res.data);
          else {
            setResult(null);
            setError(res.detail);
          }
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(false));
    });
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={run}
        disabled={working}
        aria-busy={working}
        className="inline-flex items-center gap-2 rounded-xl bg-admin-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_6px_18px_-6px_rgb(79_70_229)] transition-colors hover:bg-admin-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon name="sparkle" size={16} strokeWidth={2} />
        {working ? "계산 중…" : result ? "다시 계산" : "이 후보가 가맹 전환하면?"}
      </button>

      {error ? (
        <p
          role="alert"
          className="mt-2 break-keep rounded-lg bg-state-bad-bg px-2.5 py-2 text-xs leading-5 text-state-bad ring-1 ring-inset ring-state-bad-line"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 animate-fade-up rounded-xl bg-admin-primary-soft p-4 ring-1 ring-inset ring-admin-primary-line">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13px] font-bold text-admin-primary">가맹 전환 시 예상 효과</h4>
            <AssumptionBadge />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {/* 지수는 소수 1자리 고정 — 정수로 반올림하면 같은 응답의 delta_pp와 어긋난다 (05 §2) */}
            <Metric
              label="현재 지역 소비 집중도"
              value={result.current_index.toFixed(1)}
              unit="/ 100"
            />
            <Metric
              label="가맹 전환 시 (예상)"
              value={result.projected_index.toFixed(1)}
              unit="/ 100"
            />
            <Metric
              label="변화폭"
              value={range(result.delta_pp)}
              sub="양수 = 집중도 하락 = 개선"
            />
          </div>

          <p className="mt-3 break-keep text-[15px] leading-7 text-admin-text">
            {result.narrative}
          </p>
          <AssumptionNote className="mt-2" />
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-admin-surface px-3.5 py-3 shadow-card">
      <p className="break-keep text-xs font-medium leading-5 text-admin-text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums text-admin-text">{value}</span>
        {unit ? <span className="text-xs text-admin-text-muted">{unit}</span> : null}
      </p>
      {sub ? <p className="mt-0.5 text-xs leading-5 text-admin-text-muted">{sub}</p> : null}
    </div>
  );
}
