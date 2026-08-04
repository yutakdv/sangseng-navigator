/**
 * 전 라우트 공통 로딩 스켈레톤 (docs/plan/08 F9 · 12 §5).
 *
 * 왜 스피너가 아니라 스켈레톤인가: 심사위원의 첫 접속에서 Lambda 콜드스타트로 API가 1~3초
 * 늦게 오는데, 그 사이 빈 화면이 뜨면 "데이터가 안 나온다 = 고장"으로 읽힌다. 실제 화면과 같은
 * 골격(사이드바 → 헤더 → 본문 카드)을 같은 높이로 먼저 그려 두면 레이아웃이 튀지 않고,
 * "불러오는 중"이라는 사실이 화면 자체로 전달된다.
 *
 * 담당자 화면 5개(`/` `/cards/[id]` `/dashboard` `/incentive` `/tracking`)가 공유하는 골격이며,
 * 테마가 다른 방문객 위젯은 `app/widget/loading.tsx`가 따로 덮는다.
 */
const BAR = "animate-pulse rounded-md bg-black/[0.06]";

export default function Loading() {
  return (
    <div className="min-h-screen bg-admin-bg lg:flex" role="status" aria-live="polite">
      <span className="sr-only">화면을 불러오는 중입니다</span>

      {/* 사이드바 — 실제 폭(lg:w-56)과 같게 두어 본문 시작점이 움직이지 않게 한다 */}
      <aside className="bg-admin-sidebar lg:min-h-screen lg:w-56 lg:shrink-0">
        <div className="hidden px-6 pb-1 pt-6 lg:block">
          <span className="text-lg font-bold text-white">상생 나침반</span>
          <p className="mt-1 text-[11px] leading-4 text-white/45">강원랜드 지역상생 의사결정 지원</p>
        </div>
        <div className="flex gap-2 px-3 py-3 lg:flex-col lg:px-3 lg:py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="h-8 w-24 shrink-0 animate-pulse rounded-lg bg-white/10 lg:w-full"
            />
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-black/5 bg-admin-surface px-5 py-3">
          <div className={`${BAR} h-5 w-64 max-w-full`} />
          <div className={`${BAR} mt-2 h-3 w-full max-w-xl`} />
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-5">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div>
              <div className={`${BAR} h-6 w-40`} />
              <div className={`${BAR} mt-2 h-3 w-full max-w-2xl`} />
            </div>
            {/* 본문 카드 3장 — 허브의 카드 목록·대시보드의 패널과 비슷한 높이 */}
            {[160, 200, 200].map((h, i) => (
              <div
                key={i}
                className="rounded-card bg-admin-surface p-4 shadow-card sm:p-5"
                style={{ minHeight: h }}
              >
                <div className={`${BAR} h-4 w-48`} />
                <div className={`${BAR} mt-3 h-3 w-full max-w-lg`} />
                <div className={`${BAR} mt-2 h-3 w-full max-w-md`} />
                <div className={`${BAR} mt-4 h-16 w-full`} />
              </div>
            ))}
            <p className="text-xs text-admin-text-muted">
              데이터를 불러오는 중입니다. 첫 접속은 서버가 깨어나는 시간이 더해져 몇 초 걸릴 수
              있습니다.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
