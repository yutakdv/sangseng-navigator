/** @type {import('next').NextConfig} */
// Vercel 네이티브 배포 — 정적 export(output: "export")를 쓰지 않는다.
// 동적 라우트 `/cards/[id]`를 그대로 쓰기 위한 결정 (docs/plan/08 F1).
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
