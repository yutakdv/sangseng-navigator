"use client";

import { useId, useState, useTransition } from "react";
import { progressAction } from "@/app/actions";
import type { CardProgress } from "@/types";

/** 4단계 고정 — 05 §2. 승인 시 자동으로 `검토중`에서 시작한다 */
const OPTIONS: CardProgress[] = ["검토중", "추진중", "보류", "완료"];

/**
 * 승인 카드의 추진 상태 셀렉트 (docs/plan/08 F8).
 *
 * 칸반 열 대신 행+셀렉트인 이유: 데모에서 클릭 수가 적고(열기 → 고르기 2번) 390px에서도
 * 가로 스크롤 없이 조작된다 (13 §8). 변경은 서버 액션(`app/actions.ts`)으로만 한다 —
 * `lib/api.ts`는 mock JSON을 정적 import 해서 클라이언트에서 부를 수 없기 때문이다.
 *
 * 성공하면 액션의 revalidate가 페이지를 다시 그린다(칩·KPI·완료 안내가 함께 갱신).
 * 그동안 셀렉트가 옛 값으로 남지 않도록 고른 값을 낙관적으로 표시하고, 실패하면 서버 값으로 되돌린다.
 */
export function ProgressSelect({
  cardId,
  progress,
  disabled = false,
}: {
  cardId: string;
  /** 승인 시 자동으로 `검토중`이 붙지만 계약상 null이 가능하다 — null이면 `검토중`으로 본다 (05 §2) */
  progress: CardProgress | null;
  disabled?: boolean;
  /** 서버 컴포넌트에서 함수를 props로 넘길 수 없다 — 갱신은 액션의 revalidate가 맡는다 */
  onDone?: never;
}) {
  const server: CardProgress = progress ?? "검토중";
  const [value, setValue] = useState<CardProgress>(server);
  const [synced, setSynced] = useState<CardProgress>(server);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // 서버 값이 바뀐 순간에만 로컬 선택값을 맞춘다 — effect 없이 렌더 중 조정하는 React 표준 패턴이라
  // revalidate 직후 한 번의 렌더로 끝나고, 낙관적 표시 중에는 개입하지 않는다(prop이 아직 옛 값이므로).
  if (server !== synced) {
    setSynced(server);
    setValue(server);
  }

  const working = busy || pending;

  const change = (next: CardProgress) => {
    if (next === value) return;
    setError(null);
    setValue(next);
    setBusy(true);
    // React 18의 startTransition은 async 스코프를 기다리지 않는다 — "변경 중" 표시는 busy로 따로 잡고,
    // 트랜지션은 액션이 revalidate한 화면을 논블로킹으로 커밋하는 용도로만 쓴다 (DecisionActions와 동일).
    startTransition(() => {
      progressAction(cardId, next)
        .then((res) => {
          // 409(approved가 아닌 카드)·404는 장애가 아니라 도메인 신호다 — 토스트 없이 문구로 읽힌다 (05 §8)
          if (!res.ok) {
            setValue(server);
            setError(res.detail);
          }
        })
        .catch(() => {
          setValue(server);
          setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        })
        .finally(() => setBusy(false));
    });
  };

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold text-admin-text-muted">
        추진 상태
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled || working}
        aria-busy={working}
        // 보이는 라벨은 카드마다 "추진 상태"로 같아서, 스크린리더로는 여러 셀렉트가 구분되지 않는다.
        // 카드 id를 붙여 어느 카드의 상태인지 읽히게 한다 (13 §4 접근성).
        aria-label={`${cardId} 추진 상태`}
        onChange={(e) => change(e.target.value as CardProgress)}
        className="mt-1.5 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm font-medium text-admin-text shadow-card transition-colors hover:border-admin-primary/50 focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>

      {working ? <p className="u-note mt-1.5">변경 중…</p> : null}

      {error ? (
        <p
          role="alert"
          className="mt-1.5 break-keep rounded-lg bg-state-bad-bg px-2 py-1.5 text-xs leading-5 text-state-bad"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
