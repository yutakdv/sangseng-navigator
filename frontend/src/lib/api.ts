/**
 * 단일 데이터 접근 계층 — 모든 화면은 이 파일만 통해 데이터를 얻는다 (docs/plan/08 F1).
 *
 * **실 API 전용이다.** 예전에는 `NEXT_PUBLIC_API_BASE`가 비면 `src/mocks/`로 폴백했는데,
 * 그 폴백은 설정 누락을 **조용히** 감춰 배포된 화면이 가짜 데이터를 진짜처럼 보여줬다
 * (2026-08-11 실배포에서 실제로 발생). 지금은 주소가 없으면 즉시 실패한다.
 *
 * BE 엔드포인트가 없는 파이프라인 정적 산출물(`src/data/`)만 예외로 그대로 import한다 —
 * 이건 mock이 아니라 배포본이 실제로 서빙하는 데이터다.
 *
 * ⚠ 이 파일은 **서버 컴포넌트에서만** 호출한다. `"use client"`에서 import하면
 *   usage_monthly 등 정적 JSON이 브라우저 번들에 실린다 — 서버에서 받아 props로 넘길 것.
 */
import type {
  Card,
  CandidatesResponse,
  CardProgress,
  CellLoad,
  CardStatus,
  CardType,
  Dashboard,
  EligibilityCheck,
  Kpi,
  PaybackRate,
  CreateProgressRecordResponse,
  ProgressRecordInput,
  ProgressRecordsResponse,
  ProgressReport,
  RiskSignal,
  Simulation,
  UsageDaily,
  UsageMonthly,
  WidgetResponse,
} from "@/types";
import { ApiError } from "@/lib/errors";
import cellLoadJson from "@/data/cell_load.json";
import manifestJson from "@/data/manifest.json";
import usageDailyJson from "@/data/usage_daily.json";
import usageMonthlyJson from "@/data/usage_monthly.json";

// 끝 슬래시를 떼어 `${BASE}${path}`가 `//api/...`로 조립되는 것을 막는다 (그러면 전부 404다).
const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim().replace(/\/+$/, "");

/**
 * 담당자 전용 조회·변경에 실어 보내는 공유 Bearer 토큰.
 *
 * 이름이 두 가지인 역사: BE와 루트 `.env`는 `MUTATION_API_TOKEN`, FE와 docker-compose는
 * `API_MUTATION_TOKEN`을 쓴다(compose가 값을 옮겨 담아 로컬에서는 차이가 드러나지 않는다).
 * 실배포에서 실제로 이름을 바꿔 넣어 담당자 조회가 전부 401이 됐고, 화면에는 "권한이 필요합니다"
 * 만 떠서 원인이 보이지 않았다 — 어느 이름으로 넣어도 동작하게 해 이 함정을 없앤다.
 */
const MUTATION_TOKEN = process.env.API_MUTATION_TOKEN ?? process.env.MUTATION_API_TOKEN;

if (!BASE) {
  // 모듈 로드 시점에 죽인다 — 설정이 빠진 빌드가 배포까지 가지 못하게 한다.
  throw new Error(
    "NEXT_PUBLIC_API_BASE가 비어 있습니다. 실 API 주소를 설정하세요 " +
      "(예: https://<api-id>.execute-api.ap-northeast-2.amazonaws.com — 끝 슬래시 없이). " +
      "Vercel은 프로젝트 환경변수, 로컬은 레포 루트 .env 또는 frontend/.env.local에 넣습니다. " +
      "mock 폴백은 제거됐습니다 — 주소 없이는 화면을 그리지 않습니다.",
  );
}

/**
 * 파이프라인 산출물 스냅샷 버전 — `src/data/manifest.json`(A4)은 BE 엔드포인트가 없는 정적
 * 메타다. SourceChip 팝오버에서 "이 숫자가 어느 데이터 스냅샷에서 왔는지"를 밝힌다.
 */
export function datasetVersion(): string {
  return (manifestJson as { dataset_version: string }).dataset_version;
}

/** 산출물 매니페스트 한 벌 — 파일별 sha256·바이트까지. 데이터 활용 정보 화면이 그대로 표로 낸다. */
export interface Manifest {
  dataset_version: string;
  base_month: string;
  generated_at: string;
  files: Record<string, { sha256: string; bytes: number }>;
}

/**
 * `datasetVersion()`이 버전 문자열 하나만 쓰는 데 비해, 이쪽은 매니페스트 전체를 준다 —
 * "이 화면의 숫자가 어느 스냅샷에서 나왔고 그 스냅샷이 위조되지 않았는가"를 확인하는 자리
 * (`/data`의 산출 버전·무결성 섹션)에서만 쓴다.
 */
export function manifest(): Manifest {
  return manifestJson as Manifest;
}

/**
 * 셀(지역×표시업종) 가맹점 이용 부하 — 파이프라인 P9 산출물. BE 엔드포인트가 없어 정적 import한다.
 * 동기 함수다: 셀 탐색기는 서버 컴포넌트에서 값을 읽어 클라이언트로 props로 내려보낸다.
 */
export function cellLoad(): CellLoad {
  return cellLoadJson as CellLoad;
}

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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: MUTATION_TOKEN ? { Authorization: `Bearer ${MUTATION_TOKEN}` } : undefined,
    // BE가 거부가 아니라 무응답으로 매달리면 스켈레톤이 무한 지속된다 — 네트워크 지연의
    // 여유를 두고 끊어 error.tsx의 "다시 시도" 화면으로 회복시킨다.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) await fail(res, path);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return (await postWithStatus<T>(path, body)).data;
}

