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
import type { Card, CardProgress, CardStatus, CardType, PaybackRate, Simulation } from "@/types";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string };

/** ApiError면 상태코드를 살려 넘기고, 그 밖(네트워크 단절·예상 못 한 예외)은 status 0으로 */
function toFail(error: unknown): { ok: false; status: number; detail: string } {
  if (error instanceof ApiError) return { ok: false, status: error.status, detail: error.detail };
  return { ok: false, status: 0, detail: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}

/**
 * 변경 계열 성공 시 전 라우트를 무효화한다 — 허브·트래킹·위젯·대시보드가 한 번에 갱신돼야
 * 데모 루프(승인 → 트래킹 → 위젯 신규 배지)가 돈다. KPI도 카드 상태에서 파생되므로 같이 갱신된다.
 */
function revalidateAll(): void {
  revalidatePath("/", "layout");
}

/** 승인/반려/보류 — INCENTIVE 승인에는 rate(3|5|7) 필수 (05 §2). AI 제안이 확정되는 유일한 지점 */
export async function decideAction(
  id: string,
  decision: CardStatus,
  rate?: PaybackRate,
): Promise<ActionResult<Card>> {
  try {
    const { card } = await api.decide(id, decision, rate);
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
  try {
    const { card } = await api.progress(id, progress);
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
  try {
    const result = await api.generate(type);
    revalidateAll();
    return { ok: true, data: result };
  } catch (error) {
    return toFail(error);
  }
}

/** 가맹 전환 시 예상 효과 — 상태를 바꾸지 않으므로 revalidate 하지 않는다 (EXPANSION 전용) */
export async function simulateAction(id: string): Promise<ActionResult<Simulation>> {
  try {
    const { simulation } = await api.simulate(id);
    return { ok: true, data: simulation };
  } catch (error) {
    return toFail(error);
  }
}
