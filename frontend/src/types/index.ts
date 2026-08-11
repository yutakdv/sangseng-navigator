/**
 * API 응답 타입 — 정본은 docs/plan/05-api-contract.md.
 * 계약을 바꿔야 하면 05 문서를 먼저 고치고(→ scripts/sync-fe-static.sh 재실행 → 팀 공유) 여기를 맞춘다.
 */

export type Region = "고한읍" | "사북읍" | "정선군" | "태백시" | "영월군" | "삼척시";
export type DisplayCategory = "카페" | "음식점" | "편의점" | "숙박업" | "소매점" | "기타";

/* ── §1 진단·대시보드 ─────────────────────────────────────────── */

export interface ConversionMonthly {
  month: string;
  local_uses: number;
  /** 입장 연인원(교대 합산) — "입장객 수"가 아니다 (05 §1) */
  visitors: number;
  rate: number;
}

export interface Dashboard {
  updated_at: string;
  period_note: string;
  conversion: {
    headline_rate: number;
    /** true면 FE는 반드시 `근사 지표` 배지를 렌더한다 (절대 규칙 2) */
    is_proxy: boolean;
    /** 요약·의역 금지 — 그대로 노출 (05 §1) */
    proxy_note: string;
    monthly: ConversionMonthly[];
  };
  concentration: {
    index: number;
    grade: "높음" | "보통" | "낮음";
    monthly: { month: string; index: number }[];
  };
  category_dispersion: {
    index: number;
    monthly: { month: string; index: number }[];
  };
  region_share: { region: string; count: number; share: number }[];
  monthly_by_region: ({ month: string } & Record<string, number | string>)[];
  category_share: { category: string; count: number; share: number }[];
  growth: { mom_pct: number; qoq_pp: number };
  /** P8 민감도 top3_stable_ratio×100. 추천 순위가 가중치 변화에도 유지되는 비율. */
  ranking_stability?: number | null;
  /** 구형 응답 호환 별칭. 신규 화면은 ranking_stability를 우선한다. */
  ai_stability?: number | null;
  /**
   * 임팩트 히어로 근거 (v4.1 Phase 4). 옵셔널 — 구형 응답에는 없을 수 있어 화면은
   * `data.impact_meta &&` 가드로 감싼다. 화면에 그리는 숫자는 `per_pp_additional_uses` 하나뿐이고
   * 나머지 필드는 툴팁 근거 표기용이다.
   */
  impact_meta?: {
    basis: "count";
    annual_local_uses: number;
    annual_visitors: number;
    per_pp_additional_uses: number;
    /** 요약·의역 금지 — 그대로 노출 */
    note: string;
  };
  /** 소표본 셀 비공개·집계 반올림 고지 (v4.1 Phase 4·5, C2 셀 탐색기가 소비). 옵셔널. */
  privacy_meta?: PrivacyMeta;
}

/**
 * 소표본 보호 고지 — 파이프라인 P10이 dashboard.json·usage_monthly.json에 함께 싣는다.
 * 가맹점 k곳 미만인 (지역×표시업종) 셀은 개별 사업자가 역산될 수 있어 건수를 비공개 처리하고,
 * 영향받는 집계는 aggregate_rounding.unit 단위로 반올림해 발행한다.
 * `note`는 요약·의역 없이 그대로 노출한다 (lib/constants.ts PRIVACY_NOTE가 같은 문구).
 */
export interface PrivacyMeta {
  k: number;
  suppressed_cells: { eup: string; category: string }[];
  aggregate_rounding: { unit: number };
  note: string;
  /**
   * 반올림을 타지 않는 정본 총 사용 건수. **화면이 "지역 사용 건수" 총계로 표시하는 값은 이것뿐이다** —
   * 공개 배열의 count를 더해 총계를 만들지 않는다. 구형 응답에는 없어 옵셔널이다.
   */
  canonical_total?: number;
  /**
   * 배열별 count 합에서 canonical_total을 뺀 값(공개값 − 정본). 반올림이 만든 차이를 화면이
   * 설명할 수 있게 하는 근거이며 셋이 서로 다르다.
   */
  privacy_rounding_adjustment?: {
    region_share: number;
    category_share: number;
    monthly_by_region: number;
  };
}

