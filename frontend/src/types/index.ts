/**
 * API 응답 타입 — 정본은 docs/plan/05-api-contract.md.
 * 계약을 바꿔야 하면 05 문서를 먼저 고치고(→ scripts/sync-mocks.sh 재실행 → 팀 공유) 여기를 맞춘다.
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
  privacy_meta?: {
    k: number;
    suppressed_cells: { eup: string; category: string }[];
    aggregate_rounding: { unit: number };
    note: string;
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
  weekday_category: Record<string, Record<DisplayCategory, number[]>>;
  daily_total: Record<string, [string, number][]>;
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
    /** llm | rule_fallback | rule_seed | mock_rule — 설명 출처 칩의 근거 (05 §2) */
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
  title: string;
  target: { eup: string; category: string } | null;
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
  events?: { at: string; action: string; record_id?: string }[];
  last_progress_record_at?: string | null;
  last_progress_record_id?: string | null;
  progress_before_hold?: CardProgress | null;
  completed_at?: string | null;
  /** DynamoDB 조건부 갱신용 낙관적 잠금 버전. 구형 카드에는 없을 수 있다. */
  version?: number;
}

/* ── §2-1 추진 경과 기록·리포트 ───────────────────────────────── */

export interface ProgressMetrics {
  usage_count?: number | null;
  conversion_rate_pct?: number | null;
  active_merchant_count?: number | null;
  spend_krw?: number | null;
  concentration_index?: number | null;
}

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
  metrics?: ProgressMetrics;
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
  /** 이 문구가 LLM 응답인지 규칙 기반인지 (05 §2). mock 모드는 mock_rule */
  narrative_source?: "llm" | "rule_based" | "mock_rule";
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
  /** 완료된 EXPANSION 카드의 (읍×업종)과 매칭될 때만 표시 */
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
}
