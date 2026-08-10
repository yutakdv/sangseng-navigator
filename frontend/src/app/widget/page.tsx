import type { Metadata } from "next";
import Link from "next/link";
import { NewBadge, PaybackBadge } from "@/components/Badge";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Icon } from "@/components/Icon";
import { KakaoMapView } from "@/components/KakaoMapView";
import { TodayPick } from "@/components/TodayPick";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { WidgetLiveRefresh } from "@/components/WidgetLiveRefresh";
import { api } from "@/lib/api";
import { CATEGORIES, REGIONS, REGION_TOOLTIP, VISITOR_SOURCE_NOTE } from "@/lib/constants";
import { kstWeekdayIndex, todayPickCopy, weekdayFact } from "@/lib/todayPick";
import { fetchNowcast } from "@/lib/weather";
import type { Card, DisplayCategory, Recommendation, Region } from "@/types";

export const metadata: Metadata = { title: "가맹점 찾기 · 상생 나침반" };

// 카드가 `완료`로 바뀌면 추천 목록이 즉시 달라져야 한다 (데모 마지막 동선) — 캐시하지 않는다
export const dynamic = "force-dynamic";

/**
 * ⑤ 방문객 위젯 (docs/plan/08 F7 · 13 §1 image-2).
 *
 * 로그인 없음. 지역·업종 선택은 쿼리스트링으로 하고 서버에서 필터링한다.
 * 담당자 화면(인디고)과 구분되는 그린 브랜딩 + 390px 모바일 프레임 (13 §4·F7).
 *
 * 실제로 휴대폰에서 손가락으로 누르는 화면이라, 담당자 화면보다 **탭 영역**이 중요하다.
 * 필터 칩을 11~12px에서 13px·최소 높이 36px로 올리고 카드 정보를 이름 → 업종 → 설명 →
 * 주소 → 혜택 순으로 벌려 뒀다.
 */
type Search = { region?: string; category?: string; limit?: string; live?: string };
const DEFAULT_LIST_LIMIT = 12;
const MAX_LIST_LIMIT = 120;

const href = (next: Search, current: Search): string => {
  const merged = { ...current, ...next };
  const params = new URLSearchParams();
  if (merged.region) params.set("region", merged.region);
  if (merged.category) params.set("category", merged.category);
  if (merged.limit) params.set("limit", merged.limit);
  // 라이브 미리보기(데모)는 필터를 눌러도 꺼지지 않아야 한다
  if (merged.live) params.set("live", merged.live);
  const q = params.toString();
  return q ? `/widget?${q}` : "/widget";
};