/**
 * 지역×업종×월 사용 건수 원장 행. 정선군 컬럼은 고한·사북 제외 잔여분, 삼척시는 도계읍 한정 (region_note).
 *
 * 값이 `null`이면 소표본 억제 셀이다 — **0이 아니라 "모르는 값"이다.** 0으로 치환해 합산하면
 * 억제된 지역의 소비가 실제보다 낮게 그려진다(실측: 2025-12 영월군 1,552건 → 1,223건).
 * 집계는 lib/regionAnalysis.ts를 통해서만 하고, 지역 월 합계는 dashboard의 monthly_by_region을 쓴다.
 */
export type UsageMonthlyRow = { month: string; category: string } & Record<Region, number | null>;

/**
 * 파이프라인 정적 산출물 `usage_monthly.json` — BE 엔드포인트가 없는 FE 전용 진단 데이터다.
 * `categories`는 원본 18종 표기 그대로이며(오타 포함 리터럴 수정 금지), 표시 6분류 롤업은
 * pipeline/category_map.py `HIGHONE_TO_DISPLAY`가 정본이다 (lib/regionAnalysis.ts가 복제).
 */
export interface UsageMonthly {
  source: string;
  base_month: string;
  months: string[];
  categories: string[];
  region_note: string;
  usage: UsageMonthlyRow[];
  visitors_monthly: Record<string, number>;
  /** 소표본 셀 비공개 고지 — 구형 산출물에는 없을 수 있어 옵셔널이다 */
  privacy_meta?: PrivacyMeta;
}

/**
 * 파이프라인 정적 산출물 `usage_daily.json` — 일·요일 축 집계 (05 §6, 피드백 ⑦).
 * `weekday_*` 배열 인덱스는 pandas dayofweek 계약(0=월)이며 `weekday_labels`가 라벨 정본.
 * 요일×업종은 파이프라인이 표시 6분류로 사전 롤업한 값이다 (월 원장의 18종 유지와 다름).
 */
export interface UsageDaily {
  source: string;
  period: { start: string; end: string; days: number };
  region_note: string;
  weekday_labels: string[];
  weekday_days: number[];
  /**
   * 요일×표시업종 건수. **`null`은 소표본 억제 셀이다** — 0이 아니라 "비공개"다.
   * 억제 지역의 공개 셀과 '전체'의 억제 업종은 차분 복원을 막으려 100 단위로 반올림해 발행된다
   * (`privacy_meta` 참고). 지역 요일 합계는 이 값을 더하지 말고 `daily_total`에서 만든다.
   */
  weekday_category: Record<string, Record<DisplayCategory, number[] | null>>;
  /** 지역 일별 총 건수 — 셀이 아니라 지역 총합이라 억제 영향이 없다(원값) */
  daily_total: Record<string, [string, number][]>;
  /** 소표본 셀 비공개 고지 — 구형 산출물에는 없을 수 있어 옵셔널이다 */
  privacy_meta?: PrivacyMeta;
}

/** 셀 부하 구간 — 상위/중간/하위는 공개 셀의 사분위(Q3·Q1) 경계다. suppressed는 값 자체가 없다 */
export type CellLoadTier = "high" | "mid" | "low" | "suppressed";

/**
 * 지역×표시업종 한 칸. 가맹점 수가 k(=5) 미만이면 개별 사업자가 역산될 수 있어
 * 파이프라인(P9)이 값을 비우고 `suppressed: true`로 내려보낸다 — 그 셀은 화면 선택 목록에서 뺀다.
 */
export interface CellLoadCell {
  eup: string;
  category: string;
  merchants: number;
  /** 최근 3개월 평균 월 거래 건수. suppressed면 null */
  monthly_uses_avg: number | null;
  /** 부하 지수 = monthly_uses_avg ÷ merchants (건수 기반 추정치). suppressed면 null */
  load_index: number | null;
  tier: CellLoadTier;
  suppressed: boolean;
}

