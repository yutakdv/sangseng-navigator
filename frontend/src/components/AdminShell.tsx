import type { ReactNode } from "react";
import Link from "next/link";
import { ProxyBadge } from "@/components/Badge";
import { Footer } from "@/components/Footer";
import { Icon } from "@/components/Icon";
import { SideNav } from "@/components/SideNav";
import { isMockMode } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Dashboard } from "@/types";

/**
 * 담당자 화면 공통 레이아웃 (docs/plan/08 F2 · 13 §3).
 * - 상단 고정 헤더에 "이번 분기 지역 전환율 X% [근사 지표]" 헤드라인 — 전 화면 공통
 * - 사이드바는 lg 미만에서 상단 가로 네비로 전환 (13 §8 반응형 최소선)
 * - 푸터에 데이터 출처·기준 고정 표기
 *
 * 헤더가 16px 한 줄 + 11px 각주 한 줄이던 것을, 값(28px)과 라벨을 분리해 **화면 어디서나
 * 이번 분기 지표가 먼저 읽히게** 했다. `근사 지표` 배지와 `proxy_note` 전문은 그대로 유지한다
 * (절대 규칙 2 — 배지·주석은 줄이거나 요약하지 않는다).
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
      <aside className="bg-gradient-to-b from-admin-sidebar to-admin-sidebar-deep lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[228px] lg:shrink-0 lg:flex-col">
        <div className="hidden px-5 pb-2 pt-6 lg:block">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-admin-primary text-white shadow-[0_4px_14px_-4px_rgb(79_70_229)]">
              <Icon name="compass" size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-[17px] font-bold leading-5 text-white">상생 나침반</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-white/45">
                강원랜드 지역상생 의사결정 지원
              </span>
            </span>
          </Link>
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <SideNav />
        </div>

        <div className="hidden px-5 pb-5 pt-3 lg:block">
          <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-white/80">
              김
            </span>
            <span className="min-w-0 text-[11px] leading-4 text-white/60">
              <span className="block font-semibold text-white/85">지역상생팀 김담당</span>
              가상 페르소나 · 로그인 없음
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-admin-border bg-admin-surface/90 px-4 py-3 shadow-header backdrop-blur-md sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm font-bold text-admin-text lg:hidden"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-admin-primary text-white">
                <Icon name="compass" size={16} />
              </span>
              상생 나침반
            </Link>

            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[13px] font-medium text-admin-text-muted">
                  이번 분기 지역 전환율
                </span>
                <span className="text-[28px] font-bold leading-8 tracking-[-0.02em] tabular-nums text-admin-primary">
                  {pct(conversion.headline_rate)}
                </span>
              </h1>
              {conversion.is_proxy ? <ProxyBadge note={conversion.proxy_note} /> : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full bg-admin-surface-sunken px-2.5 py-1 text-xs font-medium text-admin-text-muted sm:inline-flex">
                <Icon name="database" size={13} />
                데이터 기준 {period_note}
              </span>
              {isMockMode ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-state-notice-bg px-2.5 py-1 text-xs font-semibold text-state-notice ring-1 ring-inset ring-state-notice-line"
                  title="NEXT_PUBLIC_API_BASE 미설정 — src/mocks/의 정적 데이터로 렌더 중"
                >
                  <Icon name="info" size={12} strokeWidth={2} />
                  mock 모드
                </span>
              ) : null}
            </div>
          </div>
          {/* 절대 규칙 2 — proxy_note는 요약하지 않고 그대로 노출한다 */}
          <p className="mt-1.5 break-keep text-xs leading-5 text-admin-text-muted">
            {conversion.proxy_note}
          </p>
        </header>

        {/* 허브는 1600px까지 열리는 화면이라 큰 뷰포트에서 좌우 여백을 한 단계 더 준다 (13 §8) */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-7 2xl:px-10 2xl:py-9">
          {children}
        </main>
        <Footer periodNote={period_note} />
      </div>
    </div>
  );
}
