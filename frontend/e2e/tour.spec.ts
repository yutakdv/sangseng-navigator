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

type Box = { x: number; y: number; width: number; height: number };

/** 두 사각형이 실제로 겹치는지 — 1px은 서브픽셀 반올림 허용치. */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 1 &&
    b.x < a.x + a.width - 1 &&
    a.y < b.y + b.height - 1 &&
    b.y < a.y + a.height - 1
  );
}

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
    // 마지막 장면의 앵커 — 승인된 페이백 배너(widget-payback)가 있으면 그것을, 없으면(현재 데모 시드가
    // 그렇다 — INC-001이 pending) 항상 렌더되는 "추천 가맹점" 섹션(widget-recommendations)을 대신
    // 하이라이트한다(TourStep.fallbackAnchor, tourSteps.ts). 어느 쪽도 안 보이면 안내 카드가
    // "표시할 화면 요소가 없습니다"로 대체된다는 뜻이라 그것부터 배제한다.
    await expect(
      dialog,
      "6단계 안내 카드가 '표시할 화면 요소가 없습니다'로 대체됐습니다 — 앵커도 대체 앵커도 못 찾았다는 뜻입니다",
    ).not.toContainText("표시할 화면 요소가 없습니다");
    const paybackAnchor = page.locator('[data-tour="widget-payback"]');
    const fallbackAnchor = page.locator('[data-tour="widget-recommendations"]');
    if (await paybackAnchor.count()) {
      await expect(paybackAnchor).toBeVisible();
    } else {
      await expect(
        fallbackAnchor,
        "6단계 대체 앵커(추천 가맹점 섹션)도 보이지 않습니다 — 페이백 배너도, 대체 화면 요소도 없습니다",
      ).toBeVisible();
    }

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

/**
 * 5단계는 본문이 "슬라이더를 한 칸 올려 보세요"라고 **화면 조작을 지시**하는 유일한 스텝이다
 * (TourStep.interactive). 오버레이가 그 조작을 삼키면 심사위원은 이 출품작의 창의성 대표 장면인
 * 처방 반전을 한 번도 보지 못한 채 다음 화면으로 넘어간다 — 그래서 "실제로 움직여 실제로 뒤집히는가"를
 * 직접 확인한다. 반대로 다른 스텝의 차단은 유지돼야 한다(2단계 링크를 직접 누르면 ?tour=3이 붙지 않아
 * 투어가 조용히 끊긴다).
 */
test.describe("5단계 반전 장면 — 투어 중에도 조작이 통과한다", () => {
  test("β 슬라이더를 실제로 움직이면 처방이 공급 측으로 뒤집힌다", async ({ page }) => {
    await page.goto("/incentive?preset=flip&tour=5");

    const dialog = tourDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("5 / 6");

    const flipCard = page.locator('[data-tour="flip"]');
    const slider = page.locator("#cell-explorer-beta");
    await expect(slider).toBeVisible();
    // 딥링크(?preset=flip)는 반전 **직전** 상태로 들어온다 — 아직은 수요 측 처방이어야 한다
    await expect(slider).toHaveValue("0.25");
    await expect(flipCard).toContainText("수요 측 우선");

    // 실제 포인터 클릭이다. 오버레이가 클릭을 삼키면 Playwright의 hit-target 검사가 여기서
    // "intercepts pointer events"로 실패한다 — C1 회귀를 잡는 핵심 지점이다.
    await slider.click({ timeout: 5_000 });
    const beta = Number(await slider.inputValue());
    expect(beta, `슬라이더 조작이 화면에 닿지 않았습니다(값이 ${beta}에 머무름)`).toBeGreaterThanOrEqual(0.3);

    // 그리고 실제로 처방이 뒤집혀야 한다 — 조작만 되고 판정이 그대로면 시연 가치가 없다
    await expect(flipCard).toContainText("공급 측 우선 — 가맹점 확충");
    await expect(flipCard).toContainText("가맹점 확충이 먼저입니다");

    // 투어는 계속 5단계로 살아 있어야 한다(조작이 투어를 끊지 않는다)
    await expect(dialog).toContainText("5 / 6");

    // 반전 판정이 투어 안내 카드에 가려지면 "뒤집혔다"를 볼 수 없다 — 좌표로 확인한다
    const verdict = flipCard.getByText("공급 측 우선 — 가맹점 확충");
    await expect(verdict).toBeInViewport();
    const verdictBox = await verdict.boundingBox();
    const cardBox = await tourCard(page).boundingBox();
    expect(verdictBox, "반전 판정 배지의 boundingBox를 가져오지 못했습니다").not.toBeNull();
    expect(cardBox, "투어 안내 카드의 boundingBox를 가져오지 못했습니다").not.toBeNull();
    expect(
      overlaps(verdictBox!, cardBox!),
      `투어 안내 카드가 반전 판정을 가립니다 — 판정 y=${verdictBox!.y}~${verdictBox!.y + verdictBox!.height}, 카드 y=${cardBox!.y}~${cardBox!.y + cardBox!.height}`,
    ).toBe(false);
  });

  test("2단계에서는 오버레이가 아래 화면 클릭을 계속 막는다", async ({ page }) => {
    await page.goto("/?tour=2");
    await expect(tourDialog(page)).toContainText("2 / 6");

    const anchorLink = page.locator('[data-tour="first-proposal"]');
    await expect(anchorLink).toBeVisible();
    // 하이라이트된 링크를 직접 누르면 ?tour=3이 붙지 않아 투어가 조용히 끊긴다 — 막혀 있어야 정상이다.
    const blocked = await anchorLink
      .click({ timeout: 2_000 })
      .then(() => false)
      .catch(() => true);
    expect(
      blocked,
      "2단계에서 하이라이트된 링크가 직접 클릭됐습니다 — 이동은 '다음' 버튼으로만 일어나야 투어가 이어집니다",
    ).toBe(true);
    await expect(page).toHaveURL(/tour=2/);
  });
});

test.describe("첫 방문 자동 시작 · 재시작", () => {
  test("빈 localStorage로 허브에 들어오면 투어가 자동으로 시작된다", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/tour=1/);
    await expect(tourDialog(page)).toBeVisible();
  });

  test("자동 시작이 기존 쿼리(?type=)를 버리지 않는다", async ({ page }) => {
    await page.goto("/?type=INCENTIVE");
    await page.waitForURL(/tour=1/);
    const url = new URL(page.url());
    expect(url.searchParams.get("type"), "자동 시작이 기존 쿼리(?type=)를 지워 버렸습니다").toBe("INCENTIVE");
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
