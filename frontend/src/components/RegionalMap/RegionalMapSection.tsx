"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { RegionalMap } from "@/components/RegionalMap/RegionalMap";
import { type MapRegion } from "@/components/RegionalMap/regions";
import { RegionStatusCard, type RegionStatus } from "@/components/RegionStatusCard";

/**
 * 지도 + 지역 상태 팝업 — 지역별 현재 상태 블록의 본문.
 *
 * 지도가 블록 전체 폭을 쓰고, 지역을 고르면 **화면 중앙 팝업**으로 상태 카드가 뜬다.
 * 배경은 옅은 틴트 + 블러로 가라앉혀 카드에 시선을 모은다.
 *
 * 수치는 전부 서버가 계산해 평면 배열(statuses)로 내려준다. 선택은 일시적 미리보기라
 * URL에 올리지 않는다 — 정식 이동은 카드 안 `이 지역 상세 분석` 링크가 맡는다.
 *
 * 팝업 접근성: role="dialog" + aria-modal, 열리면 닫기 버튼으로 포커스 이동, 닫으면
 * 방아쇠(지도 path)로 복귀. Esc·배경 클릭·닫기 버튼 세 경로로 닫힌다. 열려 있는 동안
 * body 스크롤을 잠가 뒤 화면이 흐른 채 팝업만 남는 상태를 막는다.
 * 닫아도 지도 강조는 남긴다 — 방금 본 지역이 어디였는지가 지도에 남아야 다음 비교가 쉽다.
 */
export function RegionalMapSection({ statuses }: { statuses: RegionStatus[] }) {
  const [selected, setSelected] = useState<MapRegion | null>(null);
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  const statusByRegion = new Map(statuses.map((s) => [s.region, s]));
  const selectedStatus = selected ? statusByRegion.get(selected.name) : undefined;
  const popupVisible = open && selectedStatus !== undefined;

  const close = () => {
    setOpen(false);
    // 팝업을 연 지도 path로 포커스 복귀 — 키보드 사용자가 제자리에서 탐색을 잇는다
    if (triggerRef.current instanceof HTMLElement || triggerRef.current instanceof SVGElement) {
      (triggerRef.current as SVGElement & { focus: () => void }).focus();
    }
  };

  useEffect(() => {
    if (!popupVisible) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    // 팝업이 떠 있는 동안 뒤 화면 스크롤 잠금
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [popupVisible]);

  return (
    <div>
      {/* 지도 상자 — 테두리·틴트 없이 흰 면. 폭 80%(가운데 정렬)로 여백을 둔다 */}
      <div className="rounded-2xl bg-[#ffffff] p-3 sm:p-5">
        <div className="mx-auto w-full sm:w-4/5">
          <RegionalMap
            selectedId={selected?.id ?? null}
            onRegionSelect={(region) => {
              triggerRef.current = document.activeElement;
              setSelected(region);
              setOpen(true);
            }}
          />
        </div>
        <p className="mt-14 flex items-center gap-1.5 px-1 text-[11px] text-admin-text-muted">
          <Icon name="info" size={12} />
          실제 행정구역 경계 기반 · 정선군은 고한읍·사북읍을 제외한 잔여 지역, 삼척시는
          도계읍(지역가맹 대상지역) 기준
        </p>
      </div>

      {popupVisible ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedStatus.region} 현재 상태`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          {/* 배경 — 옅은 틴트 + 블러. 버튼이라 클릭·보조기기 어느 쪽으로도 닫힌다 */}
          <button
            type="button"
            aria-label="팝업 닫기"
            onClick={close}
            className="absolute inset-0 cursor-default bg-lavender-950/25 backdrop-blur-sm"
          />
          <div key={selectedStatus.region} className="relative w-full max-w-sm animate-rise">
            <RegionStatusCard status={selectedStatus} />
            <button
              ref={closeButtonRef}
              type="button"
              aria-label="닫기"
              onClick={close}
              className="absolute -right-2.5 -top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-admin-surface text-admin-text-muted shadow-card ring-1 ring-inset ring-admin-border transition-colors hover:text-admin-text focus-visible:ring-2 focus-visible:ring-admin-primary"
            >
              <Icon name="close" size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
