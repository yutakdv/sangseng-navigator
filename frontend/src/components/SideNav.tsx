"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 사이드바 — 목업(image-1)의 8메뉴 뼈대를 유지하되 MVP 6라우트로 연결한다 (docs/plan/13 §3).
 * 매핑 불가 메뉴는 디밍 + `로드맵` 툴팁. 알림 벨·프로필 클릭 동작은 없다 (13 §2-12·16).
 *
 * 데모 동선(허브 → 카드 상세 → 트래킹 → 위젯 → 인센티브, 11 §1)이 **사이드바 클릭 1회**로
 * 이어져야 하므로 방문객 위젯도 하단 별도 묶음으로 싣는다 — 위젯 자체는 그린 테마 단독 화면이라
 * 담당자 메뉴와 구분선으로 나눈다 (13 §3의 "사이드바 없음"은 위젯 화면 안쪽 이야기다).
 *
 * 8개 메뉴가 같은 무게로 나열돼 있으면 지금 어디인지·무엇이 로드맵인지 읽히지 않는다.
 * 목업의 **순서는 그대로 두고** 묶음 라벨(의사결정/분석·정책/운영)·아이콘·활성 표시줄만 얹었다.
 */
type Item = {
  label: string;
  icon: IconName;
  href?: string;
  note: string;
  /** 활성 판정. 없으면 href와 정확히 같은 경로일 때만 활성 */
  match?: (pathname: string) => boolean;
  /** 모바일 가로 스트립에서는 감춘다 — 디밍 항목은 데스크톱 목업 재현용이라 좁은 화면에선 방해만 된다 */
  desktopOnly?: boolean;
};

/** 목업 8메뉴의 순서를 유지한 채 세 묶음으로만 나눈다 (13 §3 매핑표와 1:1) */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "의사결정",
    items: [
      {
        label: "홈",
        icon: "home",
        href: "/",
        note: "정책 한눈에 보기 — Action Card 허브",
        match: (p) => p === "/",
      },
      {
        label: "정책 나침반",
        icon: "compass",
        href: "/",
        note: "AI 분석 및 제안 (허브의 카드 생성·카드 상세)",
        // 카드 상세는 13 §3에서 이 메뉴에 매핑된다 — 상세로 들어가도 현재 위치가 사라지지 않게 한다
        match: (p) => p.startsWith("/cards/"),
      },
      {
        label: "정책 카드 관리",
        icon: "cards",
        href: "/tracking",
        note: "Action Card 실행 상태 현황",
        match: (p) => p === "/tracking",
      },
    ],
  },
  {
    title: "분석 · 정책",
    items: [
      {
        label: "지역 소비 분석",
        icon: "chart",
        href: "/dashboard",
        note: "집중도·전환율 진단",
        match: (p) => p === "/dashboard",
      },
      {
        label: "가맹점 관리",
        icon: "store",
        note: "로드맵 — 카드 상세의 지도로 흡수",
        desktopOnly: true,
      },
      {
        label: "인센티브 정책",
        icon: "gift",
        href: "/incentive",
        note: "페이백 시나리오 비교",
        match: (p) => p === "/incentive",
      },
    ],
  },
  {
    title: "운영",
    items: [
      // 같은 /dashboard를 가리키므로 활성 표시는 "지역 소비 분석" 쪽에만 준다 (match 없음)
      {
        label: "성과 리포트",
        icon: "report",
        href: "/dashboard#kpi",
        note: "대시보드 KPI 행",
        desktopOnly: true,
      },
      {
        label: "데이터 관리",
        icon: "database",
        note: "로드맵 — 푸터의 데이터 기준·출처 표기로 대체",
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
  "group relative flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] transition-colors lg:w-full lg:whitespace-normal lg:text-sm";

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="주 메뉴"
      className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-3 lg:py-3"
    >
      {GROUPS.map((group) => (
        <div key={group.title} className="contents lg:block">
          {/* 묶음 라벨은 데스크톱에서만 — 모바일 가로 스트립에서는 자리를 먹기만 한다 */}
          <p className="mb-1 mt-4 hidden px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50 lg:block">
            {group.title}
          </p>
          {group.items.map((item) => (
            <NavItem key={item.label} item={item} pathname={pathname} />
          ))}
        </div>
      ))}

      <span
        aria-hidden="true"
        className="mx-1 h-6 w-px shrink-0 self-center bg-white/15 lg:mx-3 lg:my-3 lg:h-px lg:w-auto lg:self-auto"
      />

      <NavItem item={VISITOR} pathname={pathname} visitor />
    </nav>
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
        className={`${ITEM} ${hidden} cursor-not-allowed text-white/45`}
      >
        <Icon name={item.icon} size={17} />
        <span className="min-w-0 flex-1">{item.label}</span>
        <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-white/45">
          로드맵
        </span>
      </span>
    );
  }

  const active = item.match ? item.match(pathname) : item.href === pathname;

  return (
    <Link
      href={item.href}
      title={item.note}
      aria-current={active ? "page" : undefined}
      className={`${ITEM} ${hidden} ${
        active
          ? "bg-admin-sidebar-active font-semibold text-white shadow-[0_2px_12px_-4px_rgb(99_102_241)]"
          : "text-white/65 hover:bg-white/10 hover:text-white"
      }`}
    >
      {/* 활성 표시는 배경색 + 왼쪽 표시줄 둘 다 — 색만으로 전달하지 않는다 (13 §4) */}
      {active ? (
        <span
          aria-hidden
          className="absolute -left-3 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-r-full bg-white lg:block"
        />
      ) : null}
      <Icon name={item.icon} size={17} />
      <span className="min-w-0 flex-1">{item.label}</span>
      {visitor ? (
        <span className="rounded-full bg-visitor-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-visitor-primary">
          방문객
        </span>
      ) : null}
    </Link>
  );
}
