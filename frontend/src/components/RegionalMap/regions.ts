/**
 * 지도 지역 정의 — geometry(mapData.ts)와 UI 메타를 분리해 관리한다.
 *
 * `name`이 곧 서비스 데이터 키다(REGIONS·usage 산출물과 동일 문자열). 지도에서 지역을
 * 고르면 이 name으로 지역별 수치·상세 링크를 잇는다.
 *
 * ⚠ `dogye`의 name이 "삼척시"인 이유: 이 서비스의 삼척시 값은 시 전역이 아니라
 *   하이원포인트 지역가맹 대상지역인 **도계읍** 기준이다(REGION_TOOLTIP). 그래서 선택
 *   영역도 도계읍 실제 경계로 그린다 — 시 전체를 칠하면 지도가 "삼척 시내도 대상"이라고
 *   말하는 셈이 된다. 시 전역 윤곽은 비대화형 배경(samcheok)으로만 깔아 맥락을 준다.
 *
 * 지역별 색을 두지 않는다 — 전 지역이 같은 라벤더 계열이고, 지역 구분은 흰 경계선과
 * 라벨이 맡는다. 색은 상태(hover·선택)만 인코딩한다 (13 §4 "색은 신호일 때만").
 * 처음에는 REGION_COLORS를 저투명도로 깔았지만, 알파 블렌딩이 색을 탁하게 만들고
 * 6색이 라벤더 UI 위에서 시끄러워 걷어냈다.
 */
export type MapRegion = {
  id: string;
  /** 서비스 데이터 키 (REGIONS와 동일한 문자열) */
  name: string;
  /** 지도에 그리는 라벨 — name과 다를 수 있다 (예: 삼척시(도계읍)) */
  label: string;
  type: "county" | "town";
  parentId?: string;
  /** 라벨 미세 조정(px) — centroid 기준 배치에서 이웃 라벨과 겹칠 때만 쓴다 */
  labelDx?: number;
  labelDy?: number;
};

/** 렌더 순서 = 배열 순서 — 읍(town)이 군 위에 얹히도록 county 먼저 */
export const MAP_REGIONS: MapRegion[] = [
  { id: "yeongwol", name: "영월군", label: "영월군", type: "county" },
  { id: "jeongseon", name: "정선군", label: "정선군", type: "county" },
  { id: "taebaek", name: "태백시", label: "태백시", type: "county" },
  {
    id: "dogye",
    name: "삼척시",
    label: "삼척시(도계읍)",
    type: "town",
    parentId: "samcheok",
  },
  // 고한·사북은 정선군 위에 얹히는 별도 선택 영역 — 정선군 클릭은 두 읍을 제외한
  // 잔여 지역을 뜻한다(데이터 집계 기준과 동일).
  // 라벨 기준점이 내부 최심점(label_anchor)으로 바뀌면서 수동 오프셋은 걷어냈다 —
  // 겹침이 다시 생기면 그때만 labelDx/labelDy로 미세 조정한다.
  { id: "gohan", name: "고한읍", label: "고한읍", type: "town", parentId: "jeongseon" },
  { id: "sabuk", name: "사북읍", label: "사북읍", type: "town", parentId: "jeongseon" },
];
