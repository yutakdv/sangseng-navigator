"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";

/**
 * 투어 재시작 진입점 — 사이드바 두 자리(모바일 상단 바·데스크톱 바닥)가 같은 버튼을 쓴다.
 * 버튼 스타일은 새로 만들지 않고 사이트 전역 primary 버튼 톤을 그대로 따른다.
 *
 * 허브에서 카드를 미리보는 중(`?selected=`)이면 그 선택을 유지한 채 투어를 연다 —
 * 링크가 선택을 지우면 투어가 끝난 뒤 보던 카드가 아니라 기본 카드로 돌아온다.
 * 현재 쿼리를 읽어야 해서 이 조각만 클라이언트 컴포넌트다(AdminShell은 서버 컴포넌트).
 */
export function TourLink({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const selected = pathname === "/" ? search.get("selected") : null;
  const href = selected ? `/?selected=${encodeURIComponent(selected)}&tour=1` : "/?tour=1";

  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-admin-primary-strong ${className}`}
    >
      <Icon name="sparkle" size={14} strokeWidth={2} />
      3분 체험
    </Link>
  );
}
