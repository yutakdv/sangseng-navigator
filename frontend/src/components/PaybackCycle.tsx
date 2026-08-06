import { PRIMARY } from "@/lib/constants";
import type { PaybackRate } from "@/types";

/**
 * 페이백 순환 구조 다이어그램 — 적립 → 외부 사용 → 페이백 → 재사용 (docs/plan/08 F6).
 *
 * ⚠ 표현 규칙(05 §2 필수): 하이원포인트는 카지노 게임 참여에 비례해 적립되는 콤프다.
 * 따라서 적립·지급이 늘어나는 것으로 읽히는 **발행액 증액 뉘앙스의 표현을 쓰지 않는다** —
 * 이 정책이 손대는 구간은 사용 단계(②→③)뿐이고 적립(①)은 기존 제도 그대로다.
 * 그 사실이 캡션에서 바로 읽히도록 다이어그램과 캡션을 한 컴포넌트로 묶었다.
 *
 * 정적 인라인 SVG라 차트 라이브러리도, `"use client"`도 필요 없다.
 */
const W = 252; // 노드 박스 크기
const H = 112;
const MUTED = "#6E6C7A";
const TEXT = "#2B2833";
const LINE = "#94a3b8";

export function PaybackCycle({ rate = null }: { rate?: PaybackRate | null }) {
  return (
    <div>
      {/* 390px에서 640 폭 그림을 그대로 축소하면 노드 설명(11.5px)이 6px까지 줄어 읽히지 않는다.
          13 §8 원칙대로 그림만 자기 컨테이너 안에서 가로 스크롤하고 본문은 밀리지 않게 한다 */}
      <div className="overflow-x-auto">
        <div className="mx-auto min-w-[600px] max-w-[640px]">
          <svg
            viewBox="0 0 640 318"
            className="h-auto w-full"
            role="img"
            aria-labelledby="payback-cycle-title payback-cycle-desc"
          >
            <title id="payback-cycle-title">하이원포인트 지역 결제 페이백 순환 구조</title>
            <desc id="payback-cycle-desc">
              ① 적립(카지노 게임 참여에 비례한 콤프, 적립률·발행액은 그대로) → ② 외부 사용(리조트
              밖 지역 가맹점에서 하이원포인트로 결제) → ③ 페이백(지역 결제분에 한정한 사용 단계
              리워드) → ④ 재사용(리워드가 다시 지역 가맹점에서 쓰이며 지역 소비로 순환). 이 정책이
              바꾸는 구간은 ②에서 ③으로 가는 사용 단계뿐이며 적립 단계는 손대지 않는다.
            </desc>

            <defs>
              <marker
                id="payback-arrow"
                markerUnits="userSpaceOnUse"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
              >
                <path d="M0,0 L8,5 L0,10 z" fill={LINE} />
              </marker>
              <marker
                id="payback-arrow-on"
                markerUnits="userSpaceOnUse"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
              >
                <path d="M0,0 L8,5 L0,10 z" fill={PRIMARY} />
              </marker>
            </defs>

            {/* ①→② 위쪽, ③→④ 아래쪽, ④→① 왼쪽은 기존 흐름 — 회색 */}
            <line x1="282" y1="70" x2="356" y2="70" stroke={LINE} strokeWidth="1.5" markerEnd="url(#payback-arrow)" />
            <line x1="356" y1="246" x2="282" y2="246" stroke={LINE} strokeWidth="1.5" markerEnd="url(#payback-arrow)" />
            <line x1="150" y1="182" x2="150" y2="132" stroke={LINE} strokeWidth="1.5" markerEnd="url(#payback-arrow)" />

            {/* ②→③ 이 카드가 손대는 유일한 구간 — 강조 (색만으로 의미를 전달하지 않도록 라벨 병기) */}
            <line x1="490" y1="132" x2="490" y2="182" stroke={PRIMARY} strokeWidth="2.5" markerEnd="url(#payback-arrow-on)" />
            <text x="502" y="162" fontSize="12" fontWeight="600" fill={PRIMARY}>
              정책 적용 구간
            </text>

            <CycleNode
              x={24}
              y={14}
              title="① 적립"
              lines={["카지노 게임 참여에 비례한 콤프", "적립률·발행액은 그대로"]}
            />
            <CycleNode
              x={364}
              y={14}
              title="② 외부 사용"
              lines={["리조트 밖 지역 가맹점에서", "하이원포인트로 결제"]}
            />
            <CycleNode
              x={364}
              y={190}
              title="③ 페이백"
              lines={[
                "지역 결제분에 한정한 사용 리워드",
                rate ? `확정 페이백률 ${rate}%` : "승인 시 담당자가 3·5·7% 중 선택",
              ]}
              accent
            />
            <CycleNode
              x={24}
              y={190}
              title="④ 재사용"
              lines={["리워드가 다시 지역 가맹점에서", "쓰이며 지역 소비로 순환"]}
            />
          </svg>
        </div>
      </div>

      {/* 05 §2: 발행액 증액으로 읽히는 여지를 캡션에서 차단한다 */}
      <p className="u-body mt-4 rounded-xl bg-admin-surface-sunken p-3.5">
        이 정책이 손대는 구간은 <b className="font-bold">②→③ 사용 단계뿐</b>입니다. 적립(①)은 기존
        제도 그대로여서 <b className="font-bold">콤프 발행액은 늘지 않습니다</b> — 이미 적립된
        포인트를 지역 가맹점에서 결제할 때만 리워드가 붙는 설계입니다.
      </p>
      <p className="u-note mt-2">
        하이원포인트는 카지노 게임 참여시간·베팅액에 비례해 적립되는 콤프라, 적립률을 올리거나
        포인트를 더 지급하는 설계는 이 카드의 제안 대상이 아닙니다. 게임 참여 유인은 그대로 두고
        사용처만 지역으로 돌리는 수요 측 정책입니다.
      </p>
    </div>
  );
}

function CycleNode({
  x,
  y,
  title,
  lines,
  accent = false,
}: {
  x: number;
  y: number;
  title: string;
  lines: string[];
  accent?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={W}
        height={H}
        rx={14}
        fill={accent ? "#F6F4FE" : "#F5F4F8"}
        stroke={accent ? PRIMARY : "#E7E5EE"}
        strokeWidth={accent ? 1.75 : 1.25}
      />
      <text x={x + 18} y={y + 34} fontSize="16" fontWeight="700" fill={accent ? PRIMARY : TEXT}>
        {title}
      </text>
      {lines.map((line, i) => (
        <text key={line} x={x + 18} y={y + 61 + i * 21} fontSize="12.5" fill={MUTED}>
          {line}
        </text>
      ))}
    </g>
  );
}
