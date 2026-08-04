import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * 무인 심사에서 기본 "Create Next App" 타이틀이 노출되지 않게 metadata를 채운다 (docs/plan/08 F9).
 * OG 이미지·favicon 교체는 대표 스크린샷이 나온 뒤 F9에서 마무리한다.
 */
export const metadata: Metadata = {
  title: "상생 나침반",
  description:
    "강원랜드 담당자의 분기별 지역상생 의사결정을 지원하는 AI 플랫폼 — 진단·스코어링·AI 조정 제안·담당자 승인·실행 트래킹",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard (13 §6). 오프라인이면 system-ui 폴백으로 자연히 내려간다 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
