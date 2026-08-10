import { test, expect, type Page } from "@playwright/test";

/**
 * 가이드 투어 6단계 (Task D3a).
 *
 * 심사위원이 3분 안에 서비스를 따라가는 장치라 "깨지면 안 되는" 스펙이다. 모든 진행은
 * **버튼 클릭**으로만 한다 — URL을 직접 타이핑하면 실제 사용자 동선을 검증하지 못한다.
 */

/** 투어 설명 카드 — `fixed inset-x-3 bottom-3`(모바일 bottom sheet 자리)로 고정한 안내 카드. */
const tourCard = (page: Page) => page.locator("div.fixed.inset-x-3.bottom-3");
const tourDialog = (page: Page) => page.getByRole("dialog", { name: /가이드 투어/ });

/** 설명 카드가 실제 뷰포트 안에 있는지 — 390px 모바일에서 특히 중요하다. */
async function expectCardInViewport(page: Page) {
  const box = await tourCard(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box, "투어 설명 카드의 boundingBox를 가져오지 못했습니다").not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.y, `카드 top(${box.y})이 뷰포트 밖입니다`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `카드 bottom(${box.y + box.height})이 뷰포트(${viewport.height}) 밖입니다`).toBeLessThanOrEqual(
    viewport.height + 1,
  );
  expect(box.x, `카드 left(${box.x})가 뷰포트 밖입니다`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `카드 right(${box.x + box.width})가 뷰포트(${viewport.width}) 밖입니다`).toBeLessThanOrEqual(
    viewport.width + 1,
  );
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test.describe("가이드 투어 — 버튼 클릭만으로 6단계 완주", () => {
  test("1→2→3→4→5→6→완료", async ({ page }) => {
    await page.goto("/?tour=1");

    const dialog = tourDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("1 / 6");
    await expectCardInViewport(page);

    // ── 1단계 → 2단계 (같은 화면, tour만 올라간다) ──────────────────
    await dialog.getByRole("button", { name: "다음" }).click();
    await expect(page).toHaveURL(/tour=2/);
    await expect(dialog).toContainText("2 / 6");
    await expect(page.locator('[data-tour="first-proposal"]')).toBeVisible();
    await expectCardInViewport(page);

    // 다음 목적지는 카드 id가 동적이라(nextHrefFromAnchor) 실제 앵커 href를 먼저 읽어 둔다
    const proposalHref = await page.locator('[data-tour="first-proposal"]').getAttribute("href");
    expect(proposalHref, "2단계 앵커에 href가 없습니다").toBeTruthy();
    expect(proposalHref).toMatch(/^\/proposals\//);

    // ── 2단계 → 3단계 (동적 카드 id로 실제 이동) ─────────────────────
    await dialog.getByRole("button", { name: "다음" }).click();
    await page.waitForURL(new RegExp(`${escapeRegExp(proposalHref!)}\\?tour=3`));
    await expect(dialog).toContainText("3 / 6");
    await expect(page.locator('[data-tour="dissent"]')).toBeVisible();
    await expectCardInViewport(page);

    // ── 3단계 → 4단계 (같은 화면) ────────────────────────────────────
    await dialog.getByRole("button", { name: "다음" }).click();
    await expect(page).toHaveURL(/tour=4/);
    await expect(dialog).toContainText("4 / 6");
    await expect(page.locator('[data-tour="decision"]')).toBeVisible();
    await expectCardInViewport(page);

    // ── 4단계 → 5단계 (/incentive?preset=flip) — preset이 유실되면 반전 장면이 깨진다 ──
    await dialog.getByRole("button", { name: "다음" }).click();
    await page.waitForURL(/\/incentive\?/);
    const url5 = new URL(page.url());
    expect(url5.searchParams.get("preset"), "5단계 진입에서 preset=flip이 유실됐습니다").toBe("flip");
    expect(url5.searchParams.get("tour")).toBe("5");
    await expect(dialog).toContainText("5 / 6");
    await expect(page.locator('[data-tour="flip"]')).toBeVisible();
    await expectCardInViewport(page);

    // ── 5단계 → 6단계 (/widget) ──────────────────────────────────────
    await dialog.getByRole("button", { name: "다음" }).click();
    await page.waitForURL(/\/widget\?tour=6/);
    await expect(dialog).toContainText("6 / 6");
    await expectCardInViewport(page);
    // 마지막 장면의 핵심 앵커 — 데모 시드에 "완료된 페이백 정책"이 없으면 이 배지가 없어
    // "승인된 페이백이 방문객 위젯에 그대로 나타납니다"라는 6단계 설명이 실제로 증명되지 않는다.
    await expect(
      page.locator('[data-tour="widget-payback"]'),
      "6단계 앵커(승인된 페이백 배지)가 현재 데모 상태에 없습니다 — 마지막 장면이 실제로 보이지 않습니다",
    ).toBeVisible();

    // ── 완료 ──────────────────────────────────────────────────────────
    await dialog.getByRole("button", { name: "완료" }).click();
    await expect(page.locator('[role="dialog"][aria-label*="가이드 투어"]')).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.has("tour"), "완료 후에도 tour 파라미터가 남아 있습니다")
      .toBe(false);
    const doneFlag = await page.evaluate(() => window.localStorage.getItem("sn-tour-done"));
    expect(doneFlag, "완료 후 localStorage의 sn-tour-done이 설정되지 않았습니다").toBe("1");
  });
});

test.describe("첫 방문 자동 시작 · 재시작", () => {
  test("빈 localStorage로 허브에 들어오면 투어가 자동으로 시작된다", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/tour=1/);
    await expect(tourDialog(page)).toBeVisible();
  });

  test("완료 표시(sn-tour-done)가 있으면 자동으로 시작하지 않는다", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("sn-tour-done", "1"));
    await page.goto("/");
    // 자동 시작은 useEffect에서 즉시 일어난다 — 짧은 유예 뒤에도 안 뜨면 자동 시작이 없는 것으로 본다
    await page.waitForTimeout(500);
    expect(new URL(page.url()).searchParams.has("tour"), "완료 표시가 있는데도 tour가 자동으로 붙었습니다").toBe(false);
    await expect(page.locator('[role="dialog"][aria-label*="가이드 투어"]')).toHaveCount(0);
  });

  test("헤더 '3분 체험' 버튼으로 어디서든 재시작된다", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("sn-tour-done", "1"));
    await page.goto("/tracking");
    await page.getByRole("link", { name: "3분 체험" }).click();
    await page.waitForURL(/\/\?tour=1/);
    await expect(tourDialog(page)).toBeVisible();
    await expect(tourDialog(page)).toContainText("1 / 6");
  });
});
