import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { GradeChip, PrivacyBadge, ProxyBadge } from "@/components/Badge";
import { EmptyChart, FailedChart } from "@/components/EmptyChart";
import { Icon } from "@/components/Icon";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import { RegionalMapSection } from "@/components/RegionalMap/RegionalMapSection";
import { buildRegionStatuses } from "@/components/RegionStatusCard";
import { MenuDemoGuide } from "@/components/MenuDemoGuide";
import { GroupHeading, Section } from "@/components/Section";
import { DashboardTabs, NextViewLink, resolveView } from "@/components/DashboardTabs";
import { BarRank } from "@/components/charts/BarRank";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { LineTrend } from "@/components/charts/LineTrend";
import { ScaleCompare } from "@/components/charts/ScaleCompare";
import { api } from "@/lib/api";
import { REGIONS, REGION_TOOLTIP, STABILITY_NOTE } from "@/lib/constants";
import { monthLabel, num, pctNum, pctUnit } from "@/lib/format";

export const metadata: Metadata = { title: "전체 지역 현황 · 상생 나침반" };

// mock/실 API 어느 쪽이든 매 요청 최신 상태를 읽는다 (승인 → KPI 반영이 데모 동선이라 캐시하지 않는다)
export const dynamic = "force-dynamic";

