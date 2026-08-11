"use client";

import Link from "next/link";
import { useState } from "react";
import { AssumptionNote } from "@/components/Badge";
import { DeltaValue } from "@/components/DeltaValue";
import { DecisionActions } from "@/components/DecisionActions";
import { PaybackImpactPanel, scenarioHi } from "@/components/PaybackImpactPanel";
import type { Card, CardStatus, PaybackRate, Scenario } from "@/types";

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

export function ScenarioTable({
  cardId,
  scenarios,
  status,
  selectedRate = null,
  assumptionNote,
  avgVisitors = null,
  visitorsBasis = "",
  proxyNote,
  confidence,
  version,
}: {
  cardId: string;
  scenarios: Scenario[];
  status: CardStatus;
  /** 신뢰도 `하` 카드 승인의 확인 근거 게이트 — DecisionActions로 그대로 내려간다 (05 §2) */
  confidence?: Card["confidence"];
  /** 낙관적 잠금 version — 이 화면에서도 동시 변경을 서버가 잡을 수 있게 함께 보낸다 */
  version?: number;
  /** 승인 시 담당자가 고른 확정 페이백률 — pending·반려·보류에서는 null (05 §2) */
  selectedRate?: PaybackRate | null;
  /** 카드가 실어 보낸 가정 문구 — 있으면 요약 없이 그대로 노출한다 */
  assumptionNote?: string;
  /** 최근 3개월 평균 입장 연인원(교대 합산) — 주면 재원 부담 대비 효과 패널을 그린다 */
  avgVisitors?: number | null;
  /** 평균의 근거 기간 라벨 (예: "2025-10~2025-12") */
  visitorsBasis?: string;
  /** 근사 지표 배지 툴팁 문구 — 패널로 그대로 내려간다 (절대 규칙 2) */
  proxyNote?: string;
}) {
  const editable = status === "pending";
  const [choice, setChoice] = useState<PaybackRate | null>(selectedRate);
  const chooseRate = (rate: PaybackRate) => setChoice(rate);
  // 결정된 카드는 읽기 전용 — 담당자가 고른 rate만 체크된 채로 남는다
  const checked = editable ? choice : selectedRate;
  // 크기 인코딩 막대는 단색 + 값 직접 표기 (13 §5). 0으로 나누지 않도록 하한을 둔다
  const maxHi = Math.max(...scenarios.map(scenarioHi), 0.1);

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
                  onClick={editable ? () => chooseRate(s.rate) : undefined}
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
                      onChange={() => chooseRate(s.rate)}
                      onInput={() => chooseRate(s.rate)}
                      onClick={() => chooseRate(s.rate)}
                      className="h-[18px] w-[18px] accent-admin-primary"
                    />
                  </td>
                  <td>
                    <label
                      htmlFor={inputId}
                      onClick={editable ? () => chooseRate(s.rate) : undefined}
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
                    <DeltaValue
                      value={s.delta_pp}
                      unit="%p"
                      variant="text"
                      className="font-semibold"
                    />
                    <span className="mt-1.5 flex h-2 w-full min-w-[80px] max-w-[160px] overflow-hidden rounded-full bg-admin-surface-sunken ring-1 ring-inset ring-admin-border">
                      <span
                        className="block h-full rounded-full bg-admin-primary"
                        style={{ width: `${Math.min(100, (scenarioHi(s) / maxHi) * 100)}%` }}
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

      {/* 라디오 선택(결정 전)·확정 rate(결정 후)를 실시간 강조하는 손익 대비 패널 */}
      {avgVisitors ? (
        <PaybackImpactPanel
          scenarios={scenarios}
          activeRate={checked ?? null}
          avgVisitors={avgVisitors}
          visitorsBasis={visitorsBasis}
          proxyNote={proxyNote}
        />
      ) : null}

      {assumptionNote ? <p className="u-note mt-3">{assumptionNote}</p> : null}
      <AssumptionNote className="mt-1.5" />

      <div className="mt-4 rounded-xl bg-admin-surface-sunken p-4">
        {editable ? (
          <>
            {/* 아래 "예상 효과" 밴드는 AI의 고정 해설이라 선택에 반응하지 않는다 — 담당자가 고른
                시나리오의 수치는 결정 버튼 바로 위에서 즉시 확인시킨다 (표와 같은 delta_pp 원천) */}
            {choice
              ? (() => {
                  const s = scenarios.find((sc) => sc.rate === choice);
                  if (!s) return null;
                  const lo = s.delta_pp[0].toFixed(1);
                  const hi = s.delta_pp[s.delta_pp.length - 1].toFixed(1);
                  return (
                    <p className="mb-2.5 rounded-lg bg-admin-primary-soft px-3 py-2 text-[13px] leading-6 text-admin-text">
                      선택한 <b className="tabular-nums">{choice}%</b> 적용 시 지역 전환율 약{" "}
                      <b className="tabular-nums">{lo === hi ? lo : `${lo}~${hi}`}%p</b> 개선 예상
                      <span className="text-admin-text-muted">
                        {" "}
                        — 가정 기반 전망이며 실제와 다를 수 있음
                      </span>
                    </p>
                  );
                })()
              : null}
            <p className="u-note mb-2.5">
              AI는 세 시나리오의 효과·재원 트레이드오프를 비교해 제시할 뿐입니다. 확정 페이백률은
              담당자가 이 표에서 고른 값만 저장됩니다 — 의사결정 근거 제공이 AI의 역할입니다.
            </p>
            <DecisionActions
              cardId={cardId}
              requireRate
              selectedRate={choice}
              confidence={confidence}
              version={version}
            />
          </>
        ) : selectedRate ? (
          <div>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-admin-text">
              담당자가 선택한 페이백률{" "}
              <b className="text-2xl font-bold tabular-nums text-admin-primary">{selectedRate}%</b>
              <span className="u-note">
                (승인 시 확정된 값 — 방문객 위젯의 페이백 배지도 이 값을 씁니다)
              </span>
            </p>
            {/* 페이백 배지는 승인이 아니라 **완료** 시점에 위젯에 붙는다 (05 §4, store.payback) —
                승인 직후에 "배지 확인" 링크를 주면 빈 위젯을 보게 되므로 흐름을 정확히 적는다 */}
            <p className="u-note mt-2">
              트래킹에서 추진 상태를 <b className="font-semibold text-admin-text">완료</b>로 바꾸면
              방문객 위젯 전 추천 항목에 페이백 배지가 붙습니다.{" "}
              <Link
                href="/widget?live=1"
                className="font-semibold text-admin-primary underline-offset-4 hover:underline"
              >
                위젯 라이브 미리보기 →
              </Link>
            </p>
          </div>
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
