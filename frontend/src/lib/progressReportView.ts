import { EXPANSION_PROGRESS, INCENTIVE_PROGRESS, normalizedProgress } from "@/lib/cardWorkflow";
import { PROGRESS_METRICS } from "@/lib/progressMetrics";
import type { Card, CardProgress, CardType, ProgressMetricKey, ProgressRecord } from "@/types";

/**
 * 추진 경과 리포트(/tracking)의 파생 계산 — 순수 함수 모음 (lib/regionAnalysis.ts와 같은 위치·역할).
 *
 * 서버 컴포넌트에서만 호출한다: `"use client"`를 붙이거나 lib/api·mocks/store를 import 하면
 * mock JSON(330KB)이 브라우저 번들로 끌려간다. 여기서는 **이미 받아 온 응답만** 가공한다.
 *
 * 파생 규칙은 backend/app/services/progress_report.py와
 * backend/app/progress_db.latest_record(through=)의 정의를 그대로 복제한 것이다 — 정의가 갈리면
 * 같은 화면에서 BE 집계 숫자와 FE 목록이 서로 다른 말을 한다.
 */

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * BE 제약 (backend/app/routes/progress.py get_progress_report):
 *   from > to → 400 / to > KST 오늘 → 400 / (to - from).days >= 366 → 400
 * 따라서 만들 수 있는 최대 구간은 `from = to - 365일`(delta 365 < 366, 포함 일수 366일)이다.
 * mock(mocks/store.ts reportPeriod)은 366일 제한을 **검사하지 않으므로** 이 상한은 FE가 지켜야
 * mock 모드와 실 API 모드가 같은 화면을 만든다.
 */
export const MAX_PERIOD_DAYS = 366;

/** epoch ms → KST 'YYYY-MM-DD'. 서버 타임존과 무관하다 (mocks/store.ts kstDateFromMs와 같은 규칙) */
export const kstDate = (ms: number): string => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

export const kstToday = (): string => kstDate(Date.now());

const dayMs = (date: string): number => Date.parse(`${date}T00:00:00+09:00`);

/** '2026-08-03T12:00:00+09:00' → '2026-08-03' (오프셋이 붙어 있어 파싱이 결정적이다) */
export const kstDateOfIso = (iso: string): string | null => {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? kstDate(ms) : null;
};

export const shiftDays = (date: string, days: number): string => kstDate(dayMs(date) + days * DAY_MS);

/** 두 날짜의 간격(일). BE의 `(end - start).days`와 같은 값이라 400 조건을 그대로 재현한다 */
const spanDays = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);

/** 형식·달력 유효성을 모두 통과한 날짜만 돌려준다 ('2026-02-30' 같은 없는 날짜 차단) */
const validDate = (value: string): string | null => {
  if (!DATE_RE.test(value)) return null;
  const ms = dayMs(value);
  if (!Number.isFinite(ms)) return null;
  return kstDate(ms) === value ? value : null;
};

/* ── 기간 프리셋 (T-A) ─────────────────────────────────────────── */

export interface PeriodPreset {
  id: string;
  label: string;
  /** 포함 일수 (from = to - (days - 1)) */
  days: number;
  hint: string;
}

/**
 * 프리셋은 BE 조회 한도(최대 366일·종료일은 KST 오늘) 안에서만 만든다.
 * "데이터 전 기간"을 만들려면 최초 기록일을 알아야 하는데 그 값을 얻으려면 카드별 기록을 먼저
 * 받아야 해 순환이고, 알아내도 366일에서 잘린다 — 없는 범위를 약속하지 않고 `최근 1년`으로 둔다.
 */
export const PERIOD_PRESETS: PeriodPreset[] = [
  { id: "30", label: "최근 30일", days: 30, hint: "이번 달 흐름" },
  { id: "90", label: "최근 90일", days: 90, hint: "분기 기본값" },
  { id: "180", label: "최근 180일", days: 180, hint: "반기" },
  { id: "366", label: "최근 1년", days: MAX_PERIOD_DAYS, hint: "조회 한도 366일" },
];

/** BE 기본값(to = KST 오늘, from = to - 89일)과 같은 구간 */
const DEFAULT_PRESET_ID = "90";
const DEFAULT_DAYS = 90;

const presetFrom = (preset: PeriodPreset, to: string): string => shiftDays(to, -(preset.days - 1));

