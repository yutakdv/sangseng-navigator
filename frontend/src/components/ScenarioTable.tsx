"use client";

import { useState } from "react";
import { AssumptionNote } from "@/components/Badge";
import { DecisionActions } from "@/components/DecisionActions";
import { range } from "@/lib/format";
import type { CardStatus, PaybackRate, Scenario } from "@/types";

/**
 * 페이백률 3/5/7% 시나리오 비교 표 (docs/plan/08 F6 · 05 §2 · 13 §2-13).
 *
 * 라디오 선택 상태를 들고 있어야 해서 클라이언트 컴포넌트다 — 카드 데이터는 서버에서 props로
 * 받는다(`lib/api.ts`는 mock JSON을 정적 import 하므로 클라이언트에서 import 하지 않는다).
 * 고른 값은 `DecisionActions`의 `selectedRate`로 넘어가 승인 body의 `selected_rate`가 된다.
 * **미선택이면 승인 버튼이 비활성**이다 — "AI는 비교 제시, 확정은 담당자 선택"의 화면 증거.
 *
 * 금액·ROI는 표시하지 않는다: 원천 데이터에 금액 필드가 없어 산출할 수 없다 (13 §2-13).
 * 개선폭은 단정하지 않고 `delta_pp` 범위(소수 1자리 고정)와 `budget_note` 정성 표기만 쓴다.
 */
const DECIDED_LABEL: Record<CardStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
  held: "보류",
};

/** delta_pp = [낮은 값, 높은 값] — 막대 길이는 높은 값 기준 (05 §2) */
const hiOf = (s: Scenario): number => s.delta_pp[s.delta_pp.length - 1] ?? 0;

export function ScenarioTable({
  cardId,
  scenarios,
  status,
  selectedRate = null,
  assumptionNote,
}: {
  cardId: string;
  scenarios: Scenario[];
  status: CardStatus;
  /** 승인 시 담당자가 고른 확정 페이백률 — pending·반려·보류에서는 null (05 §2) */
  selectedRate?: PaybackRate | null;
  /** 카드가 실어 보낸 가정 문구 — 있으면 요약 없이 그대로 노출한다 */
  assumptionNote?: string;
}) {
  const editable = status === "pending";
  const [choice, setChoice] = useState<PaybackRate | null>(selectedRate);
  // 결정된 카드는 읽기 전용 — 담당자가 고른 rate만 체크된 채로 남는다
  const checked = editable ? choice : selectedRate;
  // 크기 인코딩 막대는 단색 + 값 직접 표기 (13 §5). 0으로 나누지 않도록 하한을 둔다
  const maxHi = Math.max(...scenarios.map(hiOf), 0.1);

  return (
    <div>
      <div className="u-scroll-x">
        <table className="u-table min-w-[480px]">
          <caption className="sr-only">
            페이백률 시나리오 비교 — 승인 시 이 표에서 고른 페이백률만 확정된다
          </caption>
          <thead>
            <tr>
              <th scope="col">선택</th>
              <th scope="col">페이백률</th>
              <th scope="col">예상 지역 전환율 개선폭</th>
              <th scope="col">재원 부담</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const inputId = `rate-${cardId}-${s.rate}`;
              const on = checked === s.rate;
              return (
                <tr
                  key={s.rate}
                  onClick={editable ? () => setChoice(s.rate) : undefined}
                  data-highlight={on ? "true" : undefined}
                  className={editable ? "cursor-pointer transition-colors hover:bg-admin-surface-sunken" : ""}
                >
                  <td>
                    <input
                      type="radio"
                      id={inputId}
                      name={`payback-rate-${cardId}`}
                      value={s.rate}
                      checked={on}
                      disabled={!editable}
                      onChange={() => setChoice(s.rate)}
                      className="h-[18px] w-[18px] accent-admin-primary"
                    />
                  </td>
                  <td>
                    <label
                      htmlFor={inputId}
                      className={`text-lg tabular-nums ${
                        on ? "font-bold text-admin-primary" : "font-semibold text-admin-text"
                      } ${editable ? "cursor-pointer" : ""}`}
                    >
                      {s.rate}%
                    </label>
                    {/* 색만으로 의미를 전달하지 않는다 (13 §4) — 확정 rate는 텍스트로도 적는다 */}
                    {!editable && selectedRate === s.rate ? (
                      <span className="ml-1.5 whitespace-nowrap rounded-full bg-admin-primary px-1.5 py-0.5 text-[11px] font-semibold text-white">
                        담당자 선택
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <div className="font-semibold tabular-nums text-admin-text">
                      {range(s.delta_pp)}
                    </div>
                    <span className="mt-1.5 flex h-2 w-full min-w-[80px] max-w-[160px] overflow-hidden rounded-full bg-admin-surface-sunken ring-1 ring-inset ring-admin-border">
                      <span
                        className="block h-full rounded-full bg-admin-primary"
                        style={{ width: `${Math.min(100, (hiOf(s) / maxHi) * 100)}%` }}
                      />
                    </span>
                  </td>
                  <td className="text-admin-text-muted">{s.budget_note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {assumptionNote ? <p className="u-note mt-3">{assumptionNote}</p> : null}
      <AssumptionNote className="mt-1.5" />

      <div className="mt-4 rounded-xl bg-admin-surface-sunken p-4">
        {editable ? (
          <>
            <p className="u-note mb-2.5">
              AI는 세 시나리오의 효과·재원 트레이드오프를 비교해 제시할 뿐입니다. 확정 페이백률은
              담당자가 이 표에서 고른 값만 저장됩니다 — 의사결정 근거 제공이 AI의 역할입니다.
            </p>
            <DecisionActions cardId={cardId} requireRate selectedRate={choice} />
          </>
        ) : selectedRate ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-admin-text">
            담당자가 선택한 페이백률{" "}
            <b className="text-2xl font-bold tabular-nums text-admin-primary">{selectedRate}%</b>
            <span className="u-note">
              (승인 시 확정된 값 — 방문객 위젯의 페이백 배지도 이 값을 씁니다)
            </span>
          </p>
        ) : (
          <p className="u-note">
            {DECIDED_LABEL[status]} 처리된 카드라 확정된 페이백률이 없습니다. 시나리오 비교는
            기록으로 남깁니다.
          </p>
        )}
      </div>
    </div>
  );
}
