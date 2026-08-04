import { Icon } from "@/components/Icon";
import { ANCHOR, REGIONS } from "@/lib/constants";
import type { EupScore } from "@/types";

/** Image-1의 입체 지도를 참고한 6지역 소비 진단 위치 관계도. */
const HI = [67, 56, 202] as const;
const RAMP_LO = [224, 235, 255] as const;
const RAMP_HI = [102, 118, 223] as const;
const SIDE_LO = [175, 196, 239] as const;
const SIDE_HI = [53, 49, 146] as const;

type MapPiece = {
  eup: string;
  points: string;
  label: { x: number; y: number };
};

/* 행정경계 원본을 흉내 내지 않는, 강원 남부 생활권의 위치 관계를 읽기 위한 3D 표현용 다각형이다. */
const MAP_PIECES: MapPiece[] = [
  { eup: "정선군", points: "256,45 336,24 401,71 372,131 289,122 238,82", label: { x: 321, y: 87 } },
  { eup: "사북읍", points: "253,131 335,111 388,153 347,207 272,197 232,164", label: { x: 313, y: 166 } },
  { eup: "고한읍", points: "270,206 348,212 393,265 344,324 263,296 236,247", label: { x: 317, y: 259 } },
  { eup: "태백시", points: "170,206 238,196 275,250 247,307 158,289 134,248", label: { x: 208, y: 260 } },
  { eup: "영월군", points: "74,138 150,103 233,145 219,199 135,218 64,183", label: { x: 143, y: 171 } },
  { eup: "삼척시", points: "390,132 500,101 555,160 532,241 434,242 377,194", label: { x: 467, y: 180 } },
];

