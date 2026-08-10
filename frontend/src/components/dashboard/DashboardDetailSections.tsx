import Link from "next/link";
import { ExecutionStatus } from "@/components/ExecutionStatus";
import { Icon } from "@/components/Icon";
import { Act, Panel, PanelLink } from "@/components/Panel";
import { PolicyFlow } from "@/components/PolicyFlow";
import { StatusChip } from "@/components/StatusChip";
import { isExecutionStage, isStartStage } from "@/lib/cardWorkflow";
import type { DashboardView } from "@/lib/dashboardView";
import type { Card } from "@/types";

/**
 * 허브 3층 — 결과 모니터링.
 *
 * 처리 대상(결정 대기·실행 관리·완료)은 전부 2층 우측 작업 열로 올라갔다. 여기 남은 것은
 * 행동이 아니라 관찰이다: **언제 무슨 결정을 했나 하는 이력**과 승인 이후의 단계 분포·성과
 * 표본, 그리고 진단에서 방문객 화면까지의 전체 연결.
 *
 * 결정 이력은 우측 작업 열과 카드가 겹치므로(승인 카드는 실행 관리 블록에도 있다)
 * 풀 카드가 아니라 **한 줄 이력**으로 압축했다 — 여기서 중요한 것은 카드의 내용이 아니라
 * "언제 어떤 결정이 내려졌나"라서, 시각과 결정 종류가 주인공이 되는 편이 성격에 맞는다.
 */
export function DashboardDetailSections({ view }: { view: DashboardView }) {
  const { dashboard, kpi, decided, approved, candidates } = view;

  return (
    <Act
      no="02"
      phase="점검"
      question="방금 통과시킨 것과 그 이후"
      title="결정 이후를 지켜봅니다"
      action={<PanelLink href="/tracking">정책 카드 관리</PanelLink>}
      last
    >
      <div className="flex flex-col gap-4 pb-4">
        <div className="grid grid-cols-4 gap-4 sm:grid-cols-8 xl:grid-cols-12">
          <div className="col-span-4 flex min-w-0 flex-col gap-4 sm:col-span-8 xl:col-span-8">
            <Panel
              id="recent-decisions"
              icon="check"
              title={`결정 이력 ${decided.length}건`}
              desc="승인·반려·보류로 결정이 끝난 카드입니다. 결정 이후의 적격성·심사·추진 상태는 위 실행 관리에서 기록합니다."
              flush
            >
              {decided.length ? (
                <ul className="border-t border-admin-border">
                  {decided.map((card) => (
                    <HistoryRow key={card.id} card={card} />
                  ))}
                </ul>
              ) : (
                <div className="border-t border-admin-border px-5 py-6">
                  <p className="break-keep text-sm font-semibold text-admin-text">아직 결정된 카드가 없습니다</p>
                  <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">
                    위 결정 대기 블록에서 승인·반려·보류하면 여기에 기록이 쌓입니다.
                  </p>
                </div>
              )}
            </Panel>
          </div>

          <ExecutionStatus
            approved={approved}
            kpi={kpi}
            className="col-span-4 sm:col-span-8 xl:col-span-4 xl:sticky xl:top-6 xl:self-start"
          />
        </div>

        <Panel
          icon="workflow"
          title="진단에서 방문객 반영까지"
          desc="AI는 후보 비교와 근거까지만 담당하고, 담당자가 검토·적격성·가맹 심사·실행을 기록합니다."
          action={<PanelLink href="/widget">방문객 반영 확인</PanelLink>}
        >
          <PolicyFlow
            counts={{
              // kpi가 null(호출 실패)이면 0으로 지어내지 않고 null을 그대로 넘긴다 —
              // PolicyFlow는 null인 단계의 건수 배지를 아예 표시하지 않는다(지어낸 수치 금지 원칙).
              cards: kpi?.counts.total ?? null,
              pending: kpi?.counts.pending ?? null,
              /* STEP4·5·6은 승인 카드를 겹치지 않게 나눈다 — 셋을 더하면 승인 카드 총수다.
                 예전에는 STEP4가 승인 전체를, STEP5가 `추진중`만 세어 적격성 확인·가맹 심사 카드가
                 STEP4에 중복 집계되고 STEP5에서는 통째로 빠졌다 (lib/cardWorkflow 주석 참고).
                 approved·inProgress는 이미 받아온 cards 배열에서 직접 세므로 kpi 실패와 무관하게
                 항상 값이 있다. `done`만 kpi를 그대로 쓴다 — 백엔드(routes/kpi.py)도 `승인 && 완료`로
                 세므로 정의가 같고, 프런트에서 다시 셀 이유가 없다 */
              approved: approved.filter(isStartStage).length,
              inProgress: approved.filter(isExecutionStage).length,
              done: kpi?.counts.done ?? null,
            }}
          />
          <p className="u-note mt-4 border-t border-admin-border pt-3">
            후보 데이터 {candidates ? `${candidates.candidates.length}건` : "불러오지 못함"} · 데이터
            기준 {dashboard.period_note} · 실제 성과는 완료 후 운영 기록에 별도로 입력합니다.
          </p>
        </Panel>
      </div>
    </Act>
  );
}

/** 한 줄 이력 — 시각과 결정 종류가 주인공이고 카드 내용은 식별에 필요한 만큼만 */
function HistoryRow({ card }: { card: Card }) {
  const target = card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통";

  return (
    <li className="border-b border-admin-border last:border-b-0">
      <Link
        href={`/proposals/${card.id}`}
        className="group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 transition-colors hover:bg-lavender-50/60"
      >
        <span className="text-xs tabular-nums text-admin-text-muted">{stamp(card.decided_at)}</span>
        <StatusChip status={card.status} />
        <span className="text-[13px] font-bold tabular-nums text-admin-text">{card.id}</span>
        <span className="min-w-0 break-keep text-[13px] text-admin-text-soft group-hover:text-admin-primary">
          {target}
        </span>
        <Icon
          name="chevronRight"
          size={14}
          className="ml-auto shrink-0 text-admin-text-muted group-hover:text-admin-primary"
        />
      </Link>
    </li>
  );
}

const stamp = (iso: string | null): string =>
  iso && iso.length >= 16 ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : "—";
