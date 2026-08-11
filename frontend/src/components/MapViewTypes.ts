/**
 * 카드 상세 지도의 공통 계약 — 구현체(`MapViewKakao` / 폴백 `MapViewClient`)와
 * 로더(`MapView`)가 **같은 값**을 보게 여기 한 곳에 둔다.
 * 구현체 파일에 두면 지도 스택을 갈아끼울 때마다 타입·상수의 출처가 따라 움직인다.
 */

export type MapPin = {
  name: string;
  category: string;
  lat: number;
  lng: number;
  address?: string;
};

export type MapCandidatePin = MapPin & {
  id: string;
  /** 이번 카드가 제안하는 후보 — 500m 원의 중심이자 강조 마커 */
  isTarget: boolean;
};

export type MapViewProps = {
  /** 500m 원의 중심 = 제안 후보 좌표 */
  center: { lat: number; lng: number };
  /** 같은 읍의 후보 전체 (제안 후보 포함) */
  candidates: MapCandidatePin[];
  /** 같은 읍의 하이원포인트 가맹점 — 전체(1,678건)를 넘기지 않는다 */
  merchants: MapPin[];
  /** 제안 후보와 같은 표시 업종 — 반경 안 동일 업종 공백이 눈에 보이게 크게 찍는다 */
  sameCategory: string;
  radiusM?: number;
};

/** 지도 높이 — 구현체와 `MapView.tsx`의 로딩 자리표시자가 같이 써야 레이아웃이 튀지 않는다 (13 §8) */
export const MAP_BOX = "h-[240px] w-full overflow-hidden rounded-lg bg-admin-bg sm:h-[380px]";

/** 거점 마커 — admin.sidebar-deep (lavender-950) */
export const ANCHOR_COLOR = "#1E1840";
/** 같은 읍의 다른 후보 */
export const OTHER_CANDIDATE_COLOR = "#9ca3af";
/** 표시 6분류에 없는 값이 들어올 때 */
export const FALLBACK_DOT = "#6b7280";
/** 이 시간 안에 지도가 안 뜨면 "표로 보라"는 안내를 띄운다 — 심사위원이 고장으로 오인하지 않게 */
export const SLOW_MS = 6000;

export type MapViewMode = "anchor" | "radius" | "eup";

export const MAP_VIEWS: { value: MapViewMode; label: string }[] = [
  { value: "anchor", label: "거점과 함께" },
  { value: "radius", label: "반경 500m 확대" },
  { value: "eup", label: "읍 전체 가맹점" },
];
