import { REGIONS } from "@/lib/constants";
import type { Merchant } from "@/types";

export type RegionCenter = { eup: string; lat: number; lng: number; merchants: number };

/**
 * 지역 6종의 지도 표시 좌표 — **하이원포인트 가맹점 분포의 중심**.
 *
 * 행정 중심점을 쓰지 않은 이유: 이 지도가 답하는 질문은 "행정구역이 어디냐"가 아니라
 * "하이원포인트 소비 접점이 어디에 있느냐"다. 가맹점 좌표는 이미 파이프라인이 Kakao Local
 * REST API로 지오코딩해 둔 실데이터라 새 원천도 필요 없다.
 * (삼척시가 시 전역이 아니라 도계읍으로 잡히는 것도 이 방식이 맞기 때문이다 — 05 §1)
 *
 * 서버에서만 부른다. 가맹점 1,678건을 그대로 클라이언트로 넘기면 RSC 페이로드가 그만큼 커지므로,
 * **여기서 6개로 줄인 결과만** 지도 컴포넌트에 props로 넘긴다 (MapView.tsx의 F4 주의사항과 같은 이유).
 */
export function regionCenters(merchants: Merchant[]): RegionCenter[] {
  return REGIONS.map((eup) => {
    const pts = merchants.filter((m) => m.eup === eup && m.lat && m.lng);
    if (!pts.length) return { eup, lat: 0, lng: 0, merchants: 0 };
    return {
      eup,
      lat: pts.reduce((a, b) => a + b.lat, 0) / pts.length,
      lng: pts.reduce((a, b) => a + b.lng, 0) / pts.length,
      merchants: pts.length,
    };
  }).filter((c) => c.merchants > 0);
}
