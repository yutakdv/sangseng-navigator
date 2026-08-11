import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { TodayPickCopy } from "@/lib/todayPick";

/**
 * 오늘의 추천 — 새 목록이 아니라 **필터 지름길 카드 한 장**이다.
 *
 * 페이백 배너(soft green 채움)보다 한 단계 낮은 위계로 둔다: 흰 배경 + 얇은 테두리에
 * 그린 악센트만(MerchantCard와 같은 표면). 좌측 아이콘칩 + 본문 골격은 페이백 배너와 같아
 * 두 카드가 한 줄기로 읽힌다.
 *
 * 아이콘은 날씨가 아니라 `calendar`를 쓴다 — 주근거가 요일 실측이라는 사실을 시각적으로도
 * 맞추기 위해서다(날씨 아이콘을 쓰면 날씨가 추천 근거처럼 읽힌다).
 *
 * 문구는 전부 서버에서 만들어 props로 받는다(lib/todayPick.ts) — 이 컴포넌트는 문장을 짓지 않는다.
 */
export function TodayPick({
  copy,
  chipHref,
  closeHref,
}: {
  copy: TodayPickCopy;
  chipHref: string | null;
  /** 닫기 — URL로 처리한다(`today=off`). 필터를 눌러 화면이 다시 그려져도 닫힌 상태가 유지되고,
   *  클라이언트 상태를 들이지 않아 이 컴포넌트가 서버 컴포넌트로 남는다 */
  closeHref: string;
}) {
  return (
    <section
      aria-label="오늘의 추천"
      className="relative mx-5 mt-5 rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-card sm:mx-8"
    >
      <Link
        href={closeHref}
        aria-label="오늘의 추천 닫기"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-admin-text-muted transition-colors hover:bg-slate-100 hover:text-admin-text"
      >
        <Icon name="close" size={14} strokeWidth={2.2} />
      </Link>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-visitor-primary-soft text-visitor-primary">
          <Icon name="calendar" size={17} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-visitor-primary">
            오늘의 추천
          </p>
          {/* 390px 모바일에서 headline이 2줄로 접힌다 — 단어 중간에서 끊기지 않게 break-keep.
              pr-7은 우상단 닫기 버튼 자리 */}
          <p className="mt-1 break-keep pr-7 text-[15px] font-bold leading-6 text-admin-text">
            {copy.headline}
          </p>
          <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">{copy.evidence}</p>
          {copy.weatherLine ? (
            <p className="mt-1.5 break-keep text-xs leading-5 text-admin-text">{copy.weatherLine}</p>
          ) : null}
          {chipHref ? (
            <Link
              href={chipHref}
              className="mt-2.5 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-visitor-primary px-3.5 text-[13px] font-bold text-white shadow-[0_4px_12px_-4px_rgb(22_101_52_/_0.7)]"
            >
              {copy.chipLabel}
              <Icon name="arrowRight" size={14} strokeWidth={2.2} />
            </Link>
          ) : null}
          <p className="mt-2 break-keep text-[11px] leading-5 text-admin-text-muted">
            {copy.footnote}
          </p>
        </div>
      </div>
    </section>
  );
}
