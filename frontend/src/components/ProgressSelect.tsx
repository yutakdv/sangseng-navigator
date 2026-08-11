"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { progressAction } from "@/app/actions";
import { needsRecordForm, normalizedProgress, progressOptions } from "@/lib/cardWorkflow";
import { isDemoReadOnly } from "@/lib/runtime";
import type { Card, CardProgress } from "@/types";

/**
 * 승인 카드의 추진 상태 셀렉트 (docs/plan/08 F8).
 *
 * 칸반 열 대신 행+셀렉트인 이유: 데모에서 클릭 수가 적고(열기 → 고르기 2번) 390px에서도
 * 가로 스크롤 없이 조작된다 (13 §8). 변경은 서버 액션(`app/actions.ts`)으로만 한다 —
 * `lib/api.ts`는 정적 JSON을 import 해서 클라이언트에서 부를 수 없기 때문이다.
 *
 * **어떤 단계를 고를 수 있는지는 서버가 정한다.** 카드 응답의 허용 목록을 그대로 쓰고 화면은
 * 표시 순서만 입힌다 — 예전에는 여기서 적격성 게이트만 복제해, 순차 전이·보류 재개 규칙을
 * 어기는 선택지를 정상으로 보여준 뒤 고르면 409가 났다. 못 고르는 이유도 서버 문구를 그대로 쓴다.
 *
 * 성공하면 액션의 revalidate가 페이지를 다시 그린다(칩·KPI·완료 안내가 함께 갱신).
 * 그동안 셀렉트가 옛 값으로 남지 않도록 고른 값을 낙관적으로 표시하고, 실패하면 서버 값으로 되돌린다.
 */
export function ProgressSelect({
  card,
  disabled = false,
}: {
  card: Card;
  disabled?: boolean;
  /** 서버 컴포넌트에서 함수를 props로 넘길 수 없다 — 갱신은 액션의 revalidate가 맡는다 */
  onDone?: never;
}) {
  const cardId = card.id;
  const server: CardProgress =
    normalizedProgress(card) ?? (card.type === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");
  const [value, setValue] = useState<CardProgress>(server);
  const [synced, setSynced] = useState<CardProgress>(server);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 이 경로로는 만들 수 없는 단계를 고른 경우 — 서버가 준 이유와 함께 추진 기록 폼으로 보낸다 */
  const [recordHint, setRecordHint] = useState<string | null>(null);
  /** 완료 전환 성공 직후 — 위젯 반영을 확인하러 가는 동선을 그 자리에서 보여준다 */
  const [justCompleted, setJustCompleted] = useState(false);
  const id = useId();

  // 서버 값이 바뀐 순간에만 로컬 선택값을 맞춘다 — effect 없이 렌더 중 조정하는 React 표준 패턴이라
  // revalidate 직후 한 번의 렌더로 끝나고, 낙관적 표시 중에는 개입하지 않는다(prop이 아직 옛 값이므로).
  if (server !== synced) {
    setSynced(server);
    setValue(server);
  }

  const working = busy || pending;
  const options = progressOptions(card);
  // 같은 이유가 여러 단계에 붙는 경우가 많다(예: 다음 단계 하나만 허용) — 문장 단위로 접어 보여 준다
  const blockedReasons = [
    ...new Set(
      options
        .filter((option) => !option.allowed && option.reason)
        .map((option) => option.reason as string),
    ),
  ];

  const change = (next: CardProgress) => {
    if (next === value) return;
    setError(null);
    setRecordHint(null);
    setJustCompleted(false);
    const option = options.find((o) => o.value === next);
    // 완료처럼 증빙이 필요한 단계는 빠른 상태 변경으로 만들 수 없다(보내면 422) —
    // 요청을 보내지 않고 서버가 준 안내와 함께 추진 기록 폼으로 유도한다 (05 §2·§8).
    if (option && needsRecordForm(option)) {
      setRecordHint(option.reason ?? null);
      return;
    }
    setValue(next);
    setBusy(true);
    // React 18의 startTransition은 async 스코프를 기다리지 않는다 — "변경 중" 표시는 busy로 따로 잡고,
    // 트랜지션은 액션이 revalidate한 화면을 논블로킹으로 커밋하는 용도로만 쓴다 (DecisionActions와 동일).
    startTransition(() => {
      progressAction(cardId, next)
        .then((res) => {
          // 409(잘못된 전이)·404는 장애가 아니라 도메인 신호다 — 토스트 없이 문구로 읽힌다 (05 §8)
          if (!res.ok) {
            setValue(server);
            setError(res.detail);
            return;
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
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            // 현재 값은 잠겨 있어도 선택 상태를 유지해야 셀렉트가 빈 값으로 보이지 않는다
            disabled={!option.allowed && option.value !== value}
          >
            {option.value}
            {!option.allowed && option.value !== value ? " · 선택 불가" : ""}
          </option>
        ))}
      </select>

      {blockedReasons.length ? (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {blockedReasons.map((reason) => (
            <li key={reason} className="u-note">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      {recordHint ? (
        <p className="mt-1.5 break-keep rounded-lg bg-state-notice-bg px-2 py-1.5 text-xs leading-5 text-state-notice">
          {recordHint}{" "}
          <Link
            href={`/tracking/new?card_id=${encodeURIComponent(cardId)}`}
            className="font-bold underline underline-offset-4"
          >
            추진 기록 입력으로
          </Link>
        </p>
      ) : null}

      {isDemoReadOnly ? <p className="u-note mt-1.5">공개 데모 읽기 전용</p> : null}

      {working ? <p className="u-note mt-1.5">변경 중…</p> : null}

      {/* 반영 "확정"을 단정하지 않는다 — 배지는 완료가 아니라 가맹 등록 ID 확인 이후에 붙는다.
          정확한 반영 여부는 같은 행의 DoneNote가 카드의 확인된 가맹점 ID를 보고 말해 준다. */}
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
