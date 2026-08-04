import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { RoutePlaceholder } from "@/components/RoutePlaceholder";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "정책 카드 관리 · 상생 나침반" };
export const dynamic = "force-dynamic";

/** ⑥ 실행 상태 트래킹 — F8 (FE 담당) */
export default async function TrackingPage() {
  const dashboard = await api.dashboard();

  return (
    <AdminShell dashboard={dashboard}>
      <RoutePlaceholder
        task="F8"
        title="실행 상태 트래킹"
        summary="승인된 카드의 추진 상태를 검토중·추진중·보류·완료 4단계로 관리한다. 완료로 바꾸면 방문객 위젯에 신규 배지가 뜬다."
        ready={[
          'api.cards({ status: "approved" }) — progress 필드 포함 (05 §2)',
          "api.progress(id, '검토중'|'추진중'|'보류'|'완료') — approved 카드만 가능",
          "api.kpi() — 상태 변경 후 실행 전환율 갱신 확인용 (05 §3)",
          "ProgressChip / StatusChip 컴포넌트",
        ]}
        todo={[
          "승인 카드 목록 + 4단계 상태 변경 UI (드롭다운 또는 칸반 열)",
          "상태 변경 → api.progress 호출 → KPI 실행 전환율 갱신 확인",
          "완료로 변경 → 위젯 새로고침 시 신규 배지 등장 (전체 루프 완주 검증)",
        ]}
      />
    </AdminShell>
  );
}
