/**
 * 담당자 화면 로딩 스켈레톤 (docs/plan/08 F9 · 12 §5).
 *
 * 왜 스피너가 아니라 스켈레톤인가: 심사위원의 첫 접속에서 Lambda 콜드스타트로 API가 1~3초
 * 늦게 오는데, 그 사이 빈 화면이 뜨면 "데이터가 안 나온다 = 고장"으로 읽힌다. 실제 화면과 같은
 * 골격(사이드바 → 헤더 → 본문 카드)을 같은 높이로 먼저 그려 두면 레이아웃이 튀지 않고,
 * "불러오는 중"이라는 사실이 화면 자체로 전달된다.
 *
 * ⚠ 치수는 `AdminShell`과 맞춰 둔다 — 사이드바 폭 228px, 헤더 2줄.
 * `variant`가 둘인 이유: 허브만 본문 폭이 1600px이고 상단이 인사말 + 지표 타일 4장 + 히어로
 * 8/4 분할이다. 하나로 합치면 어느 한쪽에서 스켈레톤→실화면 전환 때 가로 폭이 한 번 튄다.
 */
import Image from "next/image";

const BAR = "animate-pulse rounded-md bg-black/[0.06]";

export function PageSkeleton({ variant = "page" }: { variant?: "hub" | "page" }) {
  const hub = variant === "hub";

  return (
    <div className="min-h-screen bg-admin-bg lg:flex" role="status" aria-live="polite">
      <span className="sr-only">화면을 불러오는 중입니다</span>

      {/* 사이드바 — 실제 폭(lg:w-[228px])과 같게 두어 본문 시작점이 움직이지 않게 한다 */}
      <aside className="border-b border-admin-border bg-admin-sidebar-surface lg:min-h-screen lg:w-[228px] lg:shrink-0 lg:border-b-0 lg:border-r-[0.5px]">
        {/* 로고는 자리표시가 아니라 실제 이미지를 쓴다 — 스켈레톤→실화면 전환에서 브랜드가 깜빡이지 않는다 */}
        <div className="hidden px-5 pb-2 pt-6 lg:block">
          <Image src="/brand/sangseng-navigator-lockup.png" alt="" width={180} height={35} priority />
          <span className="mt-2 block text-xs leading-4 text-admin-text-soft">
            강원랜드 지역상생 의사결정 지원
          </span>
        </div>
        <div className="flex gap-2 px-3 py-3 lg:flex-col lg:gap-1 lg:px-3 lg:py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="h-9 w-24 shrink-0 animate-pulse rounded-lg bg-lavender-100 lg:w-full"
            />
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-admin-border bg-admin-surface px-4 py-3 sm:px-6">
          <div className={`${BAR} h-8 w-64 max-w-full`} />
          <div className={`${BAR} mt-2 h-3 w-full max-w-xl`} />
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-7 2xl:px-10 2xl:py-9">
          <div
            className={`mx-auto flex flex-col gap-6 ${hub ? "max-w-[1600px] 2xl:gap-7" : "max-w-6xl"}`}
          >
            <div>
              <div className={`${BAR} ${hub ? "h-10 w-96" : "h-8 w-48"} max-w-full`} />
              <div className={`${BAR} mt-3 h-3.5 w-full max-w-2xl`} />
            </div>

            {/* 상단 지표 4열 — 실제 화면과 같은 자리에 같은 높이로 */}
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={
                    hub
                      ? "rounded-panel bg-admin-surface p-5 shadow-float"
                      : "rounded-card bg-admin-surface p-4 shadow-card"
                  }
                  style={{ minHeight: hub ? 228 : 140 }}
                >
                  <div className={`${BAR} h-8 w-8 rounded-[10px]`} />
                  <div className={`${BAR} ${hub ? "mt-4 h-9 w-32" : "mt-3 h-8 w-24"}`} />
                  <div className={`${BAR} mt-4 h-3 w-full`} />
                  {hub ? <div className={`${BAR} mt-8 h-10 w-full`} /> : null}
                </div>
              ))}
            </div>

            {hub ? (
              /* 히어로 8/4 분할 — 첫 화면에서 가장 큰 면이라 여기가 어긋나면 전환이 가장 크게 튄다 */
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div
                  className="rounded-hero bg-admin-surface p-8 shadow-float ring-1 ring-inset ring-admin-primary-line lg:col-span-8"
                  style={{ minHeight: 520 }}
                >
                  <div className={`${BAR} h-6 w-40 rounded-full`} />
                  <div className={`${BAR} mt-5 h-10 w-full max-w-xl`} />
                  <div className={`${BAR} mt-3 h-4 w-full max-w-lg`} />
                  <div className={`${BAR} mt-8 h-24 w-full`} />
                  <div className={`${BAR} mt-6 h-11 w-64`} />
                </div>
                <div
                  className="u-float p-5 lg:col-span-4"
                  style={{ minHeight: 520 }}
                >
                  <div className={`${BAR} h-9 w-9 rounded-xl`} />
                  <div className={`${BAR} mt-4 h-4 w-full`} />
                  <div className={`${BAR} mt-2.5 h-4 w-5/6`} />
                  <div className={`${BAR} mt-6 h-4 w-full`} />
                  <div className={`${BAR} mt-2.5 h-4 w-4/6`} />
                </div>
              </div>
            ) : (
              [240, 220].map((h, i) => (
                <div
                  key={i}
                  className="rounded-card bg-admin-surface p-5 shadow-card"
                  style={{ minHeight: h }}
                >
                  <div className={`${BAR} h-5 w-52`} />
                  <div className={`${BAR} mt-3 h-3.5 w-full max-w-lg`} />
                  <div className={`${BAR} mt-2 h-3.5 w-full max-w-md`} />
                  <div className={`${BAR} mt-5 h-20 w-full`} />
                </div>
              ))
            )}

            <p className="u-note">
              데이터를 불러오는 중입니다. 첫 접속은 서버가 깨어나는 시간이 더해져 몇 초 걸릴 수
              있습니다.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
