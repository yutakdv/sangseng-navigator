import Link from "next/link";
import { Icon } from "@/components/Icon";
import { REGIONS } from "@/lib/constants";

/**
 * 지역 상세 분석(`/dashboard/region`)의 지역 선택기. 선택 상태는 URL에 남겨
 * 새로고침·공유에도 유지된다 — 지역 하나가 곧 하나의 공유 가능한 화면이다.
 *
 * `전체 지역` 항목을 두지 않는다: 이 화면은 언제나 지역 한 곳을 보는 자리라
 * "전체"는 선택지가 아니라 다른 화면(`/dashboard`)이고, 그 길은 상단 복귀 링크가 맡는다.
 * 선택 전에는 아무 항목도 활성이 아니며, 본문의 안내 카드가 그 상태를 설명한다.
 */
export function RegionFilter({ selectedRegion }: { selectedRegion: string | null }) {
  return (
    <nav
      aria-label="지역 상세 분석 지역 선택"
      className="flex flex-wrap items-center gap-2 rounded-2xl bg-admin-surface p-2 shadow-card ring-1 ring-inset ring-admin-border"
    >
      <span className="mr-1 inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-admin-text-muted">
        <Icon name="pin" size={14} />
        지역 선택
      </span>
      {REGIONS.map((region) => (
        <Link
          key={region}
          href={`/dashboard/region?region=${encodeURIComponent(region)}`}
          aria-current={selectedRegion === region ? "page" : undefined}
          className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
            selectedRegion === region
              ? "bg-admin-primary text-white shadow-[0_5px_12px_-6px_rgb(79_70_229)]"
              : "text-admin-text-muted hover:bg-admin-surface-sunken hover:text-admin-text"
          }`}
        >
          {region}
        </Link>
      ))}
    </nav>
  );
}
