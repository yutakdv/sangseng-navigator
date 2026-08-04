"use client";

import dynamic from "next/dynamic";
import type { MapViewProps } from "./MapViewClient";

/**
 * 지도 로더 (docs/plan/08 F1·F4).
 *
 * MapLibre GL은 브라우저 전용(WebGL·window 접근)이라 서버에서 렌더할 수 없다.
 * 본체를 `next/dynamic(ssr:false)`로 분리하면 maplibre 번들이 **이 화면에서만, 그것도
 * 별도 청크로** 내려간다. 타입은 `import type`이라 런타임 import가 생기지 않는다.
 *
 * 서버 컴포넌트에서 `<MapView />`를 쓰되, props는 **필요한 만큼만 걸러서** 넘긴다
 * (merchants 전체 1,678건을 넘기면 그대로 RSC 페이로드가 된다 — F4 주의사항).
 */

/** 로딩 자리표시자 높이는 `MapViewClient.tsx`의 MAP_BOX와 **같은 값**이어야 레이아웃이 튀지 않는다 */
const MAP_BOX = "h-[240px] w-full overflow-hidden rounded-lg bg-admin-bg sm:h-[380px]";

const MapViewClient = dynamic(() => import("./MapViewClient").then((m) => m.MapViewClient), {
  ssr: false,
  loading: () => (
    <div className={`${MAP_BOX} flex items-center justify-center text-xs text-admin-text-muted`}>
      지도를 불러오는 중…
    </div>
  ),
});

export type { MapViewProps, MapPin, MapCandidatePin } from "./MapViewClient";

export function MapView(props: MapViewProps) {
  return <MapViewClient {...props} />;
}
