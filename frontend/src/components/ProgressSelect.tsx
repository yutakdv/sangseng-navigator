"use client";

import Link from "next/link";
import { useId, useState, useSyncExternalStore, useTransition } from "react";
import { progressAction } from "@/app/actions";
import { EXPANSION_PROGRESS, INCENTIVE_PROGRESS, allowedProgress } from "@/lib/cardWorkflow";
import { isDemoReadOnly } from "@/lib/runtime";
import type { CardProgress, CardType } from "@/types";


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
/** sessionStorage는 구독할 이벤트가 없다 — 스냅숏만 읽는 useSyncExternalStore용 무동작 구독 */
const subscribeNoop = () => () => {};

/** 방금(8초 내) 저장한 기록의 시각 라벨 — 지났거나 없으면 null. 외부 저장소 읽기라 스냅숏 함수에 둔다 */
function readFreshSavedLabel(key: string): string | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { label, at } = JSON.parse(raw) as { label: string; at: number };
    return Date.now() - at < 8_000 ? label : null;
  } catch {
    return null;
  }
}

export function ProgressSelect({
  cardId,
  progress,
  cardType,
  verificationStatus = "unverified",
  progressBeforeHold = null,
  disabled = false,
}: {
  cardId: string;
  /** 승인 시 자동으로 `검토중`이 붙지만 계약상 null이 가능하다 — null이면 `검토중`으로 본다 (05 §2) */
  progress: CardProgress | null;
  cardType: CardType;
  verificationStatus?: "unverified" | "verified" | "ineligible";
  /** 보류 해제 시 돌아갈 직전 단계 — card.progress_before_hold (05 §2) */
  progressBeforeHold?: CardProgress | null;
  disabled?: boolean;
  /** 서버 컴포넌트에서 함수를 props로 넘길 수 없다 — 갱신은 액션의 revalidate가 맡는다 */
  onDone?: never;
}) {
  const server: CardProgress =
    cardType === "EXPANSION" && progress === "검토중"
      ? "후보 접촉·검토 시작"
      : progress ?? (cardType === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");
  const [value, setValue] = useState<CardProgress>(server);
  const [synced, setSynced] = useState<CardProgress>(server);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 완료 전환 성공 직후 — 위젯 반영을 확인하러 가는 동선을 그 자리에서 보여준다 */
  const [justCompleted, setJustCompleted] = useState(false);
  /** 저장 성공 시각 — "변경 중…"이 사라진 뒤에도 저장됐다는 사실이 화면에 남게 한다 */
  const [savedAtState, setSavedAt] = useState<string | null>(null);
  const id = useId();

  // 상태 변경 성공 시 revalidate로 카드가 목록에서 재정렬되면 이 컴포넌트가 리마운트되어
  // state가 사라진다 — 방금 저장한 기록을 sessionStorage로 이어받아 칩을 유지한다.
  // useSyncExternalStore라 서버 스냅숏은 null(SSR에 칩 없음)이고 하이드레이션과 어긋나지 않는다.
  const savedKey = `progress-saved-${cardId}`;
  const restoredLabel = useSyncExternalStore(
    subscribeNoop,
    () => readFreshSavedLabel(savedKey),
    () => null,
  );
  const savedAt = savedAtState ?? restoredLabel;

  // 서버 값이 바뀐 순간에만 로컬 선택값을 맞춘다 — effect 없이 렌더 중 조정하는 React 표준 패턴이라
  // revalidate 직후 한 번의 렌더로 끝나고, 낙관적 표시 중에는 개입하지 않는다(prop이 아직 옛 값이므로).
  if (server !== synced) {
    setSynced(server);
    setValue(server);
  }

  const working = busy || pending;
  const options = cardType === "EXPANSION" ? EXPANSION_PROGRESS : INCENTIVE_PROGRESS;
  const verificationLocked = cardType === "EXPANSION" && verificationStatus !== "verified";

  // 서버가 거부할 전환은 옵션에서 미리 닫는다 — 규칙은 lib/cardWorkflow.allowedProgress 한 곳에만 둔다
  const allowed = allowedProgress({
    cardType,
    current: server,
    beforeHold: progressBeforeHold,
    verified: !verificationLocked,
  });
  const selectable = options.filter((o) => o !== value && allowed.has(o));

  const change = (next: CardProgress) => {
    if (next === value) return;
    setError(null);
    setJustCompleted(false);
    setSavedAt(null);
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
            return;
          }
          const now = new Date();
          const label = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
          setSavedAt(label);
          try {
            sessionStorage.setItem(savedKey, JSON.stringify({ label, at: now.getTime() }));
          } catch {
            /* storage 불가 환경은 현재 마운트의 state로만 표시된다 */
          }
          if (next === "완료") setJustCompleted(true);
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
        disabled={disabled || isDemoReadOnly || working}
        aria-busy={working}
        // 보이는 라벨은 카드마다 "추진 상태"로 같아서, 스크린리더로는 여러 셀렉트가 구분되지 않는다.
        // 카드 id를 붙여 어느 카드의 상태인지 읽히게 한다 (13 §4 접근성).
        aria-label={`${cardId} 추진 상태`}
        onChange={(e) => change(e.target.value as CardProgress)}
        className="mt-1.5 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm font-medium text-admin-text shadow-card transition-colors hover:border-admin-primary/50 focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o} value={o} disabled={o !== value && !allowed.has(o)}>
            {o}
          </option>
        ))}
      </select>

      {/* 어떤 옵션이 왜 닫혀 있는지 — 지금 갈 수 있는 곳만 말한다 (감사 가능한 순차 전이) */}
      {value === "완료" ? (
        <p className="u-note mt-1.5">완료된 업무는 이전 단계로 되돌릴 수 없습니다.</p>
      ) : selectable.length ? (
        <p className="u-note mt-1.5">지금은 {selectable.join(" · ")}(으)로만 변경할 수 있습니다.</p>
      ) : null}

      {verificationLocked ? (
        <p className="u-note mt-1.5">
          필수 적격성 5개 항목 확인 전에는 적격성 확인·가맹 심사·추진·완료를 선택할 수 없습니다.
        </p>
      ) : null}

      {isDemoReadOnly ? <p className="u-note mt-1.5">공개 데모 읽기 전용</p> : null}

      {working ? <p className="u-note mt-1.5">변경 중…</p> : null}

      {savedAt && !working && !justCompleted && !error ? (
        <p className="mt-1.5 rounded-lg bg-state-good-bg px-2 py-1.5 text-xs leading-5 text-state-good">
          저장됨 · {savedAt}
        </p>
      ) : null}

      {/* 반영 "확정"을 단정하지 않는다 — 이 컴포넌트는 카드 데이터가 없어 반영 조건
          (확충: 타깃 읍×업종에 가맹점 존재, 인센티브: selected_rate 확정)을 알 수 없다.
          정확한 반영 여부는 같은 행의 DoneNote가 카드 조건을 보고 말해 준다. */}
      {justCompleted ? (
        <p className="mt-1.5 break-keep rounded-lg bg-state-good-bg px-2 py-1.5 text-xs leading-5 text-state-good">
          완료로 기록했습니다 — 방문객 위젯 반영 여부를 확인해 보세요.{" "}
          <Link href="/widget?live=1" className="font-bold underline underline-offset-4">
            위젯에서 확인
          </Link>
        </p>
      ) : null}

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
