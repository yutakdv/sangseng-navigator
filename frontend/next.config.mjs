import { readFileSync } from "node:fs";

/**
 * 레포 루트 `.env`에서 프론트가 쓰는 `NEXT_PUBLIC_*` 값을 끌어온다.
 *
 * Next는 **`next dev`를 실행한 디렉터리**(`frontend/`)의 `.env`만 읽는다. 그런데 이 레포의
 * 규약은 "시크릿은 .env / SAM 파라미터로만"(CLAUDE.md)이고 파이프라인·백엔드·docker-compose가
 * 전부 **루트 `.env`** 한 장을 본다. 그래서 담당자가 루트 `.env`에 키를 넣으면 프론트만 조용히
 * 못 읽는 상황이 생길 수 있다.
 *
 * 여기서 루트 `.env`를 읽어 채우되, **이미 설정된 값은 덮지 않는다**:
 * `frontend/.env.local` > 셸 환경변수 > 루트 `.env` 순으로 우선한다.
 * (Vercel 배포는 파일이 없으므로 대시보드의 환경변수가 그대로 쓰인다)
 */
function fromRootEnv(keys) {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return out; // 루트 .env가 없는 환경(Vercel 빌드 등) — 대시보드 환경변수를 쓴다
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rest] = m;
    if (!keys.includes(key)) continue;
    const value = rest.trim().replace(/^["']|["']$/g, "");
    if (value && !process.env[key]) out[key] = value;
  }
  return out;
}

/** @type {import('next').NextConfig} */
// Vercel 네이티브 배포 — 정적 export(output: "export")를 쓰지 않는다.
// 동적 라우트 `/cards/[id]`를 그대로 쓰기 위한 결정 (docs/plan/08 F1).
const nextConfig = {
  reactStrictMode: true,
  // Docker 검증 주소(127.0.0.1:3100)에서 dev 번들·HMR 요청이 차단되지 않도록 허용한다.
  // 이 설정이 없으면 서버 HTML은 보이지만 라디오·승인·생성 같은 클라이언트 이벤트가 연결되지 않는다.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Next 16이 dev 기동 때마다 frontend/AGENTS.md·CLAUDE.md 를 자동 생성한다 —
  // 레포 루트에 팀이 관리하는 CLAUDE.md 가 이미 있어 지침이 둘로 갈리므로 끈다.
  agentRules: false,
  env: fromRootEnv(["NEXT_PUBLIC_API_BASE", "NEXT_PUBLIC_KAKAO_MAP_KEY", "NEXT_PUBLIC_DEMO_READ_ONLY"]),
  /**
   * 관리자 화면은 승인·추진 상태가 바뀐 직후 같은 브라우저에서 확인해야 한다.
   * 페이지/API 응답은 캐시하지 않고, Next의 해시된 정적 자산(_next/static)만 캐시 대상으로 남긴다.
   */
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
