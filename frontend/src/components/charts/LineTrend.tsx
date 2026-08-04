"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, PRIMARY } from "@/lib/constants";

/**
 * 단일 시리즈 추이 라인 (docs/plan/13 §5).
 * 단일 시리즈 차트는 팔레트를 쓰지 않고 `admin.primary` 단색, 라인 2px.
 */
export function LineTrend({
  data,
  unit = "",
  height = 220,
  domain,
}: {
  data: { label: string; value: number }[];
  unit?: string;
  height?: number;
  domain?: [number | "auto", number | "auto"];
}) {
  return (
    <div className="min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={false} dy={4} />
          <YAxis
            tick={CHART.tick}
            tickLine={false}
            axisLine={false}
            domain={domain ?? ["auto", "auto"]}
            width={48}
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toLocaleString("ko-KR")}${unit}`, ""]}
            labelStyle={{ fontSize: 12, fontWeight: 600 }}
            cursor={{ stroke: PRIMARY, strokeWidth: 1, strokeDasharray: "4 4" }}
            contentStyle={CHART.tooltip}
          />
          {/* dot에 fill을 주지 않으면 Recharts 기본 fill이 흰색이라 **데이터 포인트마다 선에
              흰 구멍이 뚫린다** — 12개 지점이 전부 끊긴 선처럼 보인다. 흰 테두리는 선과 점을
              분리하는 용도이므로 fill은 반드시 선 색과 같아야 한다 */}
          <Line
            type="monotone"
            dataKey="value"
            stroke={PRIMARY}
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 2, stroke: "#ffffff", fill: PRIMARY }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff", fill: PRIMARY }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
