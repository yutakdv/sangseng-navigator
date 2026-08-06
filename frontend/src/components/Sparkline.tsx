/**
 * KPI 타일용 미니 추이선 (docs/plan/13 §5·§6).
 *
 * Recharts를 쓰지 않는다 — 타일 4장에 각각 차트를 붙이면 그만큼 `"use client"` 경계가 생기고
 * 허브 전체가 클라이언트 번들로 끌려간다. 여기는 이미 집계된 12개 숫자를 SVG path 하나로
 * 그리는 게 전부라 **서버 컴포넌트로 렌더**하고 브라우저 JS를 0으로 둔다.
 *
 * 그리기 방식:
 * - viewBox 고정(100×34) + `preserveAspectRatio="none"`으로 폭에 맞춰 늘리고,
 *   선만 `vector-effect="non-scaling-stroke"`로 두께를 지킨다 (늘려도 선이 굵어지지 않는다)
 * - `pathLength={1}`을 주면 실제 경로 길이와 무관하게 dasharray 1로 왼쪽부터 그려지는
 *   전환을 CSS만으로 걸 수 있다 (`animate-draw`). 모션 축소 설정은 globals.css가 전역으로 끈다
 *
 * ⚠ 이 그래프는 **장식이 아니라 KPI 값의 12개월 문맥**이다. 값·기간을 읽어야 하는 자리에는
 *    타일 본문의 숫자와 각주가 따로 붙고, 여기서는 방향만 전달한다 (`aria-hidden`).
 */
export function Sparkline({
  data,
  /**
   * SVG 그라디언트 id — 타일마다 다른 **ASCII 슬러그**를 준다.
   * ⚠ 한글·공백이 들어가면 `url(#지역 전환율)`이 파싱되지 않아 fill이 검정으로 떨어진다.
   */
  id,
  color = "#8B7BF0",
  height = 40,
  /** 면 채움 없이 선만 (밝은 배경 위 보조 표기용) */
  bare = false,
}: {
  data: number[];
  id: string;
  color?: string;
  height?: number;
  bare?: boolean;
}) {
  if (data.length < 2) return null;

  const gid = `spark-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const W = 100;
  const H = 34;
  const PAD = 4; // 위아래 여백 — 최고·최저점이 잘리지 않게

  const min = Math.min(...data);
  const max = Math.max(...data);
  // 전 구간이 같은 값이면 0으로 나눈다 — 그때는 가운데 수평선으로 그린다
  const span = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      aria-hidden
      className="block overflow-visible"
    >
      {bare ? null : (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
        </>
      )}
      {/*
       * ⚠ 여기에 dasharray 그리기 애니메이션(`animate-draw` + `[stroke-dasharray:1]`)을 걸면
       *    Chromium에서 선이 **중간중간 끊겨서** 그려진다. `preserveAspectRatio="none"`로 가로만
       *    ~4배 늘린 좌표계인데 `vector-effect: non-scaling-stroke`는 선을 화면 좌표로 그리기
       *    때문에, dash 길이는 늘어나기 전 경로 기준으로 계산되고 실제 렌더는 늘어난 뒤에 일어나
       *    둘이 어긋난다. 등장 연출은 선을 자르지 않는 페이드로만 준다.
       */}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="animate-fade-up"
      />
      {/* 마지막 점 = 현재 값. 원은 늘어난 좌표계에서 타원이 되므로 반지름 대신
          non-scaling-stroke를 준 점(길이 0인 선)으로 그린다 */}
      <path
        d={`M${last[0].toFixed(2)} ${last[1].toFixed(2)}h0`}
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
