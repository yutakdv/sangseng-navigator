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
import { PRIMARY } from "@/lib/constants";

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
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
            domain={domain ?? ["auto", "auto"]}
            width={44}
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toLocaleString("ko-KR")}${unit}`, ""]}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={PRIMARY}
            strokeWidth={2}
            dot={{ r: 2.5 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
