import type { Card, Simulation } from "@/types";

/**
 * 설명 문구 출처 표기 3종 (05 §2 grounding).
 *
 * LLM 호출이 실패해도 카드는 규칙 기반으로 만들어지고(07 B3 fallback), 데모 시드 카드는
 * 애초에 사람이 실데이터로 검증해 고정한 문구다. 그 사실을 화면에서 감추면 "AI가 한 일"을
 * 과장하게 되므로 세 종류를 항상 갈라 놓는다 (절대 규칙 4의 연장 — AI는 제안만 한다).
 */
export type NarrativeSourceKind = "ai" | "rule_fallback" | "rule_reference";

/** 칩 라벨과 툴팁 고지 문구 — 화면에서 문자열을 새로 쓰지 말고 이 상수를 쓴다 (13 §9) */
export const NARRATIVE_SOURCE_TEXT: Record<NarrativeSourceKind, { label: string; note: string }> = {
  ai: {
    label: "AI 생성 · 서버 검증됨",
    note: "비정량 리스크·유의사항 문구만 AI가 작성했고, 후보명·Score·순위·추진 상태·도로 시간은 서버가 정본 데이터로 다시 만들었습니다.",
  },
  rule_fallback: {
    label: "규칙 기반 설명(AI 응답 없음)",
    note: "AI 응답을 받지 못해 설명 문구까지 서버 규칙으로 작성했습니다. 후보 선택과 수치는 원래부터 서버 정량 규칙이 담당합니다.",
  },
  rule_reference: {
    label: "사전 검증 예시 문구",
    note: "실데이터로 사전 검증해 둔 예시 문구입니다. AI 호출 없이 서버 규칙으로 작성했습니다.",
  },
};

/**
 * 판정 순서가 계약이다 — "AI"를 먼저 보고, 그다음 사전 검증 예시, 마지막이 폴백이다.
 *
 * 계약에 없는 값이면 `null`을 돌려 칩 자체를 그리지 않는다. 모르는 출처를 "AI"라고 부르는 것이
 * 이 장치가 막으려는 바로 그 오류이기 때문이다. 배포 전 저장소에 남아 있는 구형 카드(grounding
 * 필드 없음)도 이 경로로 떨어져 조용히 칩만 빠진다.
 */
function fold(source?: string, status?: string): NarrativeSourceKind | null {
  if (source === "llm" || status === "ai_generated_unverified") return "ai";
  if (source === "rule_seed" || source === "mock_rule") return "rule_reference";
  if (source === "rule_fallback" || source === "rule_based" || status === "rule_based") {
    return "rule_fallback";
  }
  return null;
}

export const cardNarrativeSource = (card: Card): NarrativeSourceKind | null =>
  fold(card.ai.grounding?.explanation_source, card.ai.grounding?.narrative_status);

export const simulationNarrativeSource = (sim: Simulation): NarrativeSourceKind | null =>
  fold(sim.narrative_source);
