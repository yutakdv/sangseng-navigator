import type { DisplayCategory, Region } from "@/types";

/** 6지역 고정 순서 — pipeline/common.py REGIONS와 동일. 차트 색 배정도 이 순서를 따른다 (13 §5) */
export const REGIONS: Region[] = ["고한읍", "사북읍", "정선군", "태백시", "영월군", "삼척시"];

/** 표시 업종 6분류 고정 순서 — 롤업 정본은 pipeline/category_map.py (05 §1) */
export const CATEGORIES: DisplayCategory[] = ["카페", "음식점", "편의점", "숙박업", "소매점", "기타"];

/**
 * 카테고리 팔레트 (13 §5).
 * 색은 **항목에 고정**한다 — 필터로 항목 수가 바뀌어도 남은 항목 색을 재배열하지 않는다.
 * 슬롯 1은 브랜드 정합을 위해 lavender-500으로 교체 — 13 §5의 색각 분리 재검증 필요(직접 라벨 병행으로 완화).
 */
export const CATEGORY_COLORS: Record<string, string> = {
  카페: "#8B7BF0", // lavender-500 (브랜드)
  음식점: "#eb6834",
  편의점: "#1baf7a",
  숙박업: "#eda100",
  소매점: "#e87ba4",
  기타: "#008300",
};

/** 지역 6종에 색이 필요할 때도 같은 팔레트를 같은 순서로 (13 §5) */
export const REGION_COLORS: Record<string, string> = Object.fromEntries(
  REGIONS.map((r, i) => [r, Object.values(CATEGORY_COLORS)[i]]),
);

/** 단일 시리즈 차트(전환율 추이·지역별 막대)는 팔레트 대신 이 단색 (13 §5) — lavender-500 */
export const PRIMARY = "#8B7BF0";

/**
 * 차트 공통 시각 토큰 (13 §5).
 * Recharts는 Tailwind 클래스를 받지 않아 축·툴팁 스타일을 인라인으로 넘겨야 한다 —
 * 파일마다 따로 적으면 축 글자 크기가 차트마다 어긋나므로 여기 한 곳에 모아 둔다.
 * 축 라벨은 11px에서 12px로 올렸다(화면 최소 크기 기준, 13 §6).
 */
export const CHART = {
  tick: { fontSize: 12, fill: "#6E6C7A" },
  /** 값 라벨(막대 끝 숫자) — 축보다 진하게 */
  label: { fontSize: 12, fill: "#55525F", fontWeight: 600 },
  grid: "#E7E5EE",
  tooltip: {
    fontSize: 13,
    borderRadius: 10,
    border: "1px solid #E7E5EE",
    boxShadow: "0 10px 28px -10px rgb(30 24 64 / 0.3)",
    padding: "8px 12px",
  },
  cursor: "rgba(139,123,240,0.08)",
} as const;

/** 거점 — pipeline/common.py ANCHOR. 라벨은 이 문자열 그대로 쓴다("정문" 표기 폐기, 13 §9) */
export const ANCHOR = {
  name: "강원랜드 카지노(하이원리조트)",
  lat: 37.21164,
  lng: 128.82168,
};

/** 고지 문구 — 화면에서 문자열을 새로 쓰지 말고 이 상수를 쓴다 (절대 규칙 3, 13 §9) */
export const ASSUMPTION_NOTE = "가정 기반 전망이며 실제와 다를 수 있음";

/**
 * 지역 전환율 근사 지표 고정 설명 (절대 규칙 2) — 파이프라인 P5가 dashboard.json에 싣는
 * `conversion.proxy_note`와 같은 문구다. 대시보드 데이터를 받지 않는 화면(트래킹 폼·경과 리포트)이
 * 전환율 라벨에 배지를 병기할 때 이 상수를 툴팁으로 쓴다.
 */
export const PROXY_NOTE =
  "분자=지역 사용 건수, 분모=입장 연인원(교대 합산)으로 단위가 달라 비율이 아닌 근사 지표입니다. 강원랜드가 공개한 금액 기준 지역 사용 비율(2024년 28.5%)과는 다른 지표입니다.";

/**
 * 추천 순위 안정도 해석 주의 (13 §5 "추천 순위 안정도" 타일 · P8 민감도 산출값).
 * 맨 숫자만 보이면 "추천이 16%만 안정적"으로 읽히므로, `ranking_stability`를 표시하는
 * 자리마다(대시보드·허브·제안 요약) 이 문구를 함께 싣는다.
 */
export const STABILITY_NOTE =
  "가중치 95개 조합 전수 재계산에서 상위 3개 후보 순위가 그대로 유지된 비율입니다. 같은 조합에서 제안 대상 지역(영월군·삼척시) 선정은 60%, 영월군 포함은 100% 유지됩니다 — 흔들리는 것은 후보 순번이지 대상 지역이 아닙니다. 후보 요인이 동률로 고정된 경우에는 선발 기준의 다양성이나 강건성을 의미하지 않습니다.";

export const SOURCE_NOTE =
  "데이터: 공공데이터포털(강원랜드·소상공인시장진흥공단)·국세청 | 지도: © OpenStreetMap contributors, OpenFreeMap";

/**
 * 방문객 위젯은 Kakao 지도 JS를 사용하므로 관리자 화면과 지도 출처를 분리한다.
 * 기상청은 위젯 "오늘의 추천"의 초단기실황(관측)에만 쓴다 — 담당자 화면(SOURCE_NOTE)에는 없다.
 */
export const VISITOR_SOURCE_NOTE =
  "데이터: 공공데이터포털(강원랜드·소상공인시장진흥공단·기상청)·국세청 | 지도: © Kakao Maps";

/** 삼척시 = 시 전역이 아니라 하이원포인트 지역가맹 대상지역인 도계읍 (05 §1) */
export const REGION_TOOLTIP: Partial<Record<Region, string>> = {
  삼척시: "삼척시 도계읍 (하이원포인트 지역가맹 대상지역)",
};