/**
 * 파이프라인 정적 산출물 `cell_load.json`(P9) — usageMonthly와 같은 이유로 BE 엔드포인트가 없다.
 * 금액 컬럼이 원본에 없어 한도 소진율 대신 **건수 기반 부하 지수**를 쓴다(추정치 배지 필수).
 */
export interface CellLoad {
  base_month: string;
  window_months: string[];
  /** 산식 고지 — 요약·의역 금지, 그대로 노출 */
  method_note: string;
  k_anonymity: number;
  thresholds: { high: number; low: number };
  cells: CellLoadCell[];
}

export interface EupScore {
  rank: number;
  eup: string;
  score: number;
  low_usage: number;
  decline: number;
}

export interface Candidate {
  id: string;
  eup: string;
  category: string;
  name: string;
  lat: number;
  lng: number;
  score: number;
  gap: number;
  proximity: number;
  saturation: number;
  /** 반경 내 동일 업종 상가 중 기존 가맹점 비중. */
  market_coverage: number;
  /** 동일 업종 상가 표본 규모에 따른 공백도 신뢰도(0~1). */
  gap_confidence: number;
  /** 반경 내 전체 상가 수. 업종 공백도의 분모로 사용하지 않는다. */
  nearby_stores: number;
  /** 반경 내 후보와 동일한 표시 업종 상가 수. */
  nearby_same_category_stores: number;
  nearby_merchants: number;
  /** 거점에서 후보까지의 직선거리. */
  straight_distance_km: number;
  selection_basis: string;
  source_category: {
    large: string;
    middle: string;
    small: string;
  };
  /** 공개 라우팅 API 추정치 — 절대 수치로 인용 금지, 후보 간 상대 비교만 (05 §1) */
  road_distance_km: number | null;
  road_minutes: number | null;
}

