import { test, expect, type Page } from "@playwright/test";
import { fetchDynamicIds, measureHorizontalOverflow, watchConsole } from "./helpers";

/**
 * 스모크 — 8화면 정상 경로 (Task D3a).
 *
 * 각 화면에서 세 가지를 함께 확인한다: ① 핵심 요소가 실제로 보이는가 ② 콘솔에 error·
 * Hydration/DOM 중첩 경고가 0건인가(현재 기준선 0건 — 회귀 감지선) ③ 가로 스크롤이 생기지
 * 않는가. 동적 id(/cards/[id]·/proposals/[id])는 하드코딩하지 않고 허브·트래킹에서 실제
 * 링크를 읽어 얻는다 — 시드 데이터가 바뀌어도 이 스펙은 계속 유효해야 한다.
 */

let cardId = "";
let proposalId = "";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const ids = await fetchDynamicIds(page);
  cardId = ids.cardId;
  proposalId = ids.proposalId;
  await page.close();
});

type RouteCase = {
  title: string;
  path: () => string;
  assertCoreElement: (page: Page) => Promise<void>;
};

const cases: RouteCase[] = [
  {
    title: "허브 (/)",
    path: () => "/",
    assertCoreElement: async (page) => {
      await expect(page.getByRole("heading", { name: /오늘 결정할 사안을 확인합니다/ })).toBeVisible();
      await expect(page.locator('[data-tour="impact-hero"]')).toBeVisible();
    },
  },
  {
    title: "대시보드 (/dashboard)",
    path: () => "/dashboard",
    assertCoreElement: async (page) => {
      await expect(page.getByRole("heading", { name: "지역 소비 분석", exact: true })).toBeVisible();
    },
  },
  {
    title: "인센티브 (/incentive)",
    path: () => "/incentive",
    assertCoreElement: async (page) => {
      await expect(page.getByRole("heading", { name: "인센티브 정책 카드", exact: true })).toBeVisible();
    },
  },
  {
    title: "트래킹 (/tracking)",
    path: () => "/tracking",
    assertCoreElement: async (page) => {
      await expect(page.getByRole("heading", { name: "추진 경과 리포트", exact: true })).toBeVisible();
    },
  },
  {
    title: "트래킹 작성 (/tracking/new)",
    path: () => "/tracking/new",
    assertCoreElement: async (page) => {
      await expect(page.getByRole("heading", { name: "추진 기록 입력", exact: true })).toBeVisible();
    },
  },
  {
    title: "위젯 (/widget)",
    path: () => "/widget",
    assertCoreElement: async (page) => {
      await expect(page.getByRole("heading", { name: "지역별 하이원포인트 가맹점", exact: true })).toBeVisible();
    },
  },
  {
    title: "카드 상세 (/cards/[id])",
    path: () => `/cards/${cardId}`,
    assertCoreElement: async (page) => {
      await expect(page.getByRole("navigation", { name: "카드 검토 순서" })).toBeVisible();
      await expect(page.getByText(cardId, { exact: false }).first()).toBeVisible();
    },
  },
  {
    title: "제안 검토 (/proposals/[id])",
    path: () => `/proposals/${proposalId}`,
    assertCoreElement: async (page) => {
      await expect(page.getByText("AI 제안 · 승인 전 검토 대상", { exact: true })).toBeVisible();
    },
  },
];

/**
 * 데이터 출처 칩 팝오버 — 모바일에서 뷰포트 기준 `fixed`로 뜨기 때문에 화면 하단 고정 요소와
 * 좌표가 겹칠 수 있다. 실제로 허브(`/`)의 모바일 전용 CTA(`fixed inset-x-3 bottom-3`, `<Link>`)와
 * 정확히 같은 자리에 떠서 팝오버 하단(하필 k=5 소표본 보호 고지)이 덮이고, 고지를 읽으려 탭하면
 * 카드 상세로 이동해 버리는 회귀가 있었다. 좌표로 직접 못 박는다.
 */
