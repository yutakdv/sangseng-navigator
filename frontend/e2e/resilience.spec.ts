import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { fetchDynamicIds } from "./helpers";

/**
 * ⚠⚠ 경고 — 이 스펙은 백엔드 컨테이너를 실제로 **정지**시킨다. 데모·발표 직전에는 절대 돌리지 마라. ⚠⚠
 *
 * 정지·복구 사이에는 통합 환경 전체(FE 포함)가 데이터를 못 읽는다. 복구(`docker start`)가 실패하면
 * 컨테이너가 내려간 채 남을 수 있으므로, 돌린 뒤에는 반드시 `docker ps`로 백엔드가 살아 있는지 확인한다.
 *
 * 빈 데이터·에러·404 복원력 (Task D3a).
 *
 * **기본 실행에서 제외된다.** 파괴적 시나리오에는 `@destructive` 태그가 붙어 있고
 * `playwright.config.ts`가 `grepInvert`로 걸러 낸다 — `npm run test:e2e`로는 돌지 않는다.
 * 의도적으로 돌릴 때만 `npm run test:e2e:destructive`(= `E2E_DESTRUCTIVE=1`)를 쓴다.
 * 이 파일의 404 시나리오는 파괴적이지 않아 태그가 없고 기본 실행에 포함된다.
 *
 * 백엔드 컨테이너를 실제로 멈췄다 되살리는 시나리오라 다른 스펙과 동시에 돌면 "테스트 하네스가 만든
 * 장애"가 다른 화면 검증까지 오염시킨다. 그래서 이 파일은 `describe.serial`로 내부 순서를 고정하고,
 * `playwright.config.ts`가 `workers: 1`이라 다른 스펙 파일과도 동시에 실행되지 않는다.
 */

/** 컨테이너 이름은 환경마다 다르다(compose 프로젝트 이름에 따라 접두사가 바뀐다) — 기본값은 이 레포의 현재 값. */
const BACKEND_CONTAINER = process.env.E2E_BACKEND_CONTAINER ?? "main-backend-1";
const HEALTH_URL = "http://localhost:8000/api/dashboard";

/** 화면에 새어 나오면 안 되는 원시 오류 문구 — 사용자가 볼 화면은 한국어 안내여야 한다. */
const RAW_ERROR_PATTERN =
  /Internal Server Error|Application error|Unhandled Runtime Error|ECONNREFUSED|TypeError:/;

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

/**
 * 백엔드를 되살린다. `docker start`가 한 번 던졌다고 포기하면 컨테이너가 내려간 채 남아
 * 이 레포의 데모 환경 전체가 죽는다 — 여러 번 시도하고, 그래도 안 되면 무엇을 손으로 해야 하는지
 * 메시지로 남긴다.
 */
