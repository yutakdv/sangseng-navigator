import { Icon } from "@/components/Icon";
import { ANCHOR, REGIONS } from "@/lib/constants";
import type { EupScore } from "@/types";

/**
 * 지역 배치 개념도 — 히어로의 "어디가 문제인가" (docs/plan/13 §7).
 *
 * 목업 image-1의 6개 지역 폴리곤 지도는 13 §7이 **장식성**으로 판정했고, 기본 구현을
 * "지역 칩 그리드에 실존 필드(`eup_ranking`)의 스코어·순위를 표시하는 형태"로 못박았다.
 * 여기서는 그 칩 그리드를 **실제 위치 관계에 맞춰 배치**한 개념도로 만든다 —
 * 서→동으로 영월군·고한읍·태백시·삼척시가 한 줄에 놓이고, 고한읍 위로 사북읍·정선군이 쌓인다.
 *
 * 행정경계 GeoJSON을 쓰지 않은 이유: 실제 경계를 그리면 화면이 "지도"라고 주장하게 되는데
 * 이 그림이 전달하는 값은 위치가 아니라 **진단 스코어**다. 경계 없이 배치만 유지하면
 * 과장 없이 같은 정보를 전달한다. 제목에도 "개념도"라고 적는다.
 *
 * 색 규칙 (13 §7): 인디고 단일 색상의 밝기 램프(연→진)만 쓴다. 무지개 금지.
 * 대비 때문에 중간톤에 흰 글자를 얹지 않는다 — 램프는 밝은 구간(#eef2ff~#a5b4fc)에서만 움직이고,
 * 이번 카드의 대상 지역 한 칸만 진한 인디고 + 흰 글자로 떨어뜨린다.
 * 대상 표시는 색만이 아니라 `제안 대상` 문구로도 읽힌다 (13 §4).
 */

/** 실제 위치 관계 근사 — Tailwind는 리터럴 클래스만 읽으므로 문자열로 고정한다 */
const PLACEMENT: Record<string, string> = {
  정선군: "sm:col-start-2 sm:row-start-1",
  사북읍: "sm:col-start-2 sm:row-start-2",
  영월군: "sm:col-start-1 sm:row-start-3",
  고한읍: "sm:col-start-2 sm:row-start-3",
  태백시: "sm:col-start-3 sm:row-start-3",
  삼척시: "sm:col-start-4 sm:row-start-3",
};

const HI = [67, 56, 202] as const; // #4338ca — 이번 분기 제안 대상 한 칸 (흰 글자 대비 8.6:1)
const RAMP_LO = [245, 247, 255] as const; // #f5f7ff
const RAMP_HI = [139, 149, 245] as const; // #8b95f5 — 여기까지만 올린다(검은 글자 대비 5.9:1)

const mix = (a: readonly number[], b: readonly number[], t: number): string =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(" ")})`;

/**
 * 진단 스코어 → 칸 색. Kakao 지도 마커도 같은 함수를 써야 지도/개념도 두 표현의 색이 갈리지 않는다.
 * `t`는 최고 스코어로 나눈 0~1 값이며, 제안 대상 한 칸만 램프 밖의 진한 인디고로 떨어뜨린다.
 */
export const scoreColor = (t: number, isTarget: boolean): string =>
  isTarget ? `rgb(${HI.join(" ")})` : mix(RAMP_LO, RAMP_HI, t);

/** 범례 — 지도/개념도 공용 */
export function ScoreLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}>
      <div className="flex min-w-[140px] flex-1 items-center gap-2">
        <span className="whitespace-nowrap text-[11px] font-semibold text-admin-text-muted">
          진단 스코어
        </span>
        <span
          aria-hidden
          className="h-2 min-w-0 flex-1 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${mix(RAMP_LO, RAMP_HI, 0)}, ${mix(RAMP_LO, RAMP_HI, 1)}, rgb(${HI.join(" ")}))`,
          }}
        />
        <span className="whitespace-nowrap text-[10px] font-medium text-admin-text-muted">
          낮음 → 높음
        </span>
      </div>
      <p className="flex items-center gap-1.5 text-[10px] leading-4 text-admin-text-muted">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-admin-text ring-2 ring-white" />
        <span className="break-keep">거점 {ANCHOR.name}</span>
      </p>
    </div>
  );
}

