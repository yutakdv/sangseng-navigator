import type { ReactNode } from "react";
import { signTone } from "@/lib/format";

/**
 * KPI 타일 — 라벨·값·부가설명 (docs/plan/08 F2).
 * 값이 `—`면 05 §8의 "분모 0 → null" 케이스다. 지어낸 수치로 채우지 않는다.
 */
export function KpiCard({
  label,
  value,
  unit,
  badge,
  sub,
  delta,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** `근사 지표` 등 고지 배지 — 라벨 옆에 붙는다 */
  badge?: ReactNode;
  sub?: ReactNode;
  /** 증감 표기: 이미 포맷된 문자열 + 방향 판단용 원값 */
  delta?: { text: string; raw: number | null };
}) {
  const tone = delta ? signTone(delta.raw) : "flat";
  const deltaColor =
    tone === "good" ? "text-state-good" : tone === "bad" ? "text-state-bad" : "text-admin-text-muted";

  return (
    <div className="rounded-card bg-admin-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm text-admin-text-muted">{label}</span>
        {badge}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums text-admin-text">{value}</span>
        {unit ? <span className="text-sm text-admin-text-muted">{unit}</span> : null}
      </div>
      {delta ? <div className={`mt-1 text-xs font-medium ${deltaColor}`}>{delta.text}</div> : null}
      {sub ? <div className="mt-1 text-xs leading-4 text-admin-text-muted">{sub}</div> : null}
    </div>
  );
}
