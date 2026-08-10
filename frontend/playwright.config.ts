import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 검증 하네스 (Task D3a — 심사 보강 v4.1).
 *
 * 이미 떠 있는 통합 환경(`docker compose up -d`, FE :3100 · BE :8000)을 그대로 쓴다 — 이 설정
 * 자체가 서버를 띄우지 않는다(`webServer` 없음). `E2E_BASE_URL`로 대상을 바꿀 수 있다
 * (예: mock 모드 확인은 `FRONTEND_API_BASE=` 오버라이드로 별도 인스턴스를 띄운 뒤 가리킨다).
 *
 * **파괴적 테스트는 기본 실행에서 제외한다.** `resilience.spec.ts`의 백엔드 정지 시나리오에는
 * `@destructive` 태그가 붙어 있고 여기서 `grepInvert`로 걸러 낸다 — 데모 직전에 무심코
 * `npm run test:e2e`를 돌려 백엔드가 내려가는 사고를 막기 위해서다(이 레포는 공유 컨테이너를
 * 건드리는 테스트로 이미 데모 데이터를 한 번 잃었다). 의도적으로 돌릴 때만
 * `npm run test:e2e:destructive`(= `E2E_DESTRUCTIVE=1`)로 실행한다.
 * 또한 프로젝트가 desktop·mobile 둘이라, 제외하지 않으면 한 번의 실행에서 정지·복구가 2회 일어난다.
 *
 * 그 시나리오를 실제로 돌릴 때는 워커를 1개로 고정한 이 설정 그대로 완전히 직렬 실행된다 —
 * 그 사이 다른 스펙이 같은 백엔드에 요청을 보내면 "장애"가 아니라 "테스트 하네스가 만든 장애"와
 * 뒤섞여 결과를 오염시킨다.
 */
const runDestructive = process.env.E2E_DESTRUCTIVE === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  grepInvert: runDestructive ? undefined : /@destructive/,
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
