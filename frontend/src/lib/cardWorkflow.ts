import type {
  AllowedProgressOption,
  Card,
  CardProgress,
  CardStatus,
  CandidateVerification,
  EligibilityCheck,
  EligibilityCheckStatus,
} from "@/types";

export const REQUIRED_ELIGIBILITY_CHECKS = [
  "영업 상태",
  "가맹 자격",
  "사업자 참여 의향",
  "관광객 이용 적합성",
  "정산 연동 가능성",
] as const;

/**
 * 단계 **표시 순서**. 전이 가능 여부는 서버가 `allowed_next_progress`로 판정하고, 이 배열은
 * 진행 막대·칩 색·리포트 상태 분포가 쓰는 순서 정본으로만 남는다 (05 §2).
 */
export const EXPANSION_PROGRESS: CardProgress[] = [
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "추진중",
  "보류",
  "완료",
];

export const INCENTIVE_PROGRESS: CardProgress[] = ["검토중", "추진중", "보류", "완료"];

export function normalizeEligibility(
  verification?: CandidateVerification,
): EligibilityCheck[] {
  const byLabel = new Map<string, EligibilityCheckStatus>();
  for (const raw of verification?.checks ?? []) {
    if (typeof raw === "string") {
      byLabel.set(raw, "unverified");
      continue;
    }
    byLabel.set(raw.label, raw.status);
  }
  return REQUIRED_ELIGIBILITY_CHECKS.map((label) => ({
    key: label,
    label,
    status: byLabel.get(label) ?? "unverified",
  }));
}

export function eligibilityStatus(card: Card): "unverified" | "verified" | "ineligible" | "not_applicable" {
  if (card.type !== "EXPANSION") return "not_applicable";
  const checks = normalizeEligibility(card.candidate_verification);
  if (checks.some((check) => check.status === "failed")) return "ineligible";
  if (checks.every((check) => check.status === "verified")) return "verified";
  return "unverified";
}

export const isEligibilityVerified = (card: Card): boolean =>
  card.type !== "EXPANSION" || eligibilityStatus(card) === "verified";

export function normalizedProgress(card: Card): CardProgress | null {
  if (card.type === "EXPANSION" && card.progress === "검토중") return "후보 접촉·검토 시작";
  return card.progress;
}

/**
 * 승인 카드를 6스텝 흐름(PolicyFlow)의 STEP4·STEP5로 가르는 기준.
 *
 * STEP4 "검토 시작"은 후보 접촉 단계에 머문 카드, STEP5 "적격성·실행"은 적격성 확인·가맹 심사·
 * 추진중처럼 실제 실행에 들어간 카드다. 예전에는 STEP4가 승인 전체를 세고 STEP5는 `추진중`만
 * 세어, 적격성 확인·가맹 심사 단계의 카드가 STEP4에 중복으로 잡히면서 STEP5에서는 통째로
 * 빠졌다 — 데모 6단계에서 단계를 하나씩 올리는 동안 두 구간에서 건수가 0으로 사라진다.
 * 두 함수는 배타적이라 `isStartStage + isExecutionStage + 완료 = 승인 카드 총수`가 항상 성립한다.
 *
 * `progress`가 비어 있는 승인 카드는 `workflowLabel`과 같은 기준으로 검토 시작으로 본다 (05 §2).
 * `보류`는 완료도 검토 시작도 아니므로 STEP5에 남긴다 — 어느 스텝에도 안 잡혀 사라지는 편보다 낫다.
 */
const START_STAGES = new Set<CardProgress>(["후보 접촉·검토 시작", "검토중"]);

export const isStartStage = (card: Card): boolean => {
  const progress = normalizedProgress(card);
  return progress === null || START_STAGES.has(progress);
};

export const isExecutionStage = (card: Card): boolean => {
  const progress = normalizedProgress(card);
  return progress !== null && !START_STAGES.has(progress) && progress !== "완료";
};

