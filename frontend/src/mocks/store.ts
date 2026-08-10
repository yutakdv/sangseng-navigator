/**
 * mock 모드 상태 저장소 (docs/plan/08 F1).
 *
 * `NEXT_PUBLIC_API_BASE`가 비어 있을 때 POST(승인·상태 변경·카드 생성)가 페이지를 오가도
 * 유지되도록 카드 목록을 **모듈 스코프 인메모리 배열**로 관리한다.
 * KPI·위젯 추천도 이 배열에서 파생 계산하므로, mock 모드에서도
 * "승인 → 트래킹 → 위젯 반영" 데모 루프가 그대로 돈다.
 *
 * ⚠ 서버 컴포넌트에서 읽으면 이 배열은 **Next 서버 프로세스의 메모리**에 산다.
 *    `npm run dev` / 단일 컨테이너에서는 의도대로 유지되지만, 서버를 재시작하면 초기값으로 돌아간다.
 *    (실 API 모드에서는 DynamoDB가 이 역할을 하므로 이 파일은 쓰이지 않는다.)
 *
 * 계산 규칙은 전부 05 문서 계약 그대로이며, 백엔드 구현과 1:1로 대응한다:
 *   deriveKpi()      ↔ backend/app/routes/kpi.py
 *   deriveWidget()   ↔ backend/app/routes/widget.py
 *   generateCard()   ↔ backend/app/services/cardgen.py
 */
import type {
  Candidate,
  Card,
  CardProgress,
  CardStatus,
  CardType,
  CreateProgressRecordResponse,
  Kpi,
  Merchant,
  PaybackRate,
  ProgressMetricChange,
  ProgressMetricKey,
  ProgressMetrics,
  ProgressRecord,
  ProgressRecordInput,
  ProgressRecordsResponse,
  ProgressReport,
  Recommendation,
  EligibilityCheck,
  WidgetResponse,
} from "@/types";
import { ANCHOR, ASSUMPTION_NOTE, REGIONS } from "@/lib/constants";
import { ApiError } from "@/lib/errors";
import {
  REQUIRED_ELIGIBILITY_CHECKS,
  normalizeEligibility,
  progressOptions,
} from "@/lib/cardWorkflow";
import cardsSeed from "./cards.json";
import candidatesMock from "./candidates.json";
import progressRecordsSeed from "./progress_records.json";

const DONE = "완료";
const RUNNING: CardProgress[] = ["추진중", "완료"];
const WIDGET_DEFAULT_LIMIT = 12;
const WIDGET_MAX_LIMIT = 120;
const POLICY_NOTE = "완료된 확충 업종 우선 · 그 외 하이원리조트 거점 직선거리 기준";

/** import한 JSON 모듈을 직접 변형하지 않도록 깊은 복사 후 보관 */
let cards: Card[] = JSON.parse(JSON.stringify(cardsSeed.cards)) as Card[];

/**
 * 실측·서술 기록은 카드와 분리해 보관한다. 초기값은 **손으로 만들지 않고**
 * `seed_demo.history_records()`가 실제 서비스 경로로 재생한 결과를 그대로 떠 온 것이다
 * (`scripts/sync-mocks.sh` 대상 아님 — 카드 상태와 짝이라 cards.json과 함께 갱신한다).
 * 이력 카드 AC-003(완료)·AC-004(정체)의 기록이라 mock 모드에서도 추진 경과 리포트가
 * 실 API와 같은 수치를 낸다 — 비상 폴백(12 §5)에서 화면이 빈 지표 벽이 되지 않게 하려는 것이다.
 */
let progressRecords: ProgressRecord[] = JSON.parse(
  JSON.stringify(progressRecordsSeed.records),
) as ProgressRecord[];
const progressIdempotency = new Map<string, string>();
let progressRecordSequence = 1;

export const listCards = (opts: { type?: string; status?: string } = {}): Card[] =>
  cards.filter(
    (c) => (!opts.type || c.type === opts.type) && (!opts.status || c.status === opts.status),
  );

export const getCard = (id: string): Card | undefined => cards.find((c) => c.id === id);