export interface Merchant {
  name: string;
  category: string;
  eup: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * 운영 2년 미만 사업자 비중 — 진단 참고용 배경 정보 (05 §6, 13 §9).
 * 4개 시군이 14.6~15.1%로 최대 편차 0.5%p라 **지역 비교 근거가 못 된다** —
 * '위험' 라벨·경고색·순위 정렬에 쓰지 않는다.
 */
export interface RiskSignal {
  sigungu: string;
  under2y_ratio: number;
}

export interface CandidatesResponse {
  eup_ranking: EupScore[];
  selected_eups: string[];
  candidates: Candidate[];
  merchants: Merchant[];
}

/* ── §2 Action Card ───────────────────────────────────────────── */

export type CardType = "EXPANSION" | "INCENTIVE";
export type CardStatus = "pending" | "approved" | "rejected" | "held";
export type CardProgress =
  | "검토중"
  | "후보 접촉·검토 시작"
  | "적격성 확인"
  | "가맹 심사"
  | "추진중"
  | "보류"
  | "완료";
export type PaybackRate = 3 | 5 | 7;
export type EligibilityCheckStatus = "unverified" | "verified" | "failed";

/**
 * 지금 이 카드에서 고를 수 있는 다음 단계 — **서버 전이 규칙의 정본**이다.
 *
 * 허용되지 않는 항목도 이유와 함께 전부 실려 온다(화면이 왜 못 고르는지 말해야 하므로).
 * FE는 순차 전이·보류 재개·적격성 게이트를 자체 판정하지 않는다 — 규칙이 어긋나면 화면이
 * 서버가 거부할 선택지를 정상으로 제시하고 사용자는 고른 뒤 409를 본다.
 *
 * `allowed`인데 `reason`이 있으면 "선택은 가능하지만 이 경로로는 안 되는 단계"다 —
 * 완료가 그렇다(증빙이 필요해 추진 기록으로만 남긴다). 화면은 그 이유를 그대로 보여 준다.
 */
export interface AllowedProgressOption {
  value: CardProgress;
  allowed: boolean;
  reason?: string;
}

/**
 * 확충 카드의 타깃. 두 ID는 원천이 달라 **절대 합치지 않는다** —
 * `candidate_store_id`는 소진공 상가정보(진단 측), `verified_merchant_id`는
 * 하이원포인트 가맹점(처방 측)이다 (절대 규칙 6).
 */
export interface CardTarget {
  eup: string;
  category: string;
  /** 후보 상가의 안정 키 — 후보 순위 슬롯(CAND-00N)과 달리 재산출에도 같은 점포를 가리킨다 */
  candidate_store_id?: string | null;
  /** 그 후보가 실제 가맹점이 된 뒤 확인된 가맹점 등록번호. **확인 전 null이 정상 상태다** */
  verified_merchant_id?: string | null;
}

export type DecisionSource = "operator_ui" | "api";

/**
 * 결정 1건의 감사 기록.
 *
 * `verified: false`는 지금 신원이 검증되지 않았다는 사실을 정직하게 남기는 값이다 —
 * 담당자 계정 체계가 없어 `actor_id`는 화면이 보낸 자기신고 값이고 인증은 공유 토큰 하나다.
 * **화면은 이 사실을 감추지 않는다**(이력의 담당자 이름 옆 작은 표기).
 */
export interface CardDecision {
  outcome: CardStatus;
  reason: string | null;
  actor_id: string;
  actor_name: string | null;
  source: DecisionSource | string;
  auth: string;
  verified: boolean;
  at: string;
}

/** 반려·보류한 타깃의 재제안 차단 창. 인센티브는 타깃이 없어 대상이 아니다 */
export interface ReproposalBlock {
  until: string;
  cooldown_days: number;
  recheck_condition: string | null;
  reason: string | null;
}

/**
 * 카드 이력 1행. 결정 이벤트는 결정자·사유·경로를, 추진 기록 이벤트는 record_id를 함께 싣는다 —
 * 시각과 동작만 남으면 누가 왜 그렇게 결정했는지가 기록에서 사라진다.
 */
export interface CardEvent {
  at: string;
  action: string;
  record_id?: string;
  actor_id?: string;
  actor_name?: string;
  reason?: string;
  source?: string;
}

export interface EligibilityCheck {
  key: string;
  label: string;
  status: EligibilityCheckStatus;
}

export interface CandidateVerification {
  status: "unverified" | "verified" | "ineligible";
  /** 구형 시드의 string[]도 읽되, 새 저장은 구조화된 체크를 사용한다. */
  checks: (string | EligibilityCheck)[];
  note: string;
}

export interface CardOperations {
  owner: string | null;
  target_date: string | null;
  expected_cost: string | null;
  contact_result: string | null;
  ineligible_reason: string | null;
  actual_outcome: string | null;
}

/**
 * 후보 선택 사유 코드 (05 §2) — 화면 배지 문구의 정본.
 *
 * `adjusted`만으로는 "정량 1순위 선택"과 "진행 중인 건 제외하고 선택" 둘 중 하나로만 갈려,
 * 지역 배분 몫으로 고른 카드에까지 둘 중 하나가 잘못 붙는다. 값이 없는 구형 카드는 순위로
 * 추론하되 단정할 수 없는 경우는 배지를 그리지 않는다.
 */
export type SelectionReason = "top_score" | "exclude_in_progress" | "region_quota";

export interface CardAi {
  adjusted: boolean;
  /** 없으면 score_rank·selection_rank로 추론 (RankTrace) */
  selection_reason?: SelectionReason;
  comparison: string;
  reasons: string[];
  risks: string[];
  expected_effect: string;
  /** 정량 순위 병기용 — 절대 규칙 5. INCENTIVE는 null */
  original_ranking: { rank: number; candidate: string; score: number }[] | null;
  /**
   * AI 반대 의견 3항 — 제안을 방어하지 않고 반박하는 문장만 담는다 (05 §2 "반대 의견도 AI
   * 산출물이며 정본 수치만 인용"). B1 도입 이전에 생성·시드된 구형 카드에는 없을 수 있어
   * optional이다 — 없으면 화면은 반대 관점 섹션을 그리지 않는다.
   */
  dissent?: string[];
  /** LLM 자유서술의 숫자·순위·상태를 정본 데이터로 재검증했는지 */
  grounding?: {
    /** EXPANSION은 verified, INCENTIVE는 partial(시나리오 수치만 서버 고정) (05 §2) */
    status: "verified" | "fallback" | "partial";
    numeric_status?: "verified" | "fallback" | "fixed_by_server";
    narrative_status?: "verified" | "fallback" | "rule_based" | "ai_generated_unverified";
    selection_method?: string;
    /** llm | rule_fallback | rule_seed — 설명 출처 칩의 근거 (05 §2) */
    explanation_source?: string;
    /** dissent만의 출처 — llm | rule_fallback | rule_based (05 §2, explanation_source와 다른 축) */
    dissent_source?: string;
    source: "structured";
    checks: string[];
  };
}

export interface Scenario {
  rate: PaybackRate;
  delta_pp: [number, number] | number[];
  budget_note: string;
}

export interface Card {
  id: string;
  type: CardType;
  status: CardStatus;
  progress: CardProgress | null;
  /** 서버가 요청 시점에 계산해 모든 카드 응답에 싣는 파생값 — 저장 필드가 아니다 */
  allowed_next_progress?: AllowedProgressOption[];
  title: string;
  target: CardTarget | null;
  score_rank: number | null;
  ai_rank: number | null;
  /** 진행 중인 업무 제외 후 선택 가능한 후보 안에서의 순위. */
  selection_rank?: number | null;
  confidence: "상" | "중" | "하";
  ai: CardAi;
  scenarios: Scenario[] | null;
  /** 사업자 접촉 전 적격성 확인 상태. 기존 시드 카드에 없으면 미확인으로 본다. */
  candidate_verification?: CandidateVerification;
  /** 실제 값이 없으면 화면에서 명시적인 미입력 상태로 표시한다. */
  operations?: CardOperations;
  /** INCENTIVE 승인 시 담당자가 고른 페이백률. 위젯 payback.rate의 유일한 출처 (05 §2) */
  selected_rate?: PaybackRate | null;
  assumption_note?: string;
  sources: string[];
  created_at: string;
  decided_at: string | null;
  /** 결정 1건의 감사 기록 — 결정 전에는 없다 */
  decision?: CardDecision | null;
  /** 반려·보류 타깃의 재제안 차단 창 — 승인에는 붙지 않는다 */
  reproposal_block?: ReproposalBlock | null;
  events?: CardEvent[];
  last_progress_record_at?: string | null;
  last_progress_record_id?: string | null;
  progress_before_hold?: CardProgress | null;
  completed_at?: string | null;
  /** DynamoDB 조건부 갱신용 낙관적 잠금 버전. 구형 카드에는 없을 수 있다. */
  version?: number;
}

/**
 * 결정 요청 본문 — 담당자 승인·반려·보류.
 *
 * `reason`은 **반려·보류에서 필수**이고 `confidence`가 `하`인 카드의 승인에서도 필수다(확인 근거).
 * 누락은 서버 422이므로 화면이 사유 입력을 제공해야 한다.
 * `cooldown_days`·`recheck_condition`은 **반려·보류에서만** 의미가 있다.
 */
export interface DecisionRequest {
  decision: CardStatus;
  selected_rate?: PaybackRate;
  reason?: string;
  /** 담당자 자기신고 값 — 서버가 verified:false와 함께 저장한다 */
  actor_id: string;
  actor_name?: string;
  decision_source: DecisionSource;
  /** 화면이 읽은 카드의 version. 그 사이 다른 요청이 카드를 바꿨으면 서버가 409를 낸다 */
  version?: number;
  cooldown_days?: number;
  recheck_condition?: string;
}

/* ── §2-1 추진 경과 기록·리포트 ───────────────────────────────── */

/**
 * 관측값 1건의 입력 — 값과 함께 **무엇을 언제 어디서 쟀는지**를 반드시 보낸다.
 * 다섯 필드가 전부 필수이며 누락은 서버 422다.
 *
 * `unit`·`is_proxy`는 **보내지 않는다** — 서버가 지표 정의에서 채워 응답에 싣는다.
 * 단위를 자유 입력으로 열면 %와 %p를 뒤바꾼 값이 감사 기록에 남는다.
 */
export interface ProgressMeasurementInput {
  value: number;
  /** `YYYY-MM-DD` */
  measured_from: string;
  /** `YYYY-MM-DD` — measured_from보다 이르거나 기록 시각보다 미래일 수 없다 */
  measured_to: string;
  source: string;
  scope: string;
}

/** 저장된 관측값 — 서버가 채운 단위·근사 여부가 함께 온다 */
export interface ProgressMeasurement extends ProgressMeasurementInput {
  /** 지표 정의의 정본은 서버 한 곳이다 — 화면 메타보다 이 값을 우선한다 */
  unit: string;
  /** true면 절대 규칙 2에 따라 `근사 지표` 배지를 병기한다 */
  is_proxy: boolean;
}

export interface ProgressMetrics {
  usage_count?: ProgressMeasurement | null;
  conversion_rate_pct?: ProgressMeasurement | null;
  active_merchant_count?: ProgressMeasurement | null;
  spend_krw?: ProgressMeasurement | null;
  concentration_index?: ProgressMeasurement | null;
}

export interface ProgressMetricsInput {
  usage_count?: ProgressMeasurementInput;
  conversion_rate_pct?: ProgressMeasurementInput;
  active_merchant_count?: ProgressMeasurementInput;
  spend_krw?: ProgressMeasurementInput;
  concentration_index?: ProgressMeasurementInput;
}

/** 확충 완료 증빙 — 가맹 등록 ID 또는 증빙 문서 중 최소 하나 */
export interface ExpansionCompletionEvidence {
  /** 주면 서버가 target.verified_merchant_id에 반영하고 그때부터 위젯 확충 배지가 붙는다 */
  merchant_registration_id?: string;
  /** 등록 ID 없이 문서만 주면 카드는 완료되지만 위젯 반영은 대기로 남는다 */
  document?: string;
}

/** 인센티브 완료 증빙 — 넷 다 필수이며 예산 한도 확인이 false면 완료로 넘어갈 수 없다 */
export interface IncentiveCompletionEvidence {
  applied_from: string;
  applied_to: string;
  owner: string;
  budget_cap_confirmed: boolean;
}

export type CompletionEvidence = ExpansionCompletionEvidence | IncentiveCompletionEvidence;

export interface ProgressRecordInput {
  progress: CardProgress;
  recorded_at?: string;
  progress_pct?: number;
  note: string;
  blocker?: string;
  next_action?: string;
  owner?: string;
  due_at?: string;
  source?: string;
  metrics?: ProgressMetricsInput;
  /** `완료` 기록에는 필수 — 누락은 서버 422 */
  completion_evidence?: CompletionEvidence;
  idempotency_key: string;
}

export interface ProgressRecord {
  record_id: string;
  card_id: string;
  recorded_at: string;
  created_at: string;
  progress: CardProgress;
  previous_progress: CardProgress | null;
  progress_changed: boolean;
  progress_pct: number | null;
  /** 빠른 상태 변경으로 만들어진 기록은 메모가 없을 수 있다. */
  note: string | null;
  blocker: string | null;
  next_action: string | null;
  owner: string | null;
  due_at: string | null;
  source: string;
  metrics: ProgressMetrics;
  completion_evidence?: CompletionEvidence | null;
  card_snapshot: {
    type: CardType;
    title: string;
    eup: string | null;
    category: string | null;
  };
}

export interface ProgressRecordsResponse {
  records: ProgressRecord[];
  next_cursor: string | null;
}

export interface CreateProgressRecordResponse {
  card: Card;
  record: ProgressRecord;
  created: boolean;
}

export type ProgressMetricKey = keyof Required<ProgressMetrics>;

export interface ProgressMetricChange {
  baseline_average: number | null;
  latest_average: number | null;
  delta: number | null;
  delta_unit: "%p" | "point" | "KRW" | "count" | string;
  relative_change_pct: number | null;
  /** 양수면 개선, 음수면 악화. 집중도는 감소가 개선이라 delta의 부호를 반전한다. */
  improvement: number | null;
  lower_is_better: boolean;
  sample_size: number;
}

export interface ProgressReport {
  period: {
    from: string;
    to: string;
    timezone: string;
    days: number;
  };
  record_count: number;
  recorded_card_count: number;
  cards_without_records: number;
  status_distribution: Record<CardProgress, number>;
  completion: {
    rate: number | null;
    completed_count: number;
    sample_size: number;
  };
  average_progress_pct: {
    value: number | null;
    sample_size: number;
  };
  stale: {
    threshold_days: number;
    count: number;
    items: {
      card_id: string;
      title: string;
      progress: CardProgress;
      last_recorded_at: string;
      days_since_update: number;
    }[];
  };
  on_time: {
    rate: number | null;
    on_time_count: number;
    sample_size: number;
  };
  stage_durations: {
    from_progress: CardProgress;
    to_progress: CardProgress;
    sample_size: number;
    average_hours: number | null;
    median_hours: number | null;
  }[];
  metric_changes: Record<ProgressMetricKey, ProgressMetricChange>;
}

export interface Simulation {
  current_index: number;
  projected_index: number;
  delta_pp: number[];
  expected_monthly_count: number;
  /** 최근 3개월 월별 가맹점당 사용 건수의 관측 분위수 범위. */
  expected_monthly_range?: number[];
  uncertainty_method?: string;
  estimate_basis: string;
  base_month: string;
  effect_assessment: "미미" | "개선" | "심화" | "혼재";
  decision_note: string;
  narrative: string;
  /** 이 문구가 LLM 응답인지 규칙 기반인지 (05 §2) */
  narrative_source?: "llm" | "rule_based";
  assumption_note: string;
}

/* ── §3 KPI ───────────────────────────────────────────────────── */

/** 분모 0인 지표는 null — FE는 null이면 `—` 표시 (05 §8) */
export interface Kpi {
  adoption_rate: number | null;
  execution_rate: number | null;
  avg_decision_hours: number | null;
  /** 구형 화면·응답 호환 별칭. */
  avg_approval_hours: number | null;
  regional_balance_index: number | null;
  /**
   * 지역 균형지수를 만든 **표본 수** = 집계 6지역 안에 타깃이 있는 승인 확충 카드 수.
   * `counts.approved`는 인센티브를 포함해 다른 숫자이므로 표본으로 쓰면 안 된다.
   * 구형 응답에는 없어 옵셔널이다.
   */
  balance_sample_count?: number;
  counts: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    held: number;
    decided: number;
    done: number;
  };
}

