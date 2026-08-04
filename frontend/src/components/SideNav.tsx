"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 사이드바 — 목업(image-1)의 8메뉴 뼈대를 유지하되 MVP 6라우트로 연결한다 (docs/plan/13 §3).
 * 매핑 불가 메뉴는 디밍 + `로드맵` 툴팁. 알림 벨·프로필 클릭 동작은 없다 (13 §2-12·16).
 */
const MENU: { label: string; href?: string; note: string }[] = [
  { label: "홈", href: "/", note: "정책 한눈에 보기 — Action Card 허브" },
  { label: "정책 나침반", href: "/", note: "AI 분석 및 제안 (허브의 카드 생성·카드 상세)" },
  { label: "정책 카드 관리", href: "/tracking", note: "Action Card 실행 상태 현황" },
  { label: "지역 소비 분석", href: "/dashboard", note: "집중도·전환율 진단" },
  { label: "가맹점 관리", note: "로드맵 — 카드 상세의 지도로 흡수" },
  { label: "인센티브 정책", href: "/incentive", note: "페이백 시나리오 비교" },
  { label: "성과 리포트", href: "/dashboard#kpi", note: "대시보드 KPI 행" },
  { label: "데이터 관리", note: "로드맵 — 푸터의 데이터 기준·출처 표기로 대체" },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="주 메뉴"
      className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4"
    >
      {MENU.map((item, i) => {
        // 같은 href가 두 번 나오는 메뉴(홈·정책 나침반 → "/")는 첫 항목만 활성 표시한다
        const active = item.href === pathname && MENU.findIndex((m) => m.href === pathname) === i;
        const cls =
          "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors lg:w-full lg:whitespace-normal";
        if (!item.href) {
          return (
            <span
              key={i}
              title={item.note}
              aria-disabled="true"
              className={`${cls} cursor-not-allowed text-white/35`}
            >
              {item.label}
              <span className="ml-1.5 text-[10px] text-white/30">로드맵</span>
            </span>
          );
        }
        return (
          <Link
            key={i}
            href={item.href}
            title={item.note}
            className={`${cls} ${
              active ? "bg-admin-sidebar-active text-white" : "text-white/70 hover:bg-white/10"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
