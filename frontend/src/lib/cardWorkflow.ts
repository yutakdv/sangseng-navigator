import type {
  Card,
  CardProgress,
  CardType,
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

/**
 * 서버 `workflow.can_set_progress`의 FE 미러 — 지금 상태에서 저장이 통과할 상태만 돌려준다.
 *
 * 서버 규칙(backend/app/services/workflow.py): ① 동일 상태 재기록 허용 ② 순방향 한 단계만
 * ③ 시작 후에는 언제든 보류 가능 ④ 보류 해제는 직전 단계로만 ⑤ 완료는 되돌리기 불가
 * ⑥ EXPANSION은 적격성 5항목 충족 전에 적격성 확인 이후 단계 잠금.
 * 여기 결과는 셀렉트 옵션을 미리 닫는 편의 장치일 뿐, 최종 방어선은 서버 409다 —
 * 두 구현이 어긋나면 기존 인라인 에러로 떨어지므로 오동작이 아니라 문구로 읽힌다.
 */
export function allowedProgress(opts: {
  cardType: CardType;
  /** 정규화된 현재 상태 (EXPANSION의 검토중은 후보 접촉·검토 시작으로 읽는다) */
  current: CardProgress | null;
  /** 보류 진입 직전 상태 — card.progress_before_hold */
  beforeHold: CardProgress | null;
  verified: boolean;
}): Set<CardProgress> {
  const list = opts.cardType === "EXPANSION" ? EXPANSION_PROGRESS : INCENTIVE_PROGRESS;
  const flow = list.filter((s) => s !== "보류");
  const ok = new Set<CardProgress>();
  const cur = opts.current;
  if (cur) ok.add(cur);
  if (cur === "완료") return ok;
  if (cur === "보류") {
    if (opts.beforeHold) ok.add(opts.beforeHold);
  } else {
    const next = cur ? flow[flow.indexOf(cur) + 1] : flow[0];
    if (next) ok.add(next);
    if (cur) ok.add("보류");
  }
  if (opts.cardType === "EXPANSION" && !opts.verified) {
    for (const s of VERIFIED_REQUIRED) ok.delete(s);
  }
  return ok;
}

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
  if (card.status === "pending") return "담당자 결정 대기";
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