/** 제안 대상 요약 — 지도/개념도 공용 */
export function RegionTargetCallout({
  target,
  share,
  className = "",
}: {
  target: EupScore | undefined;
  share: number;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col justify-center rounded-2xl bg-admin-surface/80 p-4 ring-1 ring-inset ring-admin-primary-line ${className}`}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-admin-primary">
        <Icon name="flag" size={12} strokeWidth={2} />
        이번 분기 제안 대상
      </p>
      {target ? (
        <>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[22px] font-bold leading-7 tracking-[-0.02em] text-admin-text">
              {target.eup}
            </span>
            <span className="rounded-full bg-admin-primary px-2 py-0.5 text-[11px] font-bold text-white">
              진단 {target.rank}순위
            </span>
          </p>
          {/* 2열 고정 — 이 블록은 개념도에서 4칸 중 2칸 폭(약 260px)에 들어가므로
              4열로 벌리면 "소비저조도"가 두 줄로 접힌다 */}
          <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-4">
            <Fact label="소비저조도" value={target.low_usage.toFixed(2)} />
            <Fact label="소비증감" value={target.decline.toFixed(2)} />
            <Fact label="종합 스코어" value={target.score.toFixed(2)} />
            <Fact label="사용 비중" value={`${Math.round(share * 100)}%`} />
          </dl>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-[17px] font-bold leading-6 text-admin-text">전 지역 공통 적용</p>
          <p className="u-note mt-1.5">
            수요 측 인센티브는 특정 지역 한정이 아니라 6개 지역 공통으로 적용합니다.
          </p>
        </>
      )}
    </div>
  );
}

export function RegionTileMap({
  ranking,
  selectedEups,
  targetEup,
  shares,
}: {
  ranking: EupScore[];
  /** 1단계 진단에서 고른 지역 — 대상이 아니어도 후보였다는 사실을 남긴다 */
  selectedEups: string[];
  /** 이번 분기 카드가 겨눈 지역. INCENTIVE(전 지역 공통)면 null */
  targetEup: string | null;
  /** 지역별 사용 비중 (0~1) — 칸 아래 각주 */
  shares: Record<string, number>;
}) {
  const maxScore = Math.max(...ranking.map((r) => r.score), 0.0001);
  const byEup = new Map(ranking.map((r) => [r.eup, r]));
  // 좁은 화면에서는 배치가 무의미하므로 DOM 순서를 순위순으로 둔다 — sm 이상에서만 위치가 잡힌다
  const ordered = [...ranking].sort((a, b) => a.rank - b.rank);
  const target = targetEup ? byEup.get(targetEup) : undefined;

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:grid-rows-3">
        {/* 대상 콜아웃 — 개념도 오른쪽 위 빈 칸을 쓴다 */}
        <RegionTargetCallout
          target={target}
          share={target ? (shares[target.eup] ?? 0) : 0}
          className="col-span-2 sm:col-start-3 sm:row-start-1 sm:row-span-2"
        />

        {/* 범례 — 왼쪽 위 빈 칸 */}
        <div className="col-span-2 flex flex-col justify-center gap-2 rounded-2xl px-1 py-2 sm:col-span-1 sm:col-start-1 sm:row-start-1 sm:row-span-2">
          <p className="text-[11px] font-semibold text-admin-text-muted">1단계 진단 스코어</p>
          <div
            aria-hidden
            className="h-2 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${mix(RAMP_LO, RAMP_HI, 0)}, ${mix(RAMP_LO, RAMP_HI, 1)}, rgb(${HI.join(" ")}))`,
            }}
          />
          <p className="flex justify-between text-[10px] font-medium text-admin-text-muted">
            <span>낮음</span>
            <span>높음</span>
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-4 text-admin-text-muted">
            <span
              aria-hidden
              className="mt-1 h-2 w-2 shrink-0 rounded-full bg-admin-text ring-2 ring-white"
            />
            <span className="break-keep">거점 {ANCHOR.name}</span>
          </p>
        </div>

        {ordered.map((r) => (
          <RegionTile
            key={r.eup}
            row={r}
            t={r.score / maxScore}
            isTarget={r.eup === targetEup}
            isCandidate={selectedEups.includes(r.eup) && r.eup !== targetEup}
            hasAnchor={r.eup === "고한읍"}
            share={shares[r.eup] ?? 0}
          />
        ))}
      </div>

      <p className="u-note mt-3 flex items-start gap-1.5">
        <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
        <span>
          실제 행정경계가 아니라 지역 간 위치 관계만 옮긴 개념도입니다. 칸의 진하기는 소비저조도·소비증감을
          0~1로 정규화해 합산한 1단계 진단 스코어이며, 순위는 화면에서 감추지 않습니다.
        </span>
      </p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-admin-text-muted">{label}</dt>
      <dd className="font-bold tabular-nums text-admin-text">{value}</dd>
    </div>
  );
}

