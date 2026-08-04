"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, PRIMARY } from "@/lib/constants";

/**
 * 가로 막대 (지역별 사용 건수·읍 랭킹 등) — docs/plan/13 §5.
 * 크기 비교용 막대이므로 무지개색 금지: 기본은 `admin.primary` 단색.
 * `colors`를 주면 정체성 구분(업종·지역 고정 색)에만 쓰고, 값 라벨을 항상 함께 표기한다.
 */
export function BarRank({
  data,
  height = 220,
  unit = "",
  colors,
}: {
  data: { label: string; value: number; note?: string }[];
  height?: number;
  unit?: string;
  colors?: Record<string, string>;
}) {
  return (
    <div className="min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 68, bottom: 4, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 13, fill: "#181534", fontWeight: 500 }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            cursor={{ fill: CHART.cursor }}
            formatter={(v, _n, p) => [
              `${Number(v).toLocaleString("ko-KR")}${unit}${p?.payload?.note ? ` (${p.payload.note})` : ""}`,
              "",
            ]}
            contentStyle={CHART.tooltip}
          />
          <Bar dataKey="value" radius={[0, 5, 5, 0]} isAnimationActive={false} barSize={20}>
            {data.map((d) => (
              <Cell key={d.label} fill={colors?.[d.label] ?? PRIMARY} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => `${v.toLocaleString("ko-KR")}${unit}`}
              style={CHART.label}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
