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
 */
import type {
  Card,
  CardProgress,
  CardStatus,
  Kpi,
  Merchant,
  PaybackRate,
  Recommendation,
  WidgetResponse,
} from "@/types";
import { ANCHOR, REGIONS } from "@/lib/constants";
import cardsSeed from "./cards.json";
import candidatesMock from "./candidates.json";

const DONE = "완료";
const RUNNING: CardProgress[] = ["추진중", "완료"];
const WIDGET_LIMIT = 3;
const POLICY_NOTE = "확충 완료된 신규 가맹점을 우선 추천합니다";

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

/** 승인/반려/보류 — INCENTIVE 승인에는 selected_rate가 필수 (05 §2·§8) */
export const decide = (id: string, decision: CardStatus, selectedRate?: PaybackRate): Card => {
  const card = getCard(id);
  if (!card) throw new Error("card not found");
  if (card.status !== "pending") throw new Error(`이미 ${card.status} 상태인 카드입니다`);
  if (card.type === "INCENTIVE" && decision === "approved" && !selectedRate) {
    throw new Error("selected_rate(3|5|7)가 필요합니다");
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
  if (!card) throw new Error("card not found");
  if (card.status !== "approved") throw new Error("승인된 카드만 상태를 변경할 수 있습니다");
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

/** `progress=완료`인 EXPANSION 카드의 (읍, 업종) 집합 — `신규` 배지 매칭 키 */
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
 * mock 모드 blurb — 실 API는 LLM이 쓰고 실패 시 이 규칙 기반 문구로 대체한다 (05 §8).
 * mock에는 LLM이 없으므로 항상 규칙 기반. 이름·지역·업종 외의 사실은 지어내지 않는다.
 */
const fallbackBlurb = (m: Merchant, isNew: boolean): string =>
  isNew
    ? `${m.eup}에 새로 생긴 ${m.category} 하이원포인트 가맹점이에요`
    : `${m.eup}의 ${m.category} 하이원포인트 가맹점이에요`;

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
      badge: isNew(m) ? ("신규" as const) : null,
      payback: pay,
      blurb: fallbackBlurb(m, isNew(m)),
    })),
    policy_note: POLICY_NOTE,
  };
};
