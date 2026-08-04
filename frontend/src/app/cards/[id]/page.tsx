import { AdminShell } from "@/components/AdminShell";
import { RoutePlaceholder } from "@/components/RoutePlaceholder";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** ② 카드 상세 — F4 (FE 담당). 동적 라우트만 먼저 열어 둔다. */
export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15+ 에서 params·searchParams 는 Promise 다 — await 없이 접근하면 런타임 에러
  const [{ id }, dashboard] = await Promise.all([params, api.dashboard()]);

  return (
    <AdminShell dashboard={dashboard}>
      <RoutePlaceholder
        task="F4"
        title={`카드 상세 (${id})`}
        summary="AI 조정 근거 전문 + 500m 반경 지도 + 가맹 전환 시 예상 효과 시뮬레이션."
        ready={[
          "api.card(id) — 카드 단건 (05 §2)",
          "api.candidates() — eup_ranking · candidates · merchants (05 §1)",
          "api.simulate(id) — 가맹 전환 시 예상 효과 (05 §2, EXPANSION 전용)",
        ]}
        todo={[
          "후보 비교·근거·리스크·원 Score 순위 표 (정량 순위 항상 병기 — 절대 규칙 5)",
          "MapView: MapLibre GL + OpenFreeMap, 가맹점 핀 + 후보 마커 + 500m 반경 원 + 거점 마커",
          "후보 거리 표기는 '직선 X km / 도로 Y km·Z분'을 함께 — '가장 가깝다' 단정 금지 (05 §1)",
          "road_distance_km·road_minutes가 null이면 도로 항목만 '—' 처리, 이 값으로 재정렬하지 않는다",
          "1단계 근거: 읍 랭킹 바 차트 (BarRank 재사용 가능)",
          "'이 후보가 가맹 전환하면?' 버튼 → api.simulate → delta·narrative + 가정 기반 전망 배지",
        ]}
      />
    </AdminShell>
  );
}
