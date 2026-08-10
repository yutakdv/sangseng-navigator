import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { sentenceLines } from "@/lib/sentences";

/**
 * 본문 패널 (docs/plan/13 §6).
 *
 * 제목이 14px, 설명이 12px이던 시절엔 둘의 차이가 2px뿐이라 패널 안에서 무엇이 제목인지
 * 읽히지 않았다. 제목은 17px 굵게, 설명은 13px 보조색으로 벌려 둔다 — 설명 문단은 규정상
 * 반드시 실어야 하는 문구가 많아서(13 §9) 지우는 대신 **무게만 낮춘다**.
 */
export function Section({
  title,
  icon,
  badge,
  desc,
  right,
  children,
  id,
}: {
  title: string;
  icon?: IconName;
  badge?: ReactNode;
  desc?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="u-panel scroll-mt-28">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-2.5">
          {icon ? (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-admin-surface-sunken text-admin-text-muted">
              <Icon name={icon} size={16} />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="u-h2">{title}</h2>
              {badge}
            </div>
            {/* 폭 제한 없음 — 패널이 이미 폭을 정한다 (PageHeader의 lede와 같은 규칙) */}
            {desc ? (
              <p className="mt-1.5 break-keep text-[13px] leading-[1.6] text-admin-text-muted">
                {sentenceLines(desc)}
              </p>
            ) : null}
          </div>
        </div>
        {right ? <div className="ml-auto shrink-0 pt-0.5">{right}</div> : null}
      </div>
      <div className="min-w-0 px-4 pb-4 pt-4 sm:px-5 sm:pb-5">{children}</div>
    </section>
  );
}

/**
 * 화면 안의 블록 묶음 제목 — 패널 여러 장을 "진단 / 운영 / 근거"처럼 나눌 때 쓴다.
 * 대시보드처럼 패널이 8장 넘게 쌓이는 화면에서 지금 보는 게 어느 묶음인지 잃지 않게 하는 장치다.
 */
export function GroupHeading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-0.5">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.12em] text-admin-text-muted">
        {children}
      </h2>
      {note ? <span className="u-note">{note}</span> : null}
      <span aria-hidden className="h-px min-w-8 flex-1 bg-admin-border" />
    </div>
  );
}
