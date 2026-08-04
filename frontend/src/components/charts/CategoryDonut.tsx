"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CATEGORY_COLORS, CHART } from "@/lib/constants";

/**
 * 업종 6분류 도넛 (docs/plan/13 §5 · 05 §1 `category_share`).
 * - 색은 **항목에 고정** — 항목 수가 바뀌어도 재배열하지 않는다.
 * - 슬롯 3·4·5는 흰 배경 대비가 3:1 미만이라 **범례에 %값을 병기**해 식별을 보완한다.
 * - 세그먼트 사이 2px 흰 간격.
 */
export function CategoryDonut({
  data,
  height = 220,
}: {
  data: { category: string; count: number; share: number }[];
  height?: number;
}) {
  const total = data.reduce((a, b) => a + b.count, 0);

  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="category"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.category} fill={CATEGORY_COLORS[d.category] ?? "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, n) => [`${Number(v).toLocaleString("ko-KR")}건`, String(n)]}
              contentStyle={CHART.tooltip}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-1">
        {data.map((d) => (
          <li key={d.category} className="flex items-center gap-2 text-[13px] text-admin-text">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-[3px]"
              style={{ background: CATEGORY_COLORS[d.category] ?? "#94a3b8" }}
            />
            <span className="min-w-0 flex-1 truncate">{d.category}</span>
            <span className="font-semibold tabular-nums text-admin-text">
              {Math.round(d.share * 100)}%
            </span>
          </li>
        ))}
        <li className="col-span-2 mt-1.5 border-t border-admin-border pt-1.5 text-xs text-admin-text-muted sm:col-span-1">
          총 {total.toLocaleString("ko-KR")}건
        </li>
      </ul>
    </div>
  );
}
