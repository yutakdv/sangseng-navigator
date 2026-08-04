import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { AssumptionBadge } from "@/components/Badge";
import { Section } from "@/components/Section";
import { ProgressChip, StatusChip } from "@/components/StatusChip";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * ① Action Card 허브 — **F3은 FE 담당 몫이라 여기서는 만들지 않았다.**
 * 밑작업 단계에서는 데이터 계층이 실제로 물려 있다는 것만 보이도록 카드 목록을 그대로 나열한다.
 * 승인·반려·보류 버튼, 히어로 승격, "이번 분기 카드 생성"은 08 문서 F3에서 채운다.
 */
const ROUTES = [
  { href: "/", label: "Action Card 허브", task: "F3", done: false },
  { href: "/cards/AC-002", label: "카드 상세 (지도·근거·시뮬레이션)", task: "F4", done: false },
  { href: "/dashboard", label: "집중도 대시보드", task: "F5", done: true },
  { href: "/incentive", label: "인센티브 정책 카드", task: "F6", done: false },
  { href: "/widget", label: "방문객 위젯", task: "F7", done: true },
  { href: "/tracking", label: "실행 상태 트래킹", task: "F8", done: false },
];

export default async function HubPage() {
  const [dashboard, { cards }] = await Promise.all([api.dashboard(), api.cards()]);
  const pending = cards.filter((c) => c.status === "pending");

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-admin-text">이번 분기 제안</h2>
          <p className="mt-0.5 text-sm text-admin-text-muted">
            AI는 제안까지만 합니다. 확정은 담당자 승인을 거칩니다.
          </p>
        </div>

        <Section
          title={`승인 대기 ${pending.length}건`}
          desc="승인·반려·보류 버튼과 카드 생성은 F3에서 붙인다. 지금은 데이터 계층 연결만 확인하는 목록이다."
        >
          {cards.length === 0 ? (
            <p className="text-sm text-admin-text-muted">카드가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {cards.map((c) => (
                <li key={c.id} className="rounded-lg border border-black/5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-admin-text-muted">{c.id}</span>
                    <span className="text-sm font-semibold text-admin-text">{c.title}</span>
                    <StatusChip status={c.status} />
                    {c.progress ? <ProgressChip progress={c.progress} /> : null}
                  </div>
                  {/* 정량 순위 병기 — AI가 순위를 조정해도 원 Score 순위를 항상 함께 노출한다 (절대 규칙 5) */}
                  {c.ai.adjusted && c.score_rank && c.ai_rank ? (
                    <p className="mt-1.5 text-xs font-medium text-admin-primary">
                      Score {c.score_rank}위 → AI 제안 {c.ai_rank}위
                    </p>
                  ) : null}
                  <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">
                    {c.ai.expected_effect}
                  </p>
                  <div className="mt-1.5">
                    <AssumptionBadge />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="화면 구현 현황" desc="밑작업으로 만든 화면과 FE 담당이 채울 화면 (08 문서 태스크 기준).">
          <ul className="flex flex-col gap-1.5">
            {ROUTES.map((r) => (
              <li key={r.task} className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    r.done ? "bg-state-good-bg text-state-good" : "bg-state-notice-bg text-state-notice"
                  }`}
                >
                  {r.task} {r.done ? "완료" : "예정"}
                </span>
                <Link href={r.href} className="text-admin-text underline-offset-2 hover:underline">
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </AdminShell>
  );
}
