"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 라우트 에러 경계 (docs/plan/08 F9 · 12 §5).
 *
 * 심사 기간의 최대 리스크는 "FE는 살아 있는데 BE가 늦거나 죽는" 경우다. 그때 빈 화면이 뜨면
 * 심사위원에게는 서비스가 고장 난 것으로 보이므로, ① 무슨 일인지 ② 다시 시도할 수 있다는 것
 * ③ 첫 요청은 원래 느릴 수 있다는 것을 한 화면에서 알린다.
 *
 * ⚠ 이 파일은 `"use client"`다 — **`@/lib/api`를 import 하지 않는다.** 그 모듈은 mock JSON
 *   (merchants 330KB 포함)을 정적 import 하므로 여기서 `isMockMode`를 끌어오면 mock 전체가
 *   에러 화면 번들에 실린다. 같은 판정을 env로 직접 한다 —
 *   `NEXT_PUBLIC_*`는 빌드 시 문자열로 인라인되므로 클라이언트에서 그대로 읽을 수 있다.
 */
const isMockMode = !process.env.NEXT_PUBLIC_API_BASE;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 화면에는 내부 메시지를 노출하지 않는다(프로덕션 빌드에서는 Next가 이미 가린다).
    // 원인 추적은 콘솔·digest로 한다
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-admin-bg px-5 py-10">
      <div className="w-full max-w-lg rounded-card bg-admin-surface p-6 shadow-card">
        <p className="text-xs font-medium text-admin-primary">상생 나침반</p>
        <h1 className="mt-1 text-xl font-bold text-admin-text">데이터를 불러오지 못했습니다</h1>

        <p className="mt-2 break-keep text-sm leading-6 text-admin-text-muted">
          {isMockMode
            ? "화면을 그리는 중 문제가 생겼습니다. 다시 시도하면 대개 정상으로 돌아옵니다."
            : "데이터 서버 응답을 받지 못했습니다. 서버가 깨어나는 중일 수 있습니다 — 첫 요청은 1~3초가 더 걸리므로, 다시 시도하면 대개 정상으로 표시됩니다."}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-admin-sidebar-active"
          >
            다시 시도
          </button>
          <Link
            href="/"
            className="rounded-lg border border-black/10 bg-admin-surface px-4 py-2 text-sm font-medium text-admin-text transition-colors hover:bg-admin-bg"
          >
            Action Card 허브로
          </Link>
          <Link
            href="/widget"
            className="rounded-lg border border-black/10 bg-admin-surface px-4 py-2 text-sm font-medium text-admin-text transition-colors hover:bg-admin-bg"
          >
            방문객 위젯 보기
          </Link>
        </div>

        {error.digest ? (
          <p className="mt-4 border-t border-black/5 pt-3 text-[11px] leading-4 text-admin-text-muted">
            오류 코드 <span className="tabular-nums">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
