"use client";

import dynamic from "next/dynamic";
import { MAP_BOX, type MapViewProps } from "@/components/MapViewTypes";

/**
 * 지도 로더 (docs/plan/08 F1·F4).
 *
 * 지도 SDK는 브라우저 전용(window 접근)이라 서버에서 렌더할 수 없다. 본체를
 * `next/dynamic(ssr:false)`로 분리하면 지도 번들이 **이 화면에서만, 그것도 별도 청크로**
 * 내려간다. 타입은 `import type`이라 런타임 import가 생기지 않는다.
 *
 * 서버 컴포넌트에서 `<MapView />`를 쓰되, props는 **필요한 만큼만 걸러서** 넘긴다
 * (merchants 전체 1,678건을 넘기면 그대로 RSC 페이로드가 된다 — F4 주의사항).
 *
 * ⚠ **구현체 교체 지점** (02 문서 "지도 결정"): 현재는 Kakao Maps JS(`MapViewKakao`)다.
 *   키·도메인 문제나 렌더 이슈가 나오면 아래 import 대상을 MapLibre 구현
 *   `./MapViewClient`(보존해 둔 폴백)로 되돌리는 **한 줄**로 원복된다 — 두 구현은
 *   `MapViewTypes`의 같은 props 계약을 쓴다.
 */

const MapImpl = dynamic(() => import("./MapViewKakao").then((m) => m.MapViewKakao), {
  ssr: false,
  loading: () => (
    <div className={`${MAP_BOX} flex items-center justify-center text-xs text-admin-text-muted`}>
      지도를 불러오는 중…
    </div>
  ),
});

export type { MapViewProps, MapPin, MapCandidatePin } from "@/components/MapViewTypes";

export function MapView(props: MapViewProps) {
  return <MapImpl {...props} />;
}
