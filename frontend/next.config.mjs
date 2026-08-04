/** @type {import('next').NextConfig} */
// Vercel 네이티브 배포 — 정적 export(output: "export")를 쓰지 않는다.
// 동적 라우트 `/cards/[id]`를 그대로 쓰기 위한 결정 (docs/plan/08 F1).
const nextConfig = {
  reactStrictMode: true,
  // Next 16이 dev 기동 때마다 frontend/AGENTS.md·CLAUDE.md 를 자동 생성한다 —
  // 레포 루트에 팀이 관리하는 CLAUDE.md 가 이미 있어 지침이 둘로 갈리므로 끈다.
  agentRules: false,
};

export default nextConfig;