const mix = (a: readonly number[], b: readonly number[], t: number): string =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(" ")})`;

/** 진단 스코어 색상. 대상 지역은 확실히 구분하되 나머지는 같은 계열로 유지한다. */
export const scoreColor = (t: number, isTarget: boolean): string =>
  isTarget ? `rgb(${HI.join(" ")})` : mix(RAMP_LO, RAMP_HI, t);

const sideColor = (t: number, isTarget: boolean): string =>
  isTarget ? "rgb(43 38 133)" : mix(SIDE_LO, SIDE_HI, t);

const lowerPoints = (points: string, depth = 12): string =>
  points
    .split(" ")
    .map((point) => {
      const [x, y] = point.split(",").map(Number);
      return `${x},${y + depth}`;
    })
    .join(" ");

export function RegionTileMap({
  ranking,
  selectedEups,
  targetEup,
  shares,
}: {
  ranking: EupScore[];
  selectedEups: string[];
  targetEup: string | null;
  shares: Record<string, number>;
}) {
  const maxScore = Math.max(...ranking.map((r) => r.score), 0.0001);
  const target = ranking.find((r) => r.eup === targetEup);
  const rows = MAP_PIECES.flatMap((piece) => {
    const row = ranking.find((item) => item.eup === piece.eup);
    return row ? [{ piece, row }] : [];
  });

  return (
    <div className="min-w-0">
      <div
        aria-label="지역별 소비 진단 3D 맵"
        className="relative overflow-hidden rounded-[26px] bg-[radial-gradient(circle_at_52%_34%,#ffffff_0%,#edf1ff_47%,#dce9f5_100%)] p-3.5 ring-1 ring-inset ring-white/80 sm:p-4"
      >
        {target ? (
          <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-admin-primary px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_5px_14px_-6px_rgb(67_56_202)] sm:right-4 sm:top-4">
              <Icon name="flag" size={12} />
              {target.eup} 우선 검토
          </span>
        ) : (
          <span className="absolute right-3 top-3 z-10 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line sm:right-4 sm:top-4">
            전 지역 공통 적용
          </span>
        )}

        <svg
          role="img"
          aria-labelledby="consumption-map-title consumption-map-desc"
          viewBox="0 0 620 360"
          className="block h-auto min-h-[232px] w-full sm:min-h-[260px]"
        >
          <title id="consumption-map-title">지역별 하이원포인트 소비 비중과 진단 스코어</title>
          <desc id="consumption-map-desc">
            강원 남부 6개 지역의 위치 관계를 3D 스타일로 표현한 개념도입니다. 각 다각형의 큰 숫자는 전 기간 하이원포인트 사용 비중입니다.
          </desc>
          <defs>
            <filter id="map-lift" x="-20%" y="-20%" width="140%" height="160%">
              <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#27335b" floodOpacity="0.2" />
            </filter>
            <linearGradient id="map-floor" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#c9d7f0" stopOpacity="0.38" />
            </linearGradient>
          </defs>

          <path
            aria-hidden
            d="M42 110C145 23 298 14 440 48c77 18 120 75 128 144-103 110-314 142-486 66C37 220 20 160 42 110Z"
            fill="url(#map-floor)"
          />
          <path
            aria-hidden
            d="M74 282c115 31 338 27 462-36M115 90c80-45 274-62 392-5M83 220c101 31 338 15 469-47"
            fill="none"
            stroke="#a5b7dc"
            strokeDasharray="3 9"
            strokeOpacity="0.52"
          />

          {rows.map(({ piece, row }) => {
            const t = Math.max(0, Math.min(1, row.score / maxScore));
            const isTarget = row.eup === targetEup;
            const isCandidate = selectedEups.includes(row.eup) && !isTarget;
            const sharePct = Math.round((shares[row.eup] ?? 0) * 100);
            const strongText = isTarget || t > 0.64;
            const textFill = strongText ? "#ffffff" : "#232b4b";
            const subTextFill = strongText ? "rgba(255,255,255,.8)" : "#55617e";
            return (
              <g
                key={row.eup}
                role="group"
                aria-label={`${row.eup}, 사용 비중 ${sharePct}%, 1단계 진단 ${row.rank}순위, 종합 스코어 ${row.score.toFixed(2)}`}
                data-tooltip={`${row.eup} · 사용 비중 ${sharePct}% · 진단 ${row.rank}순위`}
                filter="url(#map-lift)"
                className="cursor-default"
              >
                <polygon points={lowerPoints(piece.points)} fill={sideColor(t, isTarget)} />
                <polygon
                  points={piece.points}
                  fill={scoreColor(t, isTarget)}
                  stroke={isTarget ? "#312e81" : "rgba(255,255,255,.92)"}
                  strokeWidth={isTarget ? 3 : 2}
                  strokeLinejoin="round"
                />
                {isCandidate ? (
                  <polygon
                    points={piece.points}
                    fill="none"
                    stroke="#4f46e5"
                    strokeDasharray="5 5"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                ) : null}
                <g transform={`translate(${piece.label.x} ${piece.label.y})`} textAnchor="middle">
                  <text y="-22" fill={textFill} fontSize="12" fontWeight="700">
                    {row.eup}
                  </text>
                  <text y="4" fill={textFill} fontSize="28" fontWeight="800" letterSpacing="-1.2">
                    {sharePct}%
                  </text>
                  <text y="21" fill={subTextFill} fontSize="10" fontWeight="700">
                    사용 비중 · 진단 {row.rank}순위
                  </text>
                  {isTarget ? (
                    <text y="-39" fill="#ffffff" fontSize="10" fontWeight="800">
                      제안 대상
                    </text>
                  ) : null}
                </g>
                {row.eup === "고한읍" ? (
                  <g
                    role="img"
                    aria-label={`거점 ${ANCHOR.name}`}
                    transform={`translate(${piece.label.x + 47} ${piece.label.y - 36})`}
                  >
                    <circle r="7" fill="#f4c542" stroke="#ffffff" strokeWidth="3" />
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>

        <div className="relative mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/80 px-1 pt-3 text-[10px] text-admin-text-muted">
          <span className="font-semibold">진단 스코어</span>
          <span
            aria-hidden
            className="h-1.5 min-w-[84px] flex-1 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${scoreColor(0, false)}, ${scoreColor(1, false)}, ${scoreColor(1, true)})`,
            }}
          />
          <span>낮음 → 높음</span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#f4c542] ring-2 ring-white" />
            거점 {ANCHOR.name}
          </span>
        </div>
      </div>

      <p className="u-note mt-2.5 flex items-start gap-1.5">
        <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
        <span>
          실제 행정경계가 아닌 3D 위치 관계도입니다. 큰 %는 전 기간 하이원포인트 사용 비중이며, 다각형 색은 1단계 진단 스코어입니다.
        </span>
      </p>
    </div>
  );
}

/** 6지역 고정 순서를 유지한 사용 비중 맵. */
export const shareMap = (rows: { region: string; share: number }[]): Record<string, number> =>
  Object.fromEntries(REGIONS.map((r) => [r, rows.find((x) => x.region === r)?.share ?? 0]));
