import type { ReactNode } from "react";
import { DeltaValue, type DeltaValueProps } from "@/components/DeltaValue";
import { Icon, type IconName } from "@/components/Icon";

/**
 * KPI 타일 — 라벨·값·부가설명 (docs/plan/08 F2 · 13 §6 "KPI 값 700 굵기 28~36px").
 * 값이 `—`면 05 §8의 "분모 0 → null" 케이스다. 지어낸 수치로 채우지 않는다.
 *
 * 라벨(13px 보조색) → 값(32px 굵게) → 증감 칩 → 설명(12px)으로 네 단계를 벌려 둔다.
 * 이전에는 라벨 14px·설명 12px이라 값 말고는 전부 같은 무게로 뭉쳐 보였다.
 * 증감은 방향색과 함께 `DeltaValue`의 ▲/▼·스크린리더 문구로도 읽힌다 (색만으로 전달 금지, 13 §4).
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
  /** 증감 표기: 원값으로 방향과 표기를 함께 결정하고 기준 문구("전분기 대비")를 곁들인다. */
  delta?: Omit<DeltaValueProps, "variant" | "className">;
  icon?: IconName;
  accent?: boolean;
}) {
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
        <div className="mt-2">
          <DeltaValue {...delta} />
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
