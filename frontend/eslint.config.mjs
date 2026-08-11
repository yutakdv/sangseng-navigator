// ESLint 9 flat config — eslint-config-next 16이 flat config 배열을 그대로 내보낸다.
// (Next 16에서 `next lint`가 없어져 ESLint CLI를 직접 쓴다)
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  // Playwright 산출물은 검사 대상이 아니다 — 한 번 테스트를 돌리고 나면 리포트 번들(수백 KB의
  // 미니파이 JS)까지 훑느라 `npm run lint`가 경고 수천 줄을 뱉는다. 둘 다 .gitignore 대상이다.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
