import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { GradeChip, ProxyBadge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { RegionFilter } from "@/components/RegionFilter";
import { RegionStatusGrid } from "@/components/RegionStatusGrid";
import { MenuDemoGuide } from "@/components/MenuDemoGuide";
import { GroupHeading, Section } from "@/components/Section";
import { BarRank } from "@/components/charts/BarRank";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { DailyTrend } from "@/components/charts/DailyTrend";
import { LineTrend } from "@/components/charts/LineTrend";
import { ScaleCompare } from "@/components/charts/ScaleCompare";
import { api } from "@/lib/api";
import { REGIONS, REGION_TOOLTIP, STABILITY_NOTE } from "@/lib/constants";
import { dash, monthLabel, num, pct, ratioPct, signed } from "@/lib/format";
import {
  regionCategoryShare,
  regionCategoryWeekdays,
  regionDailySeries,
  regionMonthlyTrend,
  regionWeekdayAverages,
  overallWeekdayInsight,
  regionWeekdayInsight,
  shiftWindowLabel,
  topCategoryShifts,
  USAGE_REGION_FOOTNOTE,
} from "@/lib/regionAnalysis";

export const metadata: Metadata = { title: "지역 소비 분석 · 상생 나침반" };

// mock/실 API 어느 쪽이든 매 요청 최신 상태를 읽는다 (승인 → KPI 반영이 데모 동선이라 캐시하지 않는다)
export const dynamic = "force-dynamic";

/**
 * ③ 집중도 대시보드 (docs/plan/08 F5 · 13 §3).
 *
 * 서버 컴포넌트다 — mock JSON은 서버에서만 읽히고 브라우저 번들에 실리지 않는다.
 * 차트만 `"use client"`(Recharts는 브라우저 전용)이며 이미 가공된 작은 배열만 props로 받는다.
 *
 * 패널이 열 장 넘게 세로로 쌓이는 화면이라 `GroupHeading`으로 세 묶음(진단 / 추이·분포 /
 * 제안의 정량 근거)으로 갈라 둔다 — 스크롤 도중에도 지금 보는 게 어느 단계인지 읽혀야 한다.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; demo?: string }>;
}) {
  const sp = await searchParams;
  const selectedRegion = REGIONS.includes(sp.region as (typeof REGIONS)[number])
    ? (sp.region as (typeof REGIONS)[number])
    : null;
  const demo = sp.demo === "merchant" || sp.demo === "report" || sp.demo === "data" ? sp.demo : null;

  const [d, kpi, cand, risk, usageLedger, usageDaily] = await Promise.all([
    api.dashboard(),
    api.kpi(),
    api.candidates(),
    api.riskSignal(),
    api.usageMonthly(),
    api.usageDaily(),
  ]);

  // 음수/0·빈 배열 방어 (F5 검증 항목) — 데이터가 없으면 차트 대신 안내 문구를 낸다
  const conversionTrend = (d.conversion.monthly ?? []).map((m) => ({
    label: monthLabel(m.month),
    value: m.rate,
  }));
  const concentrationTrend = (d.concentration.monthly ?? []).map((m) => ({
    label: monthLabel(m.month),
    value: m.index,
  }));
  const scaleData = (d.conversion.monthly ?? []).map((m) => ({
    label: monthLabel(m.month),
    visitors: m.visitors,
    uses: m.local_uses,
  }));
  // 지역 고정 순서로 정렬 — 값 순 정렬은 하지 않는다(색·순서 고정 원칙, 13 §5)
  const visibleRegions = selectedRegion ? [selectedRegion] : REGIONS;
  const regionBars = visibleRegions.map((r) => {
    const row = (d.region_share ?? []).find((x) => x.region === r);
    return {
      label: r,
      value: row?.count ?? 0,
      note: row ? `${Math.round(row.share * 100)}%` : "0%",
    };
  });
  const totalUses = (d.region_share ?? []).reduce((a, b) => a + b.count, 0);
  const eupRanking = cand.eup_ranking ?? [];

  // 2단계 표 주석용 — 포화도 0.00이 빈 값이 아니라 "반경 내 기존 가맹점 0곳"의 계산 결과임을 명시한다
  const saturationAllZero =
    (cand.candidates ?? []).length > 0 &&
    (cand.candidates ?? []).every((c) => c.saturation === 0 && c.nearby_merchants === 0);
  // 배경 정보 요약용 — 편차 0.5%p 수준이라 막대로 차이를 그리지 않고 문장으로 말한다 (05 §6)
  const riskPcts = risk.map((r) => r.under2y_ratio * 100);
  const riskSpread = riskPcts.length ? Math.max(...riskPcts) - Math.min(...riskPcts) : 0;
  const riskAvg = riskPcts.length ? riskPcts.reduce((a, b) => a + b, 0) / riskPcts.length : 0;
  const stability = d.ranking_stability ?? d.ai_stability;

  // 지역 드릴다운 파생값 — 지역을 선택했을 때만 계산·렌더한다 (원장은 서버에서만 읽는다)
  const ledgerRows = usageLedger.usage ?? [];
  const ledgerMonths = usageLedger.months ?? [];
  const regionDonut = selectedRegion ? regionCategoryShare(ledgerRows, selectedRegion) : [];
  const regionTrend = selectedRegion ? regionMonthlyTrend(ledgerRows, ledgerMonths, selectedRegion) : [];
  const regionShifts = selectedRegion ? topCategoryShifts(ledgerRows, ledgerMonths, selectedRegion) : [];
  // 라벨과 계산이 같은 창 정의를 쓰도록 regionAnalysis가 한 곳에서 만든다 (6개월 미만이면 null)
  const shiftWindow = shiftWindowLabel(ledgerMonths);
  // 일·요일 축 (usage_daily — 피드백 ⑦). 관측 집계라 전망 문구·근사 배지 대상이 아니다 (설계 08-08)
  const weekdayBars = selectedRegion ? regionWeekdayAverages(usageDaily, selectedRegion) : [];
  const weekdayInsight = selectedRegion ? regionWeekdayInsight(usageDaily, selectedRegion) : null;
  // 전 지역 기준선 — 지역 리듬이 "다르다"는 말은 비교 대상이 화면에 함께 있어야 성립한다
  const overallWeekday = selectedRegion ? overallWeekdayInsight(usageDaily) : null;
  const categoryWeekdays = selectedRegion ? regionCategoryWeekdays(usageDaily, selectedRegion) : [];
  const dailySeries = selectedRegion ? regionDailySeries(usageDaily, selectedRegion) : [];
  const dailyPeriod = usageDaily.period;

  return (
    <AdminShell dashboard={d}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="chart"
          eyebrow="진단"
          title="지역 소비 분석"
          lede="하이원포인트 소비가 어디에 얼마나 몰려 있는지, 그 흐름이 어떻게 움직였는지를 본다. 이 화면의 값이 Action Card 제안의 정량 출발점이다."
        >
          <p className="u-note mt-2 flex flex-wrap items-center gap-x-2">
            <Icon name="database" size={13} />
            데이터 기준 {d.period_note} · 산출일 {d.updated_at}
          </p>
        </PageHeader>

        <section aria-label="지역 필터" className="animate-rise">
          <RegionFilter selectedRegion={selectedRegion} />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-admin-text-muted" aria-live="polite">
            <Icon name="info" size={13} />
            {selectedRegion
              ? `${selectedRegion}의 지역별 소비 지표를 보고 있습니다. 아래 상세 분석에 이 지역의 업종 구성·월별 추이·상위 업종·요일과 일별 패턴이 나옵니다. 상단 진단 지표·추이·업종별 사용 비중·정책 운영 KPI는 전체 지역 기준입니다.`
              : "전체 지역을 보고 있습니다. 지역을 고르면 해당 지역의 업종 구성·월별 추이·상위 업종·요일과 일별 패턴까지 좁혀 볼 수 있습니다."}
          </p>
        </section>

        {/* ── 진단 지표 ─────────────────────────────────────────── */}
        <GroupHeading note="원천 데이터에서 바로 계산한 값">진단 지표</GroupHeading>
        {/* alignDivider: 증감 배지가 있는 카드(전환율·사용 건수)와 없는 카드(집중도·분산도)가
            한 행에 섞여 있어, 구분선을 하단 정렬로 통일한다 — 이 4장에만 적용 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            accent
            alignDivider
            icon="trend"
            label="지역 전환율"
            badge={d.conversion.is_proxy ? <ProxyBadge note={d.conversion.proxy_note} /> : null}
            value={pct(d.conversion.headline_rate)}
            delta={{
              value: d.growth?.qoq_pp ?? null,
              unit: "%p",
              note: "전분기 대비",
            }}
            sub="지역 사용 건수 ÷ 입장 연인원(교대 합산) — 비율이 아니라 연인원 1인당 건수"
          />
          <KpiCard
            alignDivider
            icon="target"
            label="지역 소비 집중도"
            badge={<GradeChip grade={d.concentration.grade} />}
            value={num(d.concentration.index)}
            unit="/ 100"
            sub="값이 높을수록 특정 지역에 소비가 몰려 있음"
          />
          <KpiCard
            alignDivider
            icon="receipt"
            label="하이원포인트 지역 사용 건수"
            value={num(totalUses)}
            unit="건"
            delta={{
              value: d.growth?.mom_pct ?? null,
              unit: "%",
              note: "전월 대비",
            }}
            sub="전 기간 누적 · 전월 대비 일평균 사용 건수"
          />
          <KpiCard
            alignDivider
            icon="scatter"
            label="업종별 소비 분산도"
            value={num(d.category_dispersion?.index)}
            unit="/ 100"
            sub="값이 높을수록 업종이 고르게 분산됨"
          />
        </div>

        {/* ── 운영 KPI (시스템 상태값) ──────────────────────────── */}
        <Section
          id="kpi"
          icon="report"
          title="성과 리포트 · 정책 운영 KPI"
          desc="Action Card 상태값으로 계산한 지표다. 승인·상태 변경이 일어나면 즉시 바뀐다."
        >
          {demo === "report" ? (
            <MenuDemoGuide
              icon="report"
              title="성과 리포트 데모"
              description={`현재 시드 카드 ${kpi.counts.total}장을 기준으로 계산합니다. 승인·반려·보류와 추진 상태를 바꾸면 아래 네 지표가 바뀝니다.`}
              steps={["채택률에서 승인 카드 비중을 확인합니다.", "실행 전환율에서 승인 후 추진 상태를 봅니다.", "균형지수로 승인 확충 카드의 지역 쏠림을 점검합니다."]}
            />
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon="check"
              label="채택률"
              value={ratioPct(kpi.adoption_rate)}
              sub={`승인 ${kpi.counts.approved} / 결정 ${kpi.counts.decided}장`}
            />
            <KpiCard
              icon="trend"
              label="실행 전환율"
              value={ratioPct(kpi.execution_rate)}
              sub="승인 카드 중 추진중·완료 비중"
            />
            <KpiCard
              icon="clock"
              label="평균 의사결정 소요"
              value={dash(kpi.avg_decision_hours)}
              unit={kpi.avg_decision_hours === null ? undefined : "시간"}
              sub="승인·반려·보류까지 걸린 시간의 평균"
            />
            <KpiCard
              icon="scale"
              label="지역 균형지수"
              value={dash(kpi.regional_balance_index)}
              unit={kpi.regional_balance_index === null ? undefined : "/ 100"}
              sub={`승인 카드가 여러 지역에 고루 쌓일수록 상승 (현재 승인 ${kpi.counts.approved}건)`}
            />
          </div>
        </Section>

        {/* ── 추이 ─────────────────────────────────────────────── */}
        <GroupHeading note="월별 흐름과 분포">추이 · 분포</GroupHeading>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            icon="trend"
            title="지역 전환율 추이"
            badge={d.conversion.is_proxy ? <ProxyBadge note={d.conversion.proxy_note} /> : null}
            desc="월별 지역 사용 건수 ÷ 입장 연인원(교대 합산). 단위가 달라 비율이 아닌 근사 지표다."
          >
            {conversionTrend.length ? (
              <LineTrend data={conversionTrend} unit="%" />
            ) : (
              <EmptyChart />
            )}
          </Section>

          <Section
            icon="target"
            title="지역 소비 집중도 추이"
            desc="0~100 지수. 값이 높을수록 특정 지역에 소비가 몰려 있다."
          >
            {concentrationTrend.length ? (
              <LineTrend data={concentrationTrend} domain={[0, 100]} />
            ) : (
              <EmptyChart />
            )}
          </Section>
        </div>

        {/* ── 분포 ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            icon="pin"
            title={selectedRegion ? `${selectedRegion} 하이원포인트 사용 건수` : "지역별 하이원포인트 사용 건수"}
            desc={selectedRegion ? "선택한 지역의 전 기간 누적 사용 건수와 전체 대비 비중." : "전 기간 누적. 괄호 안은 전체 대비 비중."}
          >
            {regionBars.some((b) => b.value > 0) ? (
              <>
                <BarRank data={regionBars} unit="건" height={240} />
                <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                  {REGION_TOOLTIP.삼척시}
                </p>
              </>
            ) : (
              <EmptyChart />
            )}
          </Section>

          <Section
            icon="scatter"
            title="업종별 사용 비중"
            desc="표시 6분류 기준. 범례에 비중을 함께 표기한다."
          >
            {(d.category_share ?? []).length ? (
              <CategoryDonut data={d.category_share} height={240} />
            ) : (
              <EmptyChart />
            )}
          </Section>
        </div>

        {/* ── 지역 드릴다운 (지역 선택 시) ─────────────────────── */}
        {selectedRegion ? (
          <>
            <GroupHeading note="지역×업종×월 원장에서 집계 — 원 업종 분류 기준">
              {selectedRegion} 상세 분석
            </GroupHeading>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section
                icon="scatter"
                title={`${selectedRegion} 업종 구성`}
                desc="전 기간 누적 사용 건수를 표시 6분류로 집계했다."
              >
                {regionDonut.length ? (
                  <CategoryDonut data={regionDonut} height={240} />
                ) : (
                  <EmptyChart />
                )}
              </Section>
              <Section
                icon="trend"
                title={`${selectedRegion} 월별 사용 추이`}
                desc="월별 하이원포인트 사용 건수 합계."
              >
                {regionTrend.some((p) => p.value > 0) ? (
                  <LineTrend data={regionTrend} unit="건" />
                ) : (
                  <EmptyChart />
                )}
              </Section>
            </div>
            <Section
              icon="report"
              title={`${selectedRegion} 상위 업종 상세`}
              desc={`누적 사용 건수 상위 업종을 원 업종 분류 그대로 보여준다.${shiftWindow ? ` 증감은 ${shiftWindow}한 값이다.` : ""}`}
            >
              {regionShifts.length ? (
                <>
                  <div className="u-scroll-x">
                    <table className="u-table min-w-[520px]">
                      <thead>
                        <tr>
                          <th scope="col">업종</th>
                          <th scope="col" className="text-right">누적 사용</th>
                          <th scope="col" className="text-right">지역 내 비중</th>
                          <th scope="col" className="text-right">최근 3개월</th>
                          <th scope="col" className="text-right">직전 대비</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regionShifts.map((s) => (
                          <tr key={s.category}>
                            <td className="font-medium">{s.category}</td>
                            <td className="text-right tabular-nums">{num(s.count)}건</td>
                            <td className="text-right tabular-nums text-admin-text-muted">
                              {ratioPct(s.share)}
                            </td>
                            <td className="text-right tabular-nums text-admin-text-muted">
                              {num(s.recent)}건
                            </td>
                            <td className="text-right font-semibold tabular-nums">
                              {s.changePct === null ? (
                                <span className="font-normal text-admin-text-muted">비교 불가</span>
                              ) : (
                                // 0자리 반올림이면 ±0.x%가 "▲0%"로 찍혀 화살표와 크기가 모순된다
                                signed(s.changePct, "%", 1)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                    {USAGE_REGION_FOOTNOTE}
                  </p>
                </>
              ) : (
                <EmptyChart />
              )}
            </Section>

            {/* ── 요일·일별 패턴 (usage_daily — 피드백 ⑦) ─────────── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section
                icon="calendar"
                title={`${selectedRegion} 요일별 사용 패턴`}
                desc={`요일별 하루 평균 사용 건수 — ${dailyPeriod.start.slice(0, 4)}년 ${dailyPeriod.days}일 일 단위 집계.`}
              >
                {weekdayBars.length ? (
                  <>
                    {weekdayInsight ? (
                      <p className="mb-2 rounded-lg bg-admin-primary-soft px-3 py-2 text-[13px] text-admin-text">
                        <span className="font-semibold">{weekdayInsight.maxLabel}요일</span>이 하루
                        평균 <span className="font-semibold tabular-nums">{num(weekdayInsight.maxAvg)}건</span>으로
                        가장 많다
                        {weekdayInsight.weekendVsWeekdayPct === null
                          ? "."
                          : ` — 주말 하루 평균은 주중 대비 ${signed(weekdayInsight.weekendVsWeekdayPct, "%", 1)}.`}
                      </p>
                    ) : null}
                    {overallWeekday ? (
                      <p className="u-note mb-2">
                        전 지역 기준: {overallWeekday.maxLabel}요일 하루 평균{" "}
                        <span className="font-semibold tabular-nums">{num(overallWeekday.maxAvg)}건</span>
                        {overallWeekday.minLabel && overallWeekday.maxVsMinPct !== null
                          ? ` (최저 ${overallWeekday.minLabel}요일 대비 ${signed(overallWeekday.maxVsMinPct ?? 0, "%", 1)})`
                          : ""}
                        . 지역마다 몰리는 요일이 다릅니다.
                      </p>
                    ) : null}
                    <BarRank data={weekdayBars} unit="건" height={236} />
                  </>
                ) : (
                  <EmptyChart />
                )}
              </Section>
              <Section
                icon="list"
                title={`${selectedRegion} 업종별 요일 패턴`}
                desc="표시 6분류별로 사용이 가장 몰리는 요일과 주중·주말 하루 평균을 비교한다."
              >
                {categoryWeekdays.length ? (
                  <div className="u-scroll-x">
                    <table className="u-table min-w-[420px]">
                      <thead>
                        <tr>
                          <th scope="col">업종</th>
                          <th scope="col" className="text-right">최대 요일</th>
                          <th scope="col" className="text-right">주중 하루 평균</th>
                          <th scope="col" className="text-right">주말 하루 평균</th>
                          <th scope="col" className="text-right">주말 - 주중</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoryWeekdays.map((row) => (
                          <tr key={row.category}>
                            <td className="font-medium">{row.category}</td>
                            <td className="text-right">{row.maxLabel}</td>
                            <td className="text-right tabular-nums text-admin-text-muted">
                              {num(row.weekdayAvg)}건
                            </td>
                            <td className="text-right tabular-nums text-admin-text-muted">
                              {num(row.weekendAvg)}건
                            </td>
                            <td className="text-right font-semibold tabular-nums">
                              {row.weekendVsWeekdayPct === null ? (
                                <span className="font-normal text-admin-text-muted">비교 불가</span>
                              ) : (
                                signed(row.weekendVsWeekdayPct, "%", 1)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyChart />
                )}
              </Section>
            </div>
            <Section
              icon="trend"
              title={`${selectedRegion} 일별 사용 추이`}
              desc="일별 사용 건수(옅은 선)와 7일 이동평균(진한 선) — 주말 파동과 계절 흐름이 함께 보인다."
            >
              {dailySeries.length ? (
                <>
                  <DailyTrend data={dailySeries} />
                  <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                    {USAGE_REGION_FOOTNOTE}
                  </p>
                </>
              ) : (
                <EmptyChart />
              )}
            </Section>
          </>
        ) : null}

        <Section
          icon="map"
          title="지역별 현재 상태"
          desc="6개 지역을 같은 기준으로 나란히 비교한다. 누적 사용 건수·전체 비중·최근 월 흐름·1단계 진단 순위를 함께 표시한다."
        >
          <RegionStatusGrid
            shares={d.region_share ?? []}
            monthlyByRegion={d.monthly_by_region ?? []}
            ranking={eupRanking}
            selectedRegions={cand.selected_eups ?? []}
            onlyRegion={selectedRegion}
          />
        </Section>

        {/* ── 문제 스케일 각인 ─────────────────────────────────── */}
        <Section
          icon="chart"
          title="리조트 체류 규모 vs 지역 전환 건수"
          desc="같은 축의 그룹 막대로 비교한다. 두 값은 단위가 다르므로 비율이 아니라 규모 차이를 읽는 용도다."
        >
          {scaleData.length ? <ScaleCompare data={scaleData} /> : <EmptyChart />}
        </Section>

        {/* ── 1단계 진단 근거 ──────────────────────────────────── */}
        <GroupHeading note="AI 제안이 딛고 선 정량 값 — 순위는 화면에서 감추지 않는다">
          제안의 정량 근거
        </GroupHeading>
        <Section
          icon="compass"
          title="1단계 지역 진단 — 읍·시 스코어"
          desc="소비저조도·소비증감을 0~1로 정규화해 합산한 값이다. AI 제안 대상 지역 선정의 정량 근거이며, 순위는 화면에서 감추지 않는다."
        >
          {eupRanking.length ? (
            <div className="u-scroll-x">
              <table className="u-table min-w-[460px]">
                <thead>
                  <tr>
                    <th scope="col">순위</th>
                    <th scope="col">지역</th>
                    <th scope="col" className="text-right">
                      종합 스코어
                    </th>
                    <th scope="col" className="text-right">
                      소비저조도
                    </th>
                    <th scope="col" className="text-right">
                      소비증감
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eupRanking.map((e) => {
                    const selected = (cand.selected_eups ?? []).includes(e.eup);
                    return (
                      <tr key={e.eup} data-highlight={selected ? "true" : undefined}>
                        <td className="tabular-nums text-admin-text-muted">{e.rank}</td>
                        <td>
                          <span className={selected ? "font-semibold text-admin-primary" : ""}>
                            {e.eup}
                          </span>
                          {selected ? (
                            <span className="ml-1.5 whitespace-nowrap rounded-full bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line">
                              제안 대상
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right font-semibold tabular-nums">
                          {e.score.toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          {e.low_usage.toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          {e.decline.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyChart />
          )}
        </Section>

        {/* ── 2단계 후보 스코어 — 개별 후보 비교라 단독 행으로 넓게 둔다
            (시군 단위 배경 정보와 층위가 달라 같은 줄에 짝짓지 않는다) ── */}
        <Section
          id="merchant-candidates"
          icon="store"
          title="가맹점 관리 · 2단계 후보 스코어"
          desc="세 요인을 같은 가중치로 합산한다. 현재 데이터에서는 업종공백도·기존가맹포화도가 후보 간 동률인지 함께 확인한다."
        >
          {demo === "merchant" ? (
            <MenuDemoGuide
              icon="store"
              title="가맹점 후보 관리 데모"
              description={`현재 ${cand.candidates.length}개 후보를 점수 순으로 보여 줍니다. 아래 표는 데모 시드의 후보·업종·생활권 데이터를 그대로 사용합니다.`}
              steps={["종합 점수로 검토 순서를 잡습니다.", "업종공백도·동선근접도·기존가맹포화도를 비교합니다.", "후보를 선택해 확충 Action Card를 생성·결정합니다."]}
            />
          ) : null}
          {(cand.candidates ?? []).length ? (
              <>
                <div className="u-scroll-x">
                  <table className="u-table min-w-[480px]">
                    <thead>
                      <tr>
                        <th scope="col">후보</th>
                        <th scope="col" className="text-right">
                          종합
                        </th>
                        <th scope="col" className="text-right">
                          업종공백도
                        </th>
                        <th scope="col" className="text-right">
                          동선근접도
                        </th>
                        <th scope="col" className="text-right">
                          기존가맹포화도
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cand.candidates.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <div className="font-semibold">{c.category}</div>
                            <div className="mt-0.5 text-xs text-admin-text-muted">
                              {c.eup} · {c.name}
                            </div>
                          </td>
                          <td className="text-right font-semibold tabular-nums">
                            {c.score.toFixed(2)}
                          </td>
                          <td className="text-right tabular-nums text-admin-text-muted">
                            {c.gap.toFixed(2)}
                          </td>
                          <td className="text-right tabular-nums text-admin-text-muted">
                            {c.proximity.toFixed(2)}
                          </td>
                          <td className="text-right tabular-nums text-admin-text-muted">
                            {c.saturation.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                  {/* 포화도 전부 0.00은 심사에서 "빈 값 아니냐"로 읽힐 수 있어 계산 근거를 먼저 밝힌다 */}
                  {saturationAllZero
                    ? "기존가맹포화도 0.00은 빈 값이 아니다 — 현재 후보 전부 반경 500m 안에 동일 업종 기존 가맹점이 0곳이라 포화도가 0으로 계산된 값이다. "
                    : null}
                  동선근접도는 거점에서의 직선거리 기반이라 산악 지형에서 실제 접근성과 역전될 수
                  있다. 업종공백도·기존가맹포화도가 모두 동률이면 실질 선발 요인은 동선근접도이며,
                  이를 상위 후보의 강건성으로 해석하지 않는다.
                </p>
              </>
            ) : (
              <EmptyChart />
            )}
        </Section>

        {/* ── 배경·주의 정보 — 후보 비교(위 표)와 층위가 다른 참고 카드 묶음 ── */}
        <div className={`grid grid-cols-1 gap-4 ${stability !== null && stability !== undefined ? "lg:grid-cols-2" : ""}`}>
          {/* 05 §6·13 §9: 편차가 0.5%p뿐이라 지역 비교 근거가 못 된다 —
              막대로 그리면 "차이가 있는 것처럼" 보이므로(설명 문구와 모순) 수치 나열 + 요약 문장만 쓴다 */}
          <Section
            icon="info"
            title="운영 2년 미만 사업자 비중"
            desc="지역 상권의 배경 정보다. 4개 시군 편차가 0.5%p 수준이라 지역 간 비교나 순위 근거로는 쓰지 않는다."
          >
            {risk.length ? (
              <>
                <p className="break-keep text-[15px] leading-7 text-admin-text">
                  {risk.length}개 시군 모두{" "}
                  <b className="font-semibold">약 {Math.round(riskAvg)}%</b>로 사실상 같은
                  수준이다 (최대 편차 {riskSpread.toFixed(1)}%p).
                </p>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                  {risk.map((r) => (
                    <li key={r.sigungu} className="flex items-baseline gap-1.5">
                      <span className="text-admin-text-muted">{r.sigungu}</span>
                      <span className="font-semibold tabular-nums text-admin-text">
                        {(r.under2y_ratio * 100).toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                  차이가 없는 값이라 막대·순위 없이 수치만 적는다 — 진단 참고용 배경 정보다.
                </p>
              </>
            ) : (
              <EmptyChart />
            )}
          </Section>

          {/* ── AI 제안 안정도 (P8 민감도) ───────────────────────
              해석 주의 문구는 lib/constants의 STABILITY_NOTE 하나로만 쓴다 — 이 숫자는 허브
              미리보기·제안 요약(ProposalSummary)에도 같이 뜨는데, 문구가 화면마다 갈리면
              어느 쪽이 정본인지 흐려진다.
              `가정 기반 전망` 배지는 붙이지 않는다 — 안정도는 미래를 내다본 전망이 아니라
              가중치를 흔들어 본 **민감도 실측값**이라 절대 규칙 3의 대상이 아니다.
              전망 배지를 남발하면 정작 시뮬레이션 출력에 붙은 배지의 무게가 줄어든다 */}
          {stability !== null && stability !== undefined ? (
            <Section
              icon="shield"
              title="추천 순위 안정도 · 해석 주의"
              desc={STABILITY_NOTE}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[32px] font-bold leading-none tabular-nums text-admin-text">
                  {stability}
                </span>
                <span className="text-[13px] font-medium text-admin-text-muted">%</span>
              </div>
            </Section>
          ) : null}
        </div>

        <Section
          id="data-demo"
          icon="database"
          title="데이터 관리 · 출처와 기준"
          desc="지표를 계산한 원천·기준 시점을 확인하는 영역입니다. 현재 버전은 원본 수정·적재 기능이 아니라 검증용 조회 화면입니다."
        >
          {demo === "data" ? (
            <MenuDemoGuide
              icon="database"
              title="데이터 관리 데모"
              description={`현재 화면은 ${d.period_note} 데이터를 기준으로 그려집니다. 원천 파일을 바꾸는 대신, 어떤 데이터가 의사결정에 쓰였는지 확인합니다.`}
              steps={["푸터의 원천 데이터 출처를 확인합니다.", "기준 시점과 산출일을 확인합니다.", "수치 이상 시 지역 소비 분석과 원천 파일을 함께 점검합니다."]}
            />
          ) : null}
          <div className="rounded-xl bg-admin-surface-sunken px-3.5 py-3 text-xs leading-5 text-admin-text-muted">
            데이터 기준: <span className="font-semibold text-admin-text">{d.period_note}</span>
          </div>
        </Section>
      </div>
    </AdminShell>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken text-[13px] text-admin-text-muted">
      표시할 데이터가 없습니다
    </div>
  );
}
