"use client";

import { useState, useTransition } from "react";
import { generateAction } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { isDemoReadOnly } from "@/lib/runtime";
import type { CardType } from "@/types";

/**
 * "이번 분기 카드 생성" (docs/plan/08 F3 · 11 §1 2-b 단계).
 *
 * 실 API 모드에서는 스코어링 + LLM 호출이라 **최대 12초(재시도 시 24초)** 가 걸린다.
 * 그 대기가 "고장"으로 보이면 데모가 죽으므로, 누른 즉시 진행 표시와 예상 소요를 함께 띄운다 (11 §1).
 *
 * 결과 분기 (05 §8):
 * - 409 → 장애가 아니라 정상 신호(전 후보가 추진중/완료)다. 에러가 아닌 **안내 문구**로 낸다
 * - 그 밖의 실패 → 서버가 준 `detail`을 그대로 노출한다 (숨기거나 바꿔 쓰지 않는다)
 * - 성공 → 액션의 revalidate가 목록을 다시 그린다. 여기서 카드를 따로 들고 있지 않는다
 */
type Feedback = { tone: "ok" | "notice" | "bad"; text: string };

const TONE: Record<Feedback["tone"], string> = {
  ok: "bg-state-good-bg text-state-good",
  notice: "bg-state-notice-bg text-state-notice",
  bad: "bg-state-bad-bg text-state-bad",
};

export function GenerateCardButton({
  type,
  label = "이번 분기 카드 생성",
}: {
  type: CardType;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const working = busy || pending;

  const run = () => {
    setFeedback(null);
    setBusy(true);
    // React 18의 startTransition은 async 스코프를 기다리지 않는다 — 진행 표시는 busy로 따로 잡고,
    // 트랜지션은 액션이 revalidate한 목록을 논블로킹으로 커밋하는 용도로만 쓴다.
    startTransition(() => {
      generateAction(type)
        .then((res) => {
          if (res.ok) {
            // 서버가 201(신규)/200(중복 가드로 기존 카드)을 구분해 주므로 그대로 말한다 (05 §8).
            // 실호출에서 AI가 이미 대기 중인 타깃을 고르면 200이 나오는 것을 확인했다 (11 §1 2-b).
            const { card, created } = res.data;
            setFeedback({
              tone: created ? "ok" : "notice",
              text: created
                ? `${card.id} 카드를 새로 만들었습니다 — 결정 대기 목록에서 확인하세요.`
                : `${card.id} — 같은 대상(${card.target?.eup} ${card.target?.category})의 결정 대기 카드가 이미 있어 새로 만들지 않고 기존 카드를 불러왔습니다.`,
            });
            return;
          }
          if (res.status === 409) {
            // 후보가 없는 이유가 하나가 아니다 — 승인 대기·진행 중 업무뿐 아니라 **반려·보류
            // 후 재제안 보류 기간**도 후보를 뺀다(05 §8). 서버가 그 사유를 문장으로 주므로
            // 화면이 다시 쓰지 않고 그대로 보여 준다. 문구가 갈리면 담당자가 원인을 잘못 짚는다.
            setFeedback({
              tone: "notice",
              text:
                res.detail ||
                "이번 분기에 새로 제안할 후보가 없습니다 — 승인 대기·진행 중이거나 반려·보류 후 재제안 보류 기간인 후보뿐입니다.",
            });
            return;
          }
          setFeedback({ tone: "bad", text: res.detail });
        })
        .catch(() => {
          setFeedback({
            tone: "bad",
            text: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          });
        })
        .finally(() => setBusy(false));
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:items-end">
      <button
        type="button"
        onClick={run}
        disabled={working || isDemoReadOnly}
        aria-busy={working}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-admin-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-admin-primary-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {working ? (
          <>
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
            AI가 후보를 검토하는 중…
          </>
        ) : (
          <>
            <Icon name="sparkle" size={16} strokeWidth={2} />
            {label}
          </>
        )}
      </button>

      {isDemoReadOnly ? <p className="u-note">공개 데모 읽기 전용</p> : null}

      {/* LLM 대기를 "멈춤"으로 오인하지 않게 하는 장치 (11 §1 · 12 §5) */}
      {working ? (
        <p role="status" className="u-note max-w-xs sm:text-right">
          Score·추진 상태·계절성 등을 종합해 후보를 비교하는 중입니다. 최대 12초(재시도 시 24초)까지
          걸릴 수 있습니다.
        </p>
      ) : null}

      {feedback ? (
        <p
          role={feedback.tone === "bad" ? "alert" : "status"}
          className={`max-w-xs break-keep rounded-lg px-2.5 py-2 text-xs font-medium leading-5 ${TONE[feedback.tone]}`}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
