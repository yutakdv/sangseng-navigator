import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { GradeChip, ProxyBadge } from "@/components/Badge";
import { BriefingPanel } from "@/components/BriefingPanel";
import { CardItem } from "@/components/CardItem";
import { CardTypeTabs } from "@/components/CardTypeTabs";
import { DecisionActions } from "@/components/DecisionActions";
import { ExecutionStatus } from "@/components/ExecutionStatus";
import { GenerateCardButton } from "@/components/GenerateCardButton";
import { HeroProposal } from "@/components/HeroProposal";
import { Icon } from "@/components/Icon";
import { MetricTile } from "@/components/MetricTile";
import { ActHeading, Panel, PanelLink } from "@/components/Panel";
import { PolicyFlow } from "@/components/PolicyFlow";
import { RegionScoreTable } from "@/components/RegionScoreTable";
import { shareMap } from "@/components/RegionTileMap";
import { ScenarioLadder } from "@/components/ScenarioLadder";
import { CategoryShareBars } from "@/components/CategoryShareBars";
import { RegionTrend } from "@/components/charts/RegionTrend";
import { api } from "@/lib/api";
import { REGIONS } from "@/lib/constants";
import { regionCenters } from "@/lib/geo";
import { monthLabel, num, signed } from "@/lib/format";
import type { Card, CardType } from "@/types";

// 승인·생성이 곧바로 목록에 반영돼야 하는 화면이라 캐시하지 않는다 (데모 5단계·2-b 단계)
export const dynamic = "force-dynamic";

/**
 * ① Action Card 허브 — 첫 화면 (docs/plan/08 F3 · 13 §3).
 *
 * 서비스 정체성은 "시각화"가 아니라 "의사결정 지원"이라 `/`는 차트 모음이 아니라 **담당자의
 * 업무 순서를 그대로 옮긴 다섯 막**이다. 막마다 담당자가 실제로 던지는 질문 하나에 답한다:
 *
 *   ① 진단  지금 무슨 일이 일어나고 있는가   → 지표 타일 4장 + 12개월 스파크라인
 *   ② 제안  AI는 무엇을, 어디에 제안하는가   → 히어로(지역 개념도 포함) + AI 정책 브리핑
 *   ③ 근거  왜 그런 판단인가                 → 전환율 추이 · 업종 분포 · 1단계 진단 표
 *   ④ 전망  따르면 어떻게 되는가             → 페이백 3/5/7% 시나리오 비교
 *   ⑤ 결정  지금 무엇을 할 것인가            → 승인 대기 큐 + 실행 현황 + 정책 흐름
 *
 * 화면 폭을 1600px까지 연 이유: 히어로가 8/12 열을 쓰고 그 옆에 브리핑이 붙는 비대칭 구성이라
 * 1152px(다른 화면의 `max-w-6xl`)에서는 두 블록 다 접힌다. 다른 담당자 화면은 목록·표 중심이라
 * 기존 폭을 그대로 둔다.
 *
 * 서버 컴포넌트다 — `lib/api.ts`는 mock JSON을 정적 import 하므로 서버에서만 호출한다.
 * 상태를 바꾸는 버튼(승인·생성)과 카운트업만 클라이언트 컴포넌트다.
 */
type Search = { type?: string };

const isCardType = (v: string | undefined): v is CardType =>
  v === "EXPANSION" || v === "INCENTIVE";

/**
 * 승인 대기 정렬: **AI 조정 카드 먼저**, 그다음 생성 순서(오래된 것부터).
 * - 앞: 정량 순위를 바꾼 제안은 담당자가 원 순위와 함께 먼저 확인해야 하는 카드다 (절대 규칙 5)
 * - 뒤: 새로 생성한 카드가 목록 맨 위를 밀어내지 않아야 "카드 생성"을 눌러도 앞선 카드의 위치가
 *   그대로 남는다 (11 §1 — 2-b 단계에서 목록이 늘어나는 것만 보이고 3단계 클릭 대상은 고정)
 */
const byPendingOrder = (a: Card, b: Card): number =>
  Number(b.ai.adjusted) - Number(a.ai.adjusted) || a.created_at.localeCompare(b.created_at);

