import type {
  Card,
  CardProgress,
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

export const EXPANSION_PROGRESS: CardProgress[] = [
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "추진중",
  "보류",
  "완료",
];

export const INCENTIVE_PROGRESS: CardProgress[] = ["검토중", "추진중", "보류", "완료"];

const VERIFIED_REQUIRED = new Set<CardProgress>(["적격성 확인", "가맹 심사", "추진중", "완료"]);

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

export function progressOptions(card: Card): { value: CardProgress; disabled: boolean; reason?: string }[] {
  const verified = isEligibilityVerified(card);
  const options = card.type === "EXPANSION" ? EXPANSION_PROGRESS : INCENTIVE_PROGRESS;
  return options.map((value) => ({
    value,
    disabled: card.type === "EXPANSION" && VERIFIED_REQUIRED.has(value) && !verified,
    reason:
      card.type === "EXPANSION" && VERIFIED_REQUIRED.has(value) && !verified
        ? "필수 적격성 5개 항목 확인 후 선택 가능"
        : undefined,
  }));
}

export function workflowLabel(card: Card): string {
  if (card.status === "pending") return "AI 제안 생성";
  if (card.status === "held") return "보류";
  if (card.status === "rejected") return "부적격 또는 반려";
  if (card.type === "EXPANSION" && eligibilityStatus(card) === "ineligible") return "부적격";
  return normalizedProgress(card) ?? (card.type === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");
}

export function decisionPrimaryLabel(cardType: Card["type"]): string {
  return cardType === "EXPANSION" ? "후보 접촉·검토 시작" : "정책안 승인";
}

export function sampleQuality(sample: number): "demo" | "limited" | "sufficient" {
  if (sample <= 3) return "demo";
  if (sample < 30) return "limited";
  return "sufficient";
}