async function restoreBackend(): Promise<{ ok: boolean; detail: string }> {
  const attempts: string[] = [];
  for (let i = 1; i <= 3; i += 1) {
    try {
      runDocker(`start ${BACKEND_CONTAINER}`);
    } catch (error) {
      attempts.push(`${i}회차 docker start 실패: ${String(error).slice(0, 200)}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    if (await waitUntil(isBackendUp, 30_000)) return { ok: true, detail: attempts.join(" / ") };
    attempts.push(`${i}회차 start는 성공했으나 30초 안에 응답이 돌아오지 않음`);
  }
  return { ok: false, detail: attempts.join(" / ") };
}

test.describe("404 — 존재하지 않는 카드", () => {
  test("/cards/존재하지-않는-id는 not-found 화면이지 서버 500이 아니다", async ({ page }) => {
    const response = await page.goto("/cards/존재하지-않는-id");
    const status = response?.status() ?? null;
    // 이 라우트에 loading.tsx가 있어 Next가 자동으로 Suspense 스트리밍 경계를 씌운다 — 최종 상태를
    // 아직 모르는 시점에 셸(로딩 스켈레톤)을 200으로 먼저 흘려보내므로, notFound()가 나중에 호출돼도
    // 이미 커밋된 HTTP 상태 코드(200)는 되돌릴 수 없다(Next App Router 스트리밍의 알려진 특성).
    // 그래서 200과 404 **둘만** 허용한다 — "500이 아니다"로 두면 3xx 리다이렉트·4xx 아무 값이나
    // 통과해 이 테스트가 사실상 아무것도 보증하지 않는다.
    expect(
      [200, 404],
      `존재하지 않는 카드 id의 HTTP 상태가 ${status}입니다 — 200(스트리밍 셸) 또는 404여야 합니다`,
    ).toContain(status);
    if (status !== 404) {
      console.log(
        `[정보] /cards/존재하지-않는-id의 최초 HTTP 상태는 ${status}입니다 — loading.tsx 스트리밍 때문에 최종 not-found와 상태 코드가 어긋날 수 있습니다.`,
      );
    }
    await expect(page.getByRole("heading", { name: "요청하신 화면을 찾을 수 없습니다" })).toBeVisible();
    // 제목만 보고 끝내지 않는다 — 404 화면의 값어치는 "여기서 어디로 갈 수 있는가"에 있다.
    await expect(page.getByRole("link", { name: /Action Card 허브/ })).toBeVisible();
    // 카드 상세 본문이 부분적으로라도 새어 나오면 안 된다(없는 카드를 있는 것처럼 그리는 셈)
    await expect(page.getByRole("navigation", { name: "카드 검토 순서" })).toHaveCount(0);
  });
});

test.describe.serial("백엔드 장애 시나리오", { tag: "@destructive" }, () => {
  test("백엔드를 멈추고 8화면을 각각 열어 무엇이 나오는지 기록한다", async ({ page }, testInfo) => {
    // 컨테이너 정지(최대 15초)·8화면 순회·복구(최대 30초×3회)는 전역 30초 예산 안에 정직하게 들어가지
    // 않는다. 이 스펙만 예산을 따로 준다 — 전역 타임아웃을 늘리면 다른 스펙의 회귀 감지가 둔해진다.
    test.setTimeout(240_000);

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
        const headingCount = navError ? 0 : await page.getByRole("heading").count();

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

        findings.push(
          `${route.label} (${route.path}) → http=${status ?? "N/A"} · ${classification} · 제목 ${headingCount}개`,
        );

        // 백엔드가 죽어도 프런트가 보증해야 하는 것 — 네 가지를 각각 강제한다. soft라 8화면을 끝까지
        // 관찰하되, 하나라도 어긋나면 테스트는 실패로 끝난다.
        // ① 탐색 자체가 성공해야 한다. 예전에는 탐색이 실패하면 isBlank가 false가 되어 "가장 나쁜
        //    결과"가 유일한 단언을 통과했다 — 그 구멍을 막는 조건이다.
        expect
          .soft(navError, `${route.label}(${route.path}) 탐색 자체가 실패했습니다 — 백엔드가 죽어도 FE는 HTML을 내려 줘야 합니다`)
          .toBeNull();
        // ② 서버가 5xx로 무너지면 안 된다
        expect
          .soft(status === null || status < 500, `${route.label}(${route.path})가 http=${status}로 응답했습니다`)
          .toBe(true);
        // ③ 완전한 빈 화면(흰 화면)이면 안 된다
        expect
          .soft(isBlank, `${route.label}(${route.path})가 백엔드 다운 상태에서 완전한 빈 화면입니다`)
          .toBe(false);
        // ④ 무엇이 일어났는지 사람이 읽을 수 있어야 한다 — 제목이 하나는 있고(에러 경계·404·부분 렌더
        //    어느 쪽이든 제목을 가진다), 원시 오류 문구가 화면에 새지 않아야 한다
        expect
          .soft(headingCount, `${route.label}(${route.path})에 제목(heading)이 하나도 없습니다 — 어떤 화면인지 읽을 수 없습니다`)
          .toBeGreaterThan(0);
        expect
          .soft(
            RAW_ERROR_PATTERN.test(bodyText),
            `${route.label}(${route.path}) 화면에 원시 오류 문구가 노출됐습니다:\n${bodyText.slice(0, 300)}`,
          )
          .toBe(false);
        void rendersPartially; // 분류 문자열에만 쓰는 값 — 위 네 조건이 보증을 대신한다
      }

      // list 리포터로 그대로 보이도록 표준출력에 남긴다 — 결과 표 작성의 원천 기록
      console.log(["", "=== 백엔드 다운 상태 — 8화면 관찰 결과 ===", ...findings, ""].join("\n"));
    } finally {
      const restored = await restoreBackend();
      expect(
        restored.ok,
        `백엔드 컨테이너(${BACKEND_CONTAINER})를 되살리지 못했습니다 — 손으로 \`docker start ${BACKEND_CONTAINER}\`를 실행해야 합니다. 시도 기록: ${restored.detail}`,
      ).toBe(true);
    }
  });
});
