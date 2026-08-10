import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Icon } from "@/components/Icon";
import { SideNav } from "@/components/SideNav";
import { TourOverlay } from "@/components/tour/TourOverlay";
import type { Dashboard } from "@/types";
import { dataFreshness } from "@/lib/dataFreshness";
import { operator, operatorInitial } from "@/lib/operator";

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
      {/* 사이드바 면은 `admin.sidebar-surface` 한 토큰에서만 온다.
          본문과 붙어 보이지 않도록 우측에 0.5px 실선을 더한다 (13 §3) */}
      <aside className="relative border-b border-admin-border bg-admin-sidebar-surface lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:h-dvh lg:w-[272px] lg:flex-col lg:border-b-0 lg:border-r-[0.5px]">
        {/* 조합형 로고(마크 + "상생 나침반")라 옆에 브랜드명을 또 쓰지 않는다.
            라벤더 칩도 걷어냈다 — 로고 마크가 자체 인디고를 갖고 있어 칩 위에 얹으면 색이 부딪힌다.
            원본 비율 720×140 = 36:7을 유지해야 글자가 눌리지 않는다 */}
        <div className="relative flex items-center justify-between border-b border-admin-border px-4 py-3 lg:hidden">
          <Link href="/" className="flex items-center">
            <Image src="/brand/sangseng-navigator-lockup.png" alt="상생 나침반" width={180} height={35} priority />
          </Link>
          <span className="rounded-full bg-lavender-100 px-2.5 py-1 text-xs font-semibold tracking-wide text-lavender-700">
            DECISION OS
          </span>
        </div>

        <div className="relative hidden px-6 pb-5 pt-7 lg:block">
          <Link href="/" className="inline-block">
            <Image src="/brand/sangseng-navigator-lockup.png" alt="상생 나침반" width={216} height={42} priority />
          </Link>
        </div>

        <div className="relative lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <SideNav />
        </div>

        {/* 하단 계정 칸 — shrink-0으로 고정해 메뉴가 길어져도 잘리지 않는다 */}
        <div className="relative hidden shrink-0 px-4 pb-4 pt-3 lg:block">
          {/* 사이드바 면보다 반 단 낮은 틴트 + 보더 — 계정 칸을 별개 블록으로 눌러 묶는다 */}
          <div className="flex items-center gap-3 rounded-xl border border-admin-border bg-admin-surface-sunken px-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lavender-100 text-[13px] font-bold text-lavender-700">
              {operatorInitial}
            </span>
            <span className="min-w-0 text-xs leading-4 text-admin-text-soft">
              <span className="block truncate font-semibold text-admin-text">
                {operator.team} {operator.name}
              </span>
              오늘 결정 대기 항목 확인
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-screen lg:pl-[272px]">
        {/*
          "3분 체험" 진입점은 hideSummary(홈)에서도 필요하다 — 홈이 이 상단 바를 가장 많이 안 쓰는
          화면이면서 동시에 심사위원이 가장 먼저 보는 화면이라, 여기서만 버튼이 사라지면 투어를
          다시 시작할 길이 없어진다. 그래서 바는 항상 그리고, "중복 요약을 홈에 두지 않는다"는
          hideSummary의 원래 취지는 라벨·데이터 신선도 배지에만 남긴다.

          다만 **홈에서는 이 바를 sticky로 두지 않는다.** 홈 본문(DashboardOverview)의 StatusBar가
          이미 `sticky top-0 z-30`이라, 이 헤더까지 `sticky top-0`이면 같은 스크롤 컨테이너·같은
          top:0에서 두 sticky가 겹치고 z-index가 낮은 이 헤더(z-20)가 StatusBar(z-30)에 가려
          "3분 체험" 버튼이 스크롤 즉시 사라진다. 헤더 높이만큼 StatusBar의 top을 밀어내는 방식은
          쓰지 않는다 — 헤더 높이가 매직 넘버로 박히고 배지 유무에 따라 높이가 흔들려 조용히
          어긋난다. 그래서 홈은 `relative`로 첫 화면에서만 보이게 하고, 스크롤 내내 붙어 있는
          역할은 원래대로 StatusBar 하나에만 맡긴다.
        */}
        <header
          className={`${hideSummary ? "relative" : "sticky top-0 z-20"} border-b border-admin-border/80 bg-admin-bg/90 px-4 py-3 backdrop-blur-xl sm:px-6 xl:px-8`}
        >
          <div className="mx-auto flex max-w-[1500px] items-center gap-3">
            <Link href="/" className="text-sm font-bold text-admin-text lg:hidden">상생 나침반</Link>
            {!hideSummary ? (
              <span className="hidden text-xs font-semibold text-admin-text-muted lg:inline">지역상생 운영 콘솔</span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {/* 심사위원이 화면 구조를 스스로 찾지 않아도 되도록 인앱 가이드 투어를 어디서든 다시 시작할 수 있게 한다.
                  버튼 스타일은 새로 만들지 않고 사이트 전역 primary 버튼 톤(bg-admin-primary/hover:primary-strong)을 그대로 쓴다. */}
              <Link
                href="/?tour=1"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-admin-primary-strong"
              >
                <Icon name="sparkle" size={14} strokeWidth={2} />
                3분 체험
              </Link>
              {!hideSummary ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    freshness.isStale
                      ? "border-state-warn-line bg-state-warn-bg text-state-warn"
                      : "border-admin-primary-line bg-admin-primary-soft text-admin-primary"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${freshness.isStale ? "bg-state-warn" : "bg-admin-primary"}`} />
                  {freshness.label}
                </span>
              ) : null}
            </div>
          </div>
        </header>

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
      <TourOverlay />
    </div>
  );
}
