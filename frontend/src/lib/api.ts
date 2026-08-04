/**
 * 단일 데이터 접근 계층 — 모든 화면은 이 파일만 통해 데이터를 얻는다 (docs/plan/08 F1).
 *
 * `NEXT_PUBLIC_API_BASE`가 비어 있으면 **mock 모드**: `src/mocks/`의 JSON과 `mocks/store.ts`가
 * 응답을 대신한다. 값을 채우면 코드 수정 없이 실 API로 전환된다.
 *
 * 08 문서 예시와 한 곳 다르다: mock 인자를 값이 아니라 **thunk `() => T`** 로 받는다.
 * 값으로 받으면 실 API 모드에서도 `store.decide(...)` 같은 mock 변경 함수가 매번 실행돼
 * (상태 전이 검증에 걸려) 실 호출이 깨진다. 실행을 mock 모드로 미루기 위한 최소 변경이다.
 *
 * ⚠ 이 파일은 mock JSON(merchants 330KB 포함)을 정적 import 한다. 지금은 **서버 컴포넌트에서만**
 *    호출하므로 브라우저 번들에 들어가지 않는다. `"use client"` 컴포넌트에서 import 하면
 *    mock 전체가 클라이언트 번들에 실린다 — 클라이언트에서 써야 하면 서버에서 받아 props로 넘길 것.
 */
import type {
  Card,
  CandidatesResponse,
  CardProgress,
  CardStatus,
  CardType,
  Dashboard,
  Kpi,
  PaybackRate,
  RiskSignal,
  Simulation,
  WidgetResponse,
} from "@/types";
import { ApiError } from "@/lib/errors";
import dashboardMock from "@/mocks/dashboard.json";
import candidatesMock from "@/mocks/candidates.json";
import riskSignalMock from "@/mocks/risk_signal.json";
import simulateMock from "@/mocks/simulate.json";
import * as store from "@/mocks/store";

const BASE = process.env.NEXT_PUBLIC_API_BASE;

/** 실 API 모드인지 — 화면에서 "mock 데이터" 고지를 띄울 때 쓴다 */
export const isMockMode = !BASE;

/**
 * 비2xx → `ApiError(status, detail)`. 에러 본문은 계약상 `{"detail": "메시지"}`다 (05 머리말).
 * 상태코드를 살려 던져야 호출부가 **409(제안할 신규 후보 없음·잘못된 상태 전이)를 구분**해
 * 에러가 아닌 안내로 표시할 수 있다 (08 F3).
 */
async function fail(res: Response, path: string): Promise<never> {
  let detail = `${path}: ${res.status}`; // 파싱 실패 시 상태코드 문구
  try {
    const body: unknown = await res.json();
    const parsed = (body as { detail?: unknown } | null)?.detail;
    if (typeof parsed === "string" && parsed.trim()) detail = parsed;
  } catch {
    // JSON이 아닌 에러 본문(게이트웨이 HTML 등) — 위 기본 문구를 그대로 쓴다
  }
  throw new ApiError(res.status, detail);
}

async function get<T>(path: string, mock: () => T): Promise<T> {
  if (!BASE) return mock(); // mock 모드
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) await fail(res, path);
  return res.json();
}

async function post<T>(path: string, body: unknown, mock: () => T): Promise<T> {
  return (await postWithStatus(path, body, () => ({ data: mock(), status: 200 }))).data;
}

/**
 * `post`와 같지만 **상태코드까지** 돌려준다. generate 전용 —
 * 05 §8이 신규 생성 201과 중복 가드로 기존 카드를 돌려주는 200을 구분하는데,
 * 본문만 보면 둘이 같아서 화면이 "새로 만들었다"고 단정하거나 반대로 늘 얼버무리게 된다.
 */
