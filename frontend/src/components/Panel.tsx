import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { sentenceLines } from "@/lib/sentences";

/**
 * 허브 전용 패널 (docs/plan/13 §6 · 17 §3.1 — T2 근거면).
 *
 * 패널은 **바깥 테두리를 두르지 않는다.** 경계는 배경(#FAFAFB)과 표면(#FFFFFF)의 밝기 차 +
 * `shadow-card`(거의 안 보이는 1px 접촉면)로만 만든다. 선이 사라진 만큼 화면이 부드러워지고,
 * 위계는 그림자의 세기가 진다 — T1(좌측 미리보기)만 `shadow-lift`로 확실히 떠 있고
 * 근거·목록 패널은 종이 한 장 얹힌 정도에 머문다.
 *
 * 카드 **안쪽** 구분선(헤더 아래·insight 위)은 그대로 둔다. 정보 영역을 나누는 역할이라
 * 바깥 테두리와 목적이 다르다.
 *
 * 다섯 자리 구성(제목 → 한 줄 설명 → 시각화 → 핵심 판독 insight → 다음 행동 action)은
 * 그대로다. `insight`는 지어낸 코멘트가 아니라 **화면에 이미 실린 값을 문장으로 옮긴 것**만 넣는다.
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
      /* scroll-mt-24 — `#decision-queue`·`#work-queue`·`#recent-decisions`가 전부 이 패널의 id다.
         허브 상단 상태 바가 sticky(top-0)라 여백 없이 스크롤하면 패널 제목이 바 뒤로 들어간다.
         허브의 `#proposal` 래퍼가 이미 쓰는 값과 맞췄고, scroll-margin은 앵커 스크롤에만
         작용해 레이아웃에는 영향이 없다 */
      className={`animate-rise flex min-w-0 flex-col overflow-hidden rounded-card bg-admin-surface shadow-card scroll-mt-24 ${className}`}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 p-5 pb-4 2xl:p-6 2xl:pb-4">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {icon ? <Icon name={icon} size={16} className="shrink-0 text-admin-primary" /> : null}
            <h3 className="u-panel-title">{title}</h3>
            {badge}
          </div>
          {desc ? (
            <p className="mt-1.5 break-keep text-[13px] leading-[1.65] text-admin-text-muted">
              {sentenceLines(desc)}
            </p>
          ) : null}
        </div>
        {action ? <div className="ml-auto shrink-0 pt-0.5">{action}</div> : null}
      </div>

      <div className={`min-w-0 flex-1 ${flush ? "" : "px-5 2xl:px-6"}`}>{children}</div>

      {insight ? (
        <div className="mt-5 border-t border-admin-border bg-lavender-50/70 px-5 py-3.5 2xl:px-6">
          <p className="flex items-start gap-2 break-keep text-[13px] font-medium leading-[1.6] text-admin-text-soft">
            <Icon
              name="bolt"
              size={14}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-admin-primary"
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
 * 결재선 막(act) — 허브의 서명 요소.
 *
 * 담당자의 업무는 실제로 순차다: 결정(01) → 근거(02) → 전망(03) → 실행(04).
 * 막 번호 사각(라벤더 500 — 화면의 유일한 채움색)과 그 아래로 이어지는 세로 괘선이
 * 이 순서를 결재 문서의 결재선처럼 화면 왼쪽에 그린다. 스크롤 어느 위치에서든
 * "지금 몇 번째 단계를 보고 있는가"가 선의 위치로 읽힌다.
 *
 * 세로선은 다음 막의 마커 위까지 내려가 겹치고(-bottom-10), 뒤에 그려지는 다음 마커가
 * 불투명하게 덮어 한 줄로 이어져 보인다. 마지막 막은 `last`로 선을 끊는다.
 * 640px 미만에서는 선·들여쓰기를 접고 마커만 남긴다.
 */
export function Act({
  no,
  phase,
  question,
  title,
  action,
  last = false,
  children,
}: {
  /** 막 번호 — "01"처럼 두 자리 문자열 */
  no: string;
  /** 막 이름 한 단어 — 결정·근거·전망·실행 */
  phase: string;
  /** 이 막이 답하는 질문 — 담당자 업무 순서와 같은 문장 */
  question: string;
  title: string;
  action?: ReactNode;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={`${no} ${phase}`} className="relative">
      {!last ? (
        <span
          aria-hidden
          className="absolute -bottom-10 left-[17px] top-11 hidden w-px bg-lavender-200 sm:block"
        />
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-admin-primary text-[15px] font-bold tabular-nums text-white"
          >
            {no}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-bold text-lavender-600">
              <span className="tracking-[0.08em]">{phase}</span>
              <span aria-hidden className="h-px w-5 bg-lavender-300" />
              <span className="min-w-0 break-keep font-semibold">{question}</span>
            </p>
            <h2 className="mt-0.5 break-keep text-[19px] font-bold leading-7 tracking-[-0.02em] text-admin-text sm:text-[22px] sm:leading-8">
              {title}
            </h2>
          </div>
        </div>
        {action ? <div className="shrink-0 pb-1">{action}</div> : null}
      </header>
      <div className="mt-5 min-w-0 sm:pl-[50px]">{children}</div>
    </section>
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
