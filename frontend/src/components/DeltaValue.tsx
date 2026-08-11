import type { ReactNode } from "react";

export type DeltaDirection = "up" | "down" | "flat";

export type DeltaValueProps = {
  value: number | readonly number[] | null | undefined;
  /**
   * 값의 부호와 화면 의미가 다를 때만 지정한다.
   * 예: 집중도 개선폭 0.1은 양수 magnitude지만 실제 지표는 감소하므로 `down`.
   */
  direction?: DeltaDirection;
  unit?: string;
  digits?: number;
  variant?: "pill" | "text";
  note?: ReactNode;
  /** 값 부분의 크기·굵기만 조정한다. 방향색은 컴포넌트가 유지한다. */
  className?: string;
};

const DIRECTION = {
  up: {
    glyph: "▲",
    label: "증가",
    pill: "bg-trend-up-bg text-trend-up",
    text: "text-trend-up",
  },
  down: {
    glyph: "▼",
    label: "감소",
    pill: "bg-trend-down-bg text-trend-down",
    text: "text-trend-down",
  },
  flat: {
    glyph: "",
    label: "변동 없음",
    pill: "bg-trend-flat-bg text-trend-flat",
    text: "text-trend-flat",
  },
} as const;

/** 숫자·범위의 증감 방향, 포맷, 비색상 단서를 한곳에서 보장한다. */
export function DeltaValue({
  value,
  direction,
  unit = "%p",
  digits = 1,
  variant = "pill",
  note,
  className = "",
}: DeltaValueProps) {
  const values = Array.isArray(value) ? [...value] : value === null || value === undefined ? [] : [value];
  const unavailable = values.length === 0 || values.some((item) => !Number.isFinite(item));
  const allZero = !unavailable && values.every((item) => item === 0);
  const resolved = unavailable || allZero ? "flat" : (direction ?? inferDirection(values));
  const tone = DIRECTION[resolved];
  const formatted = unavailable ? "—" : formatValue(values, unit, digits);
  const valueClass =
    variant === "pill"
      ? `inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold leading-5 tabular-nums ${tone.pill}`
      : `inline-flex items-center gap-0.5 tabular-nums ${tone.text}`;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`${valueClass} ${className}`}>
        <span className="sr-only">{unavailable ? "데이터 없음" : tone.label}</span>
        {tone.glyph && !unavailable ? <span aria-hidden="true">{tone.glyph}</span> : null}
        <span aria-hidden={unavailable ? "true" : undefined}>{formatted}</span>
      </span>
      {note ? <span className="text-[11px] leading-4 text-admin-text-muted">{note}</span> : null}
    </span>
  );
}

function inferDirection(values: number[]): DeltaDirection {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min >= 0 && max > 0) return "up";
  if (max <= 0 && min < 0) return "down";
  return "flat";
}

function formatValue(values: number[], unit: string, digits: number): string {
  if (values.length === 1) return `${Math.abs(values[0]).toFixed(digits)}${unit}`;

  const endpoints = [Math.abs(values[0]), Math.abs(values[values.length - 1])].sort((a, b) => a - b);
  const [lo, hi] = [endpoints[0].toFixed(digits), endpoints[1].toFixed(digits)];
  // 반올림 후 양끝이 같으면 "0.1~0.1" 같은 무의미한 범위 대신 단일값으로 축약한다
  if (lo === hi) return `${lo}${unit}`;
  return `${lo}~${hi}${unit}`;
}
