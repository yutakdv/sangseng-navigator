import { Icon } from "@/components/Icon";
import type { CardAi } from "@/types";

/**
 * 원 정량 순위 표 — **절대 규칙 5(정량 순위 병기)의 화면 구현** (docs/plan/08 F4 · 13 §9).
 *
 * 진행 중인 업무가 상위 후보를 막았든 아니든 항상 보인다. 원 순위를 접거나 숨기면
 * 감사 가능성이 사라지므로, 이 표는 접히지 않고 타깃 행에 `Score N위`와 `선택 가능한 후보 N위`가
 * 한 줄에서 같이 읽히도록 둔다.
 *
 * 여기 실리는 값은 **2단계 후보 스코어**(`card.ai.original_ranking`)다 — 1단계 읍·시 스코어와
 * 다른 층위라, 열 이름에 "후보 스코어"를 밝혀 같은 화면의 지역 진단 순위와 갈라 놓는다.
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
      <div className="u-scroll-x">
        <table className="u-table min-w-[460px]">
          <caption className="sr-only">후보 스코어 순위와 선택 가능한 후보 순위 비교표</caption>
          <thead>
            <tr>
              <th scope="col">후보 스코어 순위</th>
              <th scope="col">후보 (읍 · 업종)</th>
              <th scope="col" className="text-right">
                Score
              </th>
              <th scope="col" className="text-right">
                선택 가능한 후보
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const target = isTarget(row);
              return (
                <tr
                  key={`${row.rank}-${row.candidate}`}
                  data-highlight={target ? "true" : undefined}
                >
                  <td className="tabular-nums text-admin-text-muted">{row.rank}위</td>
                  <td>
                    <span className={target ? "font-bold text-admin-primary" : "text-admin-text"}>
                      {row.candidate}
                    </span>
                    {/* 색만으로 의미를 전달하지 않는다 (13 §4) */}
                    {target ? (
                      <span className="ml-1.5 whitespace-nowrap rounded-full bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-primary">
                        이번 제안 대상
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{row.score.toFixed(2)}</td>
                  <td className="text-right tabular-nums">
                    {target && aiRank !== null ? (
                      <span className="font-bold text-admin-primary">{aiRank}위</span>
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

      <p className="u-note mt-3 flex items-start gap-1.5 border-t border-admin-border pt-2.5">
        <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
        <span>
          {adjusted && scoreRank !== null && aiRank !== null
            ? `후보 스코어 ${scoreRank}위보다 앞선 후보는 진행 중인 업무로 중복 제안에서 제외됐습니다. 서버가 선택 가능한 후보 중 ${aiRank}위를 결정론적으로 선택했으며, 원 정량 순위를 함께 싣습니다.`
            : "서버가 후보 스코어 1순위를 그대로 선택했습니다. 선택 결과와 무관하게 원 정량 순위를 함께 싣습니다."}
        </span>
      </p>
    </div>
  );
}
