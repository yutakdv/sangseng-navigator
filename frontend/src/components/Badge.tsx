import { Icon } from "@/components/Icon";
import { NARRATIVE_SOURCE_TEXT, type NarrativeSourceKind } from "@/lib/aiSource";
import { ASSUMPTION_NOTE } from "@/lib/constants";

/**
 * 고지 배지 (docs/plan/13 §9 — 절대 규칙 2·3의 화면 구현).
 * 문구를 화면에서 새로 쓰지 말고 이 컴포넌트를 쓴다.
 *
 * 11px 텍스트만 있던 배지에 ⓘ 아이콘과 얇은 테두리를 더했다 — 회색 알약이 여러 개 붙어 있으면
 * 무엇이 "고지"이고 무엇이 "상태"인지 구분되지 않아서, 고지 계열(근사 지표·가정 기반 전망)만
 * 아이콘을 달아 한눈에 갈라 놓는다. 배지 크기도 12px로 올렸다 (13 §6의 12px 기준).
 */

const base =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap align-middle ring-1 ring-inset";

/**
 * `근사 지표` — "지역 전환율"이 보이는 **모든 위치**에 붙인다.
 * `note`(= dashboard.conversion.proxy_note)는 요약·의역 없이 그대로 title 툴팁으로 노출한다.
 */
export function ProxyBadge({ note }: { note?: string }) {
  return (
    <span
      className={`${base} bg-state-notice-bg text-state-notice ring-state-notice-line`}
      title={note}
    >
      <Icon name="info" size={12} strokeWidth={2} />
      근사 지표
    </span>
  );
}

/** `가정 기반 전망` — 시뮬레이션·예상 효과·페이백 시나리오 출력 블록마다 */
export function AssumptionBadge() {
  return (
    <span
      className={`${base} bg-state-notice-bg text-state-notice ring-state-notice-line`}
      title={ASSUMPTION_NOTE}
    >
      <Icon name="info" size={12} strokeWidth={2} />
      가정 기반 전망
    </span>
  );
}

/** 배지만으로 막지 못하는 오인을 본문으로 차단 — 블록 하단 고정 문구 (절대 규칙 3) */
export function AssumptionNote({ className = "" }: { className?: string }) {
  return (
    <p className={`u-note flex items-start gap-1.5 ${className}`}>
      <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
      <span>{ASSUMPTION_NOTE}</span>
    </p>
  );
}

/**
 * 완료된 확충 카드의 (읍×업종)과 매칭되는 업종 — 점포 신설로 오인시키지 않는다.
 *
 * `pop`은 **라이브 미리보기(?live=1)에서만** 켠다. router.refresh는 바뀐 DOM만 갈아끼우므로
 * 그 모드에선 "새로 반영된 배지만" 등장 연출이 걸리지만, 일반 내비게이션(필터 칩 클릭 등)은
 * 목록 전체를 재마운트해 모든 배지가 한꺼번에 튀어 오른다 — 그래서 기본값은 꺼짐이다.
 */
export function NewBadge({ label = "이번 분기 확충 업종", pop = false }: { label?: string; pop?: boolean }) {
  return (
    <span
      className={`${base} bg-state-good-bg text-state-good ring-state-good-line ${pop ? "motion-safe:animate-pop" : ""}`}
    >
      <Icon name="sparkle" size={12} strokeWidth={2} />
      {label}
    </span>
  );
}

/** 페이백 배지 — 완료된 인센티브 카드가 있을 때만 (05 §4). `pop`은 NewBadge와 같은 규칙 */
export function PaybackBadge({ label, pop = false }: { label: string; pop?: boolean }) {
  return (
    <span
      className={`${base} whitespace-normal bg-visitor-primary-soft text-visitor-primary ring-visitor-primary/20 ${pop ? "motion-safe:animate-pop" : ""}`}
    >
      <Icon name="gift" size={12} strokeWidth={2} />
      {label}
    </span>
  );
}

/**
 * 집중도 등급 칩 — 값은 0~100 지수, 등급은 높음/보통/낮음 (05 §1).
 * 색만으로 의미를 전달하지 않도록 항상 등급 텍스트를 함께 쓴다 (13 §4).
 * "높음"은 소비 쏠림이 심하다는 뜻이라 주의색이고, 그 사실이 툴팁으로도 읽히게 한다.
 */
export function GradeChip({ grade }: { grade: string }) {
  const tone =
    grade === "높음"
      ? "bg-state-warn-bg text-state-warn ring-state-warn-line"
      : grade === "낮음"
        ? "bg-state-good-bg text-state-good ring-state-good-line"
        : "bg-state-notice-bg text-state-notice ring-state-notice-line";
  const hint =
    grade === "높음"
      ? "특정 지역에 소비가 몰려 있는 구간"
      : grade === "낮음"
        ? "소비가 비교적 고르게 퍼져 있는 구간"
        : "중간 구간";
  return (
    <span className={`${base} ${tone}`} title={`지역 소비 집중도 등급 ${grade} — ${hint}`}>
      {grade === "높음" ? <Icon name="warn" size={12} strokeWidth={2} /> : null}
      {grade}
    </span>
  );
}

/**
 * 설명 출처 칩 — 같은 화면의 문장이 AI가 쓴 것인지 서버 규칙이 쓴 것인지 가른다 (05 §2).
 *
 * LLM 장애 시에도 카드는 규칙 기반으로 생성되고(07 B3 fallback) 데모 시드 카드는 사람이
 * 사전 검증한 문구다. 이 칩이 없으면 세 종류가 화면에서 똑같이 보여 AI의 역할이 과장된다.
 * 색이 아니라 **라벨**이 의미를 진다 (13 §4) — 문구는 `lib/aiSource.ts`가 단일 출처다.
 */
export function NarrativeSourceChip({ kind }: { kind: NarrativeSourceKind | null }) {
  if (!kind) return null;
  const { label, note } = NARRATIVE_SOURCE_TEXT[kind];
  const byAi = kind === "ai" || kind === "ai_partial";
  const tone = byAi
    ? "bg-admin-primary-soft text-admin-primary ring-admin-primary-line"
    : "bg-admin-surface-sunken text-admin-text-muted ring-admin-border";
  return (
    <span className={`${base} ${tone}`} title={note}>
      <Icon name={byAi ? "sparkle" : "info"} size={12} strokeWidth={2} />
      {label}
    </span>
  );
}
