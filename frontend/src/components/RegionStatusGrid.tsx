import Link from "next/link";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { REGION_TOOLTIP, REGIONS } from "@/lib/constants";
import { monthLabel, num } from "@/lib/format";
import type { Dashboard, EupScore, Region } from "@/types";

type RegionShare = Dashboard["region_share"][number];
type MonthlyRegion = Dashboard["monthly_by_region"][number];

/**
 * 지역 소비 분석의 요약 카드.
 *
 * 막대 하나로 끝내면 "어느 지역이 얼마인가"를 다시 읽어야 하므로, 지역 고정 순서대로
 * 누적 사용 건수·비중·최근 월·진단 순위를 한 카드에 묶는다. 값은 dashboard/candidates
 * 계약에서만 계산하고, 선택·제안 대상은 문자 배지로도 명시한다.
 */
export function RegionStatusGrid({
  shares,
  monthlyByRegion,
  ranking,
  selectedRegions = [],
  targetRegion = null,
  onlyRegion = null,
  withDetailLink = false,
}: {
  shares: RegionShare[];
  monthlyByRegion: MonthlyRegion[];
  ranking: EupScore[];
  selectedRegions?: string[];
  targetRegion?: string | null;
  onlyRegion?: string | null;
  /** 카드마다 지역 상세 존으로 가는 링크를 단다 — 이 그리드가 탐색 진입점을 겸할 때만 */
  withDetailLink?: boolean;
}) {
  const shareByRegion = new Map(shares.map((row) => [row.region, row]));
  const rankByRegion = new Map(ranking.map((row) => [row.eup, row]));
  const latest = monthlyByRegion[monthlyByRegion.length - 1];
  const previous = monthlyByRegion[monthlyByRegion.length - 2];
  const latestLabel = latest?.month ? monthLabel(String(latest.month)) : "최근 월";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {(onlyRegion ? REGIONS.filter((region) => region === onlyRegion) : REGIONS).map((region) => {
        const share = shareByRegion.get(region);
        const score = rankByRegion.get(region);
        const latestCount = Number(latest?.[region] ?? 0);
        const previousCount = Number(previous?.[region] ?? 0);
        const monthlyDelta = previousCount > 0 ? ((latestCount - previousCount) / previousCount) * 100 : null;
        const isTarget = region === targetRegion;
        const isSelected = selectedRegions.includes(region) && !isTarget;

        // 지역마다 다른 색 띠를 상단에 두지 않는다 — 그 색은 아무것도 인코딩하지 않았고,
        // 여섯 색이 시끄러워 정작 의미 있는 신호인 `진단 대상` 라벤더 배지를 덮었다.
        // 지역 구분은 지역명·진단 순위·수치가 이미 하고 있다 (13 §4 "색은 신호일 때만").
        //
        // 이 카드는 **흰 패널 안에** 놓이는데, 다른 카드처럼 면을 한 단 낮춰(surface-sunken)
        // 구분할 수가 없다. 두 가지가 막는다:
        //   ① 낮은 면(#F5F4F8)과 강조색 lavender-50(#F6F4FE)의 명도차가 0.6%p라 진단 대상이 묻힌다
        //   ② 강조를 lavender-100까지 올리면 카드 안 11px 보조문이 4.15:1로 AA 미달이 된다
        // 그래서 여기서만 1px 실선을 남긴다 — 배경 대비가 일할 수 없는 자리에서는 선이 맡는다
        // (입력·버튼에 테두리를 남겨 둔 것과 같은 기준).
        //
        // 진단 대상은 옅은 라벤더 면 + 라벤더 실선 두 겹으로, 흰 카드 넷 사이에서 즉시 읽히게 한다.
        return (
          <article
            key={region}
            className={`rounded-2xl p-4 shadow-card ring-1 ring-inset ${
              isTarget
                ? "bg-lavender-50 ring-2 ring-admin-primary"
                : isSelected
                  ? "bg-lavender-50 ring-admin-primary"
                  : "bg-admin-surface ring-admin-border"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Icon name="pin" size={14} className="text-admin-primary" />
                  <h4 className="text-[15px] font-bold text-admin-text">{region}</h4>
                </div>
                <p className="mt-1 text-[11px] text-admin-text-muted">
                  진단 {score ? `${score.rank}위 · ${score.score.toFixed(2)}` : "순위 없음"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {isTarget ? (
                  <span className="rounded-full bg-admin-primary px-2 py-0.5 text-[10px] font-bold text-white">
                    제안 대상
                  </span>
                ) : isSelected ? (
                  <span className="rounded-full bg-admin-primary-soft px-2 py-0.5 text-[10px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line">
                    진단 대상
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[25px] font-bold leading-none tracking-[-0.03em] tabular-nums text-admin-text">
                  {num(share?.count ?? 0)}
                  <span className="ml-1 text-[12px] font-medium tracking-normal text-admin-text-muted">건</span>
                </p>
                <p className="mt-1.5 text-[11px] text-admin-text-muted">전 기간 누적 사용 건수</p>
              </div>
              <div className="text-right">
                <p className="text-[18px] font-bold tabular-nums text-admin-primary">
                  {share ? `${Math.round(share.share * 100)}%` : "0%"}
                </p>
                <p className="mt-1 text-[11px] text-admin-text-muted">전체 비중</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-admin-border pt-3 text-[11px]">
              <span className="text-admin-text-muted">{latestLabel} 사용</span>
              <span className="font-semibold tabular-nums text-admin-text">{num(latestCount)}건</span>
            </div>
            <p className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-admin-text-muted">직전 월 대비</span>
              <DeltaValue
                value={monthlyDelta}
                unit="%"
                variant="text"
                className="font-semibold"
              />
            </p>

            {REGION_TOOLTIP[region as Region] ? (
              <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-admin-text-muted">
                <Icon name="info" size={12} className="mt-0.5" />
                <span>{REGION_TOOLTIP[region as Region]}</span>
              </p>
            ) : null}

            {withDetailLink ? (
              <Link
                href={`/dashboard?region=${encodeURIComponent(region)}#region-detail`}
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-admin-primary underline-offset-4 hover:underline"
              >
                이 지역 상세 분석
                <Icon name="arrowRight" size={12} strokeWidth={2} />
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