/**
 * ③ 집중도 대시보드 (docs/plan/08 F5 · 13 §3).
 *
 * 서버 컴포넌트다 — mock JSON은 서버에서만 읽히고 브라우저 번들에 실리지 않는다.
 * 차트만 `"use client"`(Recharts는 브라우저 전용)이며 이미 가공된 작은 배열만 props로 받는다.
 *
 * **페이지 하나 = 모집단 하나.** 이 화면의 모든 값은 6개 지역 전체 기준이고,
 * 지역 한 곳으로 좁힌 값(업종 구성·시간 패턴)은 전부 `/dashboard/region`에 있다.
 *
 * **뷰 하나 = 질문 하나.** 세 뷰를 한 스크롤에 쌓지 않고 `?view=`로 갈아 끼운다 —
 * 담당자의 질문 순서가 곧 탭 순서다:
 *   ① 현황(기본)   지금 어떤 상태인가 — KPI 4장 + 지역별 현재 상태(상세로 가는 진입점)
 *   ② 추이·분포    어떻게 변해왔나 — 월별 흐름·지역/업종 분포·스케일 비교
 *   ③ 제안 근거    그래서 어디에 처방하나 — 1·2단계 스코어 + 접힌 배경·주의
 * 뷰를 URL에 두는 이유와 `role="tab"`을 쓰지 않는 이유는 DashboardTabs 주석 참고.
 * 탭을 누르지 않는 사람도 순서를 따라갈 수 있도록 각 뷰 끝에 다음 뷰 링크를 둔다.
 *
 * 1·2단계 스코어가 이 화면에 남는 이유: 모집단이 6개 지역 전체(순위표·후보 풀)이고,
 * 진단에서 처방으로 이어지는 근거가 진단과 같은 화면에 있어야 감사 가능하다(절대 규칙 5).
 * 정책 운영 KPI(카드 상태값)는 추진 경과 리포트(/tracking#kpi)로, 데이터 출처·기준·비공개
 * 내역은 데이터 활용 정보(/data)로 옮겼다 — 후자는 탭 하나를 차지할 내용이 남지 않았고,
 * 기준월은 이미 이 화면 머리말에 있다. 소표본 보호 고지만 뷰와 무관하게 하단에 상시 노출한다.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const view = resolveView(sp.view);
  // 남은 데모 값은 `merchant` 하나다 — `report`는 운영 KPI와 함께 /tracking으로,
  // `data`는 데이터 활용 정보(/data)로 옮겨 갔다 (SideNav의 DASHBOARD_DEMO_ITEMS와 짝).
  const demo = sp.demo === "merchant" ? sp.demo : null;

  // 이 페이지의 존재 이유(핵심 데이터)는 진단 지표 하나(d = api.dashboard())뿐이다 — 실패하면
  // 에러 경계로 보내는 것이 정직하다. 나머지 셋은 보조 데이터라 각자 실패해도 화면의 본 뜻은
  // 성립한다 — 후보 목록(제안 근거 뷰) · 국세청 위험 신호(배경 참고) · 원장(소표본 고지).
  // null이 되면 아래에서 빈 배열(진짜 "데이터 없음")과 구분해 FailedChart로 표시한다 —
  // 0·빈 배열로 조용히 치환하지 않는다 (PR #44 견고성 원칙).
  const [d, cand, risk, usageLedger] = await Promise.all([
    api.dashboard(),
    api.candidates().catch(() => null),
    api.riskSignal().catch(() => null),
    api.usageMonthly().catch(() => null),
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
  const regionBars = REGIONS.map((r) => {
    const row = (d.region_share ?? []).find((x) => x.region === r);
    return {
      label: r,
      value: row?.count ?? 0,
      note: row ? `${Math.round(row.share * 100)}%` : "0%",
    };
  });
  const totalUses = (d.region_share ?? []).reduce((a, b) => a + b.count, 0);
  const eupRanking = cand?.eup_ranking ?? [];
  // candidates 호출 자체가 실패했는지 — ranking이 비어 있는 이유가 "없다"가 아니라
  // "못 불러왔다"일 때 빈 값을 사실처럼 그리지 않기 위한 플래그 (지도 카드·제안 근거 뷰 공용)
  const rankingUnavailable = cand === null;

  // 2단계 표 주석용 — 포화도 0.00이 빈 값이 아니라 "반경 내 기존 가맹점 0곳"의 계산 결과임을 명시한다
  const saturationAllZero =
    (cand?.candidates ?? []).length > 0 &&
    (cand?.candidates ?? []).every((c) => c.saturation === 0 && c.nearby_merchants === 0);
  // 배경 정보 요약용 — 편차 0.5%p 수준이라 막대로 차이를 그리지 않고 문장으로 말한다 (05 §6)
  // risk가 null(호출 실패)이면 빈 배열로 계산하되, 렌더에서 null을 따로 분기해
  // "0%"가 아니라 FailedChart로 표시한다.
  const riskPcts = (risk ?? []).map((r) => r.under2y_ratio * 100);
  const riskSpread = riskPcts.length ? Math.max(...riskPcts) - Math.min(...riskPcts) : 0;
  const riskAvg = riskPcts.length ? riskPcts.reduce((a, b) => a + b, 0) / riskPcts.length : 0;
  const stability = d.ranking_stability ?? d.ai_stability;

  // 소표본 보호 고지 — 원장 쪽 값이 정본이고, 구형 산출물에는 아예 없을 수 있어 둘 다 가드한다
  const privacy = usageLedger?.privacy_meta ?? d.privacy_meta ?? null;

  return (
    <AdminShell dashboard={d}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <PageHeader
          icon="chart"
          eyebrow="진단"
          title="전체 지역 현황"
          lede="석탄산업전환지역(구 폐광지역) 4개 시군(정선·태백·영월·삼척 도계읍)에서 하이원포인트(강원랜드 방문객이 적립해 지역 가맹점에서 쓰는 포인트) 소비가 어디에 얼마나 몰려 있는지 본다. 이 화면의 값은 모두 6개 지역 전체 기준이며, 지역 한 곳으로 좁혀 보려면 각 지역 카드의 상세 분석으로 들어간다. 이 화면의 값이 확충 제안의 정량 출발점이다."
        >
          <p className="u-note mt-2 flex flex-wrap items-center gap-x-2">
            <Icon name="database" size={13} />
            데이터 기준 {d.period_note} · 산출일 {d.updated_at}
          </p>
        </PageHeader>

        <DashboardTabs view={view} />

        {/* ══ 뷰 ① 현황 — 지역별 현재 상태(개별 지역) → 진단 지표(전체 합산) 순서.
            지역 여섯 곳을 먼저 훑고 그 값들이 합쳐진 지표를 보는 흐름이라, 지표 4장이
            "앞의 여섯 카드를 요약한 값"으로 읽힌다. 지표를 먼저 두면 그 숫자가 어느
            모집단에서 나왔는지 모른 채 읽게 된다 ══ */}
        {view === "overview" ? (
        <section aria-label="현황" className="flex flex-col gap-6">
          <GroupHeading note="원천 데이터에서 바로 계산한 값">현황</GroupHeading>

          {/* 지도가 첫 조망이자 탐색 진입점이다 — 지역을 고르면 상태 카드가 열리고,
              카드의 상세 링크로 지역 상세 분석 화면에 들어가는 것이 기본 동선이다.
              수치 계산은 여기(서버)서 끝내고 평면 배열만 내려보낸다 */}
          <Section
            icon="map"
            title="지역별 현재 상태"
            desc="실제 행정구역 경계 지도에서 지역을 고르면 누적 사용 건수·전체 비중·최근 월 흐름·1단계 진단 순위가 열린다. 지역 한 곳의 업종 구성·시간 패턴은 카드의 상세 분석에서 본다."
          >
            <RegionalMapSection
              statuses={buildRegionStatuses({
                shares: d.region_share ?? [],
                monthlyByRegion: d.monthly_by_region ?? [],
                ranking: eupRanking,
                selectedRegions: cand?.selected_eups ?? [],
                rankingUnavailable,
              })}
            />
          </Section>

          <GroupHeading note="위 6개 지역을 합산한 전체 기준 값">진단 지표</GroupHeading>
          {/* alignDivider: 증감 배지가 있는 카드(전환율·사용 건수)와 없는 카드(집중도·분산도)가
              한 행에 섞여 있어, 구분선을 하단 정렬로 통일한다 — 이 4장에만 적용 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              accent
              alignDivider
              icon="trend"
              label="지역 전환율"
              badge={d.conversion.is_proxy ? <ProxyBadge note={d.conversion.proxy_note} /> : null}
              value={pctNum(d.conversion.headline_rate)}
              unit={pctUnit(d.conversion.headline_rate)}
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

          <NextViewLink view={view} />
        </section>
        ) : null}

        {/* ══ 뷰 ② 추이 · 분포 — 시간·공간 축 ══ */}
        {view === "trends" ? (
        <section aria-label="추이와 분포" className="flex flex-col gap-6">
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section
              icon="pin"
              title="지역별 하이원포인트 사용 건수"
              desc="전 기간 누적. 괄호 안은 전체 대비 비중."
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

          {/* ── 문제 스케일 각인 — 성격이 추이·분포와 같아 이 존의 꼬리에 둔다 ── */}
          <Section
            icon="chart"
            title="리조트 체류 규모 vs 지역 전환 건수"
            desc="같은 축의 그룹 막대로 비교한다. 두 값은 단위가 다르므로 비율이 아니라 규모 차이를 읽는 용도다."
          >
            {scaleData.length ? <ScaleCompare data={scaleData} /> : <EmptyChart />}
          </Section>
          <NextViewLink view={view} />
        </section>
        ) : null}

        {/* ══ 뷰 ③ 제안의 정량 근거 — 관측값이 아니라 파생 스코어 층위 ══ */}
        {view === "evidence" ? (
        <section aria-label="제안의 정량 근거" className="flex flex-col gap-6">
          <GroupHeading note="AI 제안이 딛고 선 정량 값 — 순위는 화면에서 감추지 않는다">
            제안의 정량 근거
          </GroupHeading>
          <Section
            icon="compass"
            title="1단계 지역 진단 — 읍·시 스코어"
            desc="소비저조도·소비증감을 0~1로 정규화해 합산한 값이다. AI 제안 대상 지역 선정의 정량 근거이며, 순위는 화면에서 감추지 않는다."
          >
            {rankingUnavailable ? (
              <FailedChart />
            ) : eupRanking.length ? (
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
                      const selected = (cand?.selected_eups ?? []).includes(e.eup);
                      return (
                        <tr key={e.eup} data-highlight={selected ? "true" : undefined}>
                          <td className="tabular-nums text-admin-text-muted">{e.rank}</td>
                          <td>
                            <span className={selected ? "font-semibold text-admin-primary" : ""}>
                              {e.eup}
                            </span>
                            {selected ? (
                              <span className="ml-1.5 whitespace-nowrap rounded-full bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-primary">
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
            {demo === "merchant" && cand ? (
              <MenuDemoGuide
                icon="store"
                title="가맹점 후보 관리 데모"
                description={`현재 ${cand.candidates.length}개 후보를 점수 순으로 보여 줍니다. 아래 표는 데모 시드의 후보·업종·생활권 데이터를 그대로 사용합니다.`}
                steps={["종합 점수로 검토 순서를 잡습니다.", "업종공백도·동선근접도·기존가맹포화도를 비교합니다.", "후보를 선택해 확충 Action Card를 생성·결정합니다."]}
              />
            ) : null}
            {rankingUnavailable ? (
              <FailedChart />
            ) : (cand?.candidates ?? []).length ? (
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
                        {(cand?.candidates ?? []).map((c) => (
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

          {/* ── 배경·주의 정보 — 본문 스스로 "비교·순위 근거로 쓰지 않는다"고 말하는 참고 값이라
              본문 카드와 대등하게 두지 않고 접는다. 펼쳐야 보이는 것이 이 정보의 정직한 무게다 ── */}
          <details className="u-panel px-4 py-3.5 sm:px-5">
            <summary className="u-disclosure">
              배경·주의 정보 — 운영 2년 미만 사업자 비중 · 추천 순위 안정도 (순위·비교 근거로 쓰지 않는 참고 값)
            </summary>
            <div className={`mt-4 grid grid-cols-1 gap-4 ${stability !== null && stability !== undefined ? "lg:grid-cols-2" : ""}`}>
              {/* 05 §6·13 §9: 편차가 0.5%p뿐이라 지역 비교 근거가 못 된다 —
                  막대로 그리면 "차이가 있는 것처럼" 보이므로(설명 문구와 모순) 수치 나열 + 요약 문장만 쓴다 */}
              <div className="rounded-xl border border-admin-border p-4">
                <h3 className="u-h3">운영 2년 미만 사업자 비중</h3>
                <p className="u-note mt-1.5 break-keep">
                  국세청 사업자등록 데이터 기준 — 지역 상권의 배경 정보다. 4개 시군 편차가 0.5%p
                  수준이라 지역 간 비교나 순위 근거로는 쓰지 않는다.
                </p>
                {risk === null ? (
                  // 0%·"—"로 채우면 실제 값으로 오독된다 — 못 불러왔다고 밝힌다
                  <FailedChart />
                ) : risk.length ? (
                  <>
                    <p className="mt-3 break-keep text-[15px] leading-7 text-admin-text">
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
                  </>
                ) : (
                  <EmptyChart />
                )}
              </div>

              {/* ── AI 제안 안정도 (P8 민감도) ───────────────────────
                  해석 주의 문구는 lib/constants의 STABILITY_NOTE 하나로만 쓴다 — 이 숫자는 허브
                  미리보기·제안 요약(ProposalSummary)에도 같이 뜨는데, 문구가 화면마다 갈리면
                  어느 쪽이 정본인지 흐려진다.
                  `가정 기반 전망` 배지는 붙이지 않는다 — 안정도는 미래를 내다본 전망이 아니라
                  가중치를 흔들어 본 **민감도 실측값**이라 절대 규칙 3의 대상이 아니다.
                  전망 배지를 남발하면 정작 시뮬레이션 출력에 붙은 배지의 무게가 줄어든다 */}
              {stability !== null && stability !== undefined ? (
                <div className="rounded-xl border border-admin-border p-4">
                  <h3 className="u-h3">추천 순위 안정도 · 해석 주의</h3>
                  <p className="u-note mt-1.5 break-keep">{STABILITY_NOTE}</p>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    <span className="text-[32px] font-bold leading-none tabular-nums text-admin-text">
                      {stability}
                    </span>
                    <span className="text-[13px] font-medium text-admin-text-muted">%</span>
                  </div>
                </div>
              ) : null}
            </div>
          </details>
          <NextViewLink view={view} />
        </section>
        ) : null}

        {/* ══ 소표본 보호 고지 — 뷰와 무관하게 항상 보인다.
            탭 뒤로 숨기면 "감춘 사실을 감춘" 꼴이 되므로 뷰 전환에 걸지 않는다.
            출처·컬럼·체크섬·비공개 셀 목록 같은 상세는 /data가 정본이다 ══ */}
        {privacy ? (
          <p className="u-note flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-admin-border pt-4">
            <PrivacyBadge note={privacy.note} k={privacy.k} />
            이 화면 일부 값은 가맹점 {privacy.k}곳 미만 셀 {privacy.suppressed_cells.length}개가
            비공개 처리된 데이터로 그렸습니다.
            <Link
              href="/data#privacy"
              className="font-semibold text-admin-primary underline-offset-4 hover:underline"
            >
              비공개 내역 보기 →
            </Link>
          </p>
        ) : null}
      </div>
    </AdminShell>
  );
}
