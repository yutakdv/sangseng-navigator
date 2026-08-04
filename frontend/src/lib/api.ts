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
import dashboardMock from "@/mocks/dashboard.json";
import candidatesMock from "@/mocks/candidates.json";
import riskSignalMock from "@/mocks/risk_signal.json";
import simulateMock from "@/mocks/simulate.json";
import * as store from "@/mocks/store";

const BASE = process.env.NEXT_PUBLIC_API_BASE;

/** 실 API 모드인지 — 화면에서 "mock 데이터" 고지를 띄울 때 쓴다 */
export const isMockMode = !BASE;

async function get<T>(path: string, mock: () => T): Promise<T> {
  if (!BASE) return mock(); // mock 모드
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown, mock: () => T): Promise<T> {
  if (!BASE) return mock(); // mock 모드: mock/store.ts가 로컬 상태를 갱신하고 그 결과를 돌려준다
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
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

  generate: (type: CardType, mockCard: Card): Promise<{ card: Card }> =>
    post("/api/cards/generate", { type }, () => ({ card: store.addCard(mockCard) })),

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
