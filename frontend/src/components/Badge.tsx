import { ASSUMPTION_NOTE } from "@/lib/constants";

/**
 * 고지 배지 (docs/plan/13 §9 — 절대 규칙 2·3의 화면 구현).
 * 문구를 화면에서 새로 쓰지 말고 이 컴포넌트를 쓴다.
 */

const base =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap align-middle";

/**
 * `근사 지표` — "지역 전환율"이 보이는 **모든 위치**에 붙인다.
 * `note`(= dashboard.conversion.proxy_note)는 요약·의역 없이 그대로 title 툴팁으로 노출한다.
 */
export function ProxyBadge({ note }: { note?: string }) {
  return (
    <span className={`${base} bg-state-notice-bg text-state-notice`} title={note}>
      근사 지표
    </span>
  );
}

/** `가정 기반 전망` — 시뮬레이션·예상 효과·페이백 시나리오 출력 블록마다 */
export function AssumptionBadge() {
  return (
    <span className={`${base} bg-state-notice-bg text-state-notice`} title={ASSUMPTION_NOTE}>
      가정 기반 전망
    </span>
  );
}

/** 배지만으로 막지 못하는 오인을 본문으로 차단 — 블록 하단 고정 문구 (절대 규칙 3) */
export function AssumptionNote({ className = "" }: { className?: string }) {
  return <p className={`text-xs text-admin-text-muted ${className}`}>{ASSUMPTION_NOTE}</p>;
}

/** `신규` — 완료된 확충 카드의 (읍×업종)과 매칭되는 가맹점 (05 §4) */
export function NewBadge() {
  return <span className={`${base} bg-state-good-bg text-state-good`}>신규</span>;
}

/** 페이백 배지 — 완료된 인센티브 카드가 있을 때만 (05 §4) */
export function PaybackBadge({ label }: { label: string }) {
  return <span className={`${base} bg-visitor-primary-soft text-visitor-primary`}>{label}</span>;
}

/**
 * 집중도 등급 칩 — 값은 0~100 지수, 등급은 높음/보통/낮음 (05 §1).
 * 색만으로 의미를 전달하지 않도록 항상 등급 텍스트를 함께 쓴다 (13 §4).
 */
export function GradeChip({ grade }: { grade: string }) {
  const tone =
    grade === "높음"
      ? "bg-state-warn-bg text-state-warn"
      : grade === "낮음"
        ? "bg-state-good-bg text-state-good"
        : "bg-state-notice-bg text-state-notice";
  return <span className={`${base} ${tone}`}>{grade}</span>;
}
