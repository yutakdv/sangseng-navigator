"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 데모 전용 라이브 미리보기 (`/widget?live=1`) — 담당자 화면과 위젯을 나란히 띄워 두고
 * 승인·완료가 방문객 화면에 반영되는 순간을 보여주기 위한 장치다.
 *
 * `router.refresh()`는 서버 컴포넌트 데이터만 다시 읽고 변경된 DOM만 갈아끼우므로,
 * 새로 생긴 배지에만 등장 애니메이션(`animate-pop`)이 걸린다. 상시 노출 화면이 아니라
 * 쿼리로 켠 경우에만 마운트한다 — 일반 방문객 트래픽에 폴링을 걸지 않는다.
 */
export function WidgetLiveRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/25">
      <span aria-hidden className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      실시간 반영 미리보기 · {Math.round(intervalMs / 1000)}초마다 갱신
    </span>
  );
}
