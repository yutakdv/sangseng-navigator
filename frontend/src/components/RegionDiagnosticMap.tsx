"use client";

import { RegionTileMap } from "@/components/RegionTileMap";
import type { RegionCenter } from "@/lib/geo";
import type { EupScore } from "@/types";

/** 홈은 키가 필요한 외부 SDK를 호출하지 않고, 발표용 1단계 진단 개념도를 정본으로 사용한다. */
export function RegionDiagnosticMap({
  ranking, selectedEups, targetEup, shares,
}: {
  ranking: EupScore[];
  selectedEups: string[];
  targetEup: string | null;
  shares: Record<string, number>;
  centers: RegionCenter[];
}) {
  return <RegionTileMap ranking={ranking} selectedEups={selectedEups} targetEup={targetEup} shares={shares} />;
}
