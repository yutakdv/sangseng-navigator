/**
 * 방문객 위젯 전용 로딩 스켈레톤 (docs/plan/08 F9 · 13 §4).
 *
 * 루트 `app/loading.tsx`는 담당자 화면(다크 인디고 사이드바) 골격이라, 그대로 두면 데모 7단계
 * (`/tracking` → `/widget`)에서 그린 테마 위젯 직전에 인디고 화면이 한 번 번쩍인다.
 * 역할 구분(담당자=인디고, 방문객=그린)은 13 §4에서 불변 원칙이므로 로딩 중에도 유지한다.
 */

const BAR = "animate-pulse rounded-md bg-black/[0.06]";

export default function WidgetLoading() {
  return (
    <div className="min-h-screen bg-admin-bg py-0 sm:py-10" role="status" aria-live="polite">
      <span className="sr-only">추천 가맹점을 불러오는 중입니다</span>

      <div className="mx-auto w-full max-w-[390px] bg-visitor-bg shadow-card-hover sm:rounded-[28px] sm:ring-1 sm:ring-black/5">
        {/* 실제 화면과 같이 로고 바 없이 시작한다 — 우측 상단 담당자 화면 링크 자리만 비워 둔다 */}
        <div className="flex justify-end px-5 pt-4">
          <div className={`${BAR} h-3 w-20`} />
        </div>

        <div className="px-5 py-5">
          {/* 검색 한 칸 + 선택 필드 두 칸 — 실제 컨트롤과 같은 높이(52px)로 잡아 뜰 때 밀리지 않게 */}
          <div className="h-[52px] animate-pulse rounded-2xl bg-black/[0.06]" />
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <span key={i} className="h-[52px] animate-pulse rounded-2xl bg-black/[0.06]" />
            ))}
          </div>

          {/* 추천 카드 3장 — 실제 목록과 비슷한 높이로 두어 뜰 때 화면이 밀리지 않게 한다 */}
          <div className="mt-6 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3 rounded-2xl bg-visitor-surface-sunken p-4">
                <span className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-black/[0.06]" />
                <div className="min-w-0 flex-1">
                  <div className={`${BAR} h-4 w-32`} />
                  <div className={`${BAR} mt-2.5 h-3 w-full`} />
                  <div className={`${BAR} mt-1.5 h-3 w-2/3`} />
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs leading-5 text-admin-text-muted">
            가맹점 정보를 불러오는 중이에요.
          </p>
        </div>
      </div>
    </div>
  );
}
