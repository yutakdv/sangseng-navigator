import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";
import { AssumptionBadge, GradeChip, ProxyBadge } from "@/components/Badge";
import { KpiCard } from "@/components/KpiCard";
import { Section } from "@/components/Section";
import { BarRank } from "@/components/charts/BarRank";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { LineTrend } from "@/components/charts/LineTrend";
import { ScaleCompare } from "@/components/charts/ScaleCompare";
import { api } from "@/lib/api";
import { REGIONS, REGION_TOOLTIP } from "@/lib/constants";
import { dash, monthLabel, num, pct, ratioPct, signed } from "@/lib/format";

export const metadata: Metadata = { title: "지역 소비 분석 · 상생 나침반" };

// mock/실 API 어느 쪽이든 매 요청 최신 상태를 읽는다 (승인 → KPI 반영이 데모 동선이라 캐시하지 않는다)
export const dynamic = "force-dynamic";

/**
 * ③ 집중도 대시보드 (docs/plan/08 F5 · 13 §3).
 *
 * 서버 컴포넌트다 — mock JSON은 서버에서만 읽히고 브라우저 번들에 실리지 않는다.
 * 차트만 `"use client"`(Recharts는 브라우저 전용)이며 이미 가공된 작은 배열만 props로 받는다.
 */
