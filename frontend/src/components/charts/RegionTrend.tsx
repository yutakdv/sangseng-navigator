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
 * 지역별 월 사용 건수 추이 (05 §1 `monthly_by_region`).
 *
 * 허브의 ③ 근거가 답해야 하는 질문은 "지역 전환율이 어떻게 움직였나"가 아니라
 * **"왜 하필 이 지역인가"** 다. 전체 합계 한 줄짜리 추이선은 그 질문에 답하지 못한다 —
 * 제안 대상 지역이 선 안에 녹아 없어지기 때문이다. 6개 지역을 각각 그리면 대상 지역이
 * 12개월 내내 어디에 있었는지가 한눈에 보이고, 그게 곧 1단계 진단 스코어의 근거다.
 *
 * 색: 지역 6종에 고정 팔레트를 쓰는 규칙(13 §5)은 **색이 정체성을 지는 경우**의 규칙이다.
 * 여기서 색이 지는 것은 정체성이 아니라 **강조**다 — 대상 지역만 인디고, 나머지는 회색 단일
 * 톤으로 두고 모든 계열을 오른쪽 범례에서 값과 함께 직접 라벨링한다. 6색 스파게티로 그리면
 * 어느 선이 어느 지역인지 추적하는 데 시선을 다 쓰고 정작 "대상이 최하위"라는 사실이 묻힌다.
 * 색만으로 대상을 전달하지도 않는다 — 범례에 `제안 대상` 문구가 함께 붙는다 (13 §4).
 */
const MUTED = "#c3cad9";

export function RegionTrend({
  data,
  regions,
  targetRegion,
  height = 248,
}: {
  /** [{ label: "1월", 고한읍: 7840, ... }] */
  data: Record<string, string | number>[];
  /** 고정 순서 6지역 */
  regions: string[];
  /** 강조할 지역. null이면 전부 같은 무게 */
  targetRegion: string | null;
  height?: number;
}) {
  return (
    <div className="min-w-0" style={{ height }}>
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
          {/* 대상 지역을 마지막에 그려야 다른 선 위로 올라온다 */}
          {[...regions]
            .sort((a, b) => Number(a === targetRegion) - Number(b === targetRegion))
            .map((r) => {
              const on = r === targetRegion;
              return (
                <Line
                  key={r}
                  type="monotone"
                  dataKey={r}
                  stroke={on ? PRIMARY : MUTED}
                  strokeWidth={on ? 2.75 : 1.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff", fill: on ? PRIMARY : MUTED }}
                  isAnimationActive={false}
                />
              );
            })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
