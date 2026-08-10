"use client";

import { useEffect, useState } from "react";

export type TocItem = { id: string; label: string };

/**
 * 지역 소비 분석의 존 목차 — 섹션 10여 장이 쌓이는 화면에서 "지금 어디를 보는가"를
 * 구조로 답하는 장치다. 항목이 곧 앵커라 클릭하면 해당 존으로 이동하고,
 * 스크롤 위치의 존이 하이라이트된다.
 *
 * 스크롤 감지는 IntersectionObserver 대신 rAF 스로틀 스크롤 리스너를 쓴다 —
 * 존 높이가 화면보다 훨씬 커서(드릴다운 존은 수천 px) 교차 비율 기반 판정이
 * 오히려 불안정하고, "기준선을 지난 마지막 존" 규칙이 결정적이다.
 *
 * sticky 오프셋(top)은 AdminShell 고정 헤더 높이와 짝이다 — 헤더 py·폰트·버튼을 바꾸면
 * 함께 조정 (`3분 체험` 버튼이 들어오며 53px → 61px로 이미 한 번 자랐다).
 */
export function DashboardToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // 기준선: 고정 헤더(≈53px) + 목차 바 높이 + 여유. Section의 scroll-mt-28(112px)과 정합.
      const line = 130;
      let current: string | null = null;
      for (const { id } of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      setActiveId(current ?? items[0]?.id ?? null);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  return (
    <nav
      aria-label="지역 소비 분석 목차"
      className="sticky top-[61px] z-10 -mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-admin-border bg-admin-bg/90 p-1.5 backdrop-blur-xl"
    >
      {items.map(({ id, label }) => {
        const active = id === activeId;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active ? "location" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "bg-lavender-100 text-lavender-700"
                : "text-admin-text-muted hover:bg-admin-surface-sunken hover:text-admin-text"
            }`}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
