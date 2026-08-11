import type { ReactNode } from "react";
import type { CardProgress } from "@/types";

/**
 * 좁은 칸(사이드 패널)에서만 쓰는 축약 이름 — 전체 이름이 세 줄로 접히면 숫자보다 라벨이
 * 커져 트랙이 읽히지 않는다. 접근성 이름(title·sr-only)은 항상 전체 이름을 유지한다.
 */
const SHORT_LABEL: Partial<Record<CardProgress, string>> = {
  "후보 접촉·검토 시작": "후보 접촉",
  "적격성 확인": "적격성",
};

/**
 * 추진 단계 분포 — **순서가 있는 트랙**. 허브(정책 나침반)와 추진 경과 리포트가 함께 쓴다.
 *
 * 두 화면이 같은 단계 데이터를 서로 다른 그림(허브: 누적 막대 + 칩 / 리포트: 트랙)으로
 * 그리던 것을 하나로 모았다. 같은 값을 다른 시각 언어로 두 번 그리면 담당자가 두 화면을
 * 다른 지표로 읽는다. 두 화면의 **모집단**은 다르므로(허브=승인 카드의 현재 상태,
 * 리포트=기간 내 경과 기록) 그림만 공유하고 무엇을 센 값인지는 `meta`로 각자 적는다.
 *
 * 그리는 규칙 (13 §4·§5):
 * - 단계를 같은 폭 칸으로 한 줄에 세우고 칸 사이를 가는 선으로 이어 흐름을 형태로 보여 준다.
 * - 건수가 주인공이라 큰 숫자를 위에, 단계 이름을 아래 보조로 둔다.
 * - 0건은 물러난다(무채색 + 빈 진행선). 값이 있는 칸만 라벤더, 완료는 초록, 보류는 앰버.
 * - `보류`는 흐름 밖(이탈)이라 세로 구분선 뒤로 떼어 놓는다.
 */
export function StageTrack({
  title,
  stages,
  counts,
  meta,
  compact = false,
}: {
  title: string;
  /** 표시 순서 — 보류가 섞여 있으면 자동으로 흐름 밖으로 뺀다 */
  stages: CardProgress[];
  counts: Partial<Record<CardProgress, number>>;
  /** 우상단 보조 표기 — 이 트랙이 무엇을 센 값인지 (예: "기록 2건" · "카드 3장") */
  meta?: ReactNode;
  /** 좁은 칸에 놓일 때 — 단계 이름을 축약해 한 줄로 유지한다 */
  compact?: boolean;
}) {
  const path = stages.filter((stage) => stage !== "보류");
  const hasHold = stages.includes("보류");
  const holdCount = counts["보류"] ?? 0;

  return (
    <div className="rounded-xl bg-admin-surface-sunken px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-bold text-admin-text">{title}</h3>
        {meta ? <span className="text-[11px] text-admin-text-muted">{meta}</span> : null}
      </div>

      <div className="mt-2.5 flex items-stretch gap-2">
        {/* 진행 순서 — ol이라 스크린리더에도 "몇 번째 단계"가 그대로 전달된다.
            좁은 화면에서도 가로 스크롤로 밀지 않는다: 값이 있는 단계는 흐름의 뒤쪽(추진중·완료)에
            몰리는데, 스크롤로 감추면 첫 화면에 0건만 남아 "아무것도 진행되지 않았다"로 읽힌다.
            대신 칸을 줄이고 단계 이름을 두 줄로 접는다 — 칸이 한눈에 다 보이는 쪽이 낫다. */}
        <ol className="flex min-w-0 flex-1 gap-0">
          {path.map((stage, i) => (
            <StageCell
              key={stage}
              stage={stage}
              count={counts[stage] ?? 0}
              first={i === 0}
              last={i === path.length - 1}
              compact={compact}
            />
          ))}
        </ol>

        {hasHold ? (
          <>
            <span aria-hidden className="w-px shrink-0 self-stretch bg-admin-border" />
            <StageCell stage="보류" count={holdCount} standalone compact={compact} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 트랙의 칸 하나 — 건수(주)와 단계 이름(보조), 그리고 그 아래를 지나는 진행선.
 * 진행선은 칸의 좌우 절반을 따로 그린다: 첫 칸의 왼쪽 절반과 끝 칸의 오른쪽 절반을 비워
 * 트랙이 허공에서 시작하거나 끝나지 않게 하기 위해서다.
 */
function StageCell({
  stage,
  count,
  first = false,
  last = false,
  standalone = false,
  compact = false,
}: {
  stage: CardProgress;
  count: number;
  first?: boolean;
  last?: boolean;
  /** 흐름 밖 단계(보류) — 진행선을 잇지 않는다 */
  standalone?: boolean;
  compact?: boolean;
}) {
  const label = (compact && SHORT_LABEL[stage]) || stage;
  const filled = count > 0;
  // 완료만 상태색(초록)을 갖는다 — 나머지 진행 단계는 브랜드 라벤더, 0건은 무채색으로 물러난다
  const tone = !filled
    ? "text-admin-text-muted"
    : stage === "완료"
      ? "text-state-good"
      : stage === "보류"
        ? "text-state-warn"
        : "text-admin-primary";
  const rail = !filled
    ? "bg-admin-border"
    : stage === "완료"
      ? "bg-state-good"
      : stage === "보류"
        ? "bg-state-warn"
        : "bg-admin-primary";

  return (
    // 가로 여백은 li가 아니라 글자에만 준다 — li에 주면 진행선까지 안쪽으로 밀려 칸 경계마다
    // 선이 끊기고, 이어진 흐름이 아니라 토막난 막대 여섯 개로 보인다
    <li
      className={`flex flex-col items-center gap-1 ${
        standalone ? "shrink-0 px-2 sm:px-3" : "min-w-0 flex-1 basis-0"
      }`}
    >
      <span className={`text-[19px] font-bold leading-none tabular-nums ${tone}`}>{count}</span>
      <span
        title={label === stage ? undefined : stage}
        className={`break-keep px-1 text-center text-[11px] leading-4 sm:px-2.5 ${
          filled ? "font-semibold text-admin-text" : "text-admin-text-muted"
        }`}
      >
        {/* 축약해도 스크린리더·툴팁에는 전체 단계 이름이 남는다 */}
        {label === stage ? stage : <><span aria-hidden>{label}</span><span className="sr-only">{stage}</span></>}
      </span>
      {/* 진행선 — 점(현재 칸)과 이음선(이웃 칸으로).
          `mt-auto`로 칸 바닥에 붙인다: 단계 이름의 줄 수가 칸마다 달라(좁은 화면에서 특히)
          그냥 두면 선이 칸마다 다른 높이에 떠서 트랙이 계단처럼 어긋난다 */}
      <span aria-hidden className="mt-auto flex h-2 w-full items-center pt-1">
        <span className={`h-px flex-1 ${first || standalone ? "bg-transparent" : rail}`} />
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${rail}`} />
        <span className={`h-px flex-1 ${last || standalone ? "bg-transparent" : rail}`} />
      </span>
    </li>
  );
}
