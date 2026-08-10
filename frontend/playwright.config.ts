import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 검증 하네스 (Task D3a — 심사 보강 v4.1).
 *
 * 이미 떠 있는 통합 환경(`docker compose up -d`, FE :3100 · BE :8000)을 그대로 쓴다 — 이 설정
 * 자체가 서버를 띄우지 않는다(`webServer` 없음). `E2E_BASE_URL`로 대상을 바꿀 수 있다
 * (예: mock 모드 확인은 `FRONTEND_API_BASE=` 오버라이드로 별도 인스턴스를 띄운 뒤 가리킨다).
 *
 * `resilience.spec.ts`가 백엔드 컨테이너를 잠깐 멈췄다 되살리는 시나리오를 포함하므로,
 * 워커를 1개로 고정해 전체 스위트를 완전히 직렬로 돌린다 — 그 사이 다른 스펙이 같은 백엔드에
 * 요청을 보내면 "장애"가 아니라 "테스트 하네스가 만든 장애"와 뒤섞여 결과를 오염시킨다.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
