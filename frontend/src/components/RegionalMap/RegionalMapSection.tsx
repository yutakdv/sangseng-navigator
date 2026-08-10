"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { RegionalMap } from "@/components/RegionalMap/RegionalMap";
import { type MapRegion } from "@/components/RegionalMap/regions";
import { RegionStatusCard, type RegionStatus } from "@/components/RegionStatusCard";

/**
 * 지도 + 지역 상태 팝업 패널 — 지역별 현재 상태 블록의 본문.
 *
 * 수치는 전부 서버가 계산해 평면 배열(statuses)로 내려준다. 이 컴포넌트는 "어느 지역이
 * 선택됐나"만 들고 있다 — 선택은 일시적 미리보기라 URL에 올리지 않는다(이 레포의 URL
 * 상태 컨벤션과의 역할 분담: 정식 이동은 카드 안 `이 지역 상세 분석` 링크가 맡는다).
 *
 * 팝업은 지도 위 오버레이가 아니라 옆(모바일: 아래) 고정 패널이다 — 카드가 수치 6개짜리
 * 밀도라 지도를 덮으면 다음 선택을 방해한다. 등장 애니메이션(key 교체 + animate-rise)으로
 * 팝업감만 살린다. aria-live로 선택 결과가 스크린리더에도 알려진다.
 */
export function RegionalMapSection({ statuses }: { statuses: RegionStatus[] }) {
  const [selected, setSelected] = useState<MapRegion | null>(null);
  const statusByRegion = new Map(statuses.map((s) => [s.region, s]));
  const selectedStatus = selected ? statusByRegion.get(selected.name) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="rounded-2xl border border-admin-border bg-admin-surface-sunken/40 p-3 sm:p-4">
        <RegionalMap
          selectedId={selected?.id ?? null}
          onRegionSelect={(region) => setSelected(region)}
        />
        <p className="mt-2 flex items-center gap-1.5 px-1 text-[11px] text-admin-text-muted">
          <Icon name="info" size={12} />
          실제 행정구역 경계 기반 · 정선군은 고한읍·사북읍을 제외한 잔여 지역, 삼척시는
          도계읍(지역가맹 대상지역) 기준
        </p>
      </div>

      {/* 선택 결과 패널 — key 교체로 지역을 바꿀 때마다 카드가 새로 떠오른다 */}
      <div aria-live="polite" className="min-w-0">
        {selectedStatus ? (
          <div key={selectedStatus.region} className="animate-rise">
            <RegionStatusCard status={selectedStatus} />
          </div>
        ) : (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-admin-border bg-admin-surface px-4 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-lavender-100 text-lavender-700">
              <Icon name="pin" size={20} />
            </span>
            <p className="mt-3 text-[15px] font-semibold text-admin-text">
              지도에서 지역을 선택하세요
            </p>
            <p className="mx-auto mt-1.5 max-w-xs break-keep text-[13px] leading-6 text-admin-text-muted">
              누적 사용 건수·전체 비중·최근 월 흐름·진단 순위가 여기에 열립니다. (예: 진단
              1위 영월군)
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
