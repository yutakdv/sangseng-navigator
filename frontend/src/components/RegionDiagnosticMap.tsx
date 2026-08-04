import { RegionTileMap } from "@/components/RegionTileMap";
import type { EupScore } from "@/types";

/**
 * 홈·데모에서 공통으로 쓰는 지역 소비 3D 지형도.
 * 각 지역을 독립된 지형 블록으로 분할해, 사용 비중과 진단 순위를 한 장에서 비교한다.
 */
export function RegionDiagnosticMap({
  ranking,
  selectedEups,
  targetEup,
  shares,
}: {
  ranking: EupScore[];
  selectedEups: string[];
  targetEup: string | null;
  shares: Record<string, number>;
}) {
  return <RegionTileMap ranking={ranking} selectedEups={selectedEups} targetEup={targetEup} shares={shares} />;
}
