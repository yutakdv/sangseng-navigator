import { test, expect } from "@playwright/test";

/**
 * 홈 헤더 · StatusBar sticky 겹침 시각 회귀 검증 (Task D3a).
 *
 * 커밋 1f9e622가 "홈에서 헤더가 sticky top-0 z-20으로 StatusBar(sticky top-0 z-30) 뒤에 가려
 * '3분 체험' 버튼이 사라지는" 회귀를 CSS 스태킹 추론만으로 고쳤다 — 실제 렌더는 아무도
 * 보지 않았다. 여기서 실제 boundingBox로 확인한다.
 */

test.describe("홈 sticky 겹침 회귀", () => {
  test("스크롤하면 StatusBar가 상단에 고정되고, 헤더는 그 뒤에 숨지 않고 흘러 올라간다", async ({ page }) => {
    // 이 스펙은 sticky 겹침만 본다 — 첫 방문 자동 투어 시작(tour.spec.ts 대상)이 끼어들면
    // 라우터 replace가 스크롤 위치를 되돌려 이 테스트를 오염시키므로 완료 표시를 미리 남긴다.
    await page.addInitScript(() => window.localStorage.setItem("sn-tour-done", "1"));
    await page.goto("/");

    // AdminShell의 헤더만 특정한다 — 화면 안에는 시맨틱 <header>가 여럿이다(PageHeader 등)
    const header = page.locator("header").filter({ has: page.getByRole("link", { name: "3분 체험" }) });
    const statusBar = page.locator("div.sticky.top-0.z-30");

    await expect(header).toBeVisible();
    await expect(statusBar).toBeVisible();

    const headerBefore = await header.boundingBox();
    expect(headerBefore, "스크롤 전 헤더 boundingBox를 가져오지 못했습니다").not.toBeNull();

    // 헤더 높이 + StatusBar 높이를 넉넉히 넘는 양만큼 스크롤한다
    await page.evaluate(() => window.scrollTo(0, 1500));
    // sticky 재계산은 즉시 일어나지만, 레이아웃이 안정될 여유를 짧게 둔다
    await page.waitForTimeout(100);

    const statusBarAfter = await statusBar.boundingBox();
    expect(statusBarAfter, "스크롤 후 StatusBar boundingBox를 가져오지 못했습니다").not.toBeNull();
    // sticky top-0 — 뷰포트 상단에 고정돼 있어야 한다
    expect(statusBarAfter!.y, `StatusBar가 상단에 고정되지 않았습니다(top=${statusBarAfter!.y})`).toBeGreaterThanOrEqual(-1);
    expect(statusBarAfter!.y, `StatusBar가 상단에 고정되지 않았습니다(top=${statusBarAfter!.y})`).toBeLessThanOrEqual(2);

    const headerAfter = await header.boundingBox();
    expect(headerAfter, "스크롤 후 헤더 boundingBox를 가져오지 못했습니다").not.toBeNull();
    // 회귀가 재발했다면 헤더가 sticky로 top:0에 남아 headerAfter.y ≈ 0이 된다(그리고 StatusBar에 가려진다).
    // 고친 상태(relative)라면 헤더는 스크롤과 함께 흘러 올라가 뷰포트 위로 완전히 벗어나야 한다.
    expect(
      headerAfter!.y + headerAfter!.height,
      `헤더가 스크롤 후에도 상단에 남아 있습니다(top=${headerAfter!.y}, height=${headerAfter!.height}) — StatusBar에 가려지는 회귀 재발 의심`,
    ).toBeLessThanOrEqual(0);

    // "3분 체험" 버튼도 같은 이유로 화면 밖으로 사라져 있어야 한다(가려진 채 남아 있으면 안 된다)
    const tourButton = page.getByRole("link", { name: "3분 체험" });
    const tourButtonBox = await tourButton.boundingBox();
    expect(tourButtonBox, "3분 체험 버튼 boundingBox를 가져오지 못했습니다").not.toBeNull();
    expect(tourButtonBox!.y + tourButtonBox!.height).toBeLessThanOrEqual(0);
  });

  test("다른 화면(/tracking)에서는 헤더가 스크롤 중에도 상단에 고정된다", async ({ page }) => {
    await page.goto("/tracking");

    const header = page.locator("header").filter({ has: page.getByRole("link", { name: "3분 체험" }) });
    await expect(header).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(100);

    const headerAfter = await header.boundingBox();
    expect(headerAfter, "스크롤 후 헤더 boundingBox를 가져오지 못했습니다").not.toBeNull();
    expect(headerAfter!.y, `/tracking 헤더가 상단에 고정되지 않았습니다(top=${headerAfter!.y})`).toBeGreaterThanOrEqual(-1);
    expect(headerAfter!.y, `/tracking 헤더가 상단에 고정되지 않았습니다(top=${headerAfter!.y})`).toBeLessThanOrEqual(2);

    // 고정된 화면에서는 "3분 체험" 버튼도 항상 보여야 한다
    await expect(page.getByRole("link", { name: "3분 체험" })).toBeVisible();
  });
});
