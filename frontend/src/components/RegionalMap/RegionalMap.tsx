"use client";

import { useState } from "react";
import { MAP_SHAPES, MAP_VIEWBOX } from "@/components/RegionalMap/mapData";
import { MAP_REGIONS, type MapRegion } from "@/components/RegionalMap/regions";

/**
 * 지역 선택용 인터랙티브 2D 일러스트 지도.
 *
 * geometry는 실제 행정구역 경계(mapData.ts — KOSTAT 시군구 + 행안부 행정동 기반)이고,
 * 이 컴포넌트는 렌더와 인터랙션만 맡는다. 일러스트 느낌은 데이터 왜곡이 아니라
 * 표현에서 온다: 저채도 면 + 흰 경계선 + 둥근 이음새 + 부드러운 전환.
 *
 * 지도 전체가 버튼 그룹이다 — 각 지역 path가 개별 클릭·키보드 대상이고(role="button",
 * Enter/Space), 선택 결과는 콜백으로 올린다. PNG 한 장이나 지도 API iframe이 아니다.
 *
 * 전 지역이 같은 라벤더 계열이다 — 색 농도는 상태만 인코딩한다:
 * 기본 lavender-50 → hover/focus lavender-200 → 선택 lavender-300 + 흰 테두리 + 그림자.
 * 색만으로 상태를 말하지 않도록 선택은 세 겹으로 표시한다.
 *
 * 기본 면이 거의 흰색에 가까워 흰 경계선으로는 지역이 갈리지 않는다 — 기본·hover의
 * 경계선은 라벤더(300)가 맡고, 선택만 흰 경계선으로 반전시켜 짙은 면 위에서 도드라진다.
 */
const FILL = { base: "#F6F4FE", hover: "#D6CEF8", selected: "#C4B8F5" }; // lavender-50/200/300
const STROKE = { base: "#C4B8F5", selected: "#ffffff" }; // lavender-300 / white
export function RegionalMap({
  selectedId,
  onRegionSelect,
}: {
  selectedId: string | null;
  onRegionSelect: (region: MapRegion) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  return (
    <svg
      viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
      className="h-auto w-full select-none"
      role="group"
      aria-label="강원 남부권 지역 선택 지도"
    >
      {/* 삼척시 전역 — 비대화형 배경. 선택 영역(도계읍)이 시의 일부임을 맥락으로 보여준다 */}
      <path
        d={MAP_SHAPES.samcheok.d}
        className="fill-admin-surface-sunken stroke-admin-border"
        strokeWidth={1}
        strokeDasharray="4 3"
        aria-hidden
      />
      <text
        x={MAP_SHAPES.samcheok.cx + 40}
        y={MAP_SHAPES.samcheok.cy - 60}
        textAnchor="middle"
        aria-hidden
        className="pointer-events-none fill-admin-text-muted text-[18px] sm:text-[12px]"
      >
        삼척시 전역
      </text>

      {/* 선택 가능한 지역 — 배열 순서가 z-order라 읍이 군 위에 얹힌다 */}
      {MAP_REGIONS.map((region) => {
        const shape = MAP_SHAPES[region.id];
        const selected = region.id === selectedId;
        const hovered = region.id === hoverId;
        return (
          <path
            key={region.id}
            id={region.id}
            d={shape.d}
            role="button"
            tabIndex={0}
            aria-label={`${region.label} 선택`}
            aria-pressed={selected}
            fill={selected ? FILL.selected : hovered ? FILL.hover : FILL.base}
            stroke={selected ? STROKE.selected : STROKE.base}
            strokeWidth={selected ? 2.5 : 1.8}
            strokeLinejoin="round"
            className="cursor-pointer outline-none transition-[fill,stroke-width,stroke] duration-200"
            style={selected ? { filter: "drop-shadow(0 2px 6px rgb(63 61 86 / 0.28))" } : undefined}
            onClick={() => onRegionSelect(region)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRegionSelect(region);
              }
            }}
            onMouseEnter={() => setHoverId(region.id)}
            onMouseLeave={() => setHoverId((cur) => (cur === region.id ? null : cur))}
            onFocus={() => setHoverId(region.id)}
            onBlur={() => setHoverId((cur) => (cur === region.id ? null : cur))}
          />
        );
      })}

      {/* 라벨 — polygon centroid 기준 + 이웃과 겹칠 때만 미세 조정(regions.ts).
          흰 halo(paint-order)로 어느 색 면 위에서도 읽힌다. 클릭은 면이 받는다 */}
      {MAP_REGIONS.map((region) => {
        const shape = MAP_SHAPES[region.id];
        const selected = region.id === selectedId;
        return (
          <text
            key={`label-${region.id}`}
            x={shape.cx + (region.labelDx ?? 0)}
            y={shape.cy + (region.labelDy ?? 0)}
            textAnchor="middle"
            aria-hidden
            stroke="#ffffff"
            strokeWidth={3}
            style={{ paintOrder: "stroke" }}
            /* SVG 텍스트는 viewBox 배율로 함께 줄어든다 — 좁은 화면(축소율 큼)에서는
               viewBox 단위 글자를 키워 렌더 크기를 지킨다 (sm 미만 20px ≈ 실표시 8~9px) */
            className={`pointer-events-none fill-admin-text text-[20px] sm:text-[13px] ${
              selected ? "font-bold" : "font-semibold"
            }`}
          >
            {region.label}
          </text>
        );
      })}
    </svg>
  );
}
