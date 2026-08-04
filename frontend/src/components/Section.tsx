import type { ReactNode } from "react";

/** 본문 패널 — 카드 라운드·그림자 기준은 docs/plan/13 §6 */
export function Section({
  title,
  badge,
  desc,
  right,
  children,
  id,
}: {
  title: string;
  badge?: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="min-w-0 rounded-card bg-admin-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-sm font-semibold text-admin-text">{title}</h2>
        {badge}
        {right ? <div className="ml-auto">{right}</div> : null}
      </div>
      {desc ? <p className="-mt-2 mb-3 text-xs leading-5 text-admin-text-muted">{desc}</p> : null}
      <div className="min-w-0">{children}</div>
    </section>
  );
}
