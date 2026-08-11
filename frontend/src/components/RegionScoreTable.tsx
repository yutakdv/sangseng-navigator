import { Icon } from "@/components/Icon";
import { num } from "@/lib/format";
import { REGION_TOOLTIP } from "@/lib/constants";
import type { EupScore, Region } from "@/types";

/**
 * 1단계 지역 진단 — 순위·스코어·사용 건수를 한 표에 (docs/plan/13 §9 · 절대 규칙 5).
 *
 * 히어로의 개념도는 "어디가 문제인지"를 3초에 전달하는 그림이고, 이 표는 그 그림이 딛고 선
 * **감사 가능한 숫자**다. 둘 중 하나만 두면 화면이 예뻐지거나(그림만) 읽히지 않거나(표만) 한다.
 * AI가 순위를 조정해도 이 표의 정량 순위는 화면에서 감추지 않는다.
 *
 * 사용 건수 열은 `region_share`(전 기간 누적)에서 오고, 스코어 3열은 `eup_ranking`에서 온다 —
 * 원천이 다른 값이라 열 묶음을 시각적으로 갈라 둔다.
 */
export function RegionScoreTable({
  ranking,
  shares,
  counts,
  selectedEups,
  targetEup,
}: {
  ranking: EupScore[];
  shares: Record<string, number>;
  counts: Record<string, number>;
  selectedEups: string[];
  targetEup: string | null;
}) {
  const rows = [...ranking].sort((a, b) => a.rank - b.rank);
  const maxCount = Math.max(...Object.values(counts), 1);

  return (
    <div className="min-w-0">
      <div className="u-scroll-x">
        {/* table-fixed가 없으면 `지역` 열이 남는 폭을 전부 먹고 막대 두 열이 80px로 눌린다 */}
        <table className="u-table min-w-[760px] table-fixed">
          <thead>
            <tr>
              <th scope="col" className="w-[6%]">
                순위
              </th>
              <th scope="col" className="w-[21%]">
                지역
              </th>
              <th scope="col" className="w-[24%]">
                종합 진단 스코어
              </th>
              <th scope="col" className="w-[10%] text-right">
                소비저조도
              </th>
              <th scope="col" className="w-[10%] text-right">
                소비증감
              </th>
              <th scope="col" className="w-[29%]">
                하이원포인트 사용 건수
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isTarget = r.eup === targetEup;
              const isCandidate = selectedEups.includes(r.eup) && !isTarget;
              const count = counts[r.eup] ?? 0;
              return (
                <tr key={r.eup} data-highlight={isTarget ? "true" : undefined}>
                  <td className="tabular-nums text-admin-text-muted">{r.rank}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`font-semibold ${isTarget ? "text-admin-primary" : "text-admin-text"}`}
                        title={REGION_TOOLTIP[r.eup as Region]}
                      >
                        {r.eup}
                      </span>
                      {/* 색·굵기만으로 구분하지 않는다 (13 §4) — 상태는 문자로도 적는다 */}
                      {isTarget ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-admin-primary px-2 py-0.5 text-[11px] font-bold text-white">
                          <Icon name="flag" size={11} strokeWidth={2.2} />
                          제안 대상
                        </span>
                      ) : isCandidate ? (
                        <span className="whitespace-nowrap rounded-full bg-admin-primary-soft px-2 py-0.5 text-[11px] font-semibold text-admin-primary">
                          진단 대상
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <ValueBar value={r.score} max={1} text={r.score.toFixed(2)} strong />
                  </td>
                  <td className="text-right tabular-nums text-admin-text-muted">
                    {r.low_usage.toFixed(2)}
                  </td>
                  <td className="text-right tabular-nums text-admin-text-muted">
                    {r.decline.toFixed(2)}
                  </td>
                  <td>
                    <ValueBar
                      value={count}
                      max={maxCount}
                      text={`${num(count)}건`}
                      note={`${Math.round((shares[r.eup] ?? 0) * 100)}%`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="u-note mt-3 flex items-start gap-1.5 border-t border-admin-border pt-3">
        <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
        <span>
          진단 스코어 3열은 소비저조도·소비증감을 0~1로 정규화해 합산한 값이고, 사용 건수 열은 전 기간
          누적 집계입니다. {REGION_TOOLTIP.삼척시}
        </span>
      </p>
    </div>
  );
}

function ValueBar({
  value,
  max,
  text,
  note,
  strong = false,
}: {
  value: number;
  max: number;
  text: string;
  note?: string;
  strong?: boolean;
}) {
  const pct = Math.max(2, (value / max) * 100);
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-admin-surface-sunken">
        <span
          style={{ width: `${pct}%` }}
          className={`block h-full origin-left animate-grow rounded-full ${
            strong ? "bg-admin-primary" : "bg-admin-primary/45"
          }`}
        />
      </span>
      <span className="w-[104px] shrink-0 whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-admin-text">
        {text}
        {note ? (
          <span className="ml-1 text-[11px] font-medium text-admin-text-muted">{note}</span>
        ) : null}
      </span>
    </div>
  );
}
