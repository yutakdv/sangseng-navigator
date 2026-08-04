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
import { CHART, PRIMARY } from "@/lib/constants";

/**
 * "리조트 체류 규모(굵은 막대) vs 지역 전환 건수(가는 막대)" 비교 (docs/plan/08 F5).
 * **이중 축 금지** (13 §5) — 두 시리즈를 같은 y축의 그룹 막대로 그린다.
 * 정체성 구분이 아니라 두 측정값의 크기 비교이므로 카테고리 팔레트를 쓰지 않는다.
 */
/**
 * 대조용 막대(입장 연인원)의 회색. 인디고 막대가 도드라지도록 낮춘 색이지만,
 * 흰 배경 대비 1.6:1이던 `#c7cbd6`은 막대 자체가 잘 안 보여서 앱의 다른 회색(slate-400)과
 * 같은 값으로 올렸다 — 범례 **글자**는 아래 `legendText`가 따로 진한 색으로 그린다
 * (Recharts는 범례 텍스트를 시리즈 색으로 칠해서, 연한 시리즈 색이 그대로 글자색이 된다).
 */
const MUTED = "#94a3b8";

const legendText = (value: string) => (
  <span style={{ color: "#454c63", fontWeight: 500 }}>{value}</span>
);

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
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={false} dy={4} />
          <YAxis
            tick={CHART.tick}
            tickLine={false}
            axisLine={false}
            width={54}
            tickFormatter={(v: number) => `${Math.round(v / 1000)}천`}
          />
          <Tooltip
            cursor={{ fill: CHART.cursor }}
            formatter={(v, n) => [
              `${Number(v).toLocaleString("ko-KR")}${n === "입장 연인원(교대 합산)" ? "명" : "건"}`,
              String(n),
            ]}
            contentStyle={CHART.tooltip}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            iconType="square"
            iconSize={10}
            formatter={legendText}
          />
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