const nowIso = (): string => {
  // KST ISO8601(+09:00) — 05 §8 시각 표기 규칙
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${kst.toISOString().slice(0, 19)}+09:00`;
};

/**
 * 승인/반려/보류 — INCENTIVE 승인에는 selected_rate가 필수 (05 §2·§8).
 *
 * 던지는 에러는 `ApiError`다 — 화면이 실 API 모드와 **같은 상태코드로** 분기할 수 있어야 한다.
 * 검사 순서도 백엔드와 같다: 404(없는 ID) → 409(상태 전이) → 400(selected_rate).
 */
export const decide = (id: string, decision: CardStatus, selectedRate?: PaybackRate): Card => {
  const card = getCard(id);
  if (!card) throw new ApiError(404, "card not found");
  if (card.status !== "pending") {
    throw new ApiError(409, `pending 카드만 결정할 수 있습니다 (현재 status=${card.status})`);
  }
  if (card.type === "INCENTIVE" && decision === "approved" && !selectedRate) {
    throw new ApiError(400, "selected_rate(3|5|7)가 필요합니다");
  }
  const at = nowIso();
  card.status = decision;
  card.decided_at = at;
  card.progress =
    decision === "approved"
      ? card.type === "EXPANSION"
        ? "후보 접촉·검토 시작"
        : "검토중"
      : null;
  if (card.type === "INCENTIVE" && decision === "approved") card.selected_rate = selectedRate ?? null;
  card.events = [...(card.events ?? []), { at, action: decision }];
  return card;
};

/** 추진 상태 변경 — approved 카드만 가능 (05 §8) */
export const setProgress = (id: string, progress: CardProgress): Card =>
  writeProgressRecord(
    id,
    { progress, note: null, source: "quick_status" },
    false,
  ).card;

const ALL_PROGRESS: CardProgress[] = [
  "검토중",
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "추진중",
  "보류",
  "완료",
];

const METRIC_KEYS: ProgressMetricKey[] = [
  "usage_count",
  "conversion_rate_pct",
  "active_merchant_count",
  "spend_krw",
  "concentration_index",
];

const nullableText = (value: string | undefined): string | null => {
  const clean = value?.trim();
  return clean ? clean : null;
};

const validIso = (value: string): boolean => Number.isFinite(new Date(value).getTime());

const cleanMetrics = (input?: ProgressMetrics): ProgressMetrics => {
  if (!input) return {};
  const metrics: ProgressMetrics = {};
  for (const key of METRIC_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new ApiError(400, `${key}는 0 이상의 숫자여야 합니다`);
    }
    if ((key === "conversion_rate_pct" || key === "concentration_index") && value > 100) {
      throw new ApiError(400, `${key}는 100 이하여야 합니다`);
    }
    metrics[key] = value;
  }
  return metrics;
};

/** 카드별 기록 최신순. mock cursor는 다음 배열 offset을 문자열로 인코딩한다. */
export const listProgressRecords = (id: string, cursor?: string): ProgressRecordsResponse => {
  if (!getCard(id)) throw new ApiError(404, "card not found");
  const start = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(start) || start < 0) throw new ApiError(400, "invalid progress record cursor");
  const rows = progressRecords
    .filter((record) => record.card_id === id)
    .sort((a, b) =>
      b.recorded_at.localeCompare(a.recorded_at) || b.record_id.localeCompare(a.record_id),
    );
  const records = rows.slice(start, start + 50);
  const next = start + records.length;
  return { records, next_cursor: next < rows.length ? String(next) : null };
};

type InternalProgressRecordInput = Omit<ProgressRecordInput, "note" | "idempotency_key"> & {
  note: string | null;
  idempotency_key?: string;
};

/** 추진 상태와 근거 메모·실측값을 한 감사 기록으로 저장하는 mock 내부 원자 연산. */
function writeProgressRecord(
  id: string,
  input: InternalProgressRecordInput,
  requireNote: boolean,
): CreateProgressRecordResponse {
  const card = getCard(id);
  if (!card) throw new ApiError(404, "card not found");

  const idempotencyKey = input.idempotency_key?.trim();
  if (requireNote && !idempotencyKey) throw new ApiError(400, "idempotency_key가 필요합니다");
  const dedupeKey = idempotencyKey ? `${id}:${idempotencyKey}` : null;
  if (dedupeKey) {
    const existingId = progressIdempotency.get(dedupeKey);
    if (existingId) {
      const record = progressRecords.find((item) => item.record_id === existingId);
      if (record) return { card, record, created: false };
    }
  }

  if (card.status !== "approved") {
    throw new ApiError(409, `approved 카드만 추진 기록을 남길 수 있습니다 (현재 status=${card.status})`);
  }
  const option = progressOptions(card).find((item) => item.value === input.progress);
  if (!option) throw new ApiError(400, "지원하지 않는 추진 상태입니다");
  if (option.disabled) throw new ApiError(409, option.reason ?? "현재 선택할 수 없는 추진 상태입니다");

  const note = input.note?.trim() || null;
  if (requireNote && !note) throw new ApiError(400, "note는 필수입니다");
  if (
    input.progress_pct !== undefined &&
    (!Number.isFinite(input.progress_pct) || input.progress_pct < 0 || input.progress_pct > 100)
  ) {
    throw new ApiError(400, "progress_pct는 0~100 사이여야 합니다");
  }

  const recordedAt = input.recorded_at ?? nowIso();
  if (!validIso(recordedAt)) throw new ApiError(400, "recorded_at은 ISO8601 형식이어야 합니다");
  if (input.due_at && !/^\d{4}-\d{2}-\d{2}$/.test(input.due_at)) {
    throw new ApiError(400, "due_at은 YYYY-MM-DD 형식이어야 합니다");
  }

  const createdAt = nowIso();
  const previousProgress = card.progress;
  const record: ProgressRecord = {
    record_id: `PR-MOCK-${String(progressRecordSequence).padStart(6, "0")}`,
    card_id: card.id,
    recorded_at: recordedAt,
    created_at: createdAt,
    progress: input.progress,
    previous_progress: previousProgress,
    progress_changed: previousProgress !== input.progress,
    progress_pct: input.progress_pct ?? null,
    note,
    blocker: nullableText(input.blocker),
    next_action: nullableText(input.next_action),
    owner: nullableText(input.owner),
    due_at: nullableText(input.due_at),
    source: nullableText(input.source) ?? "manual",
    metrics: cleanMetrics(input.metrics),
    card_snapshot: {
      type: card.type,
      title: card.title,
      eup: card.target?.eup ?? null,
      category: card.target?.category ?? null,
    },
  };
  progressRecordSequence += 1;
  progressRecords = [...progressRecords, record];
  if (dedupeKey) progressIdempotency.set(dedupeKey, record.record_id);

  card.progress = input.progress;
  card.events = [
    ...(card.events ?? []),
    { at: recordedAt, action: `progress:${input.progress}`, record_id: record.record_id },
  ];
  card.version = (card.version ?? 0) + 1;
  card.last_progress_record_at = recordedAt;
  card.last_progress_record_id = record.record_id;
  if (input.progress === "완료" && !card.completed_at) card.completed_at = recordedAt;
  return { card, record, created: true };
}

/** 추진 상태와 근거 메모·실측값을 한 감사 기록으로 저장한다. */
export const createProgressRecord = (
  id: string,
  input: ProgressRecordInput,
): CreateProgressRecordResponse => writeProgressRecord(id, input, true);

/** 후보 적격성 기록 — 실 API `/verification`과 같은 상태 파생 규칙을 쓴다. */
export const setVerification = (id: string, checks: EligibilityCheck[]): Card => {
  const card = getCard(id);
  if (!card) throw new ApiError(404, "card not found");
  if (card.type !== "EXPANSION") throw new ApiError(400, "후보 적격성 확인은 EXPANSION 카드에만 적용됩니다");
  if (card.status !== "approved") {
    throw new ApiError(409, "후보 접촉·검토를 시작한 카드만 적격성을 기록할 수 있습니다");
  }
  const normalized = normalizeEligibility({ status: "unverified", checks, note: "" });
  const status = normalized.some((check) => check.status === "failed")
    ? "ineligible"
    : normalized.every((check) => check.status === "verified")
      ? "verified"
      : "unverified";
  const failed = normalized.filter((check) => check.status === "failed").map((check) => check.label);
  card.candidate_verification = {
    status,
    checks: normalized,
    note:
      status === "verified"
        ? "필수 적격성 5개 항목을 모두 확인했습니다. 다음 단계는 가맹 심사이며, 아직 가맹 확정은 아닙니다"
        : status === "ineligible"
          ? `미충족 항목: ${failed.join(", ")}. 부적격 사유를 확인하고 보류 또는 반려를 결정하세요`
          : "미확인 항목이 남아 있습니다. 가맹 심사·추진·완료 상태로 이동할 수 없습니다",
  };
  const at = nowIso();
  card.events = [...(card.events ?? []), { at, action: `verification:${status}` }];
  card.version = (card.version ?? 0) + 1;
  return card;
};

/** "이번 분기 카드 생성" mock — 실 API는 스코어링+LLM으로 만든다 (05 §2) */
export const addCard = (card: Card): Card => {
  cards = [card, ...cards];
  return card;
};

/* ── 카드 생성 (05 §2·§8 / backend/app/services/cardgen.py와 동일 규칙) ────── */

/** 동일 지역×업종의 진행 중인 업무 항목 — 백엔드 `cardgen.ACTIVE_TARGET_STATES`와 동일 */
const BLOCKED = [
  "승인 대기",
  "검토중",
  "후보 접촉·검토 시작",
  "적격성 확인",
  "가맹 심사",
  "추진중",
  "보류",
  "완료",
] as const;
const isBlocked = (state: string): boolean => BLOCKED.some((p) => p === state);
/** 백엔드 `cardgen.EXPANSION_SOURCES`와 동일 */
const EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"];
/**
 * B1 반대 의견(dissent) — mock에는 LLM이 없으므로 백엔드 `cardgen.DISSENT_FALLBACK`/
 * `INCENTIVE_DISSENT`(=규칙 기반 폴백 문구)와 같은 내용을 그대로 재사용한다. mock 모드도
 * 실 API와 같은 반대 관점 섹션을 보여줘야 하기 때문이다 (05 §2 "구조는 같아야 한다").
 */
const EXPANSION_DISSENT = [
  "기준월(2025-12) 이후 소비 패턴이 변했다면 근거 수치가 현재와 다를 가능성이 있습니다.",
  "가맹점 이용 부하는 건수 기반 추정치라 실제 매출·수요 여력과 다를 가능성이 있습니다.",
  "계절성(겨울 성수기 등)에 따라 제안 시점과 실행 시점의 수요가 다를 가능성이 있습니다.",
];
const INCENTIVE_DISSENT = [
  "전 지역 공통 페이백이라 지역별 소비 여건 차이를 반영하지 못할 가능성이 있습니다.",
  "페이백률-전환율 관계는 실측 없는 팀 설정 가정이라 실제 효과가 다를 가능성이 있습니다.",
  "지역 전환율은 근사 지표라 개선 폭이 금액 기준 성과와 다를 가능성이 있습니다.",
];

const CANDIDATES = candidatesMock.candidates as unknown as Candidate[];

type RankedCandidate = Candidate & { rank: number };

/** candidates.json → Score 내림차순 순위 부여 (변경 불가 기준선 — AI 입력 ①) */
const rankedCandidates = (): RankedCandidate[] =>
  [...CANDIDATES]
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));

/** 같은 (읍×업종) 타깃 기존 EXPANSION 카드의 추진 상태 — 없음/승인 대기/검토중/추진중/보류/완료 */
const targetState = (eup: string, category: string): string => {
  const matches = cards.filter(
    (c) => c.type === "EXPANSION" && c.target?.eup === eup && c.target?.category === category,
  );
  const approved = matches.filter((c) => c.status === "approved");
  if (approved.length) {
    const latest = approved.reduce((a, b) => ((a.decided_at ?? "") >= (b.decided_at ?? "") ? a : b));
    return latest.progress ?? "검토중";
  }
  if (matches.some((c) => c.status === "pending")) return "승인 대기";
  return "없음";
};

const findPending = (type: CardType, eup?: string, category?: string): Card | undefined =>
  cards.find(
    (c) =>
      c.type === type &&
      c.status === "pending" &&
      (type === "INCENTIVE" || (c.target?.eup === eup && c.target?.category === category)),
  );

/**
 * `AC-`/`INC-` + 3자리 순번 — 기존 ID의 **최대 순번 + 1** (05 §8, 백엔드 `db.next_card_id`와 동일).
 * 개수+1이 아닌 이유: 비순차 ID가 섞이면 이미 쓰인 ID가 다시 나와 기존 카드를 덮어쓴다.
 */
const nextCardId = (prefix: string): string => {
  let mx = 0;
  for (const c of cards) {
    if (!c.id.startsWith(prefix)) continue;
    const suffix = c.id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue; // 순번이 아닌 접미사는 건너뛴다
    mx = Math.max(mx, Number(suffix));
  }
  return `${prefix}${String(mx + 1).padStart(3, "0")}`;
};

/** 도로 값은 공개 라우팅 API 추정치 — 소요시간 중심으로 적고 null이면 `—` (05 §1) */
const roadPhrase = (c: Candidate): string =>
  c.road_minutes === null
    ? "거점에서 도로 소요시간 —(경로 산출 실패)"
    : `거점에서 도로 소요시간 약 ${c.road_minutes.toFixed(1)}분`;

const candidateLabel = (c: Candidate): string => `${c.eup} ${c.category}`;

/**
 * EXPANSION 카드 생성 — mock에는 LLM이 없으므로 **규칙 기반**이다.
 * 근거 문장은 후보의 실제 수치(업종공백도·반경 내 가맹점 수·도로 소요시간)만 인용하고,
 * 없는 사실은 지어내지 않는다. 표현은 "확보"가 아니라 "가맹 전환·우선 모집"이다 (05 §2).
 */
/**
 * 생성 결과 — `created`는 신규 생성인지, 중복 가드로 **기존 pending 카드**를 돌려준 것인지다.
 * 실 API는 이를 201/200으로 구분한다(05 §8). 화면이 "카드가 하나 늘었다"고 단정하지 않으려면
 * mock도 같은 신호를 줘야 한다 (11 §1 2-b 단계).
 */
export type GeneratedCard = { card: Card; created: boolean };

const generateExpansion = (): GeneratedCard => {
  const ranked = rankedCandidates();
  const available = ranked.filter((c) => !isBlocked(targetState(c.eup, c.category)));
  if (available.length === 0) {
    // LLM 장애가 아니라 정상적인 도메인 신호 — 화면은 에러가 아니라 안내로 다룬다 (05 §8)
    throw new ApiError(409, "제안할 수 있는 신규 후보가 없습니다 (전 후보에 승인 대기 또는 진행 중인 업무가 있음)");
  }

  const top = available[0];
  const existing = findPending("EXPANSION", top.eup, top.category);
  if (existing) return { card: existing, created: false }; // 중복 가드 — 버튼 연타 대비 (05 §8)

  const skipped = ranked.filter((c) => c.rank < top.rank);
  const second = available[1] ?? ranked.find((c) => c.rank !== top.rank);
  const now = nowIso();

  const comparison =
    `1순위(제안) ${candidateLabel(top)} ${top.name} — Score ${top.score}(정량 ${top.rank}위), ` +
    `업종공백도 ${top.gap.toFixed(2)}, 반경 500m 내 동일 업종 하이원포인트 가맹점 ${top.nearby_merchants}곳, ` +
    `${roadPhrase(top)}. ` +
    (second
      ? `차순위 ${candidateLabel(second)} ${second.name} — Score ${second.score}(정량 ${second.rank}위), ` +
        `업종공백도 ${second.gap.toFixed(2)}, ${roadPhrase(second)}. `
      : "") +
    (skipped.length
      ? `Score 상위 ${skipped.map((c) => `${candidateLabel(c)}(추진 상태=${targetState(c.eup, c.category)})`).join("·")}은(는) ` +
        "중복 제안 금지 대상이라 제외했습니다. "
      : "") +
    "동선근접도는 직선거리 기반이고 도로 소요시간은 공개 라우팅 API 추정치라, 두 값은 후보 간 상대 비교로만 읽습니다.";

  const reasons = [
    ...skipped.map(
      (c) =>
        `Score ${c.rank}위 ${candidateLabel(c)}은(는) 추진 상태=${targetState(c.eup, c.category)}로 중복 제안 대상에서 제외`,
    ),
    `${candidateLabel(top)} ${top.name} — 업종공백도 ${top.gap.toFixed(2)}, 반경 500m 내 동일 업종 하이원포인트 가맹점 ${top.nearby_merchants}곳 / 동일 업종 상가 ${top.nearby_same_category_stores}곳`,
    `동선근접도 ${top.proximity.toFixed(2)}(직선거리 기반) / ${roadPhrase(top)}`,
    "진행 중인 업무가 없는 후보 중 후보 스코어 최상위를 결정론적으로 선택하고 설명만 구조화 데이터로 다시 검증합니다",
  ];

  const risks = [
    "신규 가맹점 초기 실적 저조 가능성",
    "가맹 신청은 사업자 의사에 달려 있어 접촉해도 분기 내 계약이 성사되지 않을 가능성",
    ...(top.road_minutes === null
      ? []
      : ["도로 소요시간은 공개 라우팅 API 추정치로 비포장·임도 구간이 포함될 수 있어 절대 수치로 인용할 수 없음"]),
  ];

  const card: Card = {
    id: nextCardId("AC-"),
    type: "EXPANSION",
    status: "pending", // AI는 제안만 — 확정은 담당자 승인 (절대 규칙 4)
    progress: null,
    title: `${top.eup} ${top.category} 업종 가맹점 확충`,
    target: { eup: top.eup, category: top.category },
    score_rank: top.rank,
    ai_rank: 1,
    selection_rank: 1,
    confidence: top.gap_confidence >= 0.8 && top.road_minutes !== null ? "중" : "하",
    ai: {
      adjusted: top.rank !== 1,
      selection_reason: top.rank === 1 ? "top_score" : "exclude_in_progress",
      comparison,
      reasons,
      risks,
      expected_effect: `${candidateLabel(top)} 후보의 가맹 전환 효과는 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (${ASSUMPTION_NOTE})`,
      dissent: EXPANSION_DISSENT,
      grounding: {
        status: "verified",
        numeric_status: "verified",
        narrative_status: "rule_based",
        selection_method: "deterministic_highest_available_score",
        explanation_source: "mock_rule",
        dissent_source: "rule_based",
        source: "structured",
        checks: ["target", "score", "rank", "progress", "road_time"],
      },
      // 정량 순위 상시 병기 — AI가 순위를 조정해도 원 Score 순위를 감추지 않는다 (절대 규칙 5)
      original_ranking: ranked.map((c) => ({
        rank: c.rank,
        candidate: candidateLabel(c),
        score: c.score,
      })),
    },
    scenarios: null,
    candidate_verification: {
      status: "unverified",
      checks: REQUIRED_ELIGIBILITY_CHECKS.map((label) => ({ key: label, label, status: "unverified" })),
      note: "후보 접촉·검토 시작은 가맹 확정이 아닙니다. 필수 적격성 확인 후 별도 가맹 심사를 거칩니다",
    },
    operations: {
      owner: null,
      target_date: null,
      expected_cost: null,
      contact_result: null,
      ineligible_reason: null,
      actual_outcome: null,
    },
    sources: EXPANSION_SOURCES,
    created_at: now,
    decided_at: null,
    events: [{ at: now, action: "generated" }],
  };
  cards = [card, ...cards];
  return { card, created: true };
};

/** cards.json의 INCENTIVE 시드 — 3/5/7% 골격·assumption_note를 그대로 복제해 쓴다 */
const incentiveSeed = (cardsSeed.cards as unknown as Card[]).find((c) => c.type === "INCENTIVE");

const generateIncentive = (): GeneratedCard => {
  const existing = findPending("INCENTIVE"); // pending INCENTIVE는 동시에 1장만 (05 §8)
  if (existing) return { card: existing, created: false };
  if (!incentiveSeed) throw new ApiError(503, "mock 시드에 INCENTIVE 카드가 없습니다");

  const now = nowIso();
  const card: Card = {
    ...(JSON.parse(JSON.stringify(incentiveSeed)) as Card),
    id: nextCardId("INC-"),
    status: "pending",
    progress: null,
    selected_rate: null, // 확정 rate는 담당자가 승인할 때만 들어온다 (05 §2)
    created_at: now,
    decided_at: null,
    events: [{ at: now, action: "generated" }],
  };
  cards = [card, ...cards];
  return { card, created: true };
};

/**
 * `POST /api/cards/generate` mock — 신규 카드 또는 중복 가드에 걸린 기존 pending 카드.
 * 선택 가능한 후보가 하나도 없으면 `ApiError(409)` (05 §8 — 정상 신호라 안내 문구로 다룬다).
 */
export const generateCard = (type: CardType): GeneratedCard =>
  type === "INCENTIVE" ? generateIncentive() : generateExpansion();

/* ── KPI 파생 (05 §3 / backend/app/routes/kpi.py와 동일 규칙) ─────────────── */

/**
 * 지역 소비 집중도 0~100 지수.
 * 산식 정본은 backend/app/services/simulate.py `concentration_index`
 * (파이프라인 `pipeline/common.py`의 산식을 사칙연산으로 복제한 것)와 동일하다.
 * 화면 노출 라벨은 항상 "지역 소비 집중도" — 내부 산식명은 UI에 쓰지 않는다 (절대 규칙 1).
 */
export const concentrationIndex = (counts: number[]): number => {
  const n = counts.length;
  const mean = counts.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let spread = 0;
  for (const a of counts) for (const b of counts) spread += Math.abs(a - b);
  spread = spread / (2 * n * n * mean);
  return (spread / (1 - 1 / n)) * 100;
};

const elapsedHours = (card: Card): number | null => {
  if (!card.created_at || !card.decided_at) return null;
  const ms = new Date(card.decided_at).getTime() - new Date(card.created_at).getTime();
  return Number.isFinite(ms) ? ms / 3_600_000 : null;
};

/**
 * 지역 균형지수 = 100 − 집중도(승인 EXPANSION 카드의 6지역 분포).
 * 분모는 REGIONS 6개 고정 — 승인 카드가 없는 지역도 0건으로 포함한다.
 * 승인 1장 = 0, 서로 다른 2개 지역 = 20 (05 §3 — 데모 초반의 낮은 값은 정상 동작).
 */
const balanceIndex = (approved: Card[]): number | null => {
  const counts: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r, 0]));
  let total = 0;
  for (const card of approved) {
    const eup = card.target?.eup;
    if (card.type === "EXPANSION" && eup && eup in counts) {
      counts[eup] += 1;
      total += 1;
    }
  }
  if (total === 0) return null;
  return Math.round(100 - concentrationIndex(REGIONS.map((r) => counts[r])));
};

export const deriveKpi = (): Kpi => {
  const all = listCards();
  const by = (s: CardStatus) => all.filter((c) => c.status === s);
  const approved = by("approved");
  const decided = [...approved, ...by("rejected"), ...by("held")];
  const running = approved.filter((c) => c.progress && RUNNING.includes(c.progress));
  const done = approved.filter((c) => c.progress === DONE);
  const hours = all.map(elapsedHours).filter((h): h is number => h !== null);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const averageDecisionHours = hours.length
    ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
    : null;
  return {
    adoption_rate: decided.length ? round2(approved.length / decided.length) : null,
    execution_rate: approved.length ? round2(running.length / approved.length) : null,
    avg_decision_hours: averageDecisionHours,
    avg_approval_hours: averageDecisionHours,
    regional_balance_index: balanceIndex(approved),
    counts: {
      total: all.length,
      pending: by("pending").length,
      approved: approved.length,
      rejected: by("rejected").length,
      held: by("held").length,
      decided: decided.length,
      done: done.length,
    },
  };
};

/* ── 추진 경과 리포트 파생 (backend/app/services/progress_report.py와 동일 규칙) ── */

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
const STALE_DAYS = 14;

const kstDateFromMs = (ms: number): string =>
  new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

const kstBoundaryMs = (date: string, end = false): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "기간은 YYYY-MM-DD 형식이어야 합니다");
  const suffix = end ? "T23:59:59.999+09:00" : "T00:00:00.000+09:00";
  const ms = new Date(`${date}${suffix}`).getTime();
  if (!Number.isFinite(ms) || kstDateFromMs(ms) !== date) {
    throw new ApiError(400, "유효하지 않은 날짜입니다");
  }
  return ms;
};

const reportPeriod = (opts: { from?: string; to?: string }) => {
  const today = kstDateFromMs(Date.now());
  const to = opts.to ?? today;
  const toStart = kstBoundaryMs(to);
  const from = opts.from ?? kstDateFromMs(toStart - 89 * DAY_MS);
  const startMs = kstBoundaryMs(from);
  const endMs = kstBoundaryMs(to, true);
  if (startMs > endMs) throw new ApiError(400, "from은 to보다 늦을 수 없습니다");
  if (to > today) throw new ApiError(400, "to는 KST 오늘보다 미래일 수 없습니다");
  return {
    from,
    to,
    startMs,
    endMs,
    days: Math.floor((toStart - startMs) / DAY_MS) + 1,
  };
};

const recordTime = (record: ProgressRecord): number => new Date(record.recorded_at).getTime();

const recordsByCard = (records: ProgressRecord[]): Map<string, ProgressRecord[]> => {
  const grouped = new Map<string, ProgressRecord[]>();
  for (const record of records) {
    const rows = grouped.get(record.card_id) ?? [];
    rows.push(record);
    grouped.set(record.card_id, rows);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => recordTime(a) - recordTime(b) || a.record_id.localeCompare(b.record_id));
  }
  return grouped;
};

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const reportNumber = (value: number | null, digits = 2): number | null => {
  if (value === null) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const metricChange = (
  key: ProgressMetricKey,
  grouped: Map<string, ProgressRecord[]>,
): ProgressMetricChange => {
  const baselines: number[] = [];
  const latest: number[] = [];
  for (const rows of grouped.values()) {
    const observed = rows
      .map((record) => record.metrics[key])
      .filter((value): value is number => value !== undefined && value !== null && Number.isFinite(value));
    if (observed.length < 2) continue;
    baselines.push(observed[0]);
    latest.push(observed[observed.length - 1]);
  }

  const baselineAverage = average(baselines);
  const latestAverage = average(latest);
  const delta = baselineAverage === null || latestAverage === null ? null : latestAverage - baselineAverage;
  const relativeEligible = key === "usage_count" || key === "active_merchant_count" || key === "spend_krw";
  const relative =
    relativeEligible && baselineAverage !== null && baselineAverage !== 0 && delta !== null
      ? (delta / Math.abs(baselineAverage)) * 100
      : null;
  const lowerIsBetter = key === "concentration_index";
  const deltaUnit: ProgressMetricChange["delta_unit"] =
    key === "conversion_rate_pct"
      ? "%p"
      : key === "concentration_index"
        ? "point"
        : key === "spend_krw"
          ? "KRW"
          : "count";

  return {
    baseline_average: reportNumber(baselineAverage),
    latest_average: reportNumber(latestAverage),
    delta: reportNumber(delta),
    delta_unit: deltaUnit,
    relative_change_pct: reportNumber(relative),
    improvement: reportNumber(delta === null ? null : lowerIsBetter ? -delta : delta),
    lower_is_better: lowerIsBetter,
    sample_size: baselines.length,
  };
};

export const deriveProgressReport = (opts: { from?: string; to?: string } = {}): ProgressReport => {
  const period = reportPeriod(opts);
  const inPeriod = progressRecords
    .filter((record) => {
      const at = recordTime(record);
      return at >= period.startMs && at <= period.endMs;
    })
    .sort((a, b) => recordTime(a) - recordTime(b) || a.record_id.localeCompare(b.record_id));
  const grouped = recordsByCard(inPeriod);
  // 모집단은 **기간 종료일 시점에 이미 승인돼 있던 카드**다 (BE routes/progress.py `_approved_as_of`).
  // 여기서 '현재 승인 카드 전체'를 쓰면 mock 모드와 실 API 모드가 같은 기간에 다른 미기록 건수를 낸다.
  const approvedAsOf = (card: Card): boolean =>
    Date.parse(card.created_at) <= period.endMs &&
    Date.parse(card.decided_at ?? card.created_at) <= period.endMs;
  const approved = cards.filter((card) => card.status === "approved" && approvedAsOf(card));
  const latestByCard = new Map<string, ProgressRecord>();

  for (const card of approved) {
    const latest = progressRecords
      .filter((record) => record.card_id === card.id && recordTime(record) <= period.endMs)
      .sort((a, b) => recordTime(b) - recordTime(a) || b.record_id.localeCompare(a.record_id))[0];
    if (latest) latestByCard.set(card.id, latest);
  }

  const statusDistribution = Object.fromEntries(ALL_PROGRESS.map((progress) => [progress, 0])) as Record<
    CardProgress,
    number
  >;
  for (const record of latestByCard.values()) statusDistribution[record.progress] += 1;

  const completedCount = [...latestByCard.values()].filter((record) => record.progress === "완료").length;
  const latestProgressValues: number[] = [];
  for (const rows of grouped.values()) {
    const value = [...rows].reverse().find((record) => record.progress_pct !== null)?.progress_pct;
    if (value !== undefined && value !== null) latestProgressValues.push(value);
  }

  const staleItems = approved
    .flatMap((card) => {
      const record = latestByCard.get(card.id);
      if (!record || record.progress === "완료") return [];
      const days = Math.floor((period.endMs - recordTime(record)) / DAY_MS);
      return days >= STALE_DAYS
        ? [{
            card_id: card.id,
            title: card.title,
            progress: record.progress,
            last_recorded_at: record.recorded_at,
            days_since_update: days,
          }]
        : [];
    })
    .sort((a, b) => b.days_since_update - a.days_since_update || a.card_id.localeCompare(b.card_id));

  let onTimeCount = 0;
  let onTimeSample = 0;
  for (const rows of grouped.values()) {
    const completed = rows.find((record) => record.progress === "완료");
    if (!completed) continue;
    const completedAt = recordTime(completed);
    const dueRecord = [...rows]
      .reverse()
      .find((record) => recordTime(record) <= completedAt && record.due_at !== null);
    if (!dueRecord?.due_at) continue;
    onTimeSample += 1;
    if (kstDateFromMs(completedAt) <= dueRecord.due_at) onTimeCount += 1;
  }

  const durationBuckets = new Map<
    string,
    { from: CardProgress; to: CardProgress; hours: number[] }
  >();
  for (const rows of grouped.values()) {
    const entries: ProgressRecord[] = [];
    for (const record of rows) {
      if (entries.at(-1)?.progress === record.progress) continue;
      entries.push(record);
    }
    for (let index = 1; index < entries.length; index += 1) {
      const from = entries[index - 1];
      const to = entries[index];
      const hours = (recordTime(to) - recordTime(from)) / 3_600_000;
      if (hours <= 0) continue;
      const key = `${from.progress}\u0000${to.progress}`;
      const bucket = durationBuckets.get(key) ?? { from: from.progress, to: to.progress, hours: [] };
      bucket.hours.push(hours);
      durationBuckets.set(key, bucket);
    }
  }

  const metricChanges = Object.fromEntries(
    METRIC_KEYS.map((key) => [key, metricChange(key, grouped)]),
  ) as Record<ProgressMetricKey, ProgressMetricChange>;
  const averageProgress = average(latestProgressValues);
  const recordedCardCount = latestByCard.size;

  return {
    period: {
      from: period.from,
      to: period.to,
      timezone: "Asia/Seoul",
      days: period.days,
    },
    record_count: inPeriod.length,
    recorded_card_count: recordedCardCount,
    cards_without_records: Math.max(0, approved.length - recordedCardCount),
    status_distribution: statusDistribution,
    completion: {
      rate: recordedCardCount ? reportNumber(completedCount / recordedCardCount, 4) : null,
      completed_count: completedCount,
      sample_size: recordedCardCount,
    },
    average_progress_pct: {
      value: reportNumber(averageProgress, 1),
      sample_size: latestProgressValues.length,
    },
    stale: {
      threshold_days: STALE_DAYS,
      count: staleItems.length,
      items: staleItems,
    },
    on_time: {
      rate: onTimeSample ? reportNumber(onTimeCount / onTimeSample, 4) : null,
      on_time_count: onTimeCount,
      sample_size: onTimeSample,
    },
    stage_durations: [...durationBuckets.values()].map((bucket) => ({
      from_progress: bucket.from,
      to_progress: bucket.to,
      sample_size: bucket.hours.length,
      average_hours: reportNumber(average(bucket.hours)),
      median_hours: reportNumber(median(bucket.hours)),
    })),
    metric_changes: metricChanges,
  };
};

/* ── 위젯 추천 파생 (05 §4 / backend/app/routes/widget.py와 동일 규칙) ────── */

const merchants = candidatesMock.merchants as Merchant[];

/** 거점(ANCHOR)까지의 직선거리(km) — 추천 정렬 2차 키. 좌표가 없으면 맨 뒤로 */
const anchorKm = (m: Merchant): number => {
  if (m.lat === null || m.lat === undefined || m.lng === null || m.lng === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const R = 6371;
  const p1 = (ANCHOR.lat * Math.PI) / 180;
  const p2 = (m.lat * Math.PI) / 180;
  const a =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin((((m.lng - ANCHOR.lng) * Math.PI) / 180) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

/** `progress=완료`인 EXPANSION 카드의 (읍, 업종) 집합 — 확충 업종 배지 매칭 키 */
const newTargets = (): Set<string> => {
  const out = new Set<string>();
  for (const card of cards) {
    if (card.type === "EXPANSION" && card.progress === DONE && card.target?.eup && card.target?.category) {
      out.add(`${card.target.eup}|${card.target.category}`);
    }
  }
  return out;
};

/**
 * `완료`된 INCENTIVE 카드의 selected_rate → 페이백 배지. 없으면 null.
 * 페이백은 전 지역 공통 적용이라 추천 항목 전체에 동일하게 붙는다.
 */
const payback = (): Recommendation["payback"] => {
  const done = cards.filter(
    (c) => c.type === "INCENTIVE" && c.progress === DONE && c.selected_rate,
  );
  if (done.length === 0) return null;
  const latest = done.reduce((a, b) => ((a.decided_at ?? "") >= (b.decided_at ?? "") ? a : b));
  const rate = latest.selected_rate as PaybackRate;
  return { rate, label: `지금 여기서 쓰면 ${rate}% 페이백` };
};

/**
 * mock 모드 blurb — 실 API와 동일하게 이름·지역·업종만으로 결정론적으로 만든다.
 */
const fallbackBlurb = (m: Merchant): string => `${m.eup}의 ${m.category} 하이원포인트 가맹점이에요`;

export const deriveWidget = (
  region?: string,
  category?: string,
  limit = WIDGET_DEFAULT_LIMIT,
): WidgetResponse => {
  const targets = newTargets();
  const pay = payback();
  const rows = merchants.filter(
    (m) => (!region || m.eup === region) && (!category || m.category === category),
  );
  // 정렬 키는 backend/app/routes/widget.py와 동일하게 (완료 카드 매칭 먼저, 그다음 거점 거리)
  const isNew = (m: Merchant) => targets.has(`${m.eup}|${m.category}`);
  const sorted = [...rows].sort(
    (a, b) => Number(isNew(b)) - Number(isNew(a)) || anchorKm(a) - anchorKm(b),
  );
  const visibleLimit = Math.max(1, Math.min(WIDGET_MAX_LIMIT, limit));
  return {
    recommendations: sorted.slice(0, visibleLimit).map((m) => ({
      name: m.name,
      category: m.category,
      address: m.address,
      lat: m.lat,
      lng: m.lng,
      badge: isNew(m) ? ("이번 분기 확충 업종" as const) : null,
      directions_url: `https://map.kakao.com/link/to/${encodeURIComponent(m.name)},${m.lat},${m.lng}`,
      payback: pay,
      blurb: fallbackBlurb(m),
    })),
    policy_note: POLICY_NOTE,
    total: sorted.length,
  };
};
