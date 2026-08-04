import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 허브 전용 패널 (docs/plan/13 §6).
 *
 * `Section`(다른 담당자 화면용)과 갈라 둔 이유는 **구성 요소가 하나 더 있기 때문**이다:
 * 허브의 카드는 전부 "제목 → 한 줄 설명 → 시각화 → 핵심 판독(insight) → 다음 행동(action)"
 * 다섯 자리를 채운다. 판독 문장이 없으면 담당자가 차트를 보고 스스로 해석해야 하는데,
 * 이 화면의 목적은 시각화가 아니라 **의사결정 근거 제공**이라 그 해석까지가 화면의 몫이다.
 *
 * `insight`는 지어낸 코멘트가 아니라 **화면에 이미 실린 값을 문장으로 옮긴 것**만 넣는다.
 */
export function Panel({
  id,
  title,
  icon,
  desc,
  badge,
  action,
  insight,
  children,
  className = "",
  /** 진입 연출 단 */
  delay = 0,
  /** 패널 본문에 자체 여백이 있을 때(표·지도) 안쪽 패딩을 끈다 */
  flush = false,
}: {
  id?: string;
  title: string;
  icon?: IconName;
  desc?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  insight?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
  flush?: boolean;
}) {
  return (
    <section
      id={id}
      style={{ animationDelay: `${delay}ms` }}
      className={`u-float u-float-hover animate-rise flex flex-col ${className}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 p-5 pb-4 2xl:p-6 2xl:pb-4">
        <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
          {icon ? (
            <span className="mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-admin-surface-sunken text-admin-text-muted">
              <Icon name={icon} size={17} />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="u-panel-title">{title}</h3>
              {badge}
            </div>
            {desc ? (
              <p className="mt-1.5 max-w-2xl break-keep text-[13px] leading-[1.65] text-admin-text-muted">
                {desc}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="ml-auto shrink-0 pt-0.5">{action}</div> : null}
      </div>

      <div className={`min-w-0 flex-1 ${flush ? "" : "px-5 2xl:px-6"}`}>{children}</div>

      {insight ? (
        <div className="mt-5 border-t border-admin-border bg-admin-surface-sunken/70 px-5 py-3.5 2xl:px-6">
          <p className="flex items-start gap-2 break-keep text-[13px] font-medium leading-[1.6] text-admin-text-soft">
            <Icon
              name="bolt"
              size={14}
              strokeWidth={2}
              className="mt-0.5 text-admin-primary"
            />
            <span>{insight}</span>
          </p>
        </div>
      ) : (
        <div className="h-5 2xl:h-6" />
      )}
    </section>
  );
}

/**
 * 화면을 다섯 막으로 가르는 편집형 제목.
 *
 * 허브는 패널이 열 장 가까이 세로로 쌓이는 화면이라, 스크롤 도중 "지금 보는 게 진단인지
 * 근거인지 결정인지"가 매번 다시 읽혀야 한다. 막 번호(①~⑤)와 질문형 부제를 함께 달아
 * 담당자의 업무 순서(무슨 일 → 어디가 → 왜 → 어떻게 되나 → 무엇을 할까)와 1:1로 맞춘다.
 */
export function ActHeading({
  step,
  title,
  question,
  action,
}: {
  step: string;
  title: string;
  /** 이 막이 답하는 질문 — 담당자 업무 순서와 같은 문장 */
  question: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pt-3">
      <div className="min-w-0">
        <p className="u-overline flex items-center gap-2">
          <span className="tabular-nums">{step}</span>
          <span aria-hidden className="h-px w-6 bg-admin-primary/40" />
          {question}
        </p>
        <h2 className="u-section-title mt-1.5">{title}</h2>
      </div>
      {action ? <div className="shrink-0 pb-1">{action}</div> : null}
    </div>
  );
}

/** 패널 우상단 이동 링크 — 깊은 화면으로 넘어가는 자리 */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-admin-primary transition-colors hover:bg-admin-primary-soft"
    >
      {children}
      <Icon name="arrowUpRight" size={14} strokeWidth={2} />
    </a>
  );
}
