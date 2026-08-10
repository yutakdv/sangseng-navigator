/** 값이 null이면 `—` (05 §8: 분모 0인 KPI는 null) */
export const dash = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));

export const num = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : v.toLocaleString("ko-KR");

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)}%`;

/** 0~1 비율을 퍼센트로 (adoption_rate 0.33 → "33%") */
export const ratioPct = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;

/**
 * `%`를 값에서 떼어 낸 숫자 부분 — `KpiCard`처럼 단위를 `unit` 슬롯에 따로 받는 자리에서 쓴다.
 * 퍼센트를 값 문자열에 넣으면 32px 값 글자로 커지고, unit으로 넘기면 13px 보조 글자가 된다.
 * KPI 타일은 후자로 통일한다 — 한 행에 두 방식이 섞이면 같은 퍼센트인데 크기가 달라 보인다.
 * 값이 없으면 "—"를 돌려주므로, 호출부는 이때 `unit`을 붙이지 않는다(`pctUnit` 참고).
 */
export const pctNum = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "—" : v.toFixed(digits);

/** `ratioPct`의 숫자 부분 (0.5 → "50") — `pctNum`과 같은 규칙, 입력만 0~1 비율이다 */
export const ratioNum = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined ? "—" : (v * 100).toFixed(digits);

/** 값이 없을 때 단위를 지운다 — `—`에 `%`가 붙어 "— %"가 되지 않게 (05 §8 "분모 0 → null → —") */
export const pctUnit = (v: number | null | undefined): "%" | undefined =>
  v === null || v === undefined ? undefined : "%";

/** 증감 표기 — 부호를 항상 붙인다. 색만으로 의미를 전달하지 않기 위해 기호도 함께 (13 §4) */
export const signed = (v: number | null | undefined, unit = "%p", digits = 1): string =>
  v === null || v === undefined ? "—" : `${v > 0 ? "▲" : v < 0 ? "▼" : ""}${Math.abs(v).toFixed(digits)}${unit}`;

export const signTone = (v: number | null | undefined): "good" | "bad" | "flat" =>
  v === null || v === undefined || v === 0 ? "flat" : v > 0 ? "good" : "bad";

/** "2025-01" → "1월" (12개월 축 라벨) */
export const monthLabel = (month: string): string => `${Number(month.slice(5, 7))}월`;
