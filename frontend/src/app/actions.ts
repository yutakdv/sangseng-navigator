"use server";

/**
 * Server Actions — 변경(승인·상태 변경·생성)과 시뮬레이션의 단일 경로 (docs/plan/08 F3·F6·F8).
 *
 * 왜 Server Action인가: `lib/api.ts`는 mock JSON(merchants 330KB 포함)을 정적 import 하므로
 * 클라이언트에서 부를 수 없다. 버튼(클라이언트 컴포넌트)은 여기 액션만 호출하고,
 * 데이터 접근은 서버에 남긴다.
 *
 * 반환은 **예외를 던지지 않는 판별 유니온**이다. 409는 장애가 아니라 정상적인 도메인 신호라
 * (전 후보가 추진중/완료, pending이 아닌 카드에 결정 — 05 §8) 에러 화면이 아니라
 * 화면 안 안내 문구로 다뤄야 하기 때문이다.
 */
import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { operator } from "@/lib/operator";
import { isDemoReadOnly } from "@/lib/runtime";
import type {
  Card,
  CardProgress,
  CardStatus,
  CardType,
  CreateProgressRecordResponse,
  EligibilityCheck,
  PaybackRate,
  ProgressRecordInput,
  Simulation,
} from "@/types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string };

/** ApiError면 상태코드를 살려 넘기고, 그 밖(네트워크 단절·예상 못 한 예외)은 status 0으로 */
function toFail(error: unknown): { ok: false; status: number; detail: string } {
  if (error instanceof ApiError) return { ok: false, status: error.status, detail: error.detail };
  return { ok: false, status: 0, detail: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}

/**
 * 변경 계열 성공 시 전 라우트를 무효화한다 — 허브·트래킹·위젯·대시보드가 한 번에 갱신돼야
 * 데모 루프(승인 → 트래킹 → 위젯 확충 업종 배지)가 돈다. KPI도 카드 상태에서 파생되므로 같이 갱신된다.
 */
function revalidateAll(): void {
  revalidatePath("/", "layout");
}

const readOnlyFailure = (): ActionResult<never> => ({
  ok: false,
  status: 403,
  detail: "공개 데모는 읽기 전용입니다. 운영 권한이 연결된 환경에서 변경해 주세요.",
});

/**
 * 결정 화면이 모으는 값 — 담당자가 실제로 입력·선택하는 것만 담는다.
 *
 * 결정자(actor)와 경로(decision_source)는 화면이 아니라 여기서 채운다. 결정 버튼이 두 벌
 * (`DecisionActions`·`DecisionBar`)이라 화면마다 담으면 한쪽만 빠뜨렸을 때 그 화면에서만 422가 난다.
 */
export interface DecisionInput {
  decision: CardStatus;
  /** INCENTIVE 승인에만 쓰인다 */
  rate?: PaybackRate;
  /** 반려·보류와 신뢰도 `하` 카드 승인에서 필수 (05 §2) */
  reason?: string;
  /** 화면이 읽은 카드의 version — 그 사이 카드가 바뀌었으면 서버가 409로 막는다 */
  version?: number;
  /** 반려·보류에서만 의미가 있다 — 같은 타깃을 언제까지 다시 제안하지 않을지 */
  cooldownDays?: number;
  /** 반려·보류에서만 의미가 있다 — 무엇이 바뀌면 다시 볼지 */
  recheckCondition?: string;
}

/** 승인/반려/보류 — AI 제안이 확정되는 유일한 지점 (절대 규칙 4) */
export async function decideAction(id: string, input: DecisionInput): Promise<ActionResult<Card>> {
  if (isDemoReadOnly) return readOnlyFailure();
  const reason = input.reason?.trim();
  const recheck = input.recheckCondition?.trim();
  const blocking = input.decision === "rejected" || input.decision === "held";
  try {
    const { card } = await api.decide(id, {
      decision: input.decision,
      ...(input.rate ? { selected_rate: input.rate } : {}),
      ...(reason ? { reason } : {}),
      // 자기신고 값이다 — 서버가 verified:false·공유 토큰 인증과 함께 저장해 검증되지
      // 않았음을 남긴다. FE가 검증된 척하지 않는다 (05 §2 decision).
      actor_id: operator.id,
      ...(operator.name ? { actor_name: operator.name } : {}),
      decision_source: "operator_ui",
      ...(input.version === undefined ? {} : { version: input.version }),
      // 승인에 실어 보내면 서버가 무시하지만, 의미 없는 값을 보내지 않는다
      ...(blocking && input.cooldownDays !== undefined ? { cooldown_days: input.cooldownDays } : {}),
      ...(blocking && recheck ? { recheck_condition: recheck } : {}),
    });
    revalidateAll();
    return { ok: true, data: card };
  } catch (error) {
    return toFail(error);
  }
}

/** 추진 상태 변경 — approved 카드만 (05 §8) */
export async function progressAction(
  id: string,
  progress: CardProgress,
): Promise<ActionResult<Card>> {
  if (isDemoReadOnly) return readOnlyFailure();
  try {
    const { card } = await api.progress(id, progress);
    revalidateAll();
    return { ok: true, data: card };
  } catch (error) {
    return toFail(error);
  }
}

/** 상태 선택만이 아닌 추진 메모·목표·실측값을 함께 남기는 경과 기록. */
export async function createProgressRecordAction(
  id: string,
  input: ProgressRecordInput,
): Promise<ActionResult<CreateProgressRecordResponse>> {
  if (isDemoReadOnly) return readOnlyFailure();
  try {
    const result = await api.createProgressRecord(id, input);
    revalidateAll();
    return { ok: true, data: result };
  } catch (error) {
    return toFail(error);
  }
}

/** 가맹점 후보 필수 적격성 5개 항목 기록 — 가맹 확정과는 별개다. */
export async function verificationAction(
  id: string,
  checks: EligibilityCheck[],
): Promise<ActionResult<Card>> {
  if (isDemoReadOnly) return readOnlyFailure();
  try {
    const { card } = await api.verification(id, checks);
    revalidateAll();
    return { ok: true, data: card };
  } catch (error) {
    return toFail(error);
  }
}

/** 이번 분기 카드 생성 — 전 후보가 추진중/완료면 409, 동일 타깃 pending이 있으면 그 카드 (05 §8) */
/**
 * `created`를 그대로 올려보낸다 — 신규 생성(201)과 중복 가드로 받은 기존 카드(200)를
 * 화면이 구분해 말해야 데모 2-b에서 사실과 다른 문구가 나가지 않는다 (05 §8, 11 §1).
 */
export async function generateAction(
  type: CardType,
): Promise<ActionResult<{ card: Card; created: boolean }>> {
  if (isDemoReadOnly) return readOnlyFailure();
  try {
    const result = await api.generate(type);
    revalidateAll();
    return { ok: true, data: result };
  } catch (error) {
    return toFail(error);
  }
}

/**
 * 가맹 전환 시 예상 효과 — 상태를 바꾸지 않으므로 revalidate 하지 않는다 (EXPANSION 전용).
 *
 * 이 액션에만 `isDemoReadOnly` 조기 반환이 **의도적으로 없다**. simulate는 카드를 바꾸지 않는
 * 읽기 계산이라 05 §8의 읽기 전용 차단 대상이 아니고(BE도 `require_internal_access`),
 * 막으면 승인 판단 근거가 사라진 채 "상태 변경은…" 문구만 뜬다. 나중에 일괄 정리한다며
 * 여기에 가드를 넣으면 BE와 다시 어긋난다.
 */
export async function simulateAction(id: string): Promise<ActionResult<Simulation>> {
  try {
    const { simulation } = await api.simulate(id);
    return { ok: true, data: simulation };
  } catch (error) {
    return toFail(error);
  }
}
