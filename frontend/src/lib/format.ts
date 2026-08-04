/** 값이 null이면 `—` (05 §8: 분모 0인 KPI는 null) */
export const dash = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));

export const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : v.toLocaleString("ko-KR");

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`;

/** 0~1 비율을 퍼센트로 (adoption_rate 0.33 → "33%") */
export const ratioPct = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;

/** 증감 표기 — 부호를 항상 붙인다. 색만으로 의미를 전달하지 않기 위해 기호도 함께 (13 §4) */
export const signed = (v: number | null | undefined, unit = "%p", digits = 1): string =>
  v === null || v === undefined ? "—" : `${v > 0 ? "▲" : v < 0 ? "▼" : ""}${Math.abs(v).toFixed(digits)}${unit}`;

export const signTone = (v: number | null | undefined): "good" | "bad" | "flat" =>
  v === null || v === undefined || v === 0 ? "flat" : v > 0 ? "good" : "bad";

/** "2025-01" → "1월" (12개월 축 라벨) */
export const monthLabel = (month: string): string => `${Number(month.slice(5, 7))}월`;

/** delta_pp [0.0, 0.1] → "0.0~0.1%p" (05 §2 — 단정 대신 범위) */
export const range = (v: number[] | null | undefined, unit = "%p", digits = 1): string =>
  !v || v.length === 0 ? "—" : `${v[0].toFixed(digits)}~${v[v.length - 1].toFixed(digits)}${unit}`;
