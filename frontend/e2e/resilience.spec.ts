import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { fetchDynamicIds } from "./helpers";

/**
 * 빈 데이터·에러·404 복원력 (Task D3a).
 *
 * 백엔드 컨테이너를 실제로 멈췄다 되살리는 시나리오를 포함한다 — 다른 스펙과 동시에 돌면
 * "테스트 하네스가 만든 장애"가 다른 화면 검증까지 오염시키므로, 이 파일은 `describe.serial`로
 * 내부 순서를 고정하고(파일 자체도 분리돼 있다), `playwright.config.ts`가 `workers: 1`이라
 * 다른 스펙 파일과도 동시에 실행되지 않는다.
 */

const BACKEND_CONTAINER = "main-backend-1";
const HEALTH_URL = "http://localhost:8000/api/dashboard";

function runDocker(args: string): void {
  execSync(`docker ${args}`, { stdio: ["ignore", "pipe", "pipe"] });
}

async function isBackendUp(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

test.describe("404 — 존재하지 않는 카드", () => {
  test("/cards/존재하지-않는-id는 not-found 화면이지 서버 500이 아니다", async ({ page }) => {
    const response = await page.goto("/cards/존재하지-않는-id");
    // 이 라우트에 loading.tsx가 있어 Next가 자동으로 Suspense 스트리밍 경계를 씌운다 — 최종 상태를
    // 아직 모르는 시점에 셸(로딩 스켈레톤)을 200으로 먼저 흘려보내므로, notFound()가 나중에 호출돼도
    // 이미 커밋된 HTTP 상태 코드(200)는 되돌릴 수 없다(Next App Router 스트리밍의 알려진 특성).
    // 그래서 여기서는 "500이 아니다"만 하드 조건으로 보고, 실제 200/404 여부는 기록만 한다.
    expect(response?.status(), "존재하지 않는 카드 id가 500(서버 크래시)을 반환합니다").toBeLessThan(500);
    if (response?.status() !== 404) {
      console.log(
        `[정보] /cards/존재하지-않는-id의 최초 HTTP 상태는 ${response?.status()}입니다 — loading.tsx 스트리밍 때문에 최종 not-found와 상태 코드가 어긋날 수 있습니다.`,
      );
    }
    await expect(page.getByRole("heading", { name: "요청하신 화면을 찾을 수 없습니다" })).toBeVisible();
  });
});

test.describe.serial("백엔드 장애 시나리오", () => {
  test("백엔드를 멈추고 8화면을 각각 열어 무엇이 나오는지 기록한다", async ({ page }, testInfo) => {
    // 백엔드가 살아 있을 때 동적 id를 먼저 확보한다 — 죽은 뒤에는 허브·트래킹조차 id를 못 읽는다
    const { proposalId, cardId } = await fetchDynamicIds(page);

    const routes: { label: string; slug: string; path: string }[] = [
      { label: "허브", slug: "hub", path: "/" },
      { label: "대시보드", slug: "dashboard", path: "/dashboard" },
      { label: "인센티브", slug: "incentive", path: "/incentive" },
      { label: "트래킹", slug: "tracking", path: "/tracking" },
      { label: "트래킹 작성", slug: "tracking-new", path: "/tracking/new" },
      { label: "위젯", slug: "widget", path: "/widget" },
      { label: "카드 상세", slug: "card-detail", path: `/cards/${cardId}` },
      { label: "제안 검토", slug: "proposal-detail", path: `/proposals/${proposalId}` },
    ];

    expect(await isBackendUp(), "백엔드를 멈추기 전 상태 확인에 실패했습니다 — 시작 전부터 응답이 없습니다").toBe(true);

    runDocker(`stop ${BACKEND_CONTAINER}`);
    try {
      const down = await waitUntil(async () => !(await isBackendUp()), 15_000);
      expect(down, "백엔드 컨테이너를 멈췄는데도 여전히 응답합니다").toBe(true);

      const findings: string[] = [];
      for (const route of routes) {
        let status: number | null = null;
        let navError: string | null = null;
        try {
          const response = await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 15_000 });
          status = response?.status() ?? null;
        } catch (error) {
          navError = String(error);
        }
        // domcontentloaded는 이 앱의 스트리밍 셸(loading.tsx)이 도착한 시점일 수 있다 — 실제
        // 최종 상태(에러 경계로 대체됐는지 등)가 안정되도록 짧게 더 기다린 뒤 본문을 읽는다.
        // (이 여유가 없으면 "로딩 중" 스냅샷을 최종 상태로 오분류한다 — 실제로 겪은 문제다)
        if (!navError) await page.waitForTimeout(900);

        const bodyText = navError ? "" : await page.locator("body").innerText().catch(() => "");
        const isBlank = !navError && bodyText.trim().length === 0;
        const showsErrorBoundary = bodyText.includes("데이터를 불러오지 못했습니다");
        const showsNotFound = bodyText.includes("요청하신 화면을 찾을 수 없습니다");
        const rendersPartially = !navError && !isBlank && !showsErrorBoundary && !showsNotFound;

        await page
          .screenshot({ path: testInfo.outputPath(`backend-down-${route.slug}.png`), fullPage: true })
          .catch(() => {});

        const classification = navError
          ? `탐색 실패(${navError.slice(0, 160)})`
          : isBlank
            ? "빈 화면(흰 화면)"
            : showsErrorBoundary
              ? "에러 경계(app/error.tsx)"
              : showsNotFound
                ? "404 화면"
                : "부분 렌더(방어 catch 동작)";

        findings.push(`${route.label} (${route.path}) → http=${status ?? "N/A"} · ${classification}`);

        // 완전한 빈 화면(흰 화면)만은 항상 결함으로 본다 — 그 외 분류는 "기록"이 목적이라
        // 강제로 실패시키지 않는다(soft — 나머지 7화면도 계속 관찰한다).
        expect
          .soft(isBlank, `${route.label}(${route.path})가 백엔드 다운 상태에서 완전한 빈 화면입니다`)
          .toBe(false);
        void rendersPartially; // 분류값 자체가 기록 목적 — 별도 강제 조건은 두지 않는다
      }

      // list 리포터로 그대로 보이도록 표준출력에 남긴다 — 결과 표 작성의 원천 기록
      console.log(["", "=== 백엔드 다운 상태 — 8화면 관찰 결과 ===", ...findings, ""].join("\n"));
    } finally {
      runDocker(`start ${BACKEND_CONTAINER}`);
      const up = await waitUntil(isBackendUp, 30_000);
      expect(up, "백엔드 컨테이너를 되살렸지만 다시 응답하지 않습니다 — 수동 확인이 필요합니다").toBe(true);
    }
  });
});
