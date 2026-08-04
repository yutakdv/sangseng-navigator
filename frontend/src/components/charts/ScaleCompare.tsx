"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PRIMARY } from "@/lib/constants";

/**
 * "리조트 체류 규모(굵은 막대) vs 지역 전환 건수(가는 막대)" 비교 (docs/plan/08 F5).
 * **이중 축 금지** (13 §5) — 두 시리즈를 같은 y축의 그룹 막대로 그린다.
 * 정체성 구분이 아니라 두 측정값의 크기 비교이므로 카테고리 팔레트를 쓰지 않는다.
 */
const MUTED = "#c7cbd6";

export function ScaleCompare({
  data,
  height = 240,
}: {
  /** label=월, visitors=입장 연인원(교대 합산), uses=지역 사용 건수 */
  data: { label: string; visitors: number; uses: number }[];
  height?: number;
}) {
  return (
    <div className="min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barGap={2}>
          <CartesianGrid stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6b7280" }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => `${Math.round(v / 1000)}천`}
          />
          <Tooltip
            cursor={{ fill: "rgba(79,70,229,0.06)" }}
            formatter={(v, n) => [`${Number(v).toLocaleString("ko-KR")}${n === "입장 연인원(교대 합산)" ? "명" : "건"}`, String(n)]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="square" iconSize={9} />
          <Bar
            dataKey="visitors"
            name="입장 연인원(교대 합산)"
            fill={MUTED}
            radius={[4, 4, 0, 0]}
            barSize={14}
            isAnimationActive={false}
          />
          <Bar
            dataKey="uses"
            name="지역 사용 건수"
            fill={PRIMARY}
            radius={[4, 4, 0, 0]}
            barSize={7}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