/* ── §4 방문객 위젯 ───────────────────────────────────────────── */

export interface Recommendation {
  name: string;
  category: string;
  address: string;
  lat: number;
  lng: number;
  /**
   * 완료된 확충 카드의 `target.verified_merchant_id`와 가맹점 등록번호가 **정확히 일치**할 때만 붙는다.
   * 확인된 ID가 없거나 그 ID가 아직 가맹점 산출에 없으면 붙지 않으며 그 상태를 "반영 대기"라 부른다.
   */
  badge: "이번 분기 확충 업종" | null;
  directions_url: string;
  /** 완료된 INCENTIVE 카드가 있을 때만 — rate는 그 카드의 selected_rate */
  payback: { rate: PaybackRate; label: string } | null;
  blurb: string;
}

export interface WidgetResponse {
  recommendations: Recommendation[];
  policy_note: string;
  /** 현재 필터에 맞는 전체 가맹점 수 — 화면은 한 번에 읽기 좋은 만큼만 보여 준다. */
  total: number;
  /**
   * 완료된 확충 카드가 위젯에 실제로 반영된 상태 — **담당자 화면의 정보다.**
   * 방문객 화면에는 노출하지 않는다(반영 대기는 방문객이 알 일이 아니다).
   */
  expansion_sync?: {
    completed_cards: number;
    reflected: number;
    pending_sync: number;
  };
}
