import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { PrivacyBadge } from "@/components/Badge";
import { DashboardToc } from "@/components/DashboardToc";
import { EmptyChart } from "@/components/EmptyChart";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { RegionFilter } from "@/components/RegionFilter";
import { GroupHeading, Section } from "@/components/Section";
import { BarRank } from "@/components/charts/BarRank";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { DailyTrend } from "@/components/charts/DailyTrend";
import { LineTrend } from "@/components/charts/LineTrend";
import { api } from "@/lib/api";
import { REGIONS } from "@/lib/constants";
import { num, ratioPct, signed } from "@/lib/format";
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

export const metadata: Metadata = { title: "지역 상세 분석 · 상생 나침반" };

// 전체 지역 현황과 같은 이유로 캐시하지 않는다 — 승인·상태 변경이 곧바로 반영돼야 한다
export const dynamic = "force-dynamic";

const TOC = [
  { id: "category-mix", label: "업종 구성" },
  { id: "time-pattern", label: "시간 패턴" },
];

/**
 * ③-2 지역 상세 분석 — 전체 지역 현황(`/dashboard`)에서 갈라져 나온 드릴다운 화면.
 *
 * **페이지 하나 = 모집단 하나.** 이 화면의 모든 값은 선택한 지역 한 곳 기준이고,
 * 전체 지역 기준 값(진단 KPI·추이·분포·제안 근거)은 전부 `/dashboard`에 있다.
 * 예전에는 두 모집단이 한 페이지에 번갈아 나와(전체 → 선택 지역 → 다시 전체) 스크롤
 * 위치마다 기준을 다시 판단해야 했는데, 그 경계를 페이지로 끌어올린 것이 이 분리다.
 *
 * 지역 필터가 여기 사는 이유도 같다 — 필터가 지배하는 영역이 곧 이 페이지 전체다.
 * 필터에 `전체 지역`을 두지 않는다: 그건 지역 선택이 아니라 다른 화면으로 가는 일이고,
 * 그 길은 상단 복귀 링크가 맡는다.
 *
 * 서버 컴포넌트다 — 원장(usage_monthly·usage_daily)은 서버에서만 읽고, 차트에는 이미
 * 가공된 작은 배열만 넘긴다.
 */
