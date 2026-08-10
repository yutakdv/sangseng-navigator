import type { Page } from "@playwright/test";

/**
 * 공용 테스트 헬퍼 (Task D3a).
 *
 * 이 파일은 애플리케이션 코드가 아니라 검증 하네스다 — `frontend/src/`를 건드리지 않고
 * 여기서만 8화면·투어·sticky·복원력 스펙이 공유하는 조각을 모은다.
 */

/** React 하이드레이션 불일치·잘못된 DOM 중첩 경고를 잡아내는 패턴 (기준선 0건 — 회귀 감지선). */
const HYDRATION_PATTERNS: RegExp[] = [/hydration/i, /validateDOMNesting/i, /cannot be a descendant/i];

export type ConsoleWatch = {
  /** 위 패턴에 걸리지 않는 일반 콘솔 에러 */
  errors: string[];
  /** 하이드레이션·DOM 중첩류 경고(error 레벨로 찍히는 경우 포함) */
  hydrationWarnings: string[];
};

/**
 * 페이지에 콘솔 감시기를 붙인다. `page.goto()` **이전에** 호출해야 초기 렌더의 에러도 잡는다.
 */
export function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { errors: [], hydrationWarnings: [] };
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const text = msg.text();
    const isHydration = HYDRATION_PATTERNS.some((p) => p.test(text));
    if (isHydration) {
      watch.hydrationWarnings.push(text);
    } else if (type === "error") {
      watch.errors.push(text);
    }
  });
  page.on("pageerror", (err) => {
    watch.errors.push(String(err?.message ?? err));
  });
  return watch;
}

/** 문서 전체가 clientWidth를 넘겨 가로 스크롤이 생기는지 — 1px 여유는 서브픽셀 반올림 허용치. */
export async function measureHorizontalOverflow(
  page: Page,
): Promise<{ scrollWidth: number; clientWidth: number; overflowing: boolean }> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  return { scrollWidth, clientWidth, overflowing: scrollWidth > clientWidth + 1 };
}

export type DynamicIds = {
  /** 허브 "오늘 검토 1순위" 카드가 잇는 /proposals/[id] */
  proposalId: string;
  /** 트래킹의 승인 카드가 잇는 /cards/[id] */
  cardId: string;
};

/**
 * 시드 데이터가 바뀌어도 깨지지 않도록, 하드코딩 대신 실제 화면에서 링크를 읽어 동적 id를 얻는다.
 * - `/proposals/[id]`는 허브(`/`)의 "근거·전망 검토하기" 버튼(`data-tour="first-proposal"`)에서.
 * - `/cards/[id]`는 트래킹(`/tracking`)의 승인 카드 행 링크에서.
 */
export async function fetchDynamicIds(page: Page): Promise<DynamicIds> {
  await page.goto("/");
  const proposalHref = await page.locator('a[href^="/proposals/"]').first().getAttribute("href");
  if (!proposalHref) {
    throw new Error("허브(/)에서 /proposals/ 링크를 찾지 못했습니다 — 결정 대기 카드가 없는 시드 상태일 수 있습니다.");
  }
  const proposalId = proposalHref.replace(/^\/proposals\//, "").split(/[?#]/)[0];

  await page.goto("/tracking");
  const cardHref = await page.locator('a[href^="/cards/"]').first().getAttribute("href");
  if (!cardHref) {
    throw new Error("트래킹(/tracking)에서 /cards/ 링크를 찾지 못했습니다 — 승인된 카드가 없는 시드 상태일 수 있습니다.");
  }
  const cardId = cardHref.replace(/^\/cards\//, "").split(/[?#]/)[0];

  return { proposalId, cardId };
}
