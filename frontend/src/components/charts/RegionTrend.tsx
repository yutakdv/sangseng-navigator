"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, PRIMARY, REGION_COLORS } from "@/lib/constants";

/**
 * 지역별 월 사용 건수 추이 (05 §1 `monthly_by_region`).
 *
 * 허브의 ③ 근거가 답해야 하는 질문은 "지역 전환율이 어떻게 움직였나"가 아니라
 * **"왜 하필 이 지역인가"** 다. 전체 합계 한 줄짜리 추이선은 그 질문에 답하지 못한다 —
 * 제안 대상 지역이 선 안에 녹아 없어지기 때문이다. 6개 지역을 각각 그리면 대상 지역이
 * 12개월 내내 어디에 있었는지가 한눈에 보이고, 그게 곧 1단계 진단 스코어의 근거다.
 *
 * 기본 상태에서는 대상 지역만 인디고로 두되, 오른쪽 지역 목록에 마우스를 올리면 해당 계열만
 * 고정 지역색으로 올린다. 그러면 6색 스파게티가 되지 않으면서도 "이 지역의 흐름"을 즉시
 * 추적할 수 있다. 키보드 포커스도 같은 동작을 한다.
 */
const MUTED = "#C9C7D4";

export function RegionTrend({
  data,
  regions,
  targetRegion,
  latestByRegion = [],
  latestMonth,
  height = 248,
}: {
  /** [{ label: "1월", 고한읍: 7840, ... }] */
  data: Record<string, string | number>[];
  /** 고정 순서 6지역 */
  regions: string[];
  /** 강조할 지역. null이면 전부 같은 무게 */
  targetRegion: string | null;
  /** 오른쪽에서 직접 조작하는 최신 월 지역 목록 */
  latestByRegion?: { region: string; value: number }[];
  latestMonth?: string;
  height?: number;
}) {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const highlightedRegion = hoveredRegion ?? targetRegion;

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center">
      <div className="min-w-0 flex-1" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -6 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={false} dy={4} />
            <YAxis
              tick={CHART.tick}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
            />
            <Tooltip
              formatter={(v, n) => [`${Number(v).toLocaleString("ko-KR")}건`, String(n)]}
              labelStyle={{ fontSize: 12, fontWeight: 600 }}
              cursor={{ stroke: PRIMARY, strokeWidth: 1, strokeDasharray: "4 4" }}
              contentStyle={CHART.tooltip}
            />
            {/* 강조 계열을 마지막에 그려 다른 선 위에서도 읽히게 한다. */}
            {[...regions]
              .sort((a, b) => Number(a === highlightedRegion) - Number(b === highlightedRegion))
              .map((r) => {
                const isHighlighted = r === highlightedRegion;
                const isTarget = r === targetRegion;
                const stroke = isHighlighted
                  ? isTarget
                    ? PRIMARY
                    : (REGION_COLORS[r] ?? PRIMARY)
                  : highlightedRegion
                    ? "#E7E5EE"
                    : MUTED;
                return (
                  <Line
                    key={r}
                    type="monotone"
                    dataKey={r}
                    stroke={stroke}
                    strokeWidth={isHighlighted ? 3 : 1.35}
                    strokeOpacity={highlightedRegion && !isHighlighted ? 0.62 : 1}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: stroke }}
                    isAnimationActive={false}
                  />
                );
              })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {latestByRegion.length ? (
        <div className="shrink-0 lg:w-[172px]">
          <p className="mb-1.5 text-[11px] font-medium text-admin-text-muted">
            지역에 커서를 올려 강조{latestMonth ? ` · 최신 ${latestMonth}` : ""}
          </p>
          <ul className="grid grid-cols-2 gap-1.5 lg:grid-cols-1" aria-label="지역별 최신 사용 건수">
            {latestByRegion.map((row) => {
              const isHighlighted = row.region === highlightedRegion;
              const isTarget = row.region === targetRegion;
              const color = isTarget ? PRIMARY : (REGION_COLORS[row.region] ?? PRIMARY);
              return (
                <li key={row.region}>
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredRegion(row.region)}
                    onMouseLeave={() => setHoveredRegion(null)}
                    onFocus={() => setHoveredRegion(row.region)}
                    onBlur={() => setHoveredRegion(null)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary ${
                      isHighlighted
                        ? "bg-admin-primary-soft ring-1 ring-inset ring-admin-primary-line"
                        : "hover:bg-admin-surface-sunken"
                    }`}
                    aria-label={`${row.region} ${row.value.toLocaleString("ko-KR")}건 추이 강조`}
                  >
                    <span
                      aria-hidden
                      className="h-0.5 w-3 shrink-0 rounded-full transition-colors"
                      style={{ backgroundColor: isHighlighted ? color : MUTED }}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        isHighlighted ? "font-bold text-admin-primary" : "text-admin-text-soft"
                      }`}
                    >
                      {row.region}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-admin-text">
                      {row.value.toLocaleString("ko-KR")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
