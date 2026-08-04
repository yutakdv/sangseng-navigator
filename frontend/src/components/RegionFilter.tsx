import Link from "next/link";
import { Icon } from "@/components/Icon";
import { REGIONS } from "@/lib/constants";

/** 지역 소비 분석의 지역 고정 필터. 선택 상태는 URL에 남겨 새로고침·공유에도 유지된다. */
export function RegionFilter({ selectedRegion }: { selectedRegion: string | null }) {
  return (
    <nav
      aria-label="지역 소비 분석 지역 필터"
      className="flex flex-wrap items-center gap-2 rounded-2xl bg-admin-surface p-2 shadow-card ring-1 ring-inset ring-admin-border"
    >
      <span className="mr-1 inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-admin-text-muted">
        <Icon name="pin" size={14} />
        지역 보기
      </span>
      <Link
        href="/dashboard"
        aria-current={selectedRegion === null ? "page" : undefined}
        className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
          selectedRegion === null
            ? "bg-admin-primary text-white shadow-[0_5px_12px_-6px_rgb(79_70_229)]"
            : "text-admin-text-muted hover:bg-admin-surface-sunken hover:text-admin-text"
        }`}
      >
        전체 지역
      </Link>
      {REGIONS.map((region) => (
        <Link
          key={region}
          href={`/dashboard?region=${encodeURIComponent(region)}`}
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
