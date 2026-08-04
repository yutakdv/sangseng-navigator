import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { SideNav } from "@/components/SideNav";
import type { Dashboard } from "@/types";
import { dataFreshness } from "@/lib/dataFreshness";

/**
 * 담당자 화면 공통 레이아웃 (docs/plan/08 F2 · 13 §3).
 * - 상세 화면은 데이터 기준 헤더를 제공하고, 홈은 핵심 KPI를 최상단에 바로 배치
 * - 사이드바는 lg 미만에서 상단 가로 네비로 전환 (13 §8 반응형 최소선)
 * - 푸터에 데이터 출처·기준 고정 표기
 *
 * 홈의 KPI와 상세 화면의 데이터 기준이 역할을 나누므로, 같은 수치를 상단에 반복하지 않는다.
 */
export function AdminShell({
  dashboard,
  children,
  hideSummary = false,
  hideFreshnessBanner = false,
}: {
  dashboard: Dashboard;
  children: ReactNode;
  /** 홈은 핵심 KPI가 이 역할을 하므로 상단 전환율 요약을 중복으로 두지 않는다. */
  hideSummary?: boolean;
  /** 홈은 KPI의 데이터 기준 셀로 경고를 합쳐 중복 경고를 피한다. */
  hideFreshnessBanner?: boolean;
}) {
  const { period_note } = dashboard;
  const freshness = dataFreshness(period_note);

  return (
    <div className="min-h-screen bg-admin-bg">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[60] -translate-y-20 rounded-lg bg-white px-3 py-2 text-sm font-bold text-admin-sidebar shadow-lg transition-transform focus:translate-y-0"
      >
        본문 바로가기
      </a>
      <aside className="relative overflow-hidden border-b border-white/10 bg-admin-sidebar lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:h-dvh lg:w-[272px] lg:flex-col lg:border-b-0 lg:border-r">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/[0.05] blur-3xl" />
        <div className="relative flex items-center justify-between border-b border-white/10 px-4 py-3 lg:hidden">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-bold text-white">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[#f2a86f] shadow-lg shadow-black/10">
              <Image src="/brand/sangseng-navigator-mark.svg" alt="" width={36} height={36} priority />
            </span>
            상생 나침반
          </Link>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white/70">DECISION OS</span>
        </div>

        <div className="relative hidden px-6 pb-5 pt-7 lg:block">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#f2a86f] shadow-lg shadow-black/10">
              <Image src="/brand/sangseng-navigator-mark.svg" alt="상생 나침반" width={44} height={44} priority />
            </span>
            <span className="min-w-0">
              <span className="block text-[18px] font-bold tracking-[-0.02em] text-white">상생 나침반</span>
              <span className="mt-0.5 block text-[11px] leading-4 text-white/50">지역상생 Decision OS</span>
            </span>
          </Link>
          <p className="mt-6 max-w-[210px] text-xs leading-5 text-white/60">
            데이터에서 실행까지, 담당자의 판단이 끊기지 않도록 연결합니다.
          </p>
        </div>

        <div className="relative lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <SideNav />
        </div>

        <div className="relative hidden px-5 pb-5 pt-3 lg:block">
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">김</span>
              <span className="min-w-0 text-[11px] leading-4 text-white/60">
                <span className="block font-semibold text-white/90">지역상생팀 김담당</span>
                오늘 결정 대기 항목 확인
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-screen lg:pl-[272px]">
        {!hideSummary ? (
          <header className="sticky top-0 z-20 border-b border-admin-border/80 bg-admin-bg/90 px-4 py-3 backdrop-blur-xl sm:px-6 xl:px-8">
            <div className="mx-auto flex max-w-[1500px] items-center gap-3">
              <Link href="/" className="text-sm font-bold text-admin-text lg:hidden">상생 나침반</Link>
              <span className="hidden text-xs font-semibold text-admin-text-muted lg:inline">지역상생 운영 콘솔</span>
              <span
                className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  freshness.isStale
                    ? "border-state-warn-line bg-state-warn-bg text-state-warn"
                    : "border-admin-primary-line bg-admin-primary-soft text-admin-primary"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${freshness.isStale ? "bg-state-warn" : "bg-admin-primary"}`} />
                {freshness.label}
              </span>
            </div>
          </header>
        ) : null}

        <main id="main-content" className={`min-w-0 flex-1 px-4 sm:px-6 xl:px-9 ${hideSummary ? "py-5 sm:py-7" : "py-6 sm:py-8"}`}>
          {freshness.isStale && !hideFreshnessBanner ? (
            <section
              role="status"
              aria-label="데이터 신선도 경고"
              className="mx-auto mb-5 flex max-w-[1500px] items-start gap-2.5 rounded-2xl border border-state-warn-line bg-state-warn-bg px-4 py-3 text-xs leading-5 text-state-warn"
            >
              <span aria-hidden className="mt-0.5">⚠</span>
              <p>
                <b>{freshness.label}</b> — 현재 결과는 데모·사전 검토용입니다. 실제 결정 전 최신 사용현황과
                가맹점 영업 상태를 갱신해 다시 계산하세요. 기준: {period_note}
              </p>
            </section>
          ) : null}
          {children}
        </main>
        <Footer periodNote={period_note} />
      </div>
    </div>
  );
}
