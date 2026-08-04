import type { Config } from "tailwindcss";

// 컬러 토큰 정본: docs/plan/13-design-guide.md §4
// 담당자 화면은 인디고, 방문객 화면은 그린으로 역할을 구분한다. 따뜻한 배경·표면은 유지하되
// 내비게이션과 행동 색은 인디고로 되돌려 같은 서비스 안의 두 사용자 역할이 섞이지 않게 한다.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        admin: {
          sidebar: "#17113b",
          "sidebar-deep": "#0f0a2b",
          "sidebar-active": "#37306f",
          primary: "#5146d8",
          "primary-strong": "#4338ca",
          "primary-soft": "#eef0ff",
          "primary-line": "#c7d2fe",
          bg: "#f4f1e9",
          surface: "#fffdf8",
          /** 카드 **안쪽**의 낮은 면 (빈 상태·표 헤더·인라인 칩 배경) */
          "surface-sunken": "#f0ece2",
          /** 카드·표 구분선 — black/5보다 선명하되 딱딱하지 않은 값 */
          border: "#ded8ca",
          text: "#242039",
          "text-soft": "#4f4b63",
          "text-muted": "#6b6879",
        },
        visitor: {
          primary: "#166534",
          "primary-soft": "#dcfce7",
          accent: "#15803d",
          bg: "#ffffff",
        },
        // 상태·배지 색 (양쪽 공통 — 차트 시리즈 색과 혼용 금지, 13 §4)
        state: {
          warn: "#a64b22",
          "warn-bg": "#fff0e6",
          "warn-line": "#f2b48f",
          good: "#15803d",
          "good-bg": "#dcfce7",
          "good-line": "#86efac",
          bad: "#52525b",
          "bad-bg": "#f4f4f5",
          "bad-line": "#d4d4d8",
          notice: "#475569",
          "notice-bg": "#eef1f6",
          "notice-line": "#cbd5e1",
        },
        // 수치의 방향 전용 색. 성공/오류 상태와 증가/감소를 같은 의미로 취급하지 않는다.
        trend: {
          up: "#b91c1c",
          "up-bg": "#fef2f2",
          "up-line": "#fecaca",
          down: "#1d4ed8",
          "down-bg": "#eff6ff",
          "down-line": "#bfdbfe",
          flat: "#52525b",
          "flat-bg": "#f4f4f5",
          "flat-line": "#d4d4d8",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Display", "SF Pro Text", "Pretendard", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        panel: "20px",
        /** 히어로·시나리오처럼 화면에서 가장 큰 면 — 20px보다 한 단계 위 */
        hero: "28px",
      },
      boxShadow: {
        // 13 §6의 "은은한 단층"을 유지하되, 배경과 표면의 밝기 차가 작은 화면에서도 카드 경계가
        // 읽히도록 넓게 퍼지는 두 번째 레이어를 더했다
        card: "0 8px 24px rgb(23 17 59 / 0.06)",
        "card-hover": "0 14px 36px rgb(23 17 59 / 0.10)",
        /**
         * 허브(경영 요약 화면) 전용 3단 그림자. 테두리를 거의 지우고 그림자만으로 카드를 띄우려면
         * 접촉면(1px)·근접 확산(12px)·환경광(40px) 세 층이 있어야 면이 종이처럼 읽힌다.
         * 한 층짜리 `shadow-card`로는 큰 카드가 배경에 붙어 보인다.
         */
        float: "0 12px 32px rgb(23 17 59 / 0.07)",
        lift: "0 18px 45px rgb(23 17 59 / 0.11)",
        /** 히어로(이번 분기 핵심 제안)만 쓰는 인디고 톤 그림자 */
        hero: "0 24px 64px rgb(23 17 59 / 0.14)",
        /** 스티키 헤더가 본문 위로 지나갈 때의 경계 */
        header: "0 1px 0 rgb(24 24 27 / 0.06)",
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