export function presetIdFor(from: string, to: string): string | null {
  if (to !== kstToday()) return null;
  return PERIOD_PRESETS.find((preset) => presetFrom(preset, to) === from)?.id ?? null;
}

/**
 * 프리셋 링크 — 기본 90일은 쿼리 없이 `/tracking`으로 둔다(BE 기본값과 같은 구간이라
 * 파라미터를 붙일 이유가 없고, 공유된 URL이 날짜로 굳지 않는다).
 * `today`를 인자로 받는 이유: 컴포넌트마다 Date.now()를 다시 읽으면 자정 경계에서 링크가 갈린다.
 */
export const periodHref = (preset: PeriodPreset, today = kstToday()): string =>
  preset.id === DEFAULT_PRESET_ID
    ? "/tracking"
    : `/tracking?${new URLSearchParams({ from: presetFrom(preset, today), to: today }).toString()}`;

export interface ResolvedPeriod {
  /** api.progressReport에 넘길 인자. 기본 90일이면 {}로 두어 BE 기본값을 그대로 쓴다 */
  query: { from?: string; to?: string };
  from: string;
  to: string;
  days: number;
  /** 프리셋과 정확히 일치할 때만 값이 있다 */
  activePresetId: string | null;
  /** 쿼리스트링이 계약 범위를 벗어나 기본값으로 되돌렸는지 — 화면이 조용히 다른 값을 보여주면 안 된다 */
  invalid: boolean;
}

/** Next의 반복 쿼리(`?from=a&from=b`)와 빈 값(`?from=`)을 한 값으로 좁힌다 */
const one = (value?: string | string[]): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === "" ? undefined : first;
};

/**
 * 쿼리스트링 → 실제로 요청할 기간. 사람이 URL을 고쳐 넣어도 화면이 죽지 않게,
 * 계약 범위를 벗어나면 기본 90일로 되돌리고 그 사실(`invalid`)을 화면이 밝힌다.
 */
export function resolvePeriod(raw: { from?: string | string[]; to?: string | string[] }): ResolvedPeriod {
  const today = kstToday();
  const fallback = (invalid: boolean): ResolvedPeriod => ({
    query: {},
    from: shiftDays(today, -(DEFAULT_DAYS - 1)),
    to: today,
    days: DEFAULT_DAYS,
    activePresetId: DEFAULT_PRESET_ID,
    invalid,
  });

  const rawFrom = one(raw.from);
  const rawTo = one(raw.to);
  if (rawFrom === undefined && rawTo === undefined) return fallback(false);

  const parsedFrom = rawFrom === undefined ? undefined : validDate(rawFrom);
  const parsedTo = rawTo === undefined ? undefined : validDate(rawTo);
  if (parsedFrom === null || parsedTo === null) return fallback(true);

  const to = parsedTo ?? today;
  const from = parsedFrom ?? shiftDays(to, -(DEFAULT_DAYS - 1));
  // BE의 400 조건 3개를 그대로 앞당겨 검사한다 (400을 받고 에러 화면으로 떨어지는 것보다 낫다)
  if (from > to || to > today || spanDays(from, to) >= MAX_PERIOD_DAYS) return fallback(true);

  const activePresetId = presetIdFor(from, to);
  return {
    query: activePresetId === DEFAULT_PRESET_ID ? {} : { from, to },
    from,
    to,
    days: spanDays(from, to) + 1,
    activePresetId,
    invalid: false,
  };
}

/* ── 카드별 기록 파생 (T-B~T-E) ────────────────────────────────── */

export interface CardRecordsResult {
  card: Card;
  /**
   * 서버가 준 최신순 그대로. 재정렬 금지 — 동시각 기록에서 서버와 다른 이웃을 골라
   * 델타 부호가 뒤집힌다 (ProgressRecordTimeline 주석과 같은 이유).
   */
  records: ProgressRecord[];
  /** next_cursor가 있어 더 오래된 기록이 잘렸는지 */
  hasMore: boolean;
  /** 이 카드만 실패 — 나머지 카드는 계속 그린다 */
  failed: boolean;
}

/**
 * 기간 안(양끝 포함)의 기록만, **오래된→최신** 순으로.
 * BE `list_report_records`가 쓰는 구간 정의와 같다.
 */