/**
 * `post`와 같지만 **상태코드까지** 돌려준다. generate 전용 —
 * 05 §8이 신규 생성 201과 중복 가드로 기존 카드를 돌려주는 200을 구분하는데,
 * 본문만 보면 둘이 같아서 화면이 "새로 만들었다"고 단정하거나 반대로 늘 얼버무리게 된다.
 */
async function postWithStatus<T>(
  path: string,
  body: unknown,
): Promise<{ data: T; status: number }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(MUTATION_TOKEN ? { Authorization: `Bearer ${MUTATION_TOKEN}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    // generate는 LLM 재시도까지 최대 24.5초. API Gateway HTTP API의 통합 타임아웃이 30초
    // (증액 불가)이므로 FE를 35초로 두어 **게이트웨이가 먼저 끊게** 한다 — FE가 먼저 끊으면
    // 서버가 만든 폴백 응답조차 못 받는다.
    signal: AbortSignal.timeout(35_000),
  });
  if (!res.ok) await fail(res, path);
  return { data: (await res.json()) as T, status: res.status };
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([key, value]) => [key, String(value)] as [string, string]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

export const api = {
  /* ── 진단·대시보드 (05 §1) ─────────────────────────────────── */
  dashboard: (): Promise<Dashboard> => get("/api/dashboard"),

  candidates: (): Promise<CandidatesResponse> => get("/api/candidates"),

  /** 운영 2년 미만 사업자 비중 — 배경 정보. '위험' 라벨·순위 정렬 금지 (05 §6) */
  riskSignal: (): Promise<RiskSignal[]> => get("/api/risk-signal"),

  /**
   * 지역×업종×월 원장 — BE 엔드포인트가 **없는** 파이프라인 정적 산출물이다.
   * data/processed/usage_monthly.json은 분기 배치로 커밋되고 src/data/ 사본과 동일하다
   * (지역 드릴다운 진단 전용, 05 §1 참조).
   */
  usageMonthly: (): Promise<UsageMonthly> =>
    Promise.resolve(usageMonthlyJson as unknown as UsageMonthly),

  /** 일·요일 축 집계 — usageMonthly와 같은 이유로 정적 import (05 §6, 드릴다운 요일 섹션 전용) */
  usageDaily: (): Promise<UsageDaily> => Promise.resolve(usageDailyJson as unknown as UsageDaily),

  /* ── Action Card (05 §2) ───────────────────────────────────── */
  cards: (opts: { type?: CardType; status?: CardStatus } = {}): Promise<{ cards: Card[] }> =>
    get(`/api/cards${qs(opts)}`),

  card: (id: string): Promise<{ card: Card | undefined }> => get(`/api/cards/${id}`),

  /**
   * "이번 분기 카드 생성".
   *
   * `created`는 **신규 생성(201)인지 중복 가드로 기존 카드를 받은 것(200)인지**다. 실호출에서
   * 두 경우가 모두 나오는 것을 확인했고(LLM이 pending 타깃을 고르면 200), 화면이 이를 구분해야
   * 데모 2-b("카드가 하나 늘어남")에서 사실과 다른 말을 하지 않는다 (11 §1).
   * 선택 가능한 후보가 전부 추진중/완료면 서버가 409를 돌려준다 (05 §8).
   */
  generate: async (type: CardType): Promise<{ card: Card; created: boolean }> => {
    const { data, status } = await postWithStatus<{ card: Card }>("/api/cards/generate", { type });
    return { card: data.card, created: status === 201 };
  },

  /** INCENTIVE를 approved 할 때는 selectedRate(3|5|7) 필수 (05 §2·§8) */
  decide: (id: string, decision: CardStatus, selectedRate?: PaybackRate): Promise<{ card: Card }> =>
    post(`/api/cards/${id}/decision`, {
      decision,
      ...(selectedRate ? { selected_rate: selectedRate } : {}),
    }),

  progress: (id: string, progress: CardProgress): Promise<{ card: Card }> =>
    post(`/api/cards/${id}/progress`, { progress }),

  progressRecords: (id: string, cursor?: string): Promise<ProgressRecordsResponse> =>
    get(`/api/cards/${id}/progress-records${qs({ cursor })}`),

  createProgressRecord: (
    id: string,
    input: ProgressRecordInput,
  ): Promise<CreateProgressRecordResponse> => post(`/api/cards/${id}/progress-records`, input),

  verification: (id: string, checks: EligibilityCheck[]): Promise<{ card: Card }> =>
    post(`/api/cards/${id}/verification`, { checks }),

  /** EXPANSION 전용 — INCENTIVE에 호출하면 400 (05 §8) */
  simulate: (id: string): Promise<{ simulation: Simulation }> =>
    post(`/api/cards/${id}/simulate`, {}),

  /* ── KPI (05 §3) ───────────────────────────────────────────── */
  kpi: (): Promise<Kpi> => get("/api/kpi"),

  progressReport: (opts: { from?: string; to?: string } = {}): Promise<ProgressReport> =>
    get(`/api/progress-report${qs(opts)}`),

  /* ── 방문객 위젯 (05 §4) ───────────────────────────────────── */
  widget: (region?: string, category?: string, limit = 12): Promise<WidgetResponse> =>
    get(`/api/widget/recommend${qs({ region, category, limit })}`),
};
