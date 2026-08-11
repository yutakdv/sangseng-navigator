import type { Config } from "tailwindcss";

// 컬러 토큰 정본: docs/plan/13-design-guide.md §4 (2026-08 라벤더 개편)
// 담당자 화면은 라벤더, 방문객 화면은 그린으로 역할을 구분한다.
// 채움·강조는 lavender-500 하나로 통일하고, 상태색(그린/레드/앰버)과는 절대 섞지 않는다.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /** 담당자·AI·브랜드 영역 전용 팔레트 — 상태 신호(state.*)에는 쓰지 않는다 */
        lavender: {
          50: "#F6F4FE",
          100: "#E9E4FB",
          200: "#D6CEF8",
          300: "#C4B8F5",
          400: "#A695F3",
          500: "#8B7BF0",
          600: "#7361DC",
          700: "#5B4BC4",
          800: "#443597",
          900: "#2E2560",
          950: "#1E1840",
        },
        admin: {
          // 기존 admin.* 이름은 유지하고 값만 라벤더 스케일로 리매핑 — 사용처 전체가 자동 통일된다
          sidebar: "#2E2560", // lavender-900
          "sidebar-deep": "#1E1840", // lavender-950
          "sidebar-active": "#443597", // lavender-800
          primary: "#8B7BF0", // lavender-500 — 모든 채움·강조
          "primary-strong": "#7361DC", // lavender-600 — hover
          "primary-soft": "#F6F4FE", // lavender-50 — AI 제안 카드·틴트 배경
          "primary-line": "#D6CEF8", // lavender-200 — 틴트 면의 보더
          /**
           * 사이드바 면 — 중립 오프화이트. 사이드바 배경은 이 토큰 한 곳에서만 정의한다
           * (AdminShell·PageSkeleton).
           *
           * ⚠ 본문(`admin.bg` #FAFAFB)과 명도가 거의 같다(0.3%p). 좌측이 영역으로 읽히는 것은
           *   사실상 우측 0.5px 보더(`admin.border`)와 본문에 깔린 흰 카드들의 대비가 맡는다.
           *   배경으로도 단을 주려면 이 값을 더 낮춰야 하고, 그때는 그 위에 얹은 회색 글자
           *   대비(부제·그룹 제목)를 다시 재야 한다.
           */
          "sidebar-surface": "#FAFAFA",
          bg: "#FAFAFB",
          surface: "#FFFFFF",
          /** 카드 **안쪽**의 낮은 면 (빈 상태·표 헤더·인라인 칩·insight 배경) */
          "surface-sunken": "#F5F4F8",
          /** 카드·표 구분선 — 보라기가 살짝 도는 쿨 그레이 */
          border: "#E7E5EE",
          text: "#2B2833",
          "text-soft": "#55525F",
          "text-muted": "#6E6C7A",
        },
        visitor: {
          primary: "#166534",
          "primary-soft": "#dcfce7",
          /**
           * `primary-soft`보다 한 단 짙은 파스텔 — 로고 바처럼 **면 자체가 블록이 되는** 자리에
           * 쓴다. #dcfce7은 배지·배너 배경이라 넓게 깔면 흰 패널과 거의 붙어 보인다.
           */
          "primary-soft-deep": "#c6e9d3",
          accent: "#15803d",
          bg: "#ffffff",
          /**
           * 흰 위젯 패널 **안쪽**의 낮은 면 (가맹점 카드·목록 블록).
           * 담당자 화면의 `admin.surface-sunken`(#F5F4F8, 보랏기)과 같은 역할이지만 그린 쪽으로
           * 눕혀 둔다 — 방문객 화면에 보라 기운이 섞이면 두 화면의 색 구분이 흐려진다.
           * 흰 면 위 흰 카드에 테두리를 두르는 대신 이 면으로 가라앉힌다 (13 §6-1 규칙 2).
           */
          "surface-sunken": "#F3F7F3",
          /** 위 면에 커서를 올렸을 때 — 흰색으로 띄우면 흰 패널에 묻히므로 한 단 더 가라앉힌다 */
          "surface-hover": "#E9EEEA",
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
          /** 반려(거부) 전용 레드 — trend.up과 값이 같지만 의미가 다르므로 토큰을 분리한다 */
          danger: "#b91c1c",
          "danger-bg": "#fef2f2",
          "danger-line": "#fecaca",
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
        sans: ["Pretendard", "-apple-system", "BlinkMacSystemFont", "SF Pro Display", "SF Pro Text", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        panel: "20px",
        /** 히어로·시나리오처럼 화면에서 가장 큰 면 — 20px보다 한 단계 위 */
        hero: "28px",
      },
      boxShadow: {
        /**
         * 카드 기본 그림자 — **바깥 테두리를 대신하는 최소 단서**다.
         *
         * 카드는 테두리를 두르지 않고 배경(#FAFAFB)과 표면(#FFFFFF)의 밝기 차 + 이 그림자로만
         * 구분된다. 그래서 값이 거의 안 보일 만큼 옅다: 접촉면(1px)과 아주 짧은 확산(3px)
         * 두 층뿐이고 넓게 퍼지지 않는다. 공공 신뢰 톤에서 그림자는 장식이 아니라 경계다.
         */
        card: "0 1px 3px rgb(30 24 64 / 0.04), 0 1px 2px rgb(30 24 64 / 0.03)",
        "card-hover": "0 2px 8px rgb(30 24 64 / 0.07), 0 1px 3px rgb(30 24 64 / 0.04)",
        /**
         * 허브(경영 요약 화면) 전용 3단 그림자. 테두리를 거의 지우고 그림자만으로 카드를 띄우려면
         * 접촉면(1px)·근접 확산(12px)·환경광(40px) 세 층이 있어야 면이 종이처럼 읽힌다.
         * 한 층짜리 `shadow-card`로는 큰 카드가 배경에 붙어 보인다.
         */
        float: "0 12px 32px rgb(30 24 64 / 0.07)",
        lift: "0 18px 45px rgb(30 24 64 / 0.11)",
        /** 히어로(이번 분기 핵심 제안)만 쓰는 인디고 톤 그림자 */
        hero: "0 24px 64px rgb(30 24 64 / 0.14)",
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
        /** 새로 나타난 배지의 등장 강조 — 승인/완료 직후 위젯에 반영된 항목이 눈에 띄게 */
        pop: {
          from: { opacity: "0", transform: "scale(0.8)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.25s ease-out both",
        rise: "rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        grow: "grow 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
        draw: "draw 1.1s cubic-bezier(0.16, 1, 0.3, 1) both",
        pop: "pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
