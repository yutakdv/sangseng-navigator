import { NarrativeSourceChip } from "@/components/Badge";
import { dissentSourceOf } from "@/lib/aiSource";
import type { Card } from "@/types";

/**
 * 반대 관점 3항 — AI가 자기 제안을 방어하지 않고 스스로 반박한 문장만 담는다
 * (v4.1 C3 · 절대 규칙 4의 화면 증거). 카드 상세(Section)·제안 상세(Act+Panel)·인센티브(Section)
 * 세 화면이 각자의 레이아웃 컴포넌트로 감싸고, 반복되는 목록+출처칩 마크업만 여기서 공유한다.
 *
 * `data-tour="dissent"`는 D2 가이드 투어가 찾는 앵커라 실제 DOM 요소에 고정한다.
 * dissent가 없는 구형 카드(B1 도입 이전 시드·DDB 카드)에서는 null을 돌려 섹션 내용이 비고,
 * 각 페이지는 `hasDissent`로 섹션 헤더까지 통째로 숨긴다.
 */
export function DissentList({ card }: { card: Card }) {
  const dissent = card.ai.dissent;
  if (!dissent?.length) return null;
  return (
    <div data-tour="dissent" className="rounded-xl bg-admin-surface-sunken p-4">
      <ul className="flex list-disc flex-col gap-2 break-keep pl-4 text-[13px] leading-6 text-admin-text-soft">
        {dissent.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
      <div className="mt-3 border-t border-admin-border pt-3">
        <NarrativeSourceChip kind={dissentSourceOf(card)} />
      </div>
    </div>
  );
}

/** 반대 관점 섹션 게이트 — dissent 없는 카드는 섹션 헤더째로 숨긴다 (옵셔널 처리 필수). */
export const hasDissent = (card: Card): boolean => Boolean(card.ai.dissent?.length);
