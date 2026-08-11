"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * 라우트 에러 경계 (docs/plan/08 F9 · 12 §5).
 *
 * 심사 기간의 최대 리스크는 "FE는 살아 있는데 BE가 늦거나 죽는" 경우다. 그때 빈 화면이 뜨면
 * 심사위원에게는 서비스가 고장 난 것으로 보이므로, ① 무슨 일인지 ② 다시 시도할 수 있다는 것
 * ③ 첫 요청은 원래 느릴 수 있다는 것을 한 화면에서 알린다.
 *
 * ⚠ 이 파일은 `"use client"`다 — **`@/lib/api`를 import 하지 않는다.** 그 모듈은 정적 JSON
 *   (usage_monthly 등)을 import 하므로 여기서 끌어오면 에러 화면 번들에 함께 실린다.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    // 화면에는 내부 메시지를 노출하지 않는다(프로덕션 빌드에서는 Next가 이미 가린다).
    // 원인 추적은 콘솔·digest로 한다
    console.error(error);
  }, [error]);

  // reset()만 부르면 라우터 캐시의 실패한 RSC 페이로드를 다시 그려서 서버가 복구돼도
  // 오류 화면을 벗어나지 못한다 — refresh로 서버 컴포넌트를 재요청한 뒤 경계를 해제한다.
  const retry = () => {
    startRetry(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-admin-bg px-5 py-10">
      <div className="w-full max-w-lg rounded-card bg-admin-surface p-6 shadow-card sm:p-7">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-state-warn-bg text-state-warn">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4.2 2.9 19.8h18.2L12 4.2ZM12 10v4.2M12 17.2h.02" />
          </svg>
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-admin-primary">
          상생 나침반
        </p>
        <h1 className="mt-1.5 text-[22px] font-bold leading-8 text-admin-text">
          데이터를 불러오지 못했습니다
        </h1>

        <p className="mt-2.5 break-keep text-[15px] leading-7 text-admin-text-soft">
          데이터 서버 응답을 받지 못했습니다. 일시적인 네트워크 문제일 수 있으니 다시 시도해 주세요.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            aria-busy={retrying}
            className="rounded-lg bg-admin-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-admin-primary-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrying ? "다시 불러오는 중…" : "다시 시도"}
          </button>
          <Link
            href="/"
            className="rounded-lg border border-admin-border bg-admin-surface px-4 py-2.5 text-sm font-semibold text-admin-text transition-colors hover:bg-admin-surface-sunken"
          >
            Action Card 허브로
          </Link>
          <Link
            href="/widget"
            className="rounded-lg border border-admin-border bg-admin-surface px-4 py-2.5 text-sm font-semibold text-admin-text transition-colors hover:bg-admin-surface-sunken"
          >
            방문객 위젯 보기
          </Link>
        </div>

        {error.digest ? (
          <p className="u-note mt-5 border-t border-admin-border pt-3">
            오류 코드 <span className="tabular-nums">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