export default async function WidgetPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Next 15+ 에서 params·searchParams 는 Promise 다 — await 없이 접근하면 런타임 에러
  const sp = await searchParams;
  // 계약에 없는 값이 쿼리로 들어오면 무시한다 (필터는 6지역·표시 6분류로 고정)
  const region = REGIONS.includes(sp.region as never) ? sp.region : undefined;
  const category = CATEGORIES.includes(sp.category as never) ? sp.category : undefined;
  const requestedLimit = Number(sp.limit);
  const listLimit = Number.isFinite(requestedLimit)
    ? Math.max(DEFAULT_LIST_LIMIT, Math.min(MAX_LIST_LIMIT, Math.floor(requestedLimit)))
    : DEFAULT_LIST_LIMIT;
  const live = sp.live === "1" ? "1" : undefined;
  const current: Search = { region, category, limit: sp.limit ? String(listLimit) : undefined, live };
  const filters: Search = { region, category, live };

  const [{ recommendations, policy_note, total }, dashboard, cand, incentiveRes, usageDaily, weather] =
    await Promise.all([
      api.widget(region, category, listLimit),
      // 푸터 "데이터 기준" 한 줄 전용 — 이 엔드포인트만 죽어도 방문객 위젯 전체가 에러 화면이
      // 되면 안 된다 (아래 candidates와 같은 방어 관용구).
      api.dashboard().catch(() => null),
      // 필터 칩의 가맹점 수 표기용 — merchants는 candidates 응답에 함께 실려 온다 (05 §1).
      // 칩 숫자는 장식이라, 이 엔드포인트가 503이어도 방문객 위젯 자체는 떠야 한다.
      api.candidates().catch(() => null),
      // 페이백 배너용 — 필터로 추천이 0건이어도 시행 중인 정책은 알려야 하므로 카드에서 직접 읽는다
      api.cards({ type: "INCENTIVE" }).catch(() => ({ cards: [] as Card[] })),
      // 오늘의 추천 근거 — BE 엔드포인트가 없는 파이프라인 정적 산출물이다 (05 §6)
      api.usageDaily(),
      // 기상청 실황은 있으면 좋은 곁들임이다 — 실패해도 요일 문구는 그대로 나와야 한다.
      // fetchNowcast는 던지지 않도록 구현했지만 위 candidates와 같은 방어 관용구를 맞춘다.
      fetchNowcast(region as Region | undefined).catch(() => null),
    ]);

  // 칩의 숫자는 "그 칩을 눌렀을 때 볼 목록"의 크기 — 반대편 활성 필터를 반영해야 한다.
  // 1,679개 배열을 칩(14개)마다 재스캔하지 않도록 한 번 훑어 (지역|업종) 조합 카운트를 만든다.
  const merchants = cand?.merchants ?? [];
  const pairCount = new Map<string, number>();
  for (const m of merchants) {
    for (const key of ["|", `${m.eup}|`, `|${m.category}`, `${m.eup}|${m.category}`]) {
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    }
  }
  const countMerchants = (r?: string, c?: string): number =>
    pairCount.get(`${r ?? ""}|${c ?? ""}`) ?? 0;
  // candidates를 못 받았으면 countOf를 아예 내리지 않는다 — 칩이 전부 0으로 보이는 오표기 방지
  const countOfRegion = merchants.length ? (v?: string) => countMerchants(v, category) : undefined;
  const countOfCategory = merchants.length ? (v?: string) => countMerchants(region, v) : undefined;

  /**
   * 페이백 배너 — 우선 추천 항목이 실어 온 값을 쓰고(서버 라벨이 정본), 필터 결과가 0건이라
   * 추천이 비었을 때는 카드 상태에서 같은 조건(완료된 INCENTIVE + selected_rate,
   * store.payback()·backend widget.py와 동일)으로 복원한다. 페이백은 전 지역 공통이라
   * 어떤 필터에서도 시행 사실 자체는 보여야 한다.
   */
  const donePayback = incentiveRes.cards
    .filter((c) => c.progress === "완료" && c.selected_rate)
    .sort((a, b) => (b.decided_at ?? "").localeCompare(a.decided_at ?? ""))[0];
  const payback =
    recommendations.find((r) => r.payback)?.payback ??
    (donePayback?.selected_rate
      ? { rate: donePayback.selected_rate, label: `지금 여기서 쓰면 ${donePayback.selected_rate}% 페이백` }
      : null);
  /**
   * 오늘의 추천 — 요일 실측이 주근거, 날씨는 상황 설명이다(추천 업종을 바꾸지 않는다).
   * 지역이 없으면 "전체" 축으로 말하고 날씨는 거점 격자를 쓴다.
   * 48~49행의 `region`/`category`는 `CATEGORIES.includes(...)` 가드를 거쳐도 타입이
   * `string | undefined`다(includes가 타입 서술어가 아님) — 그래서 캐스팅한다.
   */
  const fact = weekdayFact(usageDaily, (region as Region) ?? "전체", kstWeekdayIndex(), {
    // 방문객이 업종을 이미 골랐으면 그 업종 사실만 말한다 — 다른 업종을 들이밀지 않는다
    only: category as DisplayCategory | undefined,
    // 지름길 칩이 빈 목록으로 이어지지 않게. candidates를 못 받았으면(merchants 0) 거르지 않는다
    isAvailable: merchants.length ? (c) => countMerchants(region, c) > 0 : undefined,
  });
  const todayCopy = fact ? todayPickCopy(fact, region ?? null, weather) : null;
  // 업종이 이미 선택돼 있으면 칩이 현재 필터와 같아진다 — 그때는 칩을 내리지 않는다
  const todayHref = fact && !category ? href({ category: fact.category }, filters) : null;

  const fresh = recommendations.filter((r) => r.badge);
  const others = recommendations.filter((r) => !r.badge);

  return (
    <div className="min-h-screen bg-slate-100 py-0 sm:py-8">
      {/* 모바일에서는 한 열, 넓은 화면에서는 레퍼런스(image-2)처럼 필터와 지도를 나란히 둔다. */}
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden bg-visitor-bg shadow-card-hover sm:rounded-[28px] sm:ring-1 sm:ring-black/5">
        <header className="relative overflow-hidden bg-gradient-to-br from-visitor-accent to-[#0e4a25] px-5 py-6 text-white sm:rounded-t-[28px]">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/90">
              강원랜드 지역상생
            </p>
            <span className="flex items-center gap-2">
              {live ? <WidgetLiveRefresh /> : null}
              {/* 두 얼굴(담당자↔방문객) 연결 고리가 최하단에만 있으면 모바일 심사에서 폐루프
                  서사를 놓친다 (검토 §3-2) — 하단 줄은 유지하고 헤더에도 짧게 건다 */}
              <Link href="/" className="text-[11px] font-semibold text-white/85 underline underline-offset-2">
                담당자 화면 →
              </Link>
            </span>
          </div>
          <h1 className="relative mt-1.5 break-keep text-[22px] font-bold leading-8">
            지역별 하이원포인트 가맹점
          </h1>
          <p className="relative mt-2 break-keep text-[13px] leading-6 text-white">
            관심 지역과 업종을 고르면 하이원포인트를 쓸 수 있는 곳을 알려드려요. 로그인은 필요 없어요.
          </p>
        </header>

        {/* 시행 중인 페이백은 전 항목 공통 — 목록을 스크롤하기 전에 상단에서 먼저 알린다 (카드 배지는 유지) */}
        {payback ? (
          <div
            data-tour="widget-payback"
            className={`mx-5 mt-5 flex items-start gap-3 rounded-2xl bg-visitor-primary-soft px-4 py-3.5 ring-1 ring-inset ring-visitor-primary/20 sm:mx-8 ${live ? "motion-safe:animate-pop" : ""}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-visitor-primary text-white">
              <Icon name="gift" size={17} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="break-keep text-[15px] font-bold leading-6 text-visitor-primary">
                {payback.label}
              </p>
              <p className="mt-0.5 break-keep text-xs leading-5 text-admin-text-muted">
                담당자가 승인·적용한 지역 결제 리워드예요. 이미 적립된 포인트로 아래 가맹점에서
                결제할 때 붙는 혜택이에요.
              </p>
            </div>
          </div>
        ) : null}

        {/* 오늘의 추천 — 필터로 내려가기 전에 "오늘 기준"을 한 줄로 준다. 요일 사실을 못 만들면 통째로 숨긴다 */}
        {todayCopy ? <TodayPick copy={todayCopy} chipHref={todayHref} /> : null}

        <div className="grid gap-6 px-5 py-5 sm:px-8 sm:py-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <p className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-emerald-950 sm:text-[34px]">
              포인트, 지역에서<br />
              가치로 이어지다
            </p>
            <p className="mt-3 max-w-md break-keep text-[14px] leading-7 text-slate-600">
              관심 지역과 업종을 선택하면 하이원리조트 거점에서 이동을 시작하기 좋은 순서로
              하이원포인트 가맹점을 보여드려요.
            </p>
            <Filter
              label="관심 지역"
              options={REGIONS}
              selected={region}
              makeHref={(v) => href({ region: v }, filters)}
              titleOf={(v) => REGION_TOOLTIP[v as keyof typeof REGION_TOOLTIP]}
              countOf={countOfRegion}
              className="mt-6"
            />
            <Filter
              label="업종"
              options={CATEGORIES}
              selected={category}
              makeHref={(v) => href({ category: v }, filters)}
              countOf={countOfCategory}
              className="mt-4"
            />
          </div>

          <KakaoMapView recommendations={recommendations} region={region} />
        </div>

        <div className="px-5 pb-5 sm:px-8 sm:pb-8">
          {/* 투어 6단계 대체 앵커 — 페이백 배너(widget-payback)가 없는 데모 상태에서도 이 제목 줄은
              추천 0건일 때조차 항상 렌더된다 (tourSteps.ts fallbackAnchor). 앵커를 목록 전체가 아니라
              이 작은 제목 줄에만 붙이는 이유: TourOverlay가 앵커를 `scrollIntoView({block:"center"})`로
              화면 가운데 오게 스크롤하는데, 앵커가 가맹점 카드 그리드 전체처럼 뷰포트보다 훨씬 크면
              "중앙 정렬"의 결과로 앵커 상단이 뷰포트 한참 위로 올라가 안내 카드까지 화면 밖으로
              밀려난다(실측: 데스크톱 -570px, 모바일 -1321px). 제목 줄은 항상 작아 이 문제가 없다. */}
          <div data-tour="widget-recommendations" className="flex items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-bold text-admin-text">추천 가맹점</h2>
            <span className="rounded-full bg-visitor-primary-soft px-2 py-0.5 text-xs font-semibold text-visitor-primary">
              {recommendations.length} / {total}곳
            </span>
          </div>
          {/* 추천 순서는 거점 직선거리 오름차순이지만 "가까운 순"으로 라벨링하지 않는다 —
              직선거리가 산악 지형에서 실제 접근성과 역전되기 때문 (05 §1·§4). policy_note만 그대로 노출한다 */}
          <p className="mt-1.5 break-keep text-xs leading-5 text-admin-text-muted">{policy_note}</p>

          {recommendations.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-9 text-center">
              <p className="text-[15px] font-semibold text-admin-text">
                해당 조건의 가맹점이 아직 없어요
              </p>
              <p className="mt-1.5 text-[13px] text-admin-text-muted">
                다른 지역·업종을 선택해 보세요
              </p>
              <Link
                href={href({ region: undefined, category: undefined }, filters)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-visitor-primary px-4 py-2 text-[13px] font-semibold text-white"
              >
                조건 초기화
              </Link>
            </div>
          ) : (
            <>
              {/* 확충 완료 매칭 항목은 이미 정렬 최상단이다 — 섹션으로 갈라 "무엇이 새로 생겼는지"가 먼저 읽히게 한다 */}
              {fresh.length ? (
                <section aria-label="이번 분기 새로 확충된 업종" className="mt-4">
                  <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-state-good">
                    <Icon name="sparkle" size={15} strokeWidth={2} />
                    이번 분기 새로 확충된 업종
                  </h3>
                  <p className="mt-0.5 text-xs leading-5 text-admin-text-muted">
                    지역상생팀이 이번 분기에 확충을 완료한 업종과 연결된 가맹점이에요.
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {fresh.map((r) => (
                      <MerchantCard key={`${r.name}-${r.address}`} r={r} pop={Boolean(live)} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {others.length ? (
                <ul className={`grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 ${fresh.length ? "mt-5 border-t border-slate-200 pt-5" : "mt-4"}`}>
                  {others.map((r) => (
                    <MerchantCard key={`${r.name}-${r.address}`} r={r} pop={Boolean(live)} />
                  ))}
                </ul>
              ) : null}
            </>
          )}

          {total > recommendations.length ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
              <p className="text-xs leading-5 text-admin-text-muted">
                현재 조건의 가맹점 {total}곳 중 {recommendations.length}곳을 보고 있어요.
              </p>
              <Link
                href={href({ limit: String(Math.min(MAX_LIST_LIMIT, listLimit + DEFAULT_LIST_LIMIT)) }, current)}
                className="inline-flex min-h-10 items-center rounded-xl bg-visitor-primary px-3.5 text-[13px] font-bold text-white shadow-[0_6px_16px_-8px_rgb(22_101_52_/_0.75)]"
              >
                가맹점 더 보기
              </Link>
            </div>
          ) : recommendations.length > DEFAULT_LIST_LIMIT ? (
            <Link
              href={href({}, filters)}
              className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-slate-100 px-3.5 text-[13px] font-bold text-admin-text-muted ring-1 ring-inset ring-slate-200"
            >
              목록 접기
            </Link>
          ) : null}

          <section className="mt-7 rounded-2xl bg-visitor-primary-soft px-4 py-4 sm:px-5 sm:py-5">
            <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-visitor-primary">
              <Icon name="info" size={16} strokeWidth={2} />이 서비스는요
            </h3>
            <ul className="mt-2.5 flex list-disc flex-col gap-2 break-keep pl-4 text-[13px] leading-6 text-admin-text">
              <li>
                하이원포인트로 결제할 수 있는 <b>지역 가맹점</b>을 지역·업종으로 찾아볼 수 있어요.
              </li>
              <li>
                위치 권한을 사용하지 않으며, 추천 순서는 <b>하이원리조트 거점 직선거리</b>를 기준으로
                합니다. 산악 지형에서는 실제 이동시간과 다를 수 있어요.
              </li>
              <li>
                <b>이번 분기 확충 업종</b> 배지는 지역상생팀이 확충을 완료한 업종과 연결된 가맹점이에요.
              </li>
              <li>
                페이백 배지는 담당자가 승인·적용한 <b>지역 결제 리워드</b>가 있을 때만 보여요. 이미
                적립된 포인트를 지역에서 쓸 때 붙는 혜택이라, 포인트가 더 적립되는 건 아니에요.
              </li>
            </ul>
          </section>

          <p className="mt-4 break-keep text-xs leading-5 text-admin-text-muted">
            영업시간·영업 상태 정보는 제공하지 않아요. 방문 전 가맹점에 확인해 주세요.
          </p>
          <footer className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-5 text-admin-text-muted">
            <p>{VISITOR_SOURCE_NOTE}</p>
            {dashboard ? <p>데이터 기준: {dashboard.period_note}</p> : null}
          </footer>
        </div>
      </div>

      {/* 위젯에는 담당자 사이드바가 없다(13 §3) — 그래서 돌아갈 길이 이 줄뿐이다.
          모바일에서 숨기면 심사위원이 휴대폰으로 위젯에 들어온 순간 막다른 길이 되고,
          데모 7→8단계(위젯 → 인센티브)도 한 번에 못 넘어간다 (11 §1) */}
      <p className="mx-auto mt-5 flex max-w-[390px] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 text-center text-xs leading-6 text-slate-600">
        방문객이 보는 화면입니다 · 담당자 화면
        <Link href="/" className="font-semibold text-slate-700 underline underline-offset-4">
          Action Card 허브
        </Link>
        ·
        <Link href="/incentive" className="font-semibold text-slate-700 underline underline-offset-4">
          인센티브 정책
        </Link>
      </p>
      {/* /widget은 AdminShell을 쓰지 않으므로(방문객 화면) 여기서 직접 마운트한다 */}
      <TourOverlay />
    </div>
  );
}

function Filter({
  label,
  options,
  selected,
  makeHref,
  titleOf,
  countOf,
  className = "",
}: {
  label: string;
  options: readonly string[];
  selected?: string;
  makeHref: (value?: string) => string;
  titleOf?: (value: string) => string | undefined;
  /** 칩을 눌렀을 때 보게 될 가맹점 수 — 반대편 활성 필터가 반영된 값이어야 한다 */
  countOf?: (value?: string) => number;
  className?: string;
}) {
  const chip = (active: boolean) =>
    `inline-flex min-h-[36px] items-center gap-1 rounded-full px-3.5 text-[13px] transition-colors ${
      active
        ? "bg-visitor-primary font-semibold text-white shadow-[0_4px_12px_-4px_rgb(22_101_52_/_0.7)]"
        : "bg-slate-100 font-medium text-admin-text hover:bg-slate-200"
    }`;
  const count = (active: boolean, value?: string) =>
    countOf ? (
      <span className={`text-[11px] font-semibold tabular-nums ${active ? "text-white/80" : "text-admin-text-muted"}`}>
        {countOf(value)}
      </span>
    ) : null;

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-semibold text-admin-text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <Link href={makeHref(undefined)} className={chip(!selected)}>
          전체{count(!selected)}
        </Link>
        {options.map((o) => (
          <Link key={o} href={makeHref(o)} title={titleOf?.(o)} className={chip(selected === o)}>
            {o}
            {count(selected === o, o)}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** 추천 가맹점 카드 한 장 — 확충 섹션과 전체 목록이 같은 마크업을 쓴다. pop은 라이브 미리보기 전용 */
function MerchantCard({ r, pop = false }: { r: Recommendation; pop?: boolean }) {
  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-card">
      <div className="flex gap-3">
        <CategoryIcon category={r.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-[15px] font-bold text-admin-text">
              {r.name}
            </span>
            {r.badge ? <NewBadge label={r.badge} pop={pop} /> : null}
          </div>
          <p className="mt-0.5 text-xs font-medium text-admin-text-muted">
            {r.category}
          </p>
          <p className="mt-1.5 break-keep text-[13px] leading-6 text-admin-text">
            {r.blurb}
          </p>
          <p className="mt-1.5 flex items-start gap-1.5 break-keep text-xs leading-5 text-admin-text-muted">
            <Icon name="pin" size={13} className="mt-0.5" />
            {r.address}
          </p>
          <a
            href={r.directions_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-bold text-visitor-primary underline underline-offset-4"
          >
            카카오맵에서 길찾기
          </a>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-visitor-primary-soft px-2 py-0.5 text-xs font-semibold text-visitor-primary ring-1 ring-inset ring-visitor-primary/20">
              <Icon name="check" size={12} strokeWidth={2} />
              하이원포인트 사용 가능
            </span>
            {r.payback ? <PaybackBadge label={r.payback.label} pop={pop} /> : null}
          </div>
        </div>
      </div>
    </li>
  );
}
