import type { Config } from "tailwindcss";

// 컬러 토큰 정본: docs/plan/13-design-guide.md §4
// 역할 구분(담당자=인디고, 방문객=그린)은 불변. 값은 FE가 ±1단계 조정 가능 — 아래는 그 범위 안의
// 가독성 조정이다:
//  - bg를 #f5f6fa → #eef1f7로 한 단계 내려 흰 카드가 배경에서 실제로 떠 보이게 했다
//    (기존엔 표면과 배경의 밝기 차가 2%뿐이라 카드 경계가 사라져 화면이 한 장의 회색 종이로 읽혔다)
//  - text-muted를 #6b7280 → #626b82로 한 단계 어둡게 (흰 배경 대비 4.83:1 → 5.32:1).
//    이 색이 화면 텍스트의 절반 이상을 차지해서 작은 글자의 가독성을 좌우한다
//  - text-soft를 새로 뒀다 — "보조 본문"(설명 문단)은 muted보다 진해야 읽힌다
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        admin: {
          sidebar: "#171139",
          /** 사이드바 그라데이션 아래쪽 — 로고/메뉴/푸터의 층위를 만든다 */
          "sidebar-deep": "#100c28",
          "sidebar-active": "#4338ca",
          primary: "#4f46e5",
          /** hover·강조 테두리용 진한 인디고 */
          "primary-strong": "#4338ca",
          "primary-soft": "#eef2ff",
          /** 강조 블록의 얇은 테두리 (indigo-200) */
          "primary-line": "#c7d2fe",
          bg: "#eef1f7",
          surface: "#ffffff",
          /** 카드 **안쪽**의 낮은 면 (빈 상태·표 헤더·인라인 칩 배경) */
          "surface-sunken": "#f4f6fb",
          /** 카드·표 구분선 — black/5보다 선명하되 딱딱하지 않은 값 */
          border: "#e2e7f0",
          text: "#181534",
          /** 보조 본문 (설명 문단·리스트) — 흰 배경 대비 8.5:1 */
          "text-soft": "#454c63",
          /** 라벨·각주 — 흰 배경 대비 5.3:1 */
          "text-muted": "#626b82",
        },
        visitor: {
          primary: "#166534",
          "primary-soft": "#dcfce7",
          accent: "#15803d",
          bg: "#ffffff",
        },
        // 상태·배지 색 (양쪽 공통 — 차트 시리즈 색과 혼용 금지, 13 §4)
        state: {
          warn: "#b45309",
          "warn-bg": "#fef3c7",
          "warn-line": "#fcd34d",
          good: "#15803d",
          "good-bg": "#dcfce7",
          "good-line": "#86efac",
          bad: "#b91c1c",
          "bad-bg": "#fee2e2",
          "bad-line": "#fca5a5",
          notice: "#475569",
          "notice-bg": "#eef1f6",
          "notice-line": "#cbd5e1",
        },
      },
      fontFamily: {
        sans: ["Pretendard", "Pretendard Variable", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        panel: "20px",
        /** 히어로·시나리오처럼 화면에서 가장 큰 면 — 20px보다 한 단계 위 */
        hero: "26px",
      },
      boxShadow: {
        // 13 §6의 "은은한 단층"을 유지하되, 배경과 표면의 밝기 차가 작은 화면에서도 카드 경계가
        // 읽히도록 넓게 퍼지는 두 번째 레이어를 더했다
        card: "0 1px 2px 0 rgb(24 21 52 / 0.04), 0 2px 8px -2px rgb(24 21 52 / 0.07)",
        "card-hover": "0 2px 4px -1px rgb(24 21 52 / 0.06), 0 10px 24px -6px rgb(24 21 52 / 0.12)",
        /**
         * 허브(경영 요약 화면) 전용 3단 그림자. 테두리를 거의 지우고 그림자만으로 카드를 띄우려면
         * 접촉면(1px)·근접 확산(12px)·환경광(40px) 세 층이 있어야 면이 종이처럼 읽힌다.
         * 한 층짜리 `shadow-card`로는 큰 카드가 배경에 붙어 보인다.
         */
        float:
          "0 1px 1px 0 rgb(24 21 52 / 0.04), 0 4px 12px -3px rgb(24 21 52 / 0.05), 0 16px 40px -14px rgb(24 21 52 / 0.10)",
        lift: "0 2px 4px -1px rgb(24 21 52 / 0.05), 0 12px 28px -8px rgb(24 21 52 / 0.10), 0 28px 60px -22px rgb(24 21 52 / 0.20)",
        /** 히어로(이번 분기 핵심 제안)만 쓰는 인디고 톤 그림자 */
        hero: "0 18px 48px -20px rgb(49 40 130 / 0.55), 0 4px 14px -6px rgb(24 21 52 / 0.16)",
        /** 스티키 헤더가 본문 위로 지나갈 때의 경계 */
        header: "0 1px 0 0 rgb(24 21 52 / 0.06), 0 4px 16px -8px rgb(24 21 52 / 0.16)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /** 허브 진입 시 패널이 순서대로 올라오는 연출 — `animationDelay`로 단을 준다 */
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /** 막대·게이지가 0에서 자기 길이까지 자라는 전환 */
        grow: {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        /** 스파크라인이 왼쪽부터 그려지는 전환 — path에 pathLength="1"을 주면 길이와 무관하게 쓸 수 있다 */
        draw: {
          from: { strokeDashoffset: "1" },
          to: { strokeDashoffset: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.25s ease-out both",
        rise: "rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        grow: "grow 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
        draw: "draw 1.1s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
