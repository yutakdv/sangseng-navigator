// ESLint 9 flat config — eslint-config-next 16이 flat config 배열을 그대로 내보낸다.
// (Next 16에서 `next lint`가 없어져 ESLint CLI를 직접 쓴다)
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
