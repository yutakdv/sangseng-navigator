"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 사이드바 — 담당자가 먼저 고르는 두 흐름(정책 의사결정 · 지역 소비 분석)만 상위에 둔다.
 * 정책 카드 관리와 인센티브, 가맹점·성과·데이터 관리는 각 흐름 안의 하위 진입점이다.
 *
 * 데모 동선(허브 → 카드 상세 → 트래킹 → 위젯 → 인센티브, 11 §1)이 **사이드바 클릭 1회**로
 * 이어져야 하므로 방문객 위젯도 하단 별도 묶음으로 싣는다 — 위젯 자체는 그린 테마 단독 화면이라
 * 담당자 메뉴와 구분선으로 나눈다 (13 §3의 "사이드바 없음"은 위젯 화면 안쪽 이야기다).
 *
 * 하위 메뉴는 들여써서 독립 업무 영역처럼 보이지 않게 하고, 상위 메뉴는 흐름의 시작점으로 남긴다.
 */
type Item = {
  label: string;
  icon: IconName;
  href?: string;
  note: string;
  step?: string;
  /** 활성 판정. 없으면 href와 정확히 같은 경로일 때만 활성 */
  match?: (pathname: string) => boolean;
  /** 모바일 가로 스트립에서는 감춘다 — 디밍 항목은 데스크톱 목업 재현용이라 좁은 화면에선 방해만 된다 */
  desktopOnly?: boolean;
  /** 상위 분석 화면 안에서 쓰는 보조 기능 */
  child?: boolean;
};

/** 순서가 아니라 담당자가 찾는 업무 객체로 묶는다. 실제 단계는 카드 안에서만 안내한다. */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "정책 업무",
    items: [
      {
        label: "정책 나침반",
        icon: "compass",
        href: "/",
        note: "결정 대기 제안과 오늘 할 일",
        match: (p) => p === "/" || p.startsWith("/cards/"),
      },
      {
        label: "추진 경과 리포트",
        icon: "report",
        href: "/tracking",
        note: "진행률·정체·실제 성과 확인",
        match: (p) => p === "/tracking",
      },
      {
        label: "추진 기록 입력",
        icon: "workflow",
        href: "/tracking/new",
        note: "경과 메모·다음 행동·실측값 입력",
        match: (p) => p === "/tracking/new",
        child: true,
      },
      {
        label: "인센티브 정책",
        icon: "gift",
        href: "/incentive",
        note: "페이백 3·5·7% 시나리오 비교",
        match: (p) => p === "/incentive",
      },
    ],
  },
  {
    title: "분석과 전달",
    items: [
      {
        label: "지역 소비 분석",
        icon: "chart",
        href: "/dashboard",
        note: "지역·업종별 소비 신호 진단",
        match: (p) => p === "/dashboard",
      },
      {
        label: "가맹점 후보",
        icon: "store",
        href: "/dashboard?demo=merchant#merchant-candidates",
        note: "후보·기존 가맹점 원본 확인",
        desktopOnly: true,
      },
      {
        label: "데이터 출처",
        icon: "database",
        href: "/dashboard?demo=data#data-demo",
        note: "공개 최신본과 실시간 원천 상태",
        desktopOnly: true,
      },
    ],
  },
];

const VISITOR: Item = {
  label: "방문객 위젯",
  icon: "phone",
  href: "/widget",
  note: "방문객이 보는 가맹점 추천 화면 (별도 테마)",
  match: (p) => p === "/widget",
};

const ITEM =
  "group relative flex min-h-11 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-[13px] transition-all lg:w-full lg:whitespace-normal lg:text-sm";

export function SideNav() {
  const pathname = usePathname();

  // 다른 경로의 긴 섹션으로 이동할 때는 해시가 먼저 적용되고 본문이 나중에 수화될 수 있다.
  // 대상이 생길 때까지 짧게 재시도해 사이드바 메뉴가 URL만 바꾸고 멈추지 않게 한다.
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let cancelled = false;

    const scrollToHash = () => {
      if (cancelled) return;
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }
      if (attempts < 24) {
        attempts += 1;
        frame = window.requestAnimationFrame(scrollToHash);
      }
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, [pathname]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="주 메뉴"
        className="flex gap-1.5 overflow-x-auto px-3 py-2 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:px-4 lg:py-2"
      >
        {GROUPS.map((group) => (
          <div key={group.title} className="contents lg:block">
            {/* 묶음 라벨은 데스크톱에서만 — 모바일 가로 스트립에서는 자리를 먹기만 한다 */}
            <p className="mb-2 mt-5 hidden px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50 lg:block">
              {group.title}
            </p>
            {group.items.map((item) => (
              <NavItem key={item.label} item={item} pathname={pathname} />
            ))}
          </div>
        ))}

        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 self-center bg-white/15 lg:hidden" />
        <span className="lg:hidden"><NavItem item={VISITOR} pathname={pathname} visitor /></span>
      </nav>

      {/* 데스크톱에서는 방문객 진입을 스크롤 메뉴와 분리한다. 홍보 이미지와 겹치지 않고 항상 보인다. */}
      <div className="hidden shrink-0 border-t border-white/10 px-4 py-3 lg:block">
        <NavItem item={VISITOR} pathname={pathname} visitor />
      </div>
    </div>
  );
}

function NavItem({
  item,
  pathname,
  visitor = false,
}: {
  item: Item;
  pathname: string;
  visitor?: boolean;
}) {
  const hidden = item.desktopOnly ? "hidden lg:flex" : "";

  if (!item.href) {
    return (
      <span
        title={item.note}
        aria-disabled="true"
        className={`${ITEM} ${hidden} cursor-not-allowed text-white/50`}
      >
        <Icon name={item.icon} size={17} />
        <span className="min-w-0 flex-1">{item.label}</span>
        <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-white/50">
          로드맵
        </span>
      </span>
    );
  }

  const active = item.match ? item.match(pathname) : item.href === pathname;
  const className = `${ITEM} ${hidden} ${item.child ? "lg:ml-3 lg:w-[calc(100%-0.75rem)]" : ""} ${
    active
      ? "bg-white/[0.13] font-semibold text-white shadow-sm ring-1 ring-inset ring-white/10"
      : "text-white/80 hover:bg-white/[0.07] hover:text-white"
  }`;
  const body = (
    <>
      {/* 활성 표시는 배경색 + 왼쪽 표시줄 둘 다 — 색만으로 전달하지 않는다 (13 §4) */}
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-[#f2a86f] text-admin-sidebar-deep" : "bg-white/[0.07] text-white/70"}`}>
        <Icon name={item.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span>{item.label}</span>
          {item.step ? <span className="hidden text-[9px] font-bold tracking-widest text-white/50 lg:inline">{item.step}</span> : null}
        </span>
        <span className="mt-0.5 hidden line-clamp-1 text-[10px] font-normal leading-4 text-white/60 lg:block">{item.note}</span>
      </span>
      {visitor ? (
        <span className="rounded-full bg-visitor-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-visitor-primary">
          방문객
        </span>
      ) : null}
    </>
  );

  // 링크는 표준 해시 URL을 유지하고, SideNav의 수화 후 스크롤 보정이 실제 대상까지 이동시킨다.
  if (item.href.includes("#")) {
    return (
      <a href={item.href} title={item.note} aria-current={active ? "page" : undefined} className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={item.href} title={item.note} aria-current={active ? "page" : undefined} className={className}>
      {body}
    </Link>
  );
}
