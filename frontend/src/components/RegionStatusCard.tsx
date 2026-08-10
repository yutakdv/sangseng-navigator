import Link from "next/link";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { REGION_TOOLTIP, REGIONS } from "@/lib/constants";
import { monthLabel, num } from "@/lib/format";
import type { Dashboard, EupScore, Region } from "@/types";

type RegionShare = Dashboard["region_share"][number];
type MonthlyRegion = Dashboard["monthly_by_region"][number];

/**
 * 지역 한 곳의 현재 상태 — 지도 팝업과 서버 계산 사이의 직렬화 가능한 계약.
 * 계산(buildRegionStatuses)은 서버에서 하고, 카드는 이 평면 값만 그린다 —
 * 클라이언트 트리에서 mock JSON·api 계층을 import하지 않기 위한 경계다 (api.ts 주석).
 */
export type RegionStatus = {
  region: string;
  rank: number | null;
  score: number | null;
  /** 전 기간 누적 사용 건수 */
  count: number;
  /** 전체 대비 비중(%) — 반올림값 */
  sharePct: number;
  latestLabel: string;
  latestCount: number;
  /** 직전 월 대비(%) — 직전 월이 0이면 null */
  monthlyDelta: number | null;
  /** AI 제안 대상 지역 */
  isTarget: boolean;
  /** 1단계 진단 대상 지역 */
  isDiagnosisTarget: boolean;
  tooltip: string | null;
};

/** dashboard/candidates 계약 값 → 지역 고정 순서의 RegionStatus 목록 (서버에서 호출) */
export function buildRegionStatuses({
  shares,
  monthlyByRegion,
  ranking,
  selectedRegions = [],
  targetRegion = null,
}: {
  shares: RegionShare[];
  monthlyByRegion: MonthlyRegion[];
  ranking: EupScore[];
  selectedRegions?: string[];
  targetRegion?: string | null;
}): RegionStatus[] {
  const shareByRegion = new Map(shares.map((row) => [row.region, row]));
  const rankByRegion = new Map(ranking.map((row) => [row.eup, row]));
  const latest = monthlyByRegion[monthlyByRegion.length - 1];
  const previous = monthlyByRegion[monthlyByRegion.length - 2];
  const latestLabel = latest?.month ? monthLabel(String(latest.month)) : "최근 월";

  return REGIONS.map((region) => {
    const share = shareByRegion.get(region);
    const score = rankByRegion.get(region);
    const latestCount = Number(latest?.[region] ?? 0);
    const previousCount = Number(previous?.[region] ?? 0);
    const isTarget = region === targetRegion;
    return {
      region,
      rank: score?.rank ?? null,
      score: score?.score ?? null,
      count: share?.count ?? 0,
      sharePct: share ? Math.round(share.share * 100) : 0,
      latestLabel,
      latestCount,
      monthlyDelta: previousCount > 0 ? ((latestCount - previousCount) / previousCount) * 100 : null,
      isTarget,
      isDiagnosisTarget: selectedRegions.includes(region) && !isTarget,
      tooltip: REGION_TOOLTIP[region as Region] ?? null,
    };
  });
}

/**
 * 지역 상태 카드 한 장 — 예전 지역별 현재 상태 그리드의 카드를 그대로 옮겨 왔다.
 * 지금은 지도에서 지역을 고르면 뜨는 상세 패널이 쓴다.
 *
 * 지역마다 다른 색 띠를 상단에 두지 않는다 — 그 색은 아무것도 인코딩하지 않았고,
 * 여섯 색이 시끄러워 정작 의미 있는 신호인 `진단 대상` 라벤더 배지를 덮었다.
 * 지역 색은 지도 면이 이미 말하고 있다(REGION_COLORS). 카드 안에서는 지역명·진단
 * 순위·수치가 지역을 구분한다 (13 §4 "색은 신호일 때만").
 *
 * 진단 대상은 옅은 라벤더 면 + 라벤더 실선 두 겹으로 즉시 읽히게 한다 — 배경 대비가
 * 일할 수 없는 자리라 1px 실선이 구분을 맡는다(입력·버튼과 같은 기준).
 */
export function RegionStatusCard({ status }: { status: RegionStatus }) {
  const s = status;
  return (
    <article
      className={`rounded-2xl p-4 shadow-card ring-1 ring-inset ${
        s.isTarget
          ? "bg-lavender-50 ring-2 ring-admin-primary"
          : s.isDiagnosisTarget
            ? "bg-lavender-50 ring-admin-primary"
            : "bg-admin-surface ring-admin-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon name="pin" size={14} className="text-admin-primary" />
            <h4 className="text-[15px] font-bold text-admin-text">{s.region}</h4>
          </div>
          <p className="mt-1 text-[11px] text-admin-text-muted">
            진단 {s.rank !== null && s.score !== null ? `${s.rank}위 · ${s.score.toFixed(2)}` : "순위 없음"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {s.isTarget ? (
            <span className="rounded-full bg-admin-primary px-2 py-0.5 text-[10px] font-bold text-white">
              제안 대상
            </span>
          ) : s.isDiagnosisTarget ? (
            <span className="rounded-full bg-admin-primary-soft px-2 py-0.5 text-[10px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line">
              진단 대상
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[25px] font-bold leading-none tracking-[-0.03em] tabular-nums text-admin-text">
            {num(s.count)}
            <span className="ml-1 text-[12px] font-medium tracking-normal text-admin-text-muted">건</span>
          </p>
          <p className="mt-1.5 text-[11px] text-admin-text-muted">전 기간 누적 사용 건수</p>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold tabular-nums text-admin-primary">{s.sharePct}%</p>
          <p className="mt-1 text-[11px] text-admin-text-muted">전체 비중</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-admin-border pt-3 text-[11px]">
        <span className="text-admin-text-muted">{s.latestLabel} 사용</span>
        <span className="font-semibold tabular-nums text-admin-text">{num(s.latestCount)}건</span>
      </div>
      <p className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-admin-text-muted">직전 월 대비</span>
        <DeltaValue value={s.monthlyDelta} unit="%" variant="text" className="font-semibold" />
      </p>

      {s.tooltip ? (
        <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-admin-text-muted">
          <Icon name="info" size={12} className="mt-0.5" />
          <span>{s.tooltip}</span>
        </p>
      ) : null}

      <Link
        href={`/dashboard/region?region=${encodeURIComponent(s.region)}`}
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-admin-primary underline-offset-4 hover:underline"
      >
        이 지역 상세 분석
        <Icon name="arrowRight" size={12} strokeWidth={2} />
      </Link>
    </article>
  );
}
