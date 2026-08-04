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
  /** P8 민감도 top3_stable_ratio×100. 미산출이면 null → FE는 타일을 숨기거나 `—` */
  ai_stability: number | null;
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
  nearby_stores: number;
  nearby_merchants: number;
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
export type CardProgress = "검토중" | "추진중" | "보류" | "완료";
export type PaybackRate = 3 | 5 | 7;

export interface CardAi {
  adjusted: boolean;
  comparison: string;
  reasons: string[];
  risks: string[];
  expected_effect: string;
  /** 정량 순위 병기용 — 절대 규칙 5. INCENTIVE는 null */
  original_ranking: { rank: number; candidate: string; score: number }[] | null;
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
  confidence: "상" | "중" | "하";
  ai: CardAi;
  scenarios: Scenario[] | null;
  /** INCENTIVE 승인 시 담당자가 고른 페이백률. 위젯 payback.rate의 유일한 출처 (05 §2) */
  selected_rate?: PaybackRate | null;
  assumption_note?: string;
  sources: string[];
  created_at: string;
  decided_at: string | null;
  events?: { at: string; action: string }[];
}

export interface Simulation {
  current_index: number;
  projected_index: number;
  delta_pp: number[];
  narrative: string;
  assumption_note: string;
}

/* ── §3 KPI ───────────────────────────────────────────────────── */

/** 분모 0인 지표는 null — FE는 null이면 `—` 표시 (05 §8) */
export interface Kpi {
  adoption_rate: number | null;
  execution_rate: number | null;
  avg_approval_hours: number | null;
  regional_balance_index: number | null;
  counts: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    held: number;
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
  /** 완료된 EXPANSION 카드의 (읍×업종)과 매칭될 때만 "신규" */
  badge: "신규" | null;
  /** 완료된 INCENTIVE 카드가 있을 때만 — rate는 그 카드의 selected_rate */
  payback: { rate: PaybackRate; label: string } | null;
  blurb: string;
}

export interface WidgetResponse {
  recommendations: Recommendation[];
  policy_note: string;
}