test.describe("출처 칩 팝오버 — 하단 고정 요소와 겹치지 않는다", () => {
  // path는 지연 평가한다 — 동적 id는 beforeAll에서 채워지므로 수집 시점에는 아직 비어 있다.
  // `/dashboard`에는 출처 칩이 없다(SourceChip 사용처는 허브·인센티브·셀 탐색·카드 상세 넷).
  const chipRoutes: { label: string; path: () => string }[] = [
    { label: "허브", path: () => "/" },
    { label: "인센티브", path: () => "/incentive" },
    { label: "카드 상세", path: () => `/cards/${cardId}` },
  ];

  for (const route of chipRoutes) {
    test(`${route.label} — 팝오버가 뷰포트 안에 온전히 보인다`, async ({ page }) => {
      const viewport = page.viewportSize();
      test.skip(!viewport || viewport.width >= 640, "팝오버 뷰포트 고정은 640px 미만에서만 적용된다");

      // 투어 오버레이가 첫 방문에 자동으로 뜨면 칩을 가린다 — 이 스펙의 관심사가 아니다
      await page.addInitScript(() => window.localStorage.setItem("sn-tour-done", "1"));
      await page.goto(route.path());

      const chipGroup = page
        .locator("span.group")
        .filter({ has: page.locator('button[aria-label^="데이터 출처"]') })
        .first();
      await expect(chipGroup, `${route.label}에서 출처 칩을 찾지 못했습니다`).toBeVisible();
      // 모바일에는 hover가 없다 — 키보드 포커스가 group-focus-within으로 여는 경로를 그대로 쓴다
      await chipGroup.getByRole("button").focus();

      const popover = chipGroup.getByRole("tooltip");
      await expect(popover).toBeVisible();
      const box = await popover.boundingBox();
      expect(box, "팝오버의 boundingBox를 가져오지 못했습니다").not.toBeNull();
      expect(box!.y, `팝오버 top(${box!.y})이 뷰포트 밖입니다`).toBeGreaterThanOrEqual(0);
      expect(
        box!.y + box!.height,
        `팝오버 bottom(${box!.y + box!.height})이 뷰포트(${viewport!.height}) 밖입니다`,
      ).toBeLessThanOrEqual(viewport!.height + 1);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);

      // 화면 하단 고정 요소(허브의 모바일 CTA 등)와 좌표가 겹치면 안 된다
      const fixedBottom = page.locator("a.fixed.bottom-3, div.fixed.bottom-0");
      for (let i = 0; i < (await fixedBottom.count()); i += 1) {
        const other = fixedBottom.nth(i);
        if (!(await other.isVisible())) continue;
        const otherBox = await other.boundingBox();
        if (!otherBox) continue;
        const intersects =
          box!.x < otherBox.x + otherBox.width - 1 &&
          otherBox.x < box!.x + box!.width - 1 &&
          box!.y < otherBox.y + otherBox.height - 1 &&
          otherBox.y < box!.y + box!.height - 1;
        expect(
          intersects,
          `${route.label}에서 출처 칩 팝오버(y=${box!.y}~${box!.y + box!.height})가 하단 고정 요소(y=${otherBox.y}~${otherBox.y + otherBox.height})와 겹칩니다`,
        ).toBe(false);
      }
    });
  }

  test("허브 팝오버의 k=5 소표본 보호 고지가 가려지지 않고 끝까지 읽힌다", async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= 640, "팝오버 뷰포트 고정은 640px 미만에서만 적용된다");

    await page.addInitScript(() => window.localStorage.setItem("sn-tour-done", "1"));
    await page.goto("/");

    const chipGroup = page
      .locator("span.group")
      .filter({ has: page.locator('button[aria-label^="데이터 출처"]') })
      .first();
    await chipGroup.getByRole("button").focus();
    const notice = chipGroup.getByRole("tooltip").getByText(/비공개 처리했고/);
    await expect(notice).toBeVisible();
    await expect(notice).toBeInViewport();

    // 뷰포트 안에 있다고 읽히는 것은 아니다 — 그 지점을 실제로 무엇이 차지하고 있는지까지 본다.
    // (하단 고정 CTA가 위에 깔리면 고지가 안 읽히고, 그 자리를 탭하면 카드 상세로 이동해 버린다)
    const hitInside = await notice.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && (el.contains(hit) || hit.contains(el)));
    });
    expect(hitInside, "k=5 소표본 보호 고지 위를 다른 요소가 덮고 있습니다").toBe(true);
  });
});

for (const c of cases) {
  test(c.title, async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto(c.path());
    await c.assertCoreElement(page);

    const overflow = await measureHorizontalOverflow(page);
    expect(
      overflow.overflowing,
      `가로 스크롤 발생: scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
    ).toBe(false);

    expect(watch.errors, `콘솔 에러 발생:\n${watch.errors.join("\n")}`).toEqual([]);
    expect(
      watch.hydrationWarnings,
      `Hydration/DOM 중첩 경고 발생 (기준선 0건):\n${watch.hydrationWarnings.join("\n")}`,
    ).toEqual([]);
  });
}
