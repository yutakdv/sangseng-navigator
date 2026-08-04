"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 사이드바 — 목업(image-1)의 8메뉴 뼈대를 유지하되 MVP 6라우트로 연결한다 (docs/plan/13 §3).
 * 매핑 불가 메뉴는 디밍 + `로드맵` 툴팁. 알림 벨·프로필 클릭 동작은 없다 (13 §2-12·16).
 *
 * 데모 동선(허브 → 카드 상세 → 트래킹 → 위젯 → 인센티브, 11 §1)이 **사이드바 클릭 1회**로
 * 이어져야 하므로 방문객 위젯도 하단 별도 묶음으로 싣는다 — 위젯 자체는 그린 테마 단독 화면이라
 * 담당자 메뉴와 구분선으로 나눈다 (13 §3의 "사이드바 없음"은 위젯 화면 안쪽 이야기다).
 */
type Item = {
  label: string;
  href?: string;
  note: string;
  /** 활성 판정. 없으면 href와 정확히 같은 경로일 때만 활성 */
  match?: (pathname: string) => boolean;
  /** 모바일 가로 스트립에서는 감춘다 — 디밍 항목은 데스크톱 목업 재현용이라 좁은 화면에선 방해만 된다 */
  desktopOnly?: boolean;
};

const MENU: Item[] = [
  { label: "홈", href: "/", note: "정책 한눈에 보기 — Action Card 허브", match: (p) => p === "/" },
  {
    label: "정책 나침반",
    href: "/",
    note: "AI 분석 및 제안 (허브의 카드 생성·카드 상세)",
    // 카드 상세는 13 §3에서 이 메뉴에 매핑된다 — 상세로 들어가도 현재 위치가 사라지지 않게 한다
    match: (p) => p.startsWith("/cards/"),
  },
  {
    label: "정책 카드 관리",
    href: "/tracking",
    note: "Action Card 실행 상태 현황",
    match: (p) => p === "/tracking",
  },
  {
    label: "지역 소비 분석",
    href: "/dashboard",
    note: "집중도·전환율 진단",
    match: (p) => p === "/dashboard",
  },
  { label: "가맹점 관리", note: "로드맵 — 카드 상세의 지도로 흡수", desktopOnly: true },
  {
    label: "인센티브 정책",
    href: "/incentive",
    note: "페이백 시나리오 비교",
    match: (p) => p === "/incentive",
  },
  // 같은 /dashboard를 가리키므로 활성 표시는 "지역 소비 분석" 쪽에만 준다 (match 없음)
  { label: "성과 리포트", href: "/dashboard#kpi", note: "대시보드 KPI 행", desktopOnly: true },
  { label: "데이터 관리", note: "로드맵 — 푸터의 데이터 기준·출처 표기로 대체", desktopOnly: true },
];

const VISITOR: Item = {
  label: "방문객 위젯",
  href: "/widget",
  note: "방문객이 보는 가맹점 추천 화면 (별도 테마)",
  match: (p) => p === "/widget",
};

const ITEM =
  "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors lg:w-full lg:whitespace-normal";

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="주 메뉴"
      className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4"
    >
      {MENU.map((item, i) => (
        <NavItem key={i} item={item} pathname={pathname} />
      ))}

      <span
        aria-hidden="true"
        className="mx-1 h-6 w-px shrink-0 self-center bg-white/15 lg:mx-0 lg:my-2 lg:h-px lg:w-full lg:self-auto"
      />

      <NavItem item={VISITOR} pathname={pathname}>
        <span className="ml-1.5 rounded-full bg-visitor-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-visitor-primary">
          방문객
        </span>
      </NavItem>
    </nav>
  );
}

function NavItem({
  item,
  pathname,
  children,
}: {
  item: Item;
  pathname: string;
  children?: React.ReactNode;
}) {
  const hidden = item.desktopOnly ? "hidden lg:block" : "";

  if (!item.href) {
    return (
      <span
        title={item.note}
        aria-disabled="true"
        className={`${ITEM} ${hidden} cursor-not-allowed text-white/45`}
      >
        {item.label}
        <span className="ml-1.5 text-[10px] text-white/40">로드맵</span>
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
        active ? "bg-admin-sidebar-active font-medium text-white" : "text-white/70 hover:bg-white/10"
      }`}
    >
      {item.label}
      {children}
    </Link>
  );
}
