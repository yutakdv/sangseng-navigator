import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { SideNav } from "@/components/SideNav";
import { TourLink } from "@/components/tour/TourLink";
import { TourOverlay } from "@/components/tour/TourOverlay";
import type { Dashboard } from "@/types";
import { dataFreshness } from "@/lib/dataFreshness";
import { operator, operatorInitial } from "@/lib/operator";

/**
 * 담당자 화면 공통 레이아웃 (docs/plan/08 F2 · 13 §3).
 * - 사이드바는 lg 미만에서 상단 가로 네비로 전환 (13 §8 반응형 최소선)
 * - 푸터에 데이터 출처·기준 고정 표기
 *
 * **본문 위 상단 바를 두지 않는다.** 예전에는 `지역상생 운영 콘솔` 라벨 + `3분 체험` +
 * 데이터 신선도 배지를 담은 바가 모든 화면 위에 떠 있었는데, 세 요소 모두 다른 자리에
 * 더 나은 집이 있었다: 라벨은 사이드바 로고가 이미 하는 말이고, 신선도는 화면마다
 * `PageHeader`의 "데이터 기준 · 산출일" 줄과 푸터가 상시로 싣는다(낡았을 때의 경고는
 * 아래 배너가 맡는다). 남는 건 투어 진입점 하나뿐이라 사이드바로 옮겼다 — 바 하나가
 * 모든 화면에서 세로 공간을 먹고 스크롤마다 sticky 층위 다툼을 만들 이유가 없다.
 */
export function AdminShell({
  dashboard,
  children,
  hideFreshnessBanner = false,
}: {
  dashboard: Dashboard;
  children: ReactNode;
  /** 본문 자체가 신선도를 상시 노출하는 화면에서만 켠다 (중복 경고 방지) */
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
          {/* 자리 하나를 장식(`DECISION OS` 칩)에서 기능(투어 재시작)으로 바꿨다 — 상단 바를
              걷어내면서 모바일에서 투어로 들어갈 길이 여기밖에 남지 않았다 */}
          <TourLink />
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
          {/* 심사위원이 화면 구조를 스스로 찾지 않아도 되도록 투어를 어디서든 다시 시작할 수 있게
              한다 — 상단 바를 걷어내며 이 자리로 옮겼다. 메뉴가 아니라 도구라 계정 칸과 함께
              사이드바 바닥에 둔다(SideNav의 항목 문법과 섞이지 않는다) */}
          <TourLink className="mb-3 w-full justify-center" />
          {/* 사이드바 면보다 반 단 낮은 틴트 + 보더 — 계정 칸을 별개 블록으로 눌러 묶는다 */}
          <div className="flex items-center gap-3 rounded-xl bg-admin-surface-sunken px-3 py-3">
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
        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 xl:px-9">
          {freshness.isStale && !hideFreshnessBanner ? (
            <section
              role="status"
              aria-label="데이터 신선도 경고"
              className="mx-auto mb-5 flex max-w-[1500px] items-start gap-2.5 rounded-2xl bg-state-warn-bg px-4 py-3 text-xs leading-5 text-state-warn"
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

