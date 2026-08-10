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