export function recordsWithin(records: ProgressRecord[], from: string, to: string): ProgressRecord[] {
  const inside = records.filter((record) => {
    const date = kstDateOfIso(record.recorded_at);
    return date !== null && date >= from && date <= to;
  });
  return inside.reverse();
}

/**
 * 기간 **종료일까지**의 최신 기록 1건. 하한이 없는 것이 핵심이다 —
 * BE `progress_db.latest_record(card_id, through=end)`가 그렇고, 여기에 하한을 걸면
 * 상태 분포와 미기록 판정이 리포트 숫자와 어긋난다.
 * records가 최신순이므로 조건을 만족하는 첫 원소가 답이다.
 */
export function latestThrough(records: ProgressRecord[], to: string): ProgressRecord | null {
  for (const record of records) {
    const date = kstDateOfIso(record.recorded_at);
    if (date !== null && date <= to) return record;
  }
  return null;
}

export interface WorkflowLayer {
  type: CardType;
  title: string;
  /** "후보 접촉·검토 시작 → … → 완료 (+보류)" */
  flowLabel: string;
  stages: CardProgress[];
  counts: Partial<Record<CardProgress, number>>;
  total: number;
}

const LAYER_TITLE: Record<CardType, string> = {
  EXPANSION: "가맹점 확충",
  INCENTIVE: "페이백 인센티브",
};

/**
 * 표시 순서 — **집합은 cardWorkflow의 정본 배열에서 파생**한다.
 * 원소를 손으로 다시 적으면 하나 빠졌을 때 그 상태의 카드가 어느 칩에도 안 잡혀
 * 헤더 건수와 칩 합계가 조용히 어긋난다(예전 STAGES 상수가 경고하던 함정 그대로다).
 * 보류는 흐름의 중간이 아니라 이탈이므로 자리만 맨 뒤로 옮긴다.
 */
const orderedStages = (stages: CardProgress[]): CardProgress[] => [
  ...stages.filter((stage) => stage !== "보류"),
  ...stages.filter((stage) => stage === "보류"),
];

const flowLabelOf = (stages: CardProgress[]): string =>
  `${stages.filter((stage) => stage !== "보류").join(" → ")} (+보류)`;

const STAGE_ORDER: Record<CardType, CardProgress[]> = {
  EXPANSION: orderedStages(EXPANSION_PROGRESS),
  INCENTIVE: orderedStages(INCENTIVE_PROGRESS),
};

const emptyLayers = (): Record<CardType, WorkflowLayer> => ({
  EXPANSION: {
    type: "EXPANSION",
    title: LAYER_TITLE.EXPANSION,
    flowLabel: flowLabelOf(STAGE_ORDER.EXPANSION),
    stages: STAGE_ORDER.EXPANSION,
    counts: {},
    total: 0,
  },
  INCENTIVE: {
    type: "INCENTIVE",
    title: LAYER_TITLE.INCENTIVE,
    flowLabel: flowLabelOf(STAGE_ORDER.INCENTIVE),
    stages: STAGE_ORDER.INCENTIVE,
    counts: {},
    total: 0,
  },
});

const bump = (layer: WorkflowLayer, stage: CardProgress): boolean => {
  if (!layer.stages.includes(stage)) return false;
  layer.counts[stage] = (layer.counts[stage] ?? 0) + 1;
  layer.total += 1;
  return true;
};

/**
 * 기간 종료일 시점에 **이미 승인돼 있던** 카드만 남긴다 —
 * backend/app/routes/progress.py `_approved_as_of`와 같은 정의다 (05 §8).
 *
 * BE는 리포트 집계의 모집단을 이렇게 좁히는데 화면이 '현재 승인 카드 전체'를 쓰면, 기간
 * 종료일보다 늦게 승인된 카드가 있는 순간 헤더의 집계 숫자(0건)와 바로 아래 목록(1~2장)이
 * 서로 다른 말을 한다. 프리셋(to=오늘)에서는 두 모집단이 같지만 URL을 직접 고치면 갈린다.
 *
 * `decided_at`이 비어 있는 승인 카드는 승인 시점을 알 수 없으므로 `created_at`으로 판정한다.
 */
