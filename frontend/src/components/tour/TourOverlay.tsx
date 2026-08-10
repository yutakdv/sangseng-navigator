"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TOUR_STEPS, type TourStep } from "@/lib/tourSteps";

/** 첫 방문 자동 노출 1회 기록 키. "완료"·"닫기" 어느 쪽으로 끝내도 같은 값을 남긴다. */
const DONE_KEY = "sn-tour-done";

/** "path?query" 한 문자열을 pathname과 query 문자열로 나눈다. */
function splitPath(path: string): { pathname: string; query: string } {
  const i = path.indexOf("?");
  return i === -1 ? { pathname: path, query: "" } : { pathname: path.slice(0, i), query: path.slice(i + 1) };
}

/**
 * 스텝의 path와 지금 실제 경로가 같은 화면인지 — `/proposals/`처럼 "/"로 끝나는 path는
 * 동적 하위 경로(카드 id)까지 접두 일치로 인정한다. "/"는 접두 일치를 적용하면 모든 경로가
 * 걸리므로 예외로 둔다(정확히 같을 때만).
 */
function pathMatches(stepPathname: string, actualPathname: string): boolean {
  if (actualPathname === stepPathname) return true;
  if (stepPathname !== "/" && stepPathname.endsWith("/")) return actualPathname.startsWith(stepPathname);
  return false;
}

/** 목적지 path(+선택적 query)에 tour=N을 실어 이동용 href를 만든다. path의 기존 query는 보존한다. */
function buildStepHref(path: string, tourN: number): string {
  const { pathname, query } = splitPath(path);
  const params = new URLSearchParams(query);
  params.set("tour", String(tourN));
  return `${pathname}?${params.toString()}`;
}