async function postWithStatus<T>(
  path: string,
  body: unknown,
  mock: () => { data: T; status: number },
): Promise<{ data: T; status: number }> {
  if (!BASE) return mock(); // mock 모드: mock/store.ts가 로컬 상태를 갱신하고 그 결과를 돌려준다
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) await fail(res, path);
  return { data: (await res.json()) as T, status: res.status };
}

const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v) as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

export const api = {
  /* ── 진단·대시보드 (05 §1) ─────────────────────────────────── */
  dashboard: (): Promise<Dashboard> => get("/api/dashboard", () => dashboardMock as Dashboard),

  candidates: (): Promise<CandidatesResponse> =>
    get("/api/candidates", () => candidatesMock as unknown as CandidatesResponse),

  /** 운영 2년 미만 사업자 비중 — 배경 정보. '위험' 라벨·순위 정렬 금지 (05 §6) */
  riskSignal: (): Promise<RiskSignal[]> => get("/api/risk-signal", () => riskSignalMock),

  /* ── Action Card (05 §2) ───────────────────────────────────── */
  cards: (opts: { type?: CardType; status?: CardStatus } = {}): Promise<{ cards: Card[] }> =>
    get(`/api/cards${qs(opts)}`, () => ({ cards: store.listCards(opts) })),

  card: (id: string): Promise<{ card: Card | undefined }> =>
    get(`/api/cards/${id}`, () => ({ card: store.getCard(id) })),

  /**
   * "이번 분기 카드 생성" — mock 모드도 `store.generateCard(type)`가 후보·중복 가드를 보고 만든다.
   * 목업 카드를 호출부가 넘기던 구조를 걷어냈다: 화면마다 목업을 복제하면 서사가 갈라진다.
   * 가용 후보가 전부 추진중/완료면 양쪽 모드 모두 409를 던진다 (05 §8).
   *
   * `created`는 **신규 생성(201)인지 중복 가드로 기존 카드를 받은 것(200)인지**다. 실호출에서
   * 두 경우가 모두 나오는 것을 확인했고(LLM이 pending 타깃을 고르면 200), 화면이 이를 구분해야
   * 데모 2-b("카드가 하나 늘어남")에서 사실과 다른 말을 하지 않는다 (11 §1).
   */
  generate: async (type: CardType): Promise<{ card: Card; created: boolean }> => {
    const { data, status } = await postWithStatus<{ card: Card }>(
      "/api/cards/generate",
      { type },
      () => {
        const { card, created } = store.generateCard(type);
        return { data: { card }, status: created ? 201 : 200 };
      },
    );
    return { card: data.card, created: status === 201 };
  },

  /** INCENTIVE를 approved 할 때는 selectedRate(3|5|7) 필수 (05 §2·§8) */
  decide: (id: string, decision: CardStatus, selectedRate?: PaybackRate): Promise<{ card: Card }> =>
    post(
      `/api/cards/${id}/decision`,
      { decision, ...(selectedRate ? { selected_rate: selectedRate } : {}) },
      () => ({ card: store.decide(id, decision, selectedRate) }),
    ),

  progress: (id: string, progress: CardProgress): Promise<{ card: Card }> =>
    post(`/api/cards/${id}/progress`, { progress }, () => ({ card: store.setProgress(id, progress) })),

  /** EXPANSION 전용 — INCENTIVE에 호출하면 실 API는 400 (05 §8) */
  simulate: (id: string): Promise<{ simulation: Simulation }> =>
    post(`/api/cards/${id}/simulate`, {}, () => simulateMock as { simulation: Simulation }),

  /* ── KPI (05 §3) ───────────────────────────────────────────── */
  kpi: (): Promise<Kpi> => get("/api/kpi", () => store.deriveKpi()),

  /* ── 방문객 위젯 (05 §4) ───────────────────────────────────── */
  widget: (region?: string, category?: string): Promise<WidgetResponse> =>
    get(`/api/widget/recommend${qs({ region, category })}`, () => store.deriveWidget(region, category)),
};