export function approvedAsOf(results: CardRecordsResult[], to: string): CardRecordsResult[] {
  return results.filter(({ card }) => {
    const created = kstDateOfIso(card.created_at);
    const decided = card.decided_at ? kstDateOfIso(card.decided_at) : created;
    return created !== null && decided !== null && created <= to && decided <= to;
  });
}

/**
 * 승인 카드 목록을 유형별 단계 칩으로 (T-E, 업무 목록 헤더용).
 *
 * `progress`가 null인 승인 카드도 유형별 첫 단계로 폴백해 반드시 한 칩에 들어간다
 * (05 §2가 null을 허용한다. ProgressSelect·workflowLabel과 같은 폴백 규칙).
 *
 * **불변식**: layers.reduce((sum, layer) => sum + layer.total, 0) + unclassified === rows.length
 */
export function workflowLayers(rows: Card[]): { layers: WorkflowLayer[]; unclassified: number } {
  const byType = emptyLayers();
  let unclassified = 0;
  for (const card of rows) {
    const stage =
      normalizedProgress(card) ?? (card.type === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");
    if (!bump(byType[card.type], stage)) unclassified += 1;
  }
  return { layers: [byType.EXPANSION, byType.INCENTIVE], unclassified };
}

/**
 * 카드별 **최신 경과 기록**을 유형별 단계 칩으로 (T-E, 리포트 상태 분포용).
 *
 * 기록의 `progress`를 그대로 쓴다 — BE status_distribution과 같은 정의다.
 * normalizedProgress로 재작성하지 않는 이유: EXPANSION은 progressOptions 검증 때문에
 * "검토중" 기록을 애초에 저장할 수 없어 재작성할 값이 없다.
 * 최신 기록이 없는 카드는 건너뛴다(= 미기록, 분포에서 제외).
 */
export function distributionLayers(
  results: CardRecordsResult[],
  to: string,
): { layers: WorkflowLayer[]; total: number; unclassified: number } {
  const byType = emptyLayers();
  let unclassified = 0;
  for (const result of results) {
    const latest = latestThrough(result.records, to);
    if (latest === null) continue;
    if (!bump(byType[result.card.type], latest.progress)) unclassified += 1;
  }
  const layers = [byType.EXPANSION, byType.INCENTIVE];
  return { layers, total: layers.reduce((sum, layer) => sum + layer.total, 0) + unclassified, unclassified };
}

/**
 * 기간 종료일까지 기록이 하나도 없는 승인 카드 (T-D).
 * `failed`(요청 실패)는 판정 불가라 제외한다 — 모르는 것을 미기록이라 단정하지 않는다.
 */
export function unrecordedCards(results: CardRecordsResult[], to: string): Card[] {
  return results
    .filter((result) => !result.failed && latestThrough(result.records, to) === null)
    .map((result) => result.card);
}

export interface MetricCardSeries {
  cardId: string;
  title: string;
  values: number[];
  firstAt: string;
  lastAt: string;
}

export interface MetricSeries {
  key: ProgressMetricKey;
  cards: MetricCardSeries[];
}

/**
 * 기간 내 관측값을 지표별·카드별 시계열로 (T-C).
 *
 * 여러 카드의 값을 한 선으로 평균 내지 않는다 — 카드마다 관측 시점이 달라 없는 추세를 만들어 낸다.
 * 카드 1장 = 줄 1개로만 그리고, 변화를 말할 수 있는 2건 이상만 담는다(기초값·최신값 두 점이 필요).
 */
export function metricSeries(
  results: CardRecordsResult[],
  from: string,
  to: string,
): MetricSeries[] {
  const withinByCard = results.map((result) => ({
    card: result.card,
    records: recordsWithin(result.records, from, to),
  }));

  const series: MetricSeries[] = [];
  for (const meta of PROGRESS_METRICS) {
    const cards: MetricCardSeries[] = [];
    for (const entry of withinByCard) {
      const observed = entry.records.filter((record) => {
        const value = record.metrics?.[meta.key];
        return value !== undefined && value !== null;
      });
      if (observed.length < 2) continue;
      cards.push({
        cardId: entry.card.id,
        title: entry.card.title,
        values: observed.map((record) => record.metrics[meta.key] as number),
        firstAt: observed[0].recorded_at,
        lastAt: observed[observed.length - 1].recorded_at,
      });
    }
    if (cards.length) series.push({ key: meta.key, cards });
  }
  return series;
}
