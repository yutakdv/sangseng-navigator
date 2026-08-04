import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { RoutePlaceholder } from "@/components/RoutePlaceholder";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "인센티브 정책 · 상생 나침반" };
export const dynamic = "force-dynamic";

/** ④ 인센티브 정책 카드 — F6 (FE 담당) */
export default async function IncentivePage() {
  const dashboard = await api.dashboard();

  return (
    <AdminShell dashboard={dashboard}>
      <RoutePlaceholder
        task="F6"
        title="인센티브 정책 카드"
        summary="페이백률 3/5/7% 시나리오를 비교하고, 담당자가 하나를 골라 승인한다. AI는 비교만 제시한다."
        ready={[
          'api.cards({ type: "INCENTIVE" }) — scenarios · assumption_note 포함 (05 §2)',
          "api.decide(id, 'approved', 3|5|7) — 승인 시 selected_rate 필수",
        ]}
        todo={[
          "시나리오 비교 표: 예상 전환율 개선폭(delta_pp 범위) + 재원 부담(budget_note)",
          "'적립→외부사용→페이백→재사용' 순환 다이어그램 (정적 SVG로 충분)",
          "승인 시 페이백률 라디오 선택 필수 — 미선택이면 승인 버튼 비활성 (05 §2)",
          "블록마다 '가정 기반 전망이며 실제와 다를 수 있음' 고정 (AssumptionBadge·AssumptionNote 사용)",
          "표현 규칙: 적립이 아니라 '사용 단계 리워드(발행액 증액 없음)' — 05 §2",
        ]}
      />
    </AdminShell>
  );
}