function RegionTile({
  row,
  t,
  isTarget,
  isCandidate,
  hasAnchor,
  share,
}: {
  row: EupScore;
  t: number;
  isTarget: boolean;
  isCandidate: boolean;
  hasAnchor: boolean;
  share: number;
}) {
  const bg = scoreColor(t, isTarget);

  return (
    <div
      title={`${row.eup} — 1단계 진단 ${row.rank}순위, 종합 스코어 ${row.score.toFixed(2)}, 사용 비중 ${Math.round(share * 100)}%`}
      style={{ background: bg, animationDelay: `${180 + row.rank * 55}ms` }}
      className={`animate-rise relative flex min-w-0 flex-col justify-between rounded-2xl p-3 transition-transform duration-200 hover:scale-[1.03] ${
        PLACEMENT[row.eup] ?? ""
      } ${
        isTarget
          ? "shadow-[0_8px_20px_-8px_rgb(67_56_202_/_0.7)] ring-2 ring-admin-primary ring-offset-2 ring-offset-white"
          : isCandidate
            ? "outline outline-2 outline-dashed outline-offset-[-3px] outline-admin-primary/45"
            : "ring-1 ring-inset ring-black/[0.04]"
      }`}
    >
      {hasAnchor ? (
        <span
          aria-hidden
          title={ANCHOR.name}
          className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-admin-text ring-2 ring-white"
        />
      ) : null}

      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 text-[10px] font-bold tabular-nums ${
            isTarget ? "bg-white/25 text-white" : "bg-white/70 text-admin-text-muted"
          }`}
        >
          {row.rank}
        </span>
        {isTarget ? (
          <span className="truncate text-[10px] font-bold text-white/90">제안 대상</span>
        ) : isCandidate ? (
          <span className="truncate text-[10px] font-bold text-admin-primary">진단 대상</span>
        ) : null}
      </div>

      <p
        className={`mt-1.5 truncate text-[15px] font-bold leading-5 tracking-[-0.01em] ${
          isTarget ? "text-white" : "text-admin-text"
        }`}
      >
        {row.eup}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <span
          className={`h-1.5 min-w-0 flex-1 overflow-hidden rounded-full ${
            isTarget ? "bg-white/25" : "bg-white/70"
          }`}
        >
          <span
            style={{ width: `${Math.max(3, t * 100)}%`, animationDelay: `${320 + row.rank * 55}ms` }}
            className={`block h-full origin-left animate-grow rounded-full ${
              isTarget ? "bg-white" : "bg-admin-primary"
            }`}
          />
        </span>
        <span
          className={`shrink-0 text-[11px] font-bold tabular-nums ${
            isTarget ? "text-white" : "text-admin-text"
          }`}
        >
          {row.score.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

/** 6지역 고정 순서를 유지한 사용 비중 맵 (13 §5 — 순서·색은 항목에 고정) */
export const shareMap = (rows: { region: string; share: number }[]): Record<string, number> =>
  Object.fromEntries(REGIONS.map((r) => [r, rows.find((x) => x.region === r)?.share ?? 0]));