/** 최근 결정: 마지막에 처리한 카드가 위로 — "방금 뭘 했는지"를 잃지 않게 하는 순서 */
const byDecidedDesc = (a: Card, b: Card): number =>
  (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at);

/** KST ISO8601 문자열을 그대로 잘라 쓴다 — Date로 재파싱하면 브라우저 타임존이 끼어든다 (05 §8) */
const stamp = (iso: string | null): string =>
  iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : "—";

export default async function HubPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Next 15+ 에서 searchParams는 Promise다 — await 없이 접근하면 런타임 에러
  const sp = await searchParams;
  const type = isCardType(sp.type) ? sp.type : null; // 계약에 없는 값은 무시하고 전체로 본다

  const [d, { cards }, cand, kpi] = await Promise.all([
    api.dashboard(),
    api.cards(),
    api.candidates(),
    api.kpi(),
  ]);

  /* ── 카드 분류 ───────────────────────────────────────────────── */
  const pendingAll = cards.filter((c) => c.status === "pending");
  const pendingCounts = {
    all: pendingAll.length,
    EXPANSION: pendingAll.filter((c) => c.type === "EXPANSION").length,
    INCENTIVE: pendingAll.filter((c) => c.type === "INCENTIVE").length,
  };

  const visible = type ? cards.filter((c) => c.type === type) : cards;
  const pending = visible.filter((c) => c.status === "pending").sort(byPendingOrder);
  // 결정된 카드도 남긴다 — 승인 직후 카드가 사라지면 담당자가 방금 한 일을 잃는다
  const decided = visible.filter((c) => c.status !== "pending").sort(byDecidedDesc);
  const approved = cards.filter((c) => c.status === "approved");

  // 13 §3: pending 1순위를 히어로로 승격하고, 목록에서는 빼서 같은 카드가 두 번 나오지 않게 한다
  const [hero, ...rest] = pending;
  const generateType: CardType = type ?? "EXPANSION";

  // ④ 전망 막의 원천 — 시나리오를 들고 있는 인센티브 카드. 승인 대기 건을 우선한다
  const incentive =
    visible.find((c) => c.type === "INCENTIVE" && c.status === "pending" && c.scenarios?.length) ??
    visible.find((c) => c.type === "INCENTIVE" && c.scenarios?.length) ??
    null;

  /* ── 지표 파생 (전부 계약 필드에서 계산 — 지어낸 값 없음) ────── */
  const totalUses = (d.region_share ?? []).reduce((a, b) => a + b.count, 0);
  const conversionSeries = (d.conversion.monthly ?? []).map((m) => m.rate);
  const concentrationSeries = (d.concentration.monthly ?? []).map((m) => m.index);
  const usesSeries = (d.monthly_by_region ?? []).map((row) =>
    REGIONS.reduce((a, r) => a + Number(row[r] ?? 0), 0),
  );

  /**
   * 스파크라인은 관측 구간에 세로를 맞춰 그린다(관례). 집중도처럼 41~43으로 사실상 평평한 지수는
   * 그 자동 확대 때문에 급등락처럼 읽히므로, 타일 각주에 **관측 범위를 숫자로** 함께 적는다.
   */
  const band = (xs: number[], fmt: (v: number) => string): string =>
    xs.length ? `${fmt(Math.min(...xs))}~${fmt(Math.max(...xs))}` : "";

  /* ── ③ 근거: "왜 하필 이 지역/업종인가"에 답하는 값들 ────────────
     전체 합계 추이 한 줄은 제안 대상이 선 안에 녹아 없어져 근거가 되지 못한다.
     지역 6종 × 12개월(`monthly_by_region`)을 그대로 펴서 대상 지역의 위치를 드러낸다. */
  const heroRegion = hero?.target?.eup ?? null;
  const monthlyRows = d.monthly_by_region ?? [];
  const regionTrend = monthlyRows.map((row) => ({
    label: monthLabel(String(row.month)),
    ...Object.fromEntries(REGIONS.map((r) => [r, Number(row[r] ?? 0)])),
  }));
  const lastRow = monthlyRows[monthlyRows.length - 1];
  const latestMonth = lastRow ? monthLabel(String(lastRow.month)) : "";
  const latestByRegion = lastRow
    ? REGIONS.map((r) => ({ region: r, value: Number(lastRow[r] ?? 0) })).sort(
        (a, b) => b.value - a.value,
      )
    : [];

  // 판독 문장은 화면에 이미 실린 값만으로 만든다 (지어낸 수치·해석 금지)
  const heroLatest = latestByRegion.find((r) => r.region === heroRegion);
  const topLatest = latestByRegion[0];
  const regionTrendInsight =
    heroLatest && topLatest && heroLatest.value > 0
      ? `${latestMonth} 기준 ${heroLatest.region}은 ${num(heroLatest.value)}건으로 6개 지역 중 ${
          latestByRegion.findIndex((r) => r.region === heroRegion) + 1
        }위이며, 1위 ${topLatest.region}(${num(topLatest.value)}건)의 약 ${Math.round(topLatest.value / heroLatest.value)}분의 1 수준입니다.`
      : latestByRegion.length
        ? `${latestMonth} 기준 1위 ${topLatest.region} ${num(topLatest.value)}건, 최하위 ${latestByRegion[latestByRegion.length - 1].region} ${num(latestByRegion[latestByRegion.length - 1].value)}건으로 6개 지역의 사용 규모 차이가 큽니다.`
        : undefined;

  const categories = [...(d.category_share ?? [])].sort((a, b) => b.share - a.share);
  const heroCategory = hero?.target?.category ?? null;
  const heroCatRow = categories.find((c) => c.category === heroCategory);
  const heroCatRank = heroCatRow ? categories.indexOf(heroCatRow) + 1 : 0;
  const categoryInsight = heroCatRow
    ? // 꼬리 문장은 순위에 따라 달라진다 — 6위 업종에 "가장 큰 업종"이라고 붙으면 사실과 어긋난다
      `제안 업종인 ${heroCatRow.category}은 전체 사용의 ${Math.round(heroCatRow.share * 100)}%로 6개 분류 중 ${heroCatRank}위입니다${
        heroCatRank === 1
          ? " — 가장 큰 업종의 공백을 메우는 제안입니다."
          : heroCatRank <= 3
            ? " — 상위 업종의 공백을 메우는 제안입니다."
            : "."
      }`
    : categories.length >= 2
      ? `${categories[0].category} ${Math.round(categories[0].share * 100)}% · ${categories[1].category} ${Math.round(categories[1].share * 100)}%로 두 업종이 전체의 ${Math.round((categories[0].share + categories[1].share) * 100)}%를 차지합니다.`
      : undefined;

  const shares = shareMap(d.region_share ?? []);
  const counts = Object.fromEntries((d.region_share ?? []).map((r) => [r.region, r.count]));
  const ranking = cand.eup_ranking ?? [];
  // 가맹점 1,678건은 서버에만 두고, 지도에 필요한 6개 좌표로 줄여서 넘긴다 (lib/geo.ts)
  const centers = regionCenters(cand.merchants ?? []);
  const topRegion = ranking.find((r) => r.rank === 1);
  const lowestShare = (d.region_share ?? []).reduce(
    (a, b) => (b.share < a.share ? b : a),
    (d.region_share ?? [])[0],
  );

  return (
    <AdminShell dashboard={d}>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 2xl:gap-7">
        {/* ── 인사말 · 전역 필터 ──────────────────────────────────── */}
        <header className="animate-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-5 pt-1">
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="u-display">
              안녕하세요, 지역상생 담당자님{" "}
              <span aria-hidden className="inline-block">
                👋
              </span>
            </h1>
            <p className="u-copy mt-2 max-w-[74ch]">
              AI가 공공데이터를 분석해 이번 분기 가장 효과적인 정책을{" "}
              <b className="font-semibold text-admin-text">제안</b>합니다. 확정은 담당자 승인으로만
              이뤄지며, AI가 순위를 조정한 카드에는 원래 정량 Score 순위를 항상 함께 표기합니다.
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-surface px-2.5 py-1 text-xs font-medium text-admin-text-muted shadow-card ring-1 ring-inset ring-admin-border">
                <Icon name="calendar" size={13} />
                데이터 기준 {d.period_note}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-surface px-2.5 py-1 text-xs font-medium text-admin-text-muted shadow-card ring-1 ring-inset ring-admin-border">
                <Icon name="user" size={13} />
                지역상생팀 김담당 · 가상 페르소나
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <CardTypeTabs active={type} pendingCounts={pendingCounts} />
            <GenerateCardButton
              type={generateType}
              label={
                generateType === "INCENTIVE" ? "이번 분기 인센티브 카드 생성" : "이번 분기 카드 생성"
              }
            />
          </div>
        </header>

        {/* ── ① 진단 ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            accent
            delay={0}
            icon="trend"
            label="지역 전환율"
            sparkId="conversion"
            badge={
              d.conversion.is_proxy ? <ProxyBadge note={d.conversion.proxy_note} /> : null
            }
            value={d.conversion.headline_rate}
            digits={1}
            suffix="%"
            delta={{
              text: signed(d.growth?.qoq_pp),
              raw: d.growth?.qoq_pp ?? null,
              note: "전분기 대비",
            }}
            trend={conversionSeries}
            trendNote={`최근 12개월 ${band(conversionSeries, (v) => v.toFixed(1))}%`}
            note="지역 사용 건수 ÷ 입장 연인원(교대 합산) — 비율이 아니라 연인원 1인당 건수"
          />
          <MetricTile
            delay={60}
            icon="target"
            label="지역 소비 집중도"
            sparkId="concentration"
            badge={<GradeChip grade={d.concentration.grade} />}
            value={d.concentration.index}
            unit="/ 100"
            trend={concentrationSeries}
            trendNote={`최근 12개월 ${band(concentrationSeries, (v) => String(v))} / 100`}
            note="값이 높을수록 특정 지역에 소비가 몰려 있음"
          />
          <MetricTile
            delay={120}
            icon="receipt"
            label="하이원포인트 지역 사용 건수"
            sparkId="uses"
            value={totalUses}
            unit="건"
            delta={{
              text: signed(d.growth?.mom_pct, "%"),
              raw: d.growth?.mom_pct ?? null,
              note: "전월 대비",
            }}
            trend={usesSeries}
            trendNote={`월별 합계 ${band(usesSeries, (v) => v.toLocaleString("ko-KR"))}건`}
            note="전 기간 누적 · 전월 대비 일평균 사용 건수"
          />
          <MetricTile
            delay={180}
            icon="shield"
            label="AI 제안 안정도"
            sparkId="stability"
            value={d.ai_stability}
            unit={d.ai_stability === null ? undefined : "%"}
            // P8 민감도가 미산출이면 값이 null이다 — 게이지도 함께 감춘다 (13 §2-3)
            meter={d.ai_stability ?? undefined}
            trendNote="가중치 조합 민감도 · 상위 3개 유지 비율"
            note="후보 요인이 동률이면 이 값만으로 선발 근거의 강건성을 뜻하지 않음"
          />
        </div>

        {/* ── ② 제안 ─────────────────────────────────────────────── */}
        {hero ? (
          <>
            <ActHeading
              step="②"
              question="AI는 무엇을 제안하는가"
              title="이번 분기 핵심 제안"
              action={<PanelLink href={`/cards/${hero.id}`}>제안 상세와 지도 보기</PanelLink>}
            />
            <div id="proposal" className="grid scroll-mt-24 grid-cols-1 gap-4 lg:grid-cols-12 2xl:gap-5">
              <HeroProposal
                card={hero}
                proxyNote={d.conversion.is_proxy ? d.conversion.proxy_note : undefined}
                ranking={ranking}
                selectedEups={cand.selected_eups ?? []}
                shares={shares}
                centers={centers}
              />
              <BriefingPanel card={hero} className="lg:col-span-4" />
            </div>
          </>
        ) : (
          <EmptyHero pending={pendingCounts.all} />
        )}

        {/* ── ③ 근거 ─────────────────────────────────────────────── */}
        <ActHeading
          step="③"
          question="왜 그런 판단인가"
          title="제안이 딛고 선 정량 근거"
          action={<PanelLink href="/dashboard">지역 소비 분석 전체 보기</PanelLink>}
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 2xl:gap-5">
          <Panel
            className="lg:col-span-7"
            icon="trend"
            title="지역별 월 사용 건수 추이"
            desc={
              heroRegion
                ? `6개 지역의 하이원포인트 사용 건수를 12개월로 편 것입니다. ${heroRegion}만 인디고로 강조했습니다.`
                : "6개 지역의 하이원포인트 사용 건수를 12개월로 편 것입니다."
            }
            action={<PanelLink href="/dashboard">지역 전환율 추이 보기</PanelLink>}
            insight={regionTrendInsight}
          >
            {regionTrend.length ? (
              <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <RegionTrend data={regionTrend} regions={REGIONS} targetRegion={heroRegion} />
                </div>
                {/* 계열이 6개라 선만으로는 구분이 안 된다 — 최신 월 값과 함께 직접 라벨링한다 */}
                <ul className="flex shrink-0 flex-col gap-1.5 lg:w-[168px]">
                  {latestByRegion.map((r) => (
                    <li
                      key={r.region}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] ${
                        r.region === heroRegion
                          ? "bg-admin-primary-soft ring-1 ring-inset ring-admin-primary-line"
                          : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-0.5 w-3 shrink-0 rounded-full ${
                          r.region === heroRegion ? "bg-admin-primary" : "bg-[#c3cad9]"
                        }`}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          r.region === heroRegion
                            ? "font-bold text-admin-primary"
                            : "text-admin-text-soft"
                        }`}
                      >
                        {r.region}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-admin-text">
                        {num(r.value)}
                      </span>
                    </li>
                  ))}
                  <li className="mt-1 border-t border-admin-border pt-1.5 text-[11px] text-admin-text-muted">
                    최신 월({latestMonth}) 사용 건수
                  </li>
                </ul>
              </div>
            ) : (
              <EmptyChart />
            )}
          </Panel>

          <Panel
            className="lg:col-span-5"
            icon="scatter"
            title="업종별 사용 비중"
            desc="표시 6분류 기준. 이번 제안이 겨눈 업종이 전체에서 어느 정도 크기인지 봅니다."
            insight={categoryInsight}
          >
            {(d.category_share ?? []).length ? (
              <CategoryShareBars
                data={d.category_share}
                targetCategory={hero?.target?.category ?? null}
              />
            ) : (
              <EmptyChart />
            )}
          </Panel>
        </div>

        <Panel
          icon="compass"
          title="1단계 지역 진단 — 읍·시 스코어"
          desc="소비저조도·소비증감을 0~1로 정규화해 합산한 값입니다. AI 제안 대상 지역 선정의 정량 근거이며, 순위는 화면에서 감추지 않습니다."
          action={<PanelLink href="/dashboard">2단계 후보 스코어 보기</PanelLink>}
          insight={
            topRegion && lowestShare
              ? `${topRegion.eup}이 종합 ${topRegion.score.toFixed(2)}로 1순위이며, 하이원포인트 사용 비중도 ${Math.round(lowestShare.share * 100)}%(${lowestShare.region})로 6개 지역 중 가장 낮습니다.`
              : undefined
          }
        >
          {ranking.length ? (
            <RegionScoreTable
              ranking={ranking}
              shares={shares}
              counts={counts}
              selectedEups={cand.selected_eups ?? []}
              targetEup={hero?.target?.eup ?? null}
            />
          ) : (
            <EmptyChart />
          )}
        </Panel>

        {/* ── ④ 전망 ─────────────────────────────────────────────── */}
        {incentive ? (
          <>
            <ActHeading
              step="④"
              question="따르면 어떻게 되는가"
              title="페이백 시나리오 비교"
              action={<PanelLink href="/incentive">인센티브 정책 화면으로</PanelLink>}
            />
            <Panel
              id="pending"
              icon="layers"
              title="지역 결제 페이백 3 · 5 · 7% 비교"
              badge={d.conversion.is_proxy ? <ProxyBadge note={d.conversion.proxy_note} /> : null}
              desc="이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만 리워드가 붙는 사용 단계 설계입니다. 콤프 발행액 증액은 수반하지 않으며, 특정 지역 한정이 아니라 6개 지역 공통으로 적용합니다."
              insight={insightForScenarios(incentive)}
            >
              <ScenarioLadder card={incentive} headlineRate={d.conversion.headline_rate} />
            </Panel>
          </>
        ) : null}

        {/* ── ⑤ 결정 ─────────────────────────────────────────────── */}
        <ActHeading
          step="⑤"
          question="지금 무엇을 할 것인가"
          title="승인 대기와 실행 현황"
          action={<PanelLink href="/tracking">정책 카드 관리로</PanelLink>}
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 2xl:gap-5">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-8 2xl:gap-5">
            <Panel
              icon="cards"
              title={hero ? `승인 대기 나머지 ${rest.length}건` : `승인 대기 ${pending.length}건`}
              desc={
                hero
                  ? `승인 대기 ${pending.length}건 중 1순위는 위 핵심 제안에 있습니다. 카드를 열지 않고 여기서 바로 승인·반려·보류할 수 있고, 승인한 카드만 실행 상태 트래킹으로 넘어갑니다.`
                  : "카드를 열지 않고 여기서 바로 승인·반려·보류할 수 있습니다. 승인한 카드만 실행 상태 트래킹으로 넘어갑니다."
              }
            >
              {pending.length === 0 ? (
                <EmptyPending />
              ) : rest.length === 0 ? (
                <p className="rounded-2xl bg-admin-surface-sunken px-4 py-6 text-center text-sm text-admin-text-muted">
                  승인 대기 카드는 위 핵심 제안 1건이 전부입니다.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {rest.map((c) => (
                    <li key={c.id}>
                      {/* 감사 가능성 (절대 규칙 5) — 조정 카드에는 원 순위 전체를 목록에서도 병기한다 */}
                      {c.ai.adjusted && c.ai.original_ranking?.length ? (
                        <div className="mb-1.5 rounded-2xl bg-admin-primary-soft px-3.5 py-2.5 ring-1 ring-inset ring-admin-primary-line">
                          {/* 데모 2단계 해설이 붙는 문장이라 빔프로젝터(1920×1080)에서도 읽히게
                              각주 크기가 아닌 본문 보조 크기(13px)로 둔다 (08 F9 발표 폴리시) */}
                          <p className="flex items-center gap-1.5 break-keep text-[13px] font-semibold leading-5 text-admin-primary">
                            <Icon name="sparkle" size={13} strokeWidth={2} />
                            AI가 정량 순위를 조정한 제안입니다 — 원래 Score 순위를 함께 표기합니다.
                          </p>
                          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 break-keep text-xs leading-5 text-admin-text-muted">
                            <span className="font-semibold">원래 Score 순위</span>
                            {c.ai.original_ranking.map((r) => (
                              <span
                                key={r.rank}
                                className={`whitespace-nowrap tabular-nums ${
                                  r.rank === c.score_rank ? "font-semibold text-admin-text" : ""
                                }`}
                              >
                                {r.rank}. {r.candidate} {r.score.toFixed(2)}
                                {/* 색·굵기만으로 구분하지 않는다 (13 §4) — 조정 대상은 문자로도 적는다 */}
                                {r.rank === c.score_rank ? ` ← AI 제안 ${c.ai_rank}위` : ""}
                              </span>
                            ))}
                          </p>
                        </div>
                      ) : null}
                      <CardItem card={c}>
                        <div className="flex flex-col items-start gap-1.5">
                          {/* INCENTIVE 승인은 페이백률 선택이 필수라 허브에서 바로 승인할 수 없다 (05 §2) */}
                          {c.type === "INCENTIVE" ? (
                            <Link
                              href="/incentive"
                              className="text-[13px] font-semibold text-admin-primary underline-offset-4 hover:underline"
                            >
                              페이백률 고르고 승인하기 →
                            </Link>
                          ) : null}
                          <DecisionActions cardId={c.id} requireRate={c.type === "INCENTIVE"} />
                        </div>
                      </CardItem>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {decided.length ? (
              <Panel
                icon="check"
                title={`최근 결정 ${decided.length}건`}
                desc="이미 결정한 카드입니다. 결정 버튼 대신 상태 칩만 표시되며, 추진 상태 변경은 트래킹 화면에서 합니다."
                action={<PanelLink href="/tracking">실행 상태 트래킹</PanelLink>}
              >
                <ul className="flex flex-col gap-3">
                  {decided.map((c) => (
                    <li key={c.id}>
                      <CardItem card={c}>
                        <span className="whitespace-nowrap text-xs tabular-nums text-admin-text-muted">
                          결정 {stamp(c.decided_at)}
                        </span>
                      </CardItem>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>

          {/*
           * 오른쪽 열은 왼쪽(승인 대기 + 최근 결정)보다 훨씬 짧다. 기본 stretch면 카드 한 장이
           * 빈 채로 600px 늘어나므로 내용 높이만 차지하게 두고, 대신 **스티키**로 붙여
           * 큐를 훑는 동안 "지금 몇 건이 어느 단계인지"가 계속 보이게 한다.
           */}
          <ExecutionStatus
            approved={approved}
            kpi={kpi}
            className="lg:col-span-4 lg:sticky lg:top-[104px] lg:self-start"
          />
        </div>

        <Panel
          icon="workflow"
          title="정책 실행 흐름"
          desc="진단부터 방문객 반영까지 여섯 단계입니다. 각 단계의 숫자는 지금 그 단계에 걸려 있는 카드 수이며, 누르면 해당 화면으로 이동합니다."
        >
          <PolicyFlow
            counts={{
              cards: kpi.counts.total,
              pending: kpi.counts.pending,
              approved: kpi.counts.approved,
              inProgress: approved.filter((c) => c.progress === "추진중").length,
              done: kpi.counts.done,
            }}
          />
        </Panel>
      </div>
    </AdminShell>
  );
}

/** 시나리오 판독 — 배열이 들고 있는 값만으로 문장을 만든다 (지어낸 수치·권장 표시 없음) */
function insightForScenarios(card: Card): string | undefined {
  const s = card.scenarios ?? [];
  if (s.length < 2) return undefined;
  const lo = s[0];
  const hi = s[s.length - 1];
  const fmt = (v: number[]) => `+${v[0].toFixed(1)}~${v[v.length - 1].toFixed(1)}%p`;
  return `페이백률이 ${lo.rate}%에서 ${hi.rate}%로 오르면 개선폭 전망은 ${fmt(lo.delta_pp)}에서 ${fmt(hi.delta_pp)}로 커지고, 재원 부담도 ${lo.budget_note.replace("재원 부담 ", "")}에서 ${hi.budget_note.replace("재원 부담 ", "")}으로 함께 커집니다.`;
}

function EmptyChart() {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-2xl border border-dashed border-admin-border bg-admin-surface-sunken text-[13px] text-admin-text-muted">
      표시할 데이터가 없습니다
    </div>
  );
}

/** 승인 대기가 0건이라 히어로를 세울 수 없는 상태 — 화면이 비지 않게 다음 행동을 안내한다 */
function EmptyHero({ pending }: { pending: number }) {
  return (
    <section className="animate-rise rounded-hero bg-gradient-to-br from-admin-primary-soft via-admin-surface to-admin-surface px-6 py-12 text-center shadow-float ring-1 ring-inset ring-admin-primary-line sm:px-8">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-admin-surface text-admin-primary shadow-card">
        <Icon name="cards" size={24} />
      </span>
      <h2 className="u-section-title mt-4">이번 분기 승인 대기 카드가 없습니다</h2>
      <p className="mx-auto mt-2.5 max-w-xl break-keep text-[15px] leading-7 text-admin-text-soft">
        위의 <b className="font-semibold text-admin-text">카드 생성</b> 버튼을 누르면 AI가 후보를
        비교해 새 제안을 만듭니다. 후보가 전부 추진중·완료 상태라면 새 제안 대신 안내 문구가
        표시됩니다.
        {pending > 0 ? ` 다른 종류에는 승인 대기 ${pending}건이 있습니다.` : ""}
      </p>
    </section>
  );
}

function EmptyPending() {
  return (
    <div className="rounded-2xl border border-dashed border-admin-border bg-admin-surface-sunken px-4 py-10 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-admin-surface text-admin-text-muted shadow-card">
        <Icon name="cards" size={20} />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-admin-text">
        이번 분기 승인 대기 카드가 없습니다
      </p>
      <p className="mx-auto mt-1.5 max-w-md break-keep text-[13px] leading-6 text-admin-text-muted">
        상단의 <b className="font-semibold text-admin-text">카드 생성</b> 버튼을 누르면 AI가 후보를
        비교해 새 제안을 만듭니다.
      </p>
    </div>
  );
}