function TourOverlayInner() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tourRaw = searchParams.get("tour");
  const tourN = tourRaw ? Number(tourRaw) : null;
  const validN = tourN !== null && Number.isInteger(tourN) && tourN >= 1 && tourN <= TOUR_STEPS.length ? tourN : null;
  const stepIndex = validN !== null ? validN - 1 : -1;
  const step: TourStep | null = validN !== null ? TOUR_STEPS[stepIndex] : null;
  const active = Boolean(step && pathMatches(splitPath(step.path).pathname, pathname));

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [anchorMissing, setAnchorMissing] = useState(false);

  // 첫 방문 자동 시작 — 허브(/)에 tour 파라미터 없이 들어왔고, 이전에 끝낸 적이 없을 때 1회.
  useEffect(() => {
    if (pathname !== "/" || searchParams.get("tour")) return;
    try {
      if (!window.localStorage.getItem(DONE_KEY)) router.replace("/?tour=1");
    } catch {
      // localStorage 접근 불가(시크릿/프라이빗 모드 등) — 자동 시작만 건너뛰고 조용히 넘어간다
    }
    // pathname·searchParams만 트리거로 본다 — router는 안정 참조라 의존성에서 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // 활성 스텝의 앵커를 찾아 하이라이트 사각형을 잰다. 리사이즈·스크롤에도 다시 잰다.
  // 비활성일 때는 컴포넌트가 어차피 null을 렌더하므로 rect·anchorMissing을 되돌릴 필요가 없다
  // (렌더 직후 setState를 동기 호출하면 불필요한 캐스케이드 렌더가 생긴다).
  useEffect(() => {
    if (!active || !step) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (el) {
        setRect(el.getBoundingClientRect());
        setAnchorMissing(false);
      } else {
        setRect(null);
        setAnchorMissing(true);
      }
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step, pathname]);

  // 스텝이 바뀌면 그 앵커가 화면 중앙에 오도록 1회 스크롤한다.
  // (예: /proposals/[id]에서 3단계 "반대 관점"으로 넘어올 때 dissent 블록까지 이동)
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !step) return;
    const key = `${pathname}:${step.anchor}`;
    if (scrolledFor.current === key) return;
    const el = document.querySelector(`[data-tour="${step.anchor}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      scrolledFor.current = key;
    }
  }, [active, step, pathname]);

  if (!active || !step) return null;

  const isLast = stepIndex === TOUR_STEPS.length - 1;
  // nextHrefFromAnchor 스텝은 앵커의 href가 있어야만 다음으로 갈 수 있다(동적 카드 id) —
  // 없으면(예: 결정 대기 카드가 하나도 없는 상태) "다음"을 막고 "닫기"로만 빠져나가게 한다.
  const nextBlocked = Boolean(step.nextHrefFromAnchor) && anchorMissing;

  const close = () => {
    try {
      window.localStorage.setItem(DONE_KEY, "1");
    } catch {
      // 저장 실패해도 이번 세션 진행에는 지장 없다 — 다음 방문에 다시 자동 노출될 뿐
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tour");
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  const goNext = () => {
    if (nextBlocked) return;
    const nextIndex = stepIndex + 1;
    if (nextIndex >= TOUR_STEPS.length) {
      close();
      return;
    }
    const nextTourN = nextIndex + 1;

    if (step.nextHrefFromAnchor) {
      const el = document.querySelector(`[data-tour="${step.anchor}"]`);
      const href = el?.getAttribute("href");
      if (href) {
        router.push(buildStepHref(href, nextTourN));
        return;
      }
    }

    const next = TOUR_STEPS[nextIndex];
    const { pathname: nextPathname, query: nextQuery } = splitPath(next.path);
    if (pathMatches(nextPathname, pathname)) {
      // 같은 화면(또는 같은 동적 경로 계열) — 페이지를 옮기지 않고 tour만 올린다.
      // 다음 스텝이 요구하는 쿼리(예: preset=flip)가 있으면 함께 얹고, 그 외 기존 쿼리는 보존한다.
      const params = new URLSearchParams(searchParams.toString());
      if (nextQuery) new URLSearchParams(nextQuery).forEach((v, k) => params.set(k, v));
      params.set("tour", String(nextTourN));
      router.replace(`${pathname}?${params.toString()}`);
    } else {
      router.push(buildStepHref(next.path, nextTourN));
    }
  };

  // 설명 카드는 기본적으로 화면 하단에 고정한다(모바일 bottom sheet와 동일 자리).
  // 다만 /proposals/[id]의 DecisionBar처럼 앵커 자체가 화면 하단 고정 바라 카드와 겹칠 수 있는
  // 경우(4단계 "담당자 승인")에는 카드를 하이라이트 위로 띄운다 — 그러지 않으면 카드가 승인 버튼을
  // 그대로 가려 정작 강조하려는 요소가 안 보인다.
  const CARD_RESERVE_PX = 190;
  const overlapsCardZone =
    rect !== null && typeof window !== "undefined" && rect.bottom > window.innerHeight - CARD_RESERVE_PX;
  const cardStyle = overlapsCardZone ? { bottom: Math.max(12, window.innerHeight - rect!.top + 12) } : undefined;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={`가이드 투어 ${stepIndex + 1}/${TOUR_STEPS.length}`}>
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-lg shadow-[0_0_0_3px_white,0_0_0_7px_theme(colors.admin.primary)] transition-all duration-150"
          style={{
            top: Math.max(rect.top - 6, 0),
            left: Math.max(rect.left - 6, 0),
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : null}

      <div
        style={cardStyle}
        className="fixed inset-x-3 bottom-3 z-[101] mx-auto flex flex-col gap-3 rounded-2xl bg-admin-surface p-4 shadow-card-hover ring-1 ring-inset ring-admin-border sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:w-[380px] sm:max-w-[calc(100vw-24px)] sm:-translate-x-1/2 sm:p-5">
        <span className="w-fit rounded-full bg-admin-primary-soft px-2.5 py-1 text-xs font-bold tabular-nums text-admin-primary">
          {stepIndex + 1} / {TOUR_STEPS.length}
        </span>

        <div>
          <h2 className="text-[15px] font-bold leading-6 text-admin-text">{step.title}</h2>
          <p className="mt-1.5 break-keep text-[13px] leading-6 text-admin-text-soft">{step.body}</p>
          {anchorMissing ? (
            <p className="mt-2 break-keep text-xs leading-5 text-admin-text-muted">
              지금 이 데모 상태에서는 표시할 화면 요소가 없습니다.
              {nextBlocked ? " 투어를 닫고 다음에 다시 시도해 주세요." : " 다음 단계로 계속 진행할 수 있습니다."}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-admin-text-muted transition-colors hover:bg-admin-surface-sunken hover:text-admin-text"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={nextBlocked}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-admin-primary-strong disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isLast ? "완료" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * `useSearchParams()`를 쓰는 클라이언트 컴포넌트라 Suspense 경계가 필요하다(Next 16 규칙) —
 * 마운트하는 쪽(AdminShell·widget/page.tsx)이 신경 쓰지 않도록 이 컴포넌트가 스스로 감싼다.
 */
export function TourOverlay() {
  return (
    <Suspense fallback={null}>
      <TourOverlayInner />
    </Suspense>
  );
}
