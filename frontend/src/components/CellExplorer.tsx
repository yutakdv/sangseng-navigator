"use client";

import { useEffect, useRef, useState } from "react";
import { AssumptionBadge, AssumptionNote, EstimateBadge, ProxyBadge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { SourceChip } from "@/components/SourceChip";
import { josa } from "@/lib/korean";
import type { CellLoad, CellLoadCell } from "@/types";

/**
 * 셀(지역×표시업종) 탐색 시뮬레이터 — "어느 지역부터?"를 화면에서 따져 보는 자리.
 *
 * 인센티브 카드는 **전 지역 공통**이라 지역별 여건 차이를 담지 못한다(그 사실 자체가 카드의
 * 반대 의견 문구다). 이 섹션은 그 빈틈을 메우는 탐색 도구다: 셀 하나와 가정 두 개(민감도·페이백률)를
 * 움직여 **처방 방향**이 수요 측(페이백)에서 공급 측(가맹점 확충)으로 뒤집히는 지점을 보여 준다.
 * 카드 확정과는 무관하다 — 여기서 고른 값은 저장되지 않는다 (절대 규칙 4·6).
 *
 * 클라이언트 컴포넌트다(셀·슬라이더·요율 상태). 데이터는 서버에서 props로 받는다 —
 * `lib/api.ts`는 mock JSON을 정적 import하므로 클라이언트에서 import하지 않는다(api.ts 상단 주석).
 *
 * 수치 계약(임의로 바꾸지 말 것):
 * - 민감도 가정 β = 페이백 1%p당 지역 전환율 개선(%p). 보수 0.15 / 중립 0.30 / 낙관 0.45는
 *   카드의 3·5·7% 시나리오 개선폭(0.5~1.0 / 1.0~2.0 / 2.0~3.0 %p)을 요율로 되나눈 0.17~0.43을
 *   감싸는 값이다.
 * - 감쇠 0.5는 실측이 아니라 팀 설정 상수다. 화면이 그 사실과 근거를 직접 밝힌다(아래 감쇠 블록).
 * - 반전 임계 0.30(=중립)과 딥링크 진입값 0.25, 슬라이더 step 0.05가 맞물려 "한 칸에 반전"이 된다.
 */

/** suppressed를 걸러 낸 뒤의 좁힌 타입 — 값이 공개된 셀 */
type OpenCell = CellLoadCell & { load_index: number; monthly_uses_avg: number };

const BETA_PRESETS = [
  { key: "conservative", label: "보수", value: 0.15 },
  { key: "neutral", label: "중립", value: 0.3 },
  { key: "optimistic", label: "낙관", value: 0.45 },
] as const;

/**
 * 처방 전환 기준선(%p) — 포화로 **포기하는 몫**(격차)이 이 값 이상이면 공급 측으로 돌린다.
 * 판정을 β 하나로 하면 요율을 무시해 화면이 스스로 댄 근거(격차)와 어긋난다: 페이백 7%·β 0.25의
 * 격차(0.87%p)가 3%·β 0.30(0.45%p)보다 큰데 전자만 수요 측으로 남는 모순이 생긴다.
 * 0.75는 기본 조건(페이백 5% · 중립 가정 0.30)에서 포기하는 몫이고, 그 조건에서는 β ≥ 0.30과
 * 정확히 같은 판정이 된다 — 딥링크 시연(0.25 → 한 칸 → 0.30)이 그대로 재현된다.
 */
const FLIP_GAP_PP = 0.75;
/** 부하 상위 셀 포화 감쇠 — 실측 탄력성이 아니라 팀 설정 가정 */
const DAMPING = 0.5;
const RATES = [3, 5, 7] as const;
const TIER_LABEL: Record<string, string> = { high: "상위", mid: "중간", low: "하위" };

/**
 * 민감도 슬라이더가 실제로 갈 수 있는 값들 — 강건성 문장이 훑는 구간이다.
 *
 * 프리셋 세 점만 훑으면 화면이 거짓말을 할 수 있다: 페이백 7%에서는 0.25에서 이미 공급 측인데
 * 프리셋 기준으로는 "0.30 이상에서만"이 되어, 칩 판정과 강건성 문장이 어긋난다. 슬라이더와
 * 같은 눈금을 쓰면 담당자가 손으로 확인할 수 있는 범위와 문장이 정확히 일치한다.
 */
const BETA_MIN = 0.1;
const BETA_MAX = 0.6;
const BETA_STEP = 0.05;
const BETA_STEPS = Array.from(
  { length: Math.round((BETA_MAX - BETA_MIN) / BETA_STEP) + 1 },
  // 0.1 + n×0.05는 부동소수로 0.30000000000000004가 된다 — 슬라이더 onChange와 같은 방식으로 맞춘다
  (_, i) => Math.round((BETA_MIN + i * BETA_STEP) * 100) / 100,
);
const BETA_SPAN = `${BETA_MIN.toFixed(2)}부터 ${BETA_MAX.toFixed(2)}까지`;

const keyOf = (c: { eup: string; category: string }): string => `${c.eup}·${c.category}`;

/**
 * 한 가정 조합(민감도 β · 페이백률)에서의 전망·격차·처방 판정.
 *
 * 부하 상위 셀은 페이백을 올려도 개선폭이 절반만 실현된다고 본다(가정). `fullPp`는 같은 조건에서
 * 감쇠가 없는 셀이 얻는 몫으로, 격차를 보여 줘야 감쇠의 의미가 읽힌다.
 *
 * 판정은 **화면에 찍히는 반올림값**으로 한다 — 이유는 감사 가능성 하나다. 담당자가 처방 카드의
 * 세 칸(비포화 셀 전망 − 이 셀 전망 = 격차)을 손으로 빼면 판정 근거가 그대로 재현된다.
 * 정확도 문제는 아니다: 요율 3·5·7% × 민감도 0.10~0.60 전 구간에서 원값 판정과 반올림값 판정이
 * 갈리는 지점은 없다.
 *
 * 현재 조건과 프리셋 훑기(강건성 표시)가 같은 함수를 쓴다 — 두 곳이 갈라지면 화면이 "지금 판정"과
 * "가정을 바꿨을 때의 판정"을 서로 다른 규칙으로 말하게 된다.
 */
function outcomeAt(
  tier: string,
  rate: number,
  beta: number,
): { deltaPp: number; fullPp: number; gapPp: number; flipped: boolean } {
  const damped = tier === "high" ? beta * DAMPING : beta;
  const deltaPp = +(rate * damped).toFixed(2);
  const fullPp = +(rate * beta).toFixed(2);
  const gapPp = +(fullPp - deltaPp).toFixed(2);
  return { deltaPp, fullPp, gapPp, flipped: tier === "high" && gapPp >= FLIP_GAP_PP };
}

/** 천 단위 구분 — 서버·브라우저 결과가 항상 같도록 로캘 API를 쓰지 않는다(하이드레이션 불일치 방지) */
const num = (v: number): string => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** 부하 지수·기준선은 소수 1자리 고정 — 34.0이 "34"로 찍히면 같은 지표가 자리마다 달라 보인다 */
const one = (v: number): string => v.toFixed(1);

const chip =
  "min-h-9 rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums transition-colors duration-200";
const chipOn = "bg-admin-primary text-white";
const chipOff =
  "border border-admin-border bg-admin-surface text-admin-text-soft hover:bg-admin-surface-sunken";

export function CellExplorer({
  data,
  initial,
  proxyNote,
  version,
}: {
  data: CellLoad;
  /** 딥링크 프리셋 — 시연에서 반전 직전 상태로 진입시킨다 */
  initial?: { cell?: { eup: string; category: string }; beta?: number };
  /** 근사 지표 배지 툴팁 문구 — 요약 없이 그대로 (절대 규칙 2) */
  proxyNote: string;
  /** 데이터셋 스냅샷 버전 */
  version?: string;
}) {
  // 부하 내림차순. suppressed 셀은 값이 없어 정렬·선택 어느 쪽에도 들어가지 않는다
  const open = data.cells
    .filter(
      (c): c is OpenCell => !c.suppressed && c.load_index !== null && c.monthly_uses_avg !== null,
    )
    .sort((a, b) => b.load_index - a.load_index);
  const hidden = data.cells.filter((c) => c.suppressed);

  const presetKey = initial?.cell ? keyOf(initial.cell) : "";
  // open이 비면(전 셀 억제) keyOf(open[0])이 undefined.eup을 읽어 크래시한다 — 빈 상태에서는
  // 빈 문자열로 둔다. 아래 "cell 없음" 가드가 이후 렌더를 대신 처리한다.
  const [cellKey, setCellKey] = useState(
    open.some((c) => keyOf(c) === presetKey) ? presetKey : open.length ? keyOf(open[0]) : "",
  );
  const [beta, setBeta] = useState(initial?.beta ?? 0.3);
  const [rate, setRate] = useState<number>(5);

  // 훅은 조건 분기보다 먼저, 매 렌더 같은 순서로 호출해야 한다 — 아래 "cell 없음" 조기 반환보다
  // 앞에 둔다. 딥링크로 들어왔을 때만 이 섹션까지 내려 준다 — 시연에서 스크롤을 찾느라 시간을
  // 쓰지 않도록. 일반 진입(프리셋 없음)에서는 화면이 저절로 움직이지 않는다.
  const root = useRef<HTMLDivElement>(null);
  const deepLinked = Boolean(initial?.cell);
  useEffect(() => {
    if (deepLinked) root.current?.closest("section")?.scrollIntoView({ block: "start" });
  }, [deepLinked]);

  const cell = open.find((c) => keyOf(c) === cellKey) ?? open[0];

  // 억제 규칙상 34개 셀이 전부 표본 보호로 비공개 처리될 수 있다 — 현재 데모 데이터(34개 중
  // 32개 공개)에서는 도달하지 않지만, 도달하면 아래 cell.tier 등 접근이 전부 크래시한다.
  // 새 기능을 만들지 않고 빈 상태 문구 한 줄로만 막는다.
  if (!cell) {
    return (
      <div
        ref={root}
        className="rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken p-4 text-center text-sm text-admin-text-muted"
      >
        값이 공개된 셀이 없어 셀 탐색을 표시할 수 없습니다 — 전체 {data.cells.length}개 셀이 표본
        보호로 비공개 처리됐습니다.
      </div>
    );
  }

  const { deltaPp, fullPp, gapPp, flipped } = outcomeAt(cell.tier, rate, beta);

  /**
   * 가정을 바꿨을 때의 판정 — 지금 고른 β 하나로 결론이 정해진 것처럼 보이지 않게 한다.
   * `sweep`은 이름 붙은 프리셋 3종을 나란히 보여 주고, `flipFrom`은 슬라이더 눈금 전체를 훑어
   * 처음 공급 측이 되는 가정을 찾는다. 격차는 β에 비례해 커지므로 반전 지점은 항상 하나다.
   */
  const sweep = BETA_PRESETS.map((p) => ({ ...p, ...outcomeAt(cell.tier, rate, p.value) }));
  const flipFrom = BETA_STEPS.find((b) => outcomeAt(cell.tier, rate, b).flipped);
  const robustness =
    flipFrom === undefined
      ? `이 셀은 페이백 ${rate}% 기준으로 민감도 가정 ${BETA_SPAN} 전 구간에서 수요 측입니다 — 가정을 어디에 놓아도 처방 방향이 바뀌지 않습니다.`
      : flipFrom === BETA_STEPS[0]
        ? `이 셀은 페이백 ${rate}% 기준으로 민감도 가정 ${BETA_SPAN} 전 구간에서 공급 측입니다 — 가정을 어디에 놓아도 처방 방향이 바뀌지 않습니다.`
        : `이 셀은 페이백 ${rate}% 기준으로 민감도 가정 ${flipFrom.toFixed(2)} 이상에서만 공급 측으로 바뀝니다 — 지금 판정은 가정을 어디에 놓느냐에 달려 있습니다.`;

  const rank = open.indexOf(cell) + 1;
  const position =
    cell.tier === "high"
      ? `상위 구간 기준선 ${one(data.thresholds.high)}의 ${one(cell.load_index / data.thresholds.high)}배`
      : cell.tier === "low"
        ? `하위 구간 기준선 ${one(data.thresholds.low)}보다 낮은 값`
        : `중간 구간(하위 기준 ${one(data.thresholds.low)} ~ 상위 기준 ${one(data.thresholds.high)})`;
  const fact = `${cell.eup} ${josa(cell.category, "은/는")} 가맹점 ${cell.merchants}곳이 월 평균 ${num(cell.monthly_uses_avg)}건을 처리합니다 — 가맹점당 ${one(cell.load_index)}건으로 값이 공개된 ${open.length}개 셀 중 ${rank}위, ${position}입니다.`;

  return (
    <div ref={root} className="flex flex-col gap-4">
      {/* ① 셀 선택 ─ 비억제 셀만, 부하 내림차순 ─────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="cell-explorer-cell" className="u-h3">
            탐색할 셀 (지역 × 업종)
          </label>
          <EstimateBadge note={data.method_note} />
        </div>
        <select
          id="cell-explorer-cell"
          value={cellKey}
          onChange={(e) => setCellKey(e.target.value)}
          className="mt-2 w-full rounded-lg border border-admin-border bg-admin-surface px-3 py-2 text-sm font-semibold text-admin-text focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary sm:max-w-lg"
        >
          {open.map((c) => (
            <option key={keyOf(c)} value={keyOf(c)}>
              {c.eup} {c.category} — 가맹점 이용 부하 {one(c.load_index)} ({TIER_LABEL[c.tier]})
            </option>
          ))}
        </select>
        {hidden.length ? (
          <p className="u-note mt-2">
            가맹점 {data.k_anonymity}곳 미만인 셀 {hidden.length}개(
            {hidden.map((c) => `${c.eup} ${c.category}`).join(" · ")})는 개별 사업자가 역산될 수 있어
            값을 비공개 처리했고 이 목록에서도 제외했습니다 — 전체 {data.cells.length}개 중{" "}
            {open.length}개만 선택할 수 있습니다.
          </p>
        ) : null}
      </div>

      {/* ② 민감도 가정 β ─ 슬라이더 + 프리셋 3종 ──────────────────── */}
      <div className="rounded-xl bg-admin-surface-sunken p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor="cell-explorer-beta" className="u-h3">
            민감도 가정 — 페이백 1%p당 지역 전환율 개선폭
          </label>
          <ProxyBadge note={proxyNote} />
          <AssumptionBadge />
          <span className="ml-auto text-lg font-bold tabular-nums text-admin-primary">
            {beta.toFixed(2)}%p
          </span>
        </div>
        <input
          id="cell-explorer-beta"
          type="range"
          min={BETA_MIN}
          max={BETA_MAX}
          step={BETA_STEP}
          value={beta}
          // 슬라이더가 0.1 + n×0.05를 부동소수로 만들면 0.30000000000000004 같은 값이 나온다 —
          // 반전 임계(0.30) 비교와 화면 표기가 어긋나지 않도록 소수 둘째 자리로 맞춘다
          onChange={(e) => setBeta(Math.round(Number(e.target.value) * 100) / 100)}
          aria-describedby="cell-explorer-beta-note"
          aria-valuetext={`페이백 1%p당 지역 전환율 ${beta.toFixed(2)}%p 개선`}
          className="mt-3 w-full cursor-pointer accent-admin-primary"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="민감도 가정 프리셋">
          {BETA_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={beta === p.value}
              onClick={() => setBeta(p.value)}
              className={`${chip} ${beta === p.value ? chipOn : chipOff}`}
            >
              {p.label} {p.value.toFixed(2)}
            </button>
          ))}
        </div>
        <p id="cell-explorer-beta-note" className="u-note mt-2">
          페이백률을 1%p 올릴 때 지역 전환율이 몇 %p 오르는지에 대한 팀 설정 가정입니다(실측 탄력성
          아님). 카드의 3·5·7% 시나리오 개선폭을 각 요율로 되나누면 0.17~0.43이고, 보수·중립·낙관은
          그 범위를 감싸도록 잡았습니다.
        </p>
      </div>

      {/* ③ 페이백률 ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="페이백률 선택">
        <span className="text-xs font-semibold text-admin-text-muted">페이백률</span>
        {RATES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={rate === r}
            onClick={() => setRate(r)}
            className={`${chip} ${rate === r ? chipOn : chipOff}`}
          >
            {r}%
          </button>
        ))}
      </div>

      {/* ④ 처방 카드 ─ 반전 지점. data-tour 앵커는 가이드 투어가 가리킨다 ── */}
      <div
        data-tour="flip"
        className={`rounded-xl p-4 transition-colors duration-200 ${
          flipped
            ? "bg-state-warn-bg"
            : "bg-admin-primary-soft"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* 확정형으로 읽히지 않도록 판정 앞에 조건을 붙인다 — 이 결과는 위에서 고른 가정에서만
              성립한다(실측 탄력성이 아니다). 프리셋 전 구간 판정은 아래 강건성 줄이 따로 말한다 */}
          <span
            className={`inline-flex items-center gap-1.5 break-keep rounded-lg px-2.5 py-1 text-[13px] font-bold text-white transition-colors duration-200 ${
              flipped ? "bg-state-warn" : "bg-admin-primary"
            }`}
          >
            <Icon name={flipped ? "store" : "gift"} size={14} strokeWidth={2} className="shrink-0" />
            {flipped ? "이 가정에서는 공급 측 우선 — 가맹점 확충" : "이 가정에서는 수요 측 우선 — 페이백·노출"}
          </span>
          <AssumptionBadge />
          <EstimateBadge note={data.method_note} />
          <ProxyBadge note={proxyNote} />
        </div>

        <p className="u-body mt-3 font-semibold">
          {flipped
            ? "선택한 가정에서는 이 지역의 가맹점당 이용 부하가 이미 상위권이라 페이백 증액 효과가 제한적으로 나옵니다 — 이 조건에서는 가맹점 확충이 먼저입니다."
            : "선택한 가정에서는 이 지역의 가맹점이 더 받을 여력이 남아 있어, 페이백 증액분이 그대로 전달될 여지가 큽니다."}
        </p>
        <p className="u-body mt-2 text-admin-text-soft">{fact}</p>

        {/* 감쇠가 걸린 셀은 "얼마를 잃는지"를 나란히 놓아야 판정이 읽힌다 —
            감쇠가 없는 셀에서는 세 값이 같아지므로 한 칸만 그린다 */}
        <div
          className={`mt-3 grid grid-cols-1 gap-2 ${cell.tier === "high" ? "sm:grid-cols-3" : ""}`}
        >
          <div className="rounded-lg bg-admin-surface p-3">
            <p className="u-note">
              페이백 {rate}% · 민감도 {beta.toFixed(2)}에서 지역 전환율 개선 전망
            </p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-admin-text">
              +{deltaPp.toFixed(2)}%p
            </p>
          </div>
          {cell.tier === "high" ? (
            <>
              <div className="rounded-lg bg-admin-surface p-3">
                <p className="u-note">같은 조건에서 포화되지 않은 셀의 전망</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-admin-text-muted">
                  +{fullPp.toFixed(2)}%p
                </p>
              </div>
              <div className="rounded-lg bg-admin-surface p-3">
                <p className="u-note">포화로 벌어지는 격차</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-admin-text">
                  {gapPp.toFixed(2)}%p
                </p>
              </div>
            </>
          ) : null}
        </div>

        {flipped ? (
          <p className="u-body mt-3 text-admin-text-soft">
            같은 재원을 써도 이 셀이 가져가는 몫은 포화되지 않은 셀의 절반입니다. 이 조건에서 포기하는
            몫은 {gapPp.toFixed(2)}%p로 전환 기준선 {FLIP_GAP_PP.toFixed(2)}%p를 넘습니다 — 병목이
            수요가 아니라 가맹점 수라는 뜻이므로, 이 구간에서는 하이원포인트 가맹점 확충을 먼저 놓는
            편이 근거가 섭니다.
          </p>
        ) : null}

        {/* 민감도 범위 ─ 지금 고른 β 하나가 아니라 프리셋 전 구간에서 판정이 어떻게 되는지.
            점추정 하나로 결론이 정해진 것처럼 보이면 설정값이 실측처럼 읽힌다 */}
        <div className="mt-3 rounded-lg bg-admin-surface p-3">
          <p className="u-note">
            민감도 가정을 바꾸면 — 페이백 {rate}% 고정, 프리셋 {sweep.length}종
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {sweep.map((s) => (
              <li
                key={s.key}
                className={`break-keep rounded-lg px-2.5 py-1 text-[13px] font-bold tabular-nums ${
                  s.flipped
                    ? "bg-state-warn-bg text-state-warn"
                    : "bg-admin-primary-soft text-admin-primary"
                }`}
              >
                {s.label} {s.value.toFixed(2)} · {s.flipped ? "공급 측" : "수요 측"}
                <span className="font-medium">
                  {" "}
                  (
                  {cell.tier === "high"
                    ? `격차 ${s.gapPp.toFixed(2)}%p`
                    : `전망 +${s.deltaPp.toFixed(2)}%p`}
                  {s.value === beta ? " · 지금" : ""})
                </span>
              </li>
            ))}
          </ul>
          <p className="u-note mt-2">{robustness}</p>
        </div>

        <AssumptionNote className="mt-3" />
      </div>

      {/* ⑤ 감쇠·판정 규칙 공개 ─ "왜 0.5인가"에 화면이 답한다 ────────── */}
      <div className="rounded-xl border border-admin-border p-4">
        <h3 className="u-h3 flex flex-wrap items-center gap-1.5">
          <Icon name="scale" size={15} />
          {cell.tier === "high" ? "포화 감쇠 ×0.5 적용 — 가정" : "포화 감쇠 미적용 (×1.0)"}
          <AssumptionBadge />
        </h3>
        {cell.tier === "high" ? (
          <>
            <p className="u-body mt-2 text-admin-text-soft">
              부하 상위 구간(값이 공개된 셀의 상위 25%, 기준선 {one(data.thresholds.high)}) 셀은 페이백을
              올려도 개선폭이 절반만 실현된다고 가정했습니다. 0.5는 실측 탄력성이 아니라 팀이 정한
              보수 상수입니다 — 원본 데이터에 금액 컬럼이 없어 한도 소진율을 산출할 수 없기 때문에
              포화를 측정값 대신 상수로 표현했습니다.
            </p>
            <p className="u-body mt-2 text-admin-text-soft">
              감쇠를 아예 적용하지 않아도(×1.0) 가맹점 {cell.merchants}곳이 월 평균{" "}
              {num(cell.monthly_uses_avg)}건을 처리한다는 사실은 변하지 않습니다. 처방 판정의 근거는
              감쇠 상수가 아니라 이 부하 실측치입니다.
            </p>
            <p className="u-body mt-2 text-admin-text-soft">
              감쇠는 개선폭을 줄일 뿐 음수로 만들지 않습니다. 페이백을 올리면 이 셀의 전망도 함께
              커집니다 — 다만 늘어나는 속도가 절반입니다. 포화가 삼키는 <b className="font-semibold">비율</b>은
              가정상 언제나 절반으로 고정이고, 페이백률이나 민감도 가정을 올릴수록 커지는 것은 그
              절반의 <b className="font-semibold">크기</b>입니다 — 지금 포기하는 몫은 {gapPp.toFixed(2)}%p입니다.
            </p>
          </>
        ) : (
          <p className="u-body mt-2 text-admin-text-soft">
            이 셀은 부하 상위 구간(기준선 {one(data.thresholds.high)})이 아니라 감쇠를 적용하지
            않습니다.
            가맹점이 거래를 더 받을 여력이 있다고 보고, 페이백 증액분을 그대로 반영합니다.
          </p>
        )}
        <p className="u-note mt-2 border-t border-admin-border pt-2">
          판정 규칙 — 부하 상위 구간 셀에서 포화로 <b className="font-semibold">포기하는 몫(격차)</b>이
          기준선 {FLIP_GAP_PP.toFixed(2)}%p 이상이면 처방을 공급 측으로 돌립니다. 위 세 칸에 찍힌
          값으로 그대로 검산할 수 있습니다(비포화 셀 전망 − 이 셀 전망 = 격차). 기준선{" "}
          {FLIP_GAP_PP.toFixed(2)}%p는 페이백 5% · 중립 가정(0.30)에서 포기하는 몫이며, 감쇠 0.5와
          마찬가지로 팀 설정 값입니다. 페이백률과 민감도 가정 중 어느 쪽을 올려도 포기하는 몫은
          함께 커지므로, 두 조작 모두 판정에 반영됩니다.
        </p>
      </div>

      {/* ⑥ 산식·출처·성격 고지 ─────────────────────────────────── */}
      <div className="border-t border-admin-border pt-3">
        <p className="u-note">{data.method_note}</p>
        <p className="u-note mt-1">
          이 탐색은 처방 방향을 견줘 보는 의사결정 근거 제공 도구입니다. 여기서 고른 셀·가정은 카드에
          저장되지 않으며, 인센티브 카드의 확정 페이백률은 위 시나리오 표에서 담당자가 고른 값만
          반영됩니다.
        </p>
        <div className="mt-2">
          <SourceChip
            label="하이원포인트 사용현황 외 1종"
            datasets={["하이원포인트 사용현황(월별)", "하이원포인트 가맹점 상세정보"]}
            baseNote={`기준월 ${data.base_month} · 집계 창 ${data.window_months.join(" · ")}`}
            approx
            version={version}
          />
        </div>
      </div>
    </div>
  );
}
