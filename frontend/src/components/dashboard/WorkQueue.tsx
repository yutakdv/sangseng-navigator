import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Panel } from "@/components/Panel";
import { SelectRow } from "@/components/dashboard/SelectRow";
import { WorkflowChip } from "@/components/StatusChip";
import type { Card } from "@/types";

/**
 * 작업 목록 블록 — 허브 우측 열의 세 단계(결정 → 실행 → 완료)가 모두 이 컴포넌트다.
 *
 * **마스터-디테일의 마스터.** 줄을 누르면 페이지가 바뀌는 게 아니라 좌측 미리보기가
 * 그 카드로 갈린다. 담당자가 대기 건을 나란히 비교하는 것이 이 화면의 목적이라,
 * 상세로 들어갔다 나오는 왕복을 없앴다. 상세로 가는 길은 좌측 카드의 버튼 하나뿐이다.
 *
 * **불변조건: 상단 상태 요약 띠의 숫자 = 이 블록의 줄 수.**
 * 그래서 숫자를 따로 받지 않고 `cards.length`를 제목에 쓴다. 띠의 숫자도 같은 배열의
 * 길이에서 나오므로(`dashboardView`의 statusCounts) 정의상 어긋날 수 없다.
 *
 * ⚠ 화면에 쓰는 말은 "목록"이지만 **컴포넌트명과 HTML id는 `queue`를 유지한다**
 *   (`#decision-queue`·`#work-queue`·`#done-queue`). 상단 상태 바의 숫자가 이 id로
 *   스크롤해 오므로 id를 바꾸면 그 링크가 조용히 끊긴다.
 *
 * 카드 종류는 **아이콘 + 텍스트 라벨**로 가른다 — 색으로만 구분하지 않는다 (13 §4).
 *
 * 서버 컴포넌트. 줄의 클릭 처리만 `SelectRow`(클라이언트)가 맡는다.
 */
export function WorkQueue({
  id,
  title,
  cards,
  desc,
  badge,
  action,
  leadId,
  selectedId,
  hrefFor,
  accentBar = true,
  empty,
}: {
  /** 상태 요약 띠가 스크롤로 찾아오는 앵커 */
  id: string;
  title: string;
  cards: Card[];
  desc: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  /** 오늘 검토 1순위 카드 — 선택 여부와 무관하게 배지로 표시한다 */
  leadId?: string;
  /** 지금 좌측에 떠 있는 카드 */
  selectedId?: string;
  /** 선택 시 갈아 끼울 쿼리를 만드는 함수 (서버에서 문자열로 계산) */
  hrefFor: (cardId: string) => string;
  /** 선택 줄 왼쪽의 세로 강조 바. 끄면 배경 틴트 + 우측 체크만으로 선택을 알린다 */
  accentBar?: boolean;
  /** 빈 상태는 안내가 아니라 다음 행동으로의 입구여야 한다 */
  empty: { title: string; body: ReactNode };
}) {
  return (
    <Panel id={id} title={`${title} ${cards.length}건`} badge={badge} action={action} desc={desc} flush>
      {cards.length ? (
        <ul className="border-t border-admin-border">
          {cards.map((card) => (
            <li key={card.id} className="border-b border-admin-border last:border-b-0">
              <SelectRow
                href={hrefFor(card.id)}
                selected={card.id === selectedId}
                accentBar={accentBar}
                label={`${card.id} ${card.target ? `${card.target.eup} ${card.target.category}` : "전 지역 공통"}`}
              >
                <QueueRowBody card={card} lead={card.id === leadId} selected={card.id === selectedId} />
              </SelectRow>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border-t border-admin-border px-5 py-6">
          <p className="break-keep text-sm font-semibold text-admin-text">{empty.title}</p>
          <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">{empty.body}</p>
        </div>
      )}
    </Panel>
  );
}

function QueueRowBody({ card, lead, selected }: { card: Card; lead: boolean; selected: boolean }) {
  const isExpansion = card.type === "EXPANSION";
  const target = card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통";

  return (
    <>
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
          selected ? "bg-admin-primary text-white ring-admin-primary" : "bg-admin-surface text-admin-primary ring-lavender-200"
        }`}
      >
        <Icon name={isExpansion ? "store" : "gift"} size={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-bold tabular-nums text-admin-text">{card.id}</span>
          <span className="text-xs font-semibold text-admin-text-muted">
            {isExpansion ? "가맹점 확충" : "페이백 인센티브"}
          </span>
          {lead ? (
            <span className="rounded-md bg-admin-primary px-2 py-0.5 text-xs font-bold text-white">
              오늘 검토 1순위
            </span>
          ) : null}
        </span>

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`break-keep text-[13px] font-semibold ${
              selected ? "text-admin-primary" : "text-admin-text-soft group-hover:text-admin-primary"
            }`}
          >
            {target}
          </span>
          <WorkflowChip card={card} />
          {/* AI가 정량 순위를 반영한 카드 — 원 순위 병기는 카드 안에서 항상 함께 보인다 (절대 규칙 5) */}
          {card.ai.adjusted ? (
            <span className="rounded-full border border-lavender-200 bg-admin-surface px-2 py-0.5 text-xs font-semibold text-lavender-700">
              순위 조정 · 원 순위 병기
            </span>
          ) : null}
        </span>
      </span>

      {/*
        화살표(›)를 쓰지 않는다 — 이 버튼은 페이지를 옮기지 않고 왼쪽을 갈아 끼우므로
        "이동" 기호를 두면 뜻이 어긋난다. 선택된 줄만 체크로 표시한다.
      */}
      <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
        {selected ? (
          <Icon name="check" size={16} strokeWidth={2.5} className="text-admin-primary" />
        ) : null}
      </span>
    </>
  );
}
