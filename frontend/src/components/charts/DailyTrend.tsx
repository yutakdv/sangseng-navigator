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
import type { DailyTrendPoint } from "@/lib/regionAnalysis";

/** 일별 원자료 라인 — 같은 측정값의 맥락 층이라 팔레트가 아닌 PRIMARY 옅은 단계(lavender-200) */
const RAW = "#D6CEF8";

/**
 * 일 단위 추이 (docs/plan/13 §5 단일 시리즈 원칙의 확장).
 * 365개 점은 점·개별 라벨 없이 옅은 원자료 + 진한 7일 이동평균 두 층으로 읽게 한다 —
 * 두 층은 같은 측정값이므로 다른 색상이 아니라 같은 색상의 명도 단계로 구분한다.
 */
export function DailyTrend({ data, height = 240 }: { data: DailyTrendPoint[]; height?: number }) {
  // 월 시작일만 축에 표시 — 365개 category 축은 자동 간격이 월 경계와 어긋난다
  const monthTicks = data.filter((p) => p.date.slice(8, 10) === "01").map((p) => p.date);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-admin-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-5 rounded-full" style={{ background: PRIMARY }} />
          7일 이동평균
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-5 rounded-full" style={{ background: RAW }} />
          일별 건수
        </span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -10 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="date"
              ticks={monthTicks}
              tickFormatter={(d: string) => `${Number(d.slice(5, 7))}월`}
              tick={CHART.tick}
              tickLine={false}
              axisLine={false}
              dy={4}
              interval={0}
            />
            <YAxis tick={CHART.tick} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              formatter={(v, name) => [
                `${Number(v).toLocaleString("ko-KR")}건`,
                name === "avg7" ? "7일 이동평균" : "일별",
              ]}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.tooltipLabel ?? ""}
              labelStyle={{ fontSize: 12, fontWeight: 600 }}
              cursor={{ stroke: PRIMARY, strokeWidth: 1, strokeDasharray: "4 4" }}
              contentStyle={CHART.tooltip}
            />
            <Line type="monotone" dataKey="value" stroke={RAW} strokeWidth={1.5} dot={false}
              activeDot={{ r: 3, strokeWidth: 1, stroke: "#ffffff", fill: RAW }} isAnimationActive={false} />
            <Line type="monotone" dataKey="avg7" stroke={PRIMARY} strokeWidth={2.5} dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: "#ffffff", fill: PRIMARY }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