export default async function RegionDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const sp = await searchParams;
  const selectedRegion = REGIONS.includes(sp.region as (typeof REGIONS)[number])
    ? (sp.region as (typeof REGIONS)[number])
    : null;

  const [d, usageLedger, usageDaily] = await Promise.all([
    api.dashboard(),
    api.usageMonthly(),
    api.usageDaily(),
  ]);

  // 소표본 보호 고지 — 원장 쪽 값이 정본이고, 구형 산출물에는 아예 없을 수 있어 둘 다 가드한다
  const privacy = usageLedger.privacy_meta ?? d.privacy_meta ?? null;
  const privacyK = privacy?.k ?? 5;

  // 파생값은 지역을 골랐을 때만 계산한다 (원장은 서버에서만 읽는다)
  const ledgerRows = usageLedger.usage ?? [];
  const ledgerMonths = usageLedger.months ?? [];
  const regionDonut = selectedRegion
    ? regionCategoryShare(ledgerRows, selectedRegion)
    : { shares: [], suppressed: [] };
  // 지역 월 합계는 억제 영향이 없는 monthly_by_region을 1순위로 읽는다 — 원장 셀만 더하면
  // 비공개 셀만큼 비어 실제보다 낮게 그려진다 (regionMonthlyTrend 주석 참고)
  const regionTrend = selectedRegion
    ? regionMonthlyTrend(ledgerRows, ledgerMonths, selectedRegion, d.monthly_by_region ?? [])
    : { points: [], basis: "ledger" as const };
  const regionShifts = selectedRegion ? topCategoryShifts(ledgerRows, ledgerMonths, selectedRegion) : [];
  // 비공개 업종 목록 — 도넛·추이·상세 표 세 곳이 같은 문장을 쓰도록 여기서 한 번만 만든다
  const hiddenLabel = regionDonut.suppressed.join(" · ");
  const hasHidden = regionDonut.suppressed.length > 0;
  // 라벨과 계산이 같은 창 정의를 쓰도록 regionAnalysis가 한 곳에서 만든다 (6개월 미만이면 null)
  const shiftWindow = shiftWindowLabel(ledgerMonths);
  // 일·요일 축 (usage_daily — 피드백 ⑦). 관측 집계라 전망 문구·근사 배지 대상이 아니다 (설계 08-08)
  const weekdayBars = selectedRegion ? regionWeekdayAverages(usageDaily, selectedRegion) : [];
  const weekdayInsight = selectedRegion ? regionWeekdayInsight(usageDaily, selectedRegion) : null;
  // 전 지역 기준선 — 지역 리듬이 "다르다"는 말은 비교 대상이 화면에 함께 있어야 성립한다
  const overallWeekday = selectedRegion ? overallWeekdayInsight(usageDaily) : null;
  const categoryWeekdays = selectedRegion ? regionCategoryWeekdays(usageDaily, selectedRegion) : [];
  // 요일 축은 산출물이 달라(usage_daily) 억제 여부를 따로 읽는다 — 두 파일이 어긋나도 화면은 각자 사실대로 말한다
  const hiddenWeekdayLabel = categoryWeekdays
    .filter((r) => r.suppressed)
    .map((r) => r.category)
    .join(" · ");
  const dailySeries = selectedRegion ? regionDailySeries(usageDaily, selectedRegion) : [];
  const dailyPeriod = usageDaily.period;

  return (
    <AdminShell dashboard={d}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {/* 마스터로 돌아가는 길은 화면 맨 위에 둔다 — 상세로 들어온 사람은 전체를 다시 보러 나간다 */}
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-admin-primary underline-offset-4 hover:underline"
        >
          <Icon name="arrowLeft" size={14} strokeWidth={2} />
          전체 지역 현황
        </Link>

        <PageHeader
          icon="pin"
          eyebrow="진단"
          title={selectedRegion ? `${selectedRegion} 상세 분석` : "지역 상세 분석"}
          lede={
            selectedRegion
              ? `${selectedRegion} 한 곳의 하이원포인트 소비를 업종 구성과 시간 패턴(월·요일·일) 두 축으로 본다. 이 화면의 모든 값은 ${selectedRegion} 기준이며, 6개 지역을 함께 비교하는 진단 지표·추이·제안 근거는 전체 지역 현황에 있다.`
              : "지역 한 곳을 골라 그 지역의 업종 구성과 시간 패턴(월·요일·일)을 본다. 이 화면의 값은 항상 선택한 지역 한 곳 기준이며, 6개 지역을 함께 비교하는 값은 전체 지역 현황에 있다."
          }
        >
          <p className="u-note mt-2 flex flex-wrap items-center gap-x-2">
            <Icon name="database" size={13} />
            데이터 기준 {d.period_note} · 산출일 {d.updated_at}
          </p>
        </PageHeader>

        <section aria-label="지역 선택">
          <RegionFilter selectedRegion={selectedRegion} />
        </section>

        {selectedRegion ? (
          <>
            <DashboardToc items={TOC} />

            {/* ══ 업종 구성 — 무엇을 사는가 ══ */}
            <section id="category-mix" aria-label="업종 구성" className="flex scroll-mt-32 flex-col gap-6">
              <GroupHeading note="지역×업종×월 원장에서 집계 — 원 업종 분류 기준">
                업종 구성
              </GroupHeading>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Section
                  icon="scatter"
                  title={`${selectedRegion} 업종 구성`}
                  badge={hasHidden ? <PrivacyBadge note={privacy?.note} k={privacyK} /> : null}
                  desc="전 기간 누적 사용 건수를 표시 6분류로 집계했다."
                >
                  {regionDonut.shares.length ? (
                    <>
                      <CategoryDonut data={regionDonut.shares} height={240} />
                      {/* 억제 업종을 말없이 빼면 "그 업종 소비가 없다"로 읽힌다 — 뺀 사실과 이유를 밝힌다 */}
                      {hasHidden ? (
                        <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                          가맹점 {privacyK}곳 미만인 업종({hiddenLabel})은 개별 사업자가 역산될 수 있어
                          건수를 비공개 처리했고, 이 도넛과 총 건수에서도 뺐습니다 — 여기 비중은 값이
                          공개된 {regionDonut.shares.length}개 업종의 합을 100%로 본 값이라 지역 전체
                          소비와 다릅니다. 지역 전체 규모는 아래 시간 패턴의 월별 추이에서 보십시오.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <EmptyChart />
                  )}
                </Section>
                <Section
                  icon="report"
                  title={`${selectedRegion} 상위 업종 상세`}
                  badge={hasHidden ? <PrivacyBadge note={privacy?.note} k={privacyK} /> : null}
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
                            {regionShifts.map((s) =>
                              // 억제 업종은 행을 지우지 않는다 — 사라지면 "소비가 없는 업종"으로 읽힌다
                              s.suppressed ? (
                                <tr key={s.category}>
                                  <td className="font-medium">{s.category}</td>
                                  <td
                                    colSpan={4}
                                    className="text-right text-admin-text-muted"
                                    title={privacy?.note ?? undefined}
                                  >
                                    표본 보호로 비공개
                                  </td>
                                </tr>
                              ) : (
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
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                      {hasHidden ? (
                        <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                          가맹점 {privacyK}곳 미만인 업종은 개별 사업자가 역산될 수 있어 건수를 비공개
                          처리했습니다. 지역 내 비중은 값이 공개된 업종의 합을 분모로 계산한 값입니다.
                        </p>
                      ) : null}
                      <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                        {USAGE_REGION_FOOTNOTE}
                      </p>
                    </>
                  ) : (
                    <EmptyChart />
                  )}
                </Section>
              </div>
            </section>

            {/* ══ 시간 패턴 — 언제 사는가 (월·요일·일) ══ */}
            <section id="time-pattern" aria-label="시간 패턴" className="flex scroll-mt-32 flex-col gap-6">
              <GroupHeading note="월·요일·일 축에서 본 소비 리듬 — 관측 집계라 전망 문구 대상이 아니다">
                시간 패턴
              </GroupHeading>
              <Section
                icon="trend"
                title={`${selectedRegion} 월별 사용 추이`}
                badge={hasHidden ? <PrivacyBadge note={privacy?.note} k={privacyK} /> : null}
                desc="월별 하이원포인트 사용 건수 합계."
              >
                {regionTrend.points.some((p) => p.value > 0) ? (
                  <>
                    <LineTrend data={regionTrend.points} unit="건" />
                    {hasHidden ? (
                      <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                        {regionTrend.basis === "dashboard"
                          ? `비공개 셀(${hiddenLabel})을 빼고 더하면 이 지역 합계가 실제보다 낮게 보이므로, 이 추이는 셀 비공개 이전 원값 기준 지역 합계로 그렸습니다. 대신 이 지역의 월 합계만 ${privacy?.aggregate_rounding.unit ?? 100}단위로 반올림해 발행하므로 각 점에 ±${Math.round((privacy?.aggregate_rounding.unit ?? 100) / 2)}건의 표기 오차가 있습니다.`
                          : `비공개 셀(${hiddenLabel})이 빠져 있어 이 추이는 지역 전체 소비보다 낮습니다 — 값이 공개된 업종만 더한 합계입니다.`}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <EmptyChart />
                )}
              </Section>

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
                      {/* 옆 표의 공개 업종만 더하면 이 막대에 못 미친다 — 두 값이 어긋나 보이지 않게 밝힌다 */}
                      {hiddenWeekdayLabel ? (
                        <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                          이 막대는 지역 일별 집계에서 만든 지역 전체 합계라 비공개 업종
                          ({hiddenWeekdayLabel})까지 포함합니다 — 오른쪽 업종별 표의 공개 업종을
                          더한 값보다 큽니다.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <EmptyChart />
                  )}
                </Section>
                <Section
                  icon="list"
                  title={`${selectedRegion} 업종별 요일 패턴`}
                  badge={hiddenWeekdayLabel ? <PrivacyBadge note={privacy?.note} k={privacyK} /> : null}
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
                          {categoryWeekdays.map((row) =>
                            // 문구는 위 상위 업종 표와 같은 것을 쓴다 — 같은 셀을 화면마다 달리 부르지 않는다
                            row.suppressed ? (
                              <tr key={row.category}>
                                <td className="font-medium">{row.category}</td>
                                <td
                                  colSpan={4}
                                  className="text-right text-admin-text-muted"
                                  title={privacy?.note ?? undefined}
                                >
                                  표본 보호로 비공개
                                </td>
                              </tr>
                            ) : (
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
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyChart />
                  )}
                  {hiddenWeekdayLabel ? (
                    <p className="u-note mt-3 border-t border-admin-border pt-2.5">
                      가맹점 {privacyK}곳 미만인 업종({hiddenWeekdayLabel})은 요일 축에서도 건수를
                      비공개 처리했습니다. 공개 업종 값은 차분으로 되살아나지 않도록{" "}
                      {privacy?.aggregate_rounding.unit ?? 100} 단위로 반올림해 발행합니다.
                    </p>
                  ) : null}
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
            </section>
          </>
        ) : (
          /* 지역 없이 이 URL로 바로 들어온 경우 — 빈 화면 대신 무엇을 고르면 무엇이 열리는지 말한다 */
          <div className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-4 py-10 text-center shadow-card">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-lavender-100 text-lavender-700">
              <Icon name="pin" size={20} />
            </span>
            <p className="mt-3 text-[15px] font-semibold text-admin-text">
              아직 선택한 지역이 없습니다
            </p>
            <p className="mx-auto mt-1.5 max-w-xl break-keep text-[13px] leading-6 text-admin-text-muted">
              위 필터에서 지역을 고르면 그 지역의 업종 구성·상위 업종·월별 추이·요일과 일별 패턴이
              열립니다. 어느 지역부터 볼지 모르겠다면{" "}
              <Link
                href="/dashboard"
                className="font-semibold text-admin-primary underline-offset-4 hover:underline"
              >
                전체 지역 현황
              </Link>
              에서 6개 지역을 나란히 비교해 보십시오. (예: 진단 1위 영월군)
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
