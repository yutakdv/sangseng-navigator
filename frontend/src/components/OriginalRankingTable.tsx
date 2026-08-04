import type { CardAi } from "@/types";

/**
 * 원 Score 순위 표 — **절대 규칙 5(정량 순위 병기)의 화면 구현** (docs/plan/08 F4 · 13 §9).
 *
 * AI가 순위를 조정했든 아니든 항상 보인다. 조정된 카드에서 원 순위를 접거나 숨기면
 * 감사 가능성이 사라지므로, 이 표는 접히지 않고 타깃 행에 `Score N위`와 `AI 제안 N위`가
 * 한 줄에서 같이 읽히도록 둔다.
 */
export function OriginalRankingTable({
  rows,
  targetLabel,
  scoreRank,
  aiRank,
  adjusted,
}: {
  rows: NonNullable<CardAi["original_ranking"]>;
  /** 이 카드가 제안하는 후보의 표기 — `original_ranking[].candidate`와 같은 형식("영월군 음식점") */
  targetLabel: string | null;
  scoreRank: number | null;
  aiRank: number | null;
  adjusted: boolean;
}) {
  const isTarget = (row: { rank: number; candidate: string }): boolean =>
    targetLabel !== null ? row.candidate === targetLabel : row.rank === scoreRank;

  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <caption className="sr-only">
            정량 Score 순위와 AI 제안 순위 비교표
          </caption>
          <thead>
            <tr className="border-b border-black/5 text-left text-xs text-admin-text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                정량 Score 순위
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                후보 (읍 · 업종)
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Score
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                AI 제안 순위
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const target = isTarget(row);
              return (
                <tr
                  key={`${row.rank}-${row.candidate}`}
                  className={`border-b border-black/5 last:border-0 ${
                    target ? "bg-admin-primary-soft" : ""
                  }`}
                >
                  <td className="py-2 pr-3 tabular-nums text-admin-text-muted">{row.rank}위</td>
                  <td className="py-2 pr-3">
                    <span className={target ? "font-semibold text-admin-primary" : "text-admin-text"}>
                      {row.candidate}
                    </span>
                    {/* 색만으로 의미를 전달하지 않는다 (13 §4) */}
                    {target ? (
                      <span className="ml-1.5 text-[11px] text-admin-primary">이번 제안 대상</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium">
                    {row.score.toFixed(2)}
                  </td>
                  <td className="py-2 text-right text-xs tabular-nums">
                    {target && aiRank !== null ? (
                      <span className="font-semibold text-admin-primary">{aiRank}위</span>
                    ) : (
                      <span className="text-admin-text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
        {adjusted && scoreRank !== null && aiRank !== null
          ? `AI는 정량 ${scoreRank}위 후보를 제안 ${aiRank}위로 올렸습니다. 조정 여부와 무관하게 원 Score 순위를 함께 싣습니다 — 담당자가 정량 근거와 AI 판단을 나란히 놓고 확인할 수 있어야 하기 때문입니다.`
          : "AI 제안이 정량 1순위와 같더라도 원 Score 순위를 함께 싣습니다 — 담당자가 정량 근거와 AI 판단을 나란히 놓고 확인할 수 있어야 하기 때문입니다."}
      </p>
    </div>
  );
}
