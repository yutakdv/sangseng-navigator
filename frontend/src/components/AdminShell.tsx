import type { ReactNode } from "react";
import Link from "next/link";
import { ProxyBadge } from "@/components/Badge";
import { Footer } from "@/components/Footer";
import { SideNav } from "@/components/SideNav";
import { isMockMode } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Dashboard } from "@/types";

/**
 * 담당자 화면 공통 레이아웃 (docs/plan/08 F2 · 13 §3).
 * - 상단 고정 헤더에 "이번 분기 지역 전환율 X% [근사 지표]" 헤드라인 — 전 화면 공통
 * - 사이드바는 lg 미만에서 상단 가로 네비로 전환 (13 §8 반응형 최소선)
 * - 푸터에 데이터 출처·기준 고정 표기
 */
export function AdminShell({
  dashboard,
  children,
}: {
  dashboard: Dashboard;
  children: ReactNode;
}) {
  const { conversion, period_note } = dashboard;

  return (
    <div className="min-h-screen bg-admin-bg lg:flex">
      <aside className="bg-admin-sidebar lg:min-h-screen lg:w-56 lg:shrink-0">
        <div className="hidden px-6 pb-1 pt-6 lg:block">
          <Link href="/" className="text-lg font-bold text-white">
            상생 나침반
          </Link>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            강원랜드 지역상생 의사결정 지원
          </p>
        </div>
        <SideNav />
        <div className="hidden px-6 pb-6 pt-4 text-[11px] leading-4 text-white/35 lg:block">
          지역상생팀 김담당
          <br />
          (가상 페르소나 · 로그인 없음)
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-black/5 bg-admin-surface/95 px-5 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm text-admin-text-muted lg:hidden">상생 나침반</span>
            <h1 className="text-base font-semibold text-admin-text">
              이번 분기 지역 전환율{" "}
              <span className="text-admin-primary">{pct(conversion.headline_rate)}</span>
            </h1>
            {conversion.is_proxy ? <ProxyBadge note={conversion.proxy_note} /> : null}
            {isMockMode ? (
              <span
                className="ml-auto rounded-full bg-state-notice-bg px-2 py-0.5 text-[11px] text-state-notice"
                title="NEXT_PUBLIC_API_BASE 미설정 — src/mocks/의 정적 데이터로 렌더 중"
              >
                mock 모드
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">
            {conversion.proxy_note}
          </p>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-5">{children}</main>
        <Footer periodNote={period_note} />
      </div>
    </div>
  );
}
