import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * 루트 메타 (docs/plan/08 F9 · 12 §1·§3).
 *
 * 심사는 발표 데모와 별개로 **심사위원이 안내 없이 배포 URL에 직접 접속**하는 방식으로도 이뤄진다.
 * 기본 "Create Next App" 타이틀·파비콘이 그대로 노출되면 그 첫인상이 곧 산출물 인상이 되므로
 * title·description·OG를 채우고, 파비콘은 `src/app/icon.svg`(App Router 파일 규약)로 교체한다.
 *
 * description은 12 문서 §3 "한 줄 소개" 확정 문안을 **그대로** 쓴다 — 제출 양식에 적는 문구와
 * 공유 카드에 뜨는 문구가 갈리지 않게 하기 위해서다.
 *
 * OG 이미지는 넣지 않았다: 12 §1이 정한 대표 스크린샷(실 구현 화면 1920×1080 캡처)이 Phase 6
 * 산출물이라 아직 없고, 목업(image-1.png)을 대신 실으면 구현되지 않은 화면을 산출물처럼 보여주게
 * 된다. 캡처가 나오면 `openGraph.images`에 그 파일만 추가하면 된다.
 */
const TITLE = "상생 나침반";
const DESCRIPTION =
  "강원랜드 담당자의 분기별 지역상생 의사결정을 지원하는 AI 정책 나침반 — 하이원포인트 소비 쏠림 진단부터 가맹점 확충·페이백 정책 제안, 담당자 승인, 방문객 추천 위젯 반영까지";

export const metadata: Metadata = {
  // 하위 페이지가 "지역 소비 분석 · 상생 나침반"처럼 완성된 제목을 직접 내보내므로
  // template을 쓰지 않는다 (쓰면 접미사가 두 번 붙는다)
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: {
    type: "website",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    locale: "ko_KR",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 13 §8: 모바일은 "깨지지 않음"이 기준이다 — 확대 제한을 걸지 않아야 표·지도를 키워 볼 수 있다
  themeColor: "#4f46e5",
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