export default async function DashboardPage() {
  const [d, kpi, cand, risk] = await Promise.all([
    api.dashboard(),
    api.kpi(),
    api.candidates(),
    api.riskSignal(),
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
  const eupRanking = cand.eup_ranking ?? [];

  return (
    <AdminShell dashboard={d}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-admin-text">지역 소비 분석</h2>
          <p className="mt-0.5 text-xs text-admin-text-muted">
            데이터 기준: {d.period_note} · 산출일 {d.updated_at}
          </p>
        </div>

        {/* ── 진단 지표 ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="지역 전환율"
            badge={d.conversion.is_proxy ? <ProxyBadge note={d.conversion.proxy_note} /> : null}
            value={pct(d.conversion.headline_rate)}
            delta={{ text: `전분기 대비 ${signed(d.growth?.qoq_pp)}`, raw: d.growth?.qoq_pp ?? null }}
            sub="지역 사용 건수 ÷ 입장 연인원(교대 합산) — 비율이 아니라 연인원 1인당 건수"
          />
          <KpiCard
            label="지역 소비 집중도"
            badge={<GradeChip grade={d.concentration.grade} />}
            value={num(d.concentration.index)}
            unit="/ 100"
            sub="값이 높을수록 특정 지역에 소비가 몰려 있음"
          />
          <KpiCard
            label="하이원포인트 지역 사용 건수"
            value={num(totalUses)}
            unit="건"
            delta={{ text: `전월 대비 ${signed(d.growth?.mom_pct, "%")}`, raw: d.growth?.mom_pct ?? null }}
            sub="전 기간 누적 · 6개 지역 합계"
          />
          <KpiCard
            label="업종별 소비 분산도"
            value={num(d.category_dispersion?.index)}
            unit="/ 100"
            sub="값이 높을수록 업종이 고르게 분산됨"
          />
        </div>

        {/* ── 운영 KPI (시스템 상태값) ──────────────────────────── */}
        <Section
          id="kpi"
          title="정책 운영 KPI"
          desc="Action Card 상태값으로 계산한 지표다. 승인·상태 변경이 일어나면 즉시 바뀐다."
        >
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard
              label="채택률"
              value={ratioPct(kpi.adoption_rate)}
              sub={`승인 ${kpi.counts.approved} / 전체 ${kpi.counts.total}장`}
            />
            <KpiCard
              label="실행 전환율"
              value={ratioPct(kpi.execution_rate)}
              sub="승인 카드 중 추진중·완료 비중"
            />
            <KpiCard
              label="평균 의사결정 소요"
              value={dash(kpi.avg_approval_hours)}
              unit="시간"
              sub="승인·반려·보류까지 걸린 시간의 평균"
            />
            <KpiCard
              label="지역 균형지수"
              value={dash(kpi.regional_balance_index)}
              unit={kpi.regional_balance_index === null ? undefined : "/ 100"}
              sub={`승인 카드가 여러 지역에 고루 쌓일수록 상승 (현재 승인 ${kpi.counts.approved}건)`}
            />
          </div>
        </Section>

        {/* ── 추이 ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
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
          <Section title="지역별 하이원포인트 사용 건수" desc="전 기간 누적. 괄호 안은 전체 대비 비중.">
            {regionBars.some((b) => b.value > 0) ? (
              <>
                <BarRank data={regionBars} unit="건" height={240} />
                <p className="mt-2 text-[11px] text-admin-text-muted">
                  {REGION_TOOLTIP.삼척시}
                </p>
              </>
            ) : (
              <EmptyChart />
            )}
          </Section>

          <Section title="업종별 사용 비중" desc="표시 6분류 기준. 범례에 비중을 함께 표기한다.">
            {(d.category_share ?? []).length ? (
              <CategoryDonut data={d.category_share} height={240} />
            ) : (
              <EmptyChart />
            )}
          </Section>
        </div>

        {/* ── 문제 스케일 각인 ─────────────────────────────────── */}
        <Section
          title="리조트 체류 규모 vs 지역 전환 건수"
          desc="같은 축의 그룹 막대로 비교한다. 두 값은 단위가 다르므로 비율이 아니라 규모 차이를 읽는 용도다."
        >
          {scaleData.length ? <ScaleCompare data={scaleData} /> : <EmptyChart />}
        </Section>

        {/* ── 1단계 진단 근거 ──────────────────────────────────── */}
        <Section
          title="1단계 지역 진단 — 읍·시 스코어"
          desc="소비저조도·소비증감을 0~1로 정규화해 합산한 값이다. AI 제안 대상 지역 선정의 정량 근거이며, 순위는 화면에서 감추지 않는다."
        >
          {eupRanking.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs text-admin-text-muted">
                    <th className="py-2 pr-3 font-medium">순위</th>
                    <th className="py-2 pr-3 font-medium">지역</th>
                    <th className="py-2 pr-3 text-right font-medium">종합 스코어</th>
                    <th className="py-2 pr-3 text-right font-medium">소비저조도</th>
                    <th className="py-2 text-right font-medium">소비증감</th>
                  </tr>
                </thead>
                <tbody>
                  {eupRanking.map((e) => {
                    const selected = (cand.selected_eups ?? []).includes(e.eup);
                    return (
                      <tr key={e.eup} className="border-b border-black/5 last:border-0">
                        <td className="py-2 pr-3 tabular-nums text-admin-text-muted">{e.rank}</td>
                        <td className="py-2 pr-3">
                          <span className={selected ? "font-semibold text-admin-primary" : ""}>
                            {e.eup}
                          </span>
                          {selected ? (
                            <span className="ml-1.5 rounded-full bg-admin-primary-soft px-1.5 py-0.5 text-[10px] text-admin-primary">
                              제안 대상
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">{e.score.toFixed(2)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-admin-text-muted">
                          {e.low_usage.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-admin-text-muted">
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

        {/* ── 2단계 후보 스코어 요인 + 배경 정보 ───────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title="2단계 후보 스코어 요인"
            desc="업종공백도·관광동선근접도·기존가맹포화도를 같은 가중치로 합산한 값이다. 세 요인은 후보 상가별로 산출된다."
          >
            {(cand.candidates ?? []).length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-sm">
                  <thead>
                    <tr className="border-b border-black/5 text-left text-xs text-admin-text-muted">
                      <th className="py-2 pr-3 font-medium">후보</th>
                      <th className="py-2 pr-3 text-right font-medium">종합</th>
                      <th className="py-2 pr-3 text-right font-medium">업종공백도</th>
                      <th className="py-2 pr-3 text-right font-medium">동선근접도</th>
                      <th className="py-2 text-right font-medium">기존가맹포화도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cand.candidates.map((c) => (
                      <tr key={c.id} className="border-b border-black/5 last:border-0">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{c.category}</div>
                          <div className="text-[11px] text-admin-text-muted">
                            {c.eup} · {c.name}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">
                          {c.score.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-admin-text-muted">
                          {c.gap.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-admin-text-muted">
                          {c.proximity.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-admin-text-muted">
                          {c.saturation.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
                  동선근접도는 거점에서의 직선거리 기반이라 산악 지형에서 실제 접근성과 역전될 수
                  있다. 도로 경로 소요시간은 후보별 상세 화면에서 직선거리와 함께 표기한다.
                </p>
              </div>
            ) : (
              <EmptyChart />
            )}
          </Section>

          {/* 05 §6·13 §9: 편차가 0.5%p뿐이라 지역 비교 근거가 못 된다 —
              '위험' 라벨·경고색·순위 정렬 없이 원본 순서 그대로 중립 표기만 한다 */}
          <Section
            title="운영 2년 미만 사업자 비중"
            desc="지역 상권의 배경 정보다. 4개 시군 편차가 0.5%p 수준이라 지역 간 비교나 순위 근거로는 쓰지 않는다."
          >
            {risk.length ? (
              <ul className="flex flex-col gap-2">
                {risk.map((r) => (
                  <li key={r.sigungu} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-admin-text">{r.sigungu}</span>
                    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full bg-slate-400"
                        style={{ width: `${Math.min(100, r.under2y_ratio * 100 * 4)}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right tabular-nums text-admin-text-muted">
                      {(r.under2y_ratio * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyChart />
            )}
          </Section>
        </div>

        {/* ── AI 제안 안정도 (P8 민감도) ───────────────────────── */}
        {d.ai_stability !== null && d.ai_stability !== undefined ? (
          <Section
            title="AI 제안 안정도"
            badge={<AssumptionBadge />}
            desc="가중치 조합 민감도 분석에서 상위 3개 후보가 유지된 비율이다. 가중치를 흔들어도 제안이 크게 바뀌지 않는지 보는 값이다."
          >
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-admin-text">{d.ai_stability}</span>
              <span className="text-sm text-admin-text-muted">%</span>
            </div>
          </Section>
        ) : null}
      </div>
    </AdminShell>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-lg bg-admin-bg text-xs text-admin-text-muted">
      표시할 데이터가 없습니다
    </div>
  );
}
