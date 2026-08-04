import type { ReactNode } from "react";
import { CountUp } from "@/components/CountUp";
import { Icon, type IconName } from "@/components/Icon";
import { Sparkline } from "@/components/Sparkline";
import { signTone } from "@/lib/format";

/**
 * 허브 상단 지표 타일 (docs/plan/13 §3 "상단 KPI 타일 4개" · §6).
 *
 * `KpiCard`(다른 담당자 화면용)와 나란히 두는 이유: 허브는 **값 + 12개월 문맥 + 증감**을 한 타일
 * 안에서 동시에 읽혀야 하는 유일한 화면이라 구성 요소가 다르다. 다른 화면까지 이 밀도로 올리면
 * 목록·표 화면에서 타일이 본문을 눌러 버린다.
 *
 * 읽는 순서를 네 단으로 벌려 둔다:
 *   ① 라벨 + 고지 배지(13px) → ② 값(40px) + 단위 → ③ 증감 칩(기준 문구 포함) →
 *   ④ 12개월 스파크라인(카드 아래끝까지 꽉 채움) → ⑤ 산식 각주
 *
 * 규정:
 * - `badge`로 `근사 지표`를 받는다 — "지역 전환율" 타일은 이 배지 없이 렌더하지 않는다 (절대 규칙 2)
 * - 증감은 색과 함께 `signed()`의 ▲/▼ 기호로도 읽힌다 (색만으로 전달 금지, 13 §4)
 * - 값이 `—`면 05 §8의 "분모 0 → null" 케이스다. 지어낸 수치로 채우지 않는다
 */
export function MetricTile({
  label,
  sparkId,
  icon,
  badge,
  value,
  digits = 0,
  suffix = "",
  unit,
  delta,
  note,
  trend,
  trendNote,
  meter,
  accent = false,
  /** 진입 연출 단 — 타일 인덱스 × 60ms */
  delay = 0,
}: {
  label: string;
  /** 스파크라인 그라디언트 id — ASCII 슬러그(한글 금지, Sparkline 주석 참고) */
  sparkId: string;
  icon: IconName;
  badge?: ReactNode;
  /** null이면 `—` (05 §8) */
  value: number | null;
  digits?: number;
  /** 값에 바로 붙는 기호 — % 등 */
  suffix?: string;
  /** 값과 띄워 쓰는 단위 — "건", "/ 100" 등 */
  unit?: string;
  delta?: { text: string; raw: number | null; note: string };
  note: ReactNode;
  /** 12개월 시계열 — 없으면 스파크라인을 그리지 않는다 */
  trend?: number[];
  /** 스파크라인 좌측 하단에 붙는 기간 라벨 */
  trendNote?: string;
  /** 시계열이 없는 지표(AI 제안 안정도)용 0~100 게이지 */
  meter?: number;
  accent?: boolean;
  delay?: number;
}) {
  const tone = delta ? signTone(delta.raw) : "flat";
  const deltaTone =
    tone === "good"
      ? "bg-state-good-bg text-state-good ring-state-good-line"
      : tone === "bad"
        ? "bg-state-bad-bg text-state-bad ring-state-bad-line"
        : "bg-admin-surface-sunken text-admin-text-muted ring-admin-border";

  return (
    <div
      style={{ animationDelay: `${delay}ms` }}
      className={`group animate-rise u-float-hover relative flex min-w-0 flex-col overflow-hidden rounded-panel shadow-float ring-1 ring-inset ${
        accent
          ? "bg-gradient-to-b from-admin-primary-soft via-admin-surface to-admin-surface ring-admin-primary-line"
          : "bg-admin-surface ring-admin-border/70"
      }`}
    >
      <div className="flex min-w-0 flex-col p-5 pb-3 2xl:p-6 2xl:pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-transform duration-200 group-hover:scale-105 ${
              accent
                ? "bg-admin-primary text-white shadow-[0_4px_12px_-4px_rgb(79_70_229_/_0.9)]"
                : "bg-admin-surface-sunken text-admin-text-muted"
            }`}
          >
            <Icon name={icon} size={17} />
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1">
            <span className="break-keep text-[13px] font-semibold leading-5 text-admin-text-muted">
              {label}
            </span>
            {badge}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <p className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={`text-[34px] font-bold leading-none tracking-[-0.035em] tabular-nums 2xl:text-[40px] ${
                accent ? "text-admin-primary" : "text-admin-text"
              }`}
            >
              {value === null ? (
                "—"
              ) : (
                <CountUp value={value} digits={digits} suffix={suffix} />
              )}
            </span>
            {unit ? (
              <span className="text-[13px] font-semibold text-admin-text-muted">{unit}</span>
            ) : null}
          </p>

          {delta ? (
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold leading-5 tabular-nums ring-1 ring-inset ${deltaTone}`}
              >
                {delta.text}
              </span>
              <span className="text-[11px] leading-4 text-admin-text-muted">{delta.note}</span>
            </span>
          ) : null}
        </div>

        <p className="mt-3 break-keep border-t border-admin-border pt-2.5 text-xs leading-[1.6] text-admin-text-muted">
          {note}
        </p>
      </div>

      {/*
       * 타일 바닥은 네 장 모두 "문맥 띠"다 — 시계열이 있으면 스파크라인, 없으면 게이지.
       * 자리를 통일해야 4장이 한 줄로 훑어지고, 시계열 없는 타일만 아래가 비지 않는다.
       *
       * ⚠ 스파크라인은 관측 구간에 맞춰 세로를 꽉 채운다(관례). 집중도처럼 41~43으로 거의 움직이지
       *    않는 지수는 그 자동 확대 때문에 급등락처럼 보이므로, `trendNote`에 **관측 범위를 숫자로**
       *    함께 적어 모양과 크기를 같이 읽게 한다.
       */}
      {trend && trend.length > 1 ? (
        <div className="relative mt-auto pt-2">
          {trendNote ? (
            <span className="pointer-events-none absolute -top-0.5 left-5 z-10 text-[10px] font-semibold tracking-tight text-admin-text-muted 2xl:left-6">
              {trendNote}
            </span>
          ) : null}
          <Sparkline data={trend} id={sparkId} height={40} />
        </div>
      ) : meter !== undefined ? (
        <div className="mt-auto px-5 pb-5 pt-3 2xl:px-6">
          {trendNote ? (
            <span className="mb-2 block text-[10px] font-semibold tracking-tight text-admin-text-muted">
              {trendNote}
            </span>
          ) : null}
          <Meter value={meter} />
        </div>
      ) : (
        <div className="h-3" />
      )}
    </div>
  );
}

/**
 * 시계열이 없는 지표용 10칸 게이지 (AI 제안 안정도).
 * 스파크라인 자리를 빈 칸으로 두면 타일 4장의 높이가 어긋나고, 없는 시계열을 지어내면 허위 표기가
 * 된다 — 값 하나를 그대로 눈금으로 옮긴 게이지가 둘 다 피하는 표기다.
 */
function Meter({ value }: { value: number }) {
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 10);
  return (
    <div aria-hidden className="flex gap-1">
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          style={{ animationDelay: `${240 + i * 45}ms` }}
          className={`h-1.5 flex-1 origin-left animate-grow rounded-full ${
            i < filled ? "bg-admin-primary" : "bg-admin-surface-sunken"
          }`}
        />
      ))}
    </div>
  );
}
