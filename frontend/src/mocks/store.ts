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
  Kpi,
  Merchant,
  PaybackRate,
  Recommendation,
  WidgetResponse,
} from "@/types";
import { ANCHOR, ASSUMPTION_NOTE, REGIONS } from "@/lib/constants";
import { ApiError } from "@/lib/errors";
import cardsSeed from "./cards.json";
import candidatesMock from "./candidates.json";

const DONE = "완료";
const RUNNING: CardProgress[] = ["추진중", "완료"];
const WIDGET_LIMIT = 3;
const POLICY_NOTE = "이번 분기 확충이 완료된 업종을 우선 추천합니다";

/** import한 JSON 모듈을 직접 변형하지 않도록 깊은 복사 후 보관 */
let cards: Card[] = JSON.parse(JSON.stringify(cardsSeed.cards)) as Card[];

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
  card.progress = decision === "approved" ? "검토중" : null;
  if (card.type === "INCENTIVE" && decision === "approved") card.selected_rate = selectedRate ?? null;
  card.events = [...(card.events ?? []), { at, action: decision }];
  return card;
};

/** 추진 상태 변경 — approved 카드만 가능 (05 §8) */
export const setProgress = (id: string, progress: CardProgress): Card => {
  const card = getCard(id);
  if (!card) throw new ApiError(404, "card not found");
  if (card.status !== "approved") {
    throw new ApiError(409, `approved 카드만 추진 상태를 바꿀 수 있습니다 (현재 status=${card.status})`);
  }
  const at = nowIso();
  card.progress = progress;
  card.events = [...(card.events ?? []), { at, action: `progress:${progress}` }];
  return card;
};

/** "이번 분기 카드 생성" mock — 실 API는 스코어링+LLM으로 만든다 (05 §2) */
export const addCard = (card: Card): Card => {
  cards = [card, ...cards];
  return card;
};

/* ── 카드 생성 (05 §2·§8 / backend/app/services/cardgen.py와 동일 규칙) ────── */

/** A-1 중복 제안 금지 대상 progress — 백엔드 `cardgen.BLOCKED`. (KPI의 RUNNING과 값은 같지만 다른 규칙이다) */
const BLOCKED: CardProgress[] = ["추진중", "완료"];
const isBlocked = (state: string): boolean => BLOCKED.some((p) => p === state);
/** 백엔드 `cardgen.EXPANSION_SOURCES`와 동일 */
const EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"];

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
    throw new ApiError(409, "제안할 수 있는 신규 후보가 없습니다 (전 후보가 추진중/완료 상태)");
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
    `${candidateLabel(top)} ${top.name} — 업종공백도 ${top.gap.toFixed(2)}, 반경 500m 내 동일 업종 하이원포인트 가맹점 ${top.nearby_merchants}곳(전체 상가 ${top.nearby_stores}곳)`,
    `동선근접도 ${top.proximity.toFixed(2)}(직선거리 기반) / ${roadPhrase(top)}`,
    "mock 모드에서 규칙 기반으로 생성된 카드입니다 — 실 API 모드에서는 AI가 후보 비교·근거 문장을 생성합니다",
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
    confidence: "중", // LLM 없이 규칙만으로 고른 제안이라 상으로 올리지 않는다
    ai: {
      adjusted: top.rank !== 1,
      comparison,
      reasons,
      risks,
      expected_effect: `${candidateLabel(top)} 공백 해소로 지역 소비 접점 확대 예상 (${ASSUMPTION_NOTE})`,
      // 정량 순위 상시 병기 — AI가 순위를 조정해도 원 Score 순위를 감추지 않는다 (절대 규칙 5)
      original_ranking: ranked.map((c) => ({
        rank: c.rank,
        candidate: candidateLabel(c),
        score: c.score,
      })),
    },
    scenarios: null,
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
 * 가용 후보가 하나도 없으면 `ApiError(409)` (05 §8 — 정상 신호라 안내 문구로 다룬다).
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
  const running = approved.filter((c) => c.progress && RUNNING.includes(c.progress));
  const done = approved.filter((c) => c.progress === DONE);
  const hours = all.map(elapsedHours).filter((h): h is number => h !== null);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    adoption_rate: all.length ? round2(approved.length / all.length) : null,
    execution_rate: approved.length ? round2(running.length / approved.length) : null,
    avg_approval_hours: hours.length
      ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
      : null,
    regional_balance_index: balanceIndex(approved),
    counts: {
      total: all.length,
      pending: by("pending").length,
      approved: approved.length,
      rejected: by("rejected").length,
      held: by("held").length,
      done: done.length,
    },
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

export const deriveWidget = (region?: string, category?: string): WidgetResponse => {
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
  return {
    recommendations: sorted.slice(0, WIDGET_LIMIT).map((m) => ({
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
  };
};
