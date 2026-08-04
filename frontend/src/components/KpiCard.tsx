import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { signTone } from "@/lib/format";

/**
 * KPI 타일 — 라벨·값·부가설명 (docs/plan/08 F2 · 13 §6 "KPI 값 700 굵기 28~36px").
 * 값이 `—`면 05 §8의 "분모 0 → null" 케이스다. 지어낸 수치로 채우지 않는다.
 *
 * 라벨(13px 보조색) → 값(32px 굵게) → 증감 칩 → 설명(12px)으로 네 단계를 벌려 둔다.
 * 이전에는 라벨 14px·설명 12px이라 값 말고는 전부 같은 무게로 뭉쳐 보였다.
 * 증감은 색과 함께 `signed()`가 붙이는 ▲/▼ 기호로도 읽힌다 (색만으로 전달 금지, 13 §4).
 */
export function KpiCard({
  label,
  value,
  unit,
  badge,
  sub,
  delta,
  icon,
  /** 화면의 대표 지표 하나만 — 인디고 톤으로 한 단계 띄운다 */
  accent = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  /** `근사 지표` 등 고지 배지 — 라벨 옆에 붙는다 */
  badge?: ReactNode;
  sub?: ReactNode;
  /** 증감 표기: 이미 포맷된 문자열 + 방향 판단용 원값 + 기준 문구("전분기 대비") */
  delta?: { text: string; raw: number | null; note?: string };
  icon?: IconName;
  accent?: boolean;
}) {
  const tone = delta ? signTone(delta.raw) : "flat";
  const deltaTone =
    tone === "good"
      ? "bg-state-good-bg text-state-good"
      : tone === "bad"
        ? "bg-state-bad-bg text-state-bad"
        : "bg-admin-surface-sunken text-admin-text-muted";

  return (
    <div
      className={`flex min-w-0 flex-col rounded-card border bg-admin-surface p-4 shadow-card transition-shadow hover:shadow-card-hover sm:p-[18px] ${
        accent ? "border-admin-primary-line ring-1 ring-inset ring-admin-primary/10" : "border-admin-border"
      }`}
    >
      <div className="flex items-start gap-2">
        {icon ? (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              accent
                ? "bg-admin-primary text-white"
                : "bg-admin-surface-sunken text-admin-text-muted"
            }`}
          >
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pt-0.5">
          <span className="break-keep text-[13px] font-medium leading-5 text-admin-text-muted">
            {label}
          </span>
          {badge}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span
          className={`text-[32px] font-bold leading-none tracking-[-0.02em] tabular-nums ${
            accent ? "text-admin-primary" : "text-admin-text"
          }`}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[13px] font-medium text-admin-text-muted">{unit}</span>
        ) : null}
      </div>

      {delta ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold leading-5 tabular-nums ${deltaTone}`}
          >
            {delta.text}
          </span>
          {delta.note ? <span className="u-note">{delta.note}</span> : null}
        </div>
      ) : null}

      {sub ? (
        <div className="mt-2.5 break-keep border-t border-admin-border pt-2.5 text-xs leading-[1.55] text-admin-text-muted">
          {sub}
        </div>
      ) : null}
    </div>
  );
}
