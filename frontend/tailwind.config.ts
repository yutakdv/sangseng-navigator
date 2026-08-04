import type { Config } from "tailwindcss";

// 컬러 토큰 정본: docs/plan/13-design-guide.md §4
// 역할 구분(담당자=인디고, 방문객=그린)은 불변. 값은 FE가 ±1단계 조정 가능.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        admin: {
          sidebar: "#171139",
          "sidebar-active": "#4338ca",
          primary: "#4f46e5",
          "primary-soft": "#eef2ff",
          bg: "#f5f6fa",
          surface: "#ffffff",
          text: "#1e1b39",
          "text-muted": "#6b7280",
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
          good: "#15803d",
          "good-bg": "#dcfce7",
          bad: "#b91c1c",
          "bad-bg": "#fee2e2",
          notice: "#475569",
          "notice-bg": "#f1f5f9",
        },
      },
      fontFamily: {
        sans: ["Pretendard", "Pretendard Variable", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 3px rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