/**
 * 추진 상태 선택지 — **판정은 서버가 지고 화면은 표시만 한다.**
 *
 * 예전에는 여기서 적격성 게이트만 복제했는데, 순차 전이·보류 재개 규칙은 복제하지 못해
 * 셀렉트가 서버가 거부할 단계를 정상 선택지로 보여준 뒤 사용자가 고르면 409가 났다.
 * 지금은 카드 응답의 `allowed_next_progress`를 그대로 쓰고, 이 함수는 **표시 순서**만 입힌다.
 *
 * 서버 목록이 없는 응답(구형 배포)에서는 전부 선택 가능으로 둔다 — 화면이 다시 규칙을 지어내는
 * 것보다, 서버가 이유와 함께 거부하게 두는 편이 낫다.
 */
export function progressOptions(card: Card): AllowedProgressOption[] {
  const order = card.type === "EXPANSION" ? EXPANSION_PROGRESS : INCENTIVE_PROGRESS;
  const fromServer = card.allowed_next_progress;
  if (!fromServer?.length) return order.map((value) => ({ value, allowed: true }));
  const byValue = new Map(fromServer.map((option) => [option.value, option]));
  return order.map((value) => byValue.get(value) ?? { value, allowed: true });
}

/**
 * 허용은 됐지만 **이 경로로는** 만들 수 없는 단계인지 — 서버가 허용과 함께 이유를 실어 준 항목이다.
 * `완료`가 그렇다(증빙이 필요해 추진 기록으로만 남긴다). 빠른 상태 변경은 이 항목을 고른 순간
 * 요청을 보내지 않고 그 이유를 보여 줘야 한다 — 보내면 422다.
 */
export const needsRecordForm = (option: AllowedProgressOption): boolean =>
  option.allowed && Boolean(option.reason);

/**
 * 결정에 사유가 **필수**인지 (05 §2·§8 — 누락은 422).
 *
 * 반려·보류는 신뢰도와 무관하게 항상 필요하고, 승인은 신뢰도가 `하`인 카드에서만 필요하다
 * (낮은 신뢰도를 근거 없이 통과시키지 않기 위한 게이트라 여기서는 "확인 근거"라 부른다).
 */
export const isBlockingDecision = (decision: CardStatus): boolean =>
  decision === "rejected" || decision === "held";

export const decisionReasonRequired = (
  decision: CardStatus,
  confidence: Card["confidence"],
): boolean => isBlockingDecision(decision) || (decision === "approved" && confidence === "하");

/** 반려·보류 시 같은 타깃을 다시 제안하지 않는 기본 기간(분기 의사결정 주기) */
export const DEFAULT_COOLDOWN_DAYS = 90;
export const MAX_COOLDOWN_DAYS = 365;

export function workflowLabel(card: Card): string {
  if (card.status === "pending") return "담당자 결정 대기";
  if (card.status === "held") return "보류";
  if (card.status === "rejected") return "부적격 또는 반려";
  if (card.type === "EXPANSION" && eligibilityStatus(card) === "ineligible") return "부적격";
  return normalizedProgress(card) ?? (card.type === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");
}

export function decisionPrimaryLabel(cardType: Card["type"]): string {
  return cardType === "EXPANSION" ? "후보 접촉·검토 시작" : "정책안 승인";
}

/**
 * 표본 수로 지표 신뢰 수준을 가른다 — **어떤 수를 넣는지는 호출부가 지표에 맞게 고른다.**
 * 지역 균형지수는 승인 총계가 아니라 KPI의 `balance_sample_count`를 넣어야 한다
 * (승인 총계는 인센티브를 포함해 그 지수의 표본이 아니다 — 05 §3).
 */
export function sampleQuality(sample: number): "demo" | "limited" | "sufficient" {
  if (sample <= 3) return "demo";
  if (sample < 30) return "limited";
  return "sufficient";
}
