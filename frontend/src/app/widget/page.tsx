import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PaybackBadge } from "@/components/Badge";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Icon } from "@/components/Icon";
import { KakaoMapView } from "@/components/KakaoMapView";
import { TodayPick } from "@/components/TodayPick";
import { TourOverlay } from "@/components/tour/TourOverlay";
import {
  WidgetFilterSummary,
  WidgetSearch,
  WidgetSelect,
  WidgetSort,
} from "@/components/WidgetControls";
import { WidgetLiveRefresh } from "@/components/WidgetLiveRefresh";
import { api } from "@/lib/api";
import { CATEGORIES, REGIONS, REGION_TOOLTIP, VISITOR_SOURCE_NOTE } from "@/lib/constants";
import { kstWeekdayIndex, todayPickCopy, weekdayFact } from "@/lib/todayPick";
import { fetchNowcast } from "@/lib/weather";
import {
  DEFAULT_SORT,
  filterByName,
  listNote,
  normalizeQuery,
  particle,
  sortKeyOf,
  sortRecommendations,
  type SortKey,
} from "@/lib/widgetList";
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
 * 컨트롤은 최소 높이 52px, 목록 항목은 46px, 카드 정보는 이름 → 업종 → 설명 → 주소 → 혜택
 * 순으로 벌려 뒀다.
 *
 * 탐색은 위에서부터 검색 → 지역·업종 선택 → 정렬 순이다. 칩 14개를 두 줄로 늘어놓던 필터는
 * 눌러서 목록이 열리는 선택 필드로 바꿨다(`WidgetControls`) — 390px에서 칩이 네 줄까지 접혀
 * 첫 화면이 필터로 가득 찼기 때문이다. 검색·정렬은 BE 계약에 파라미터가 없어 URL 쿼리로 받아
 * 서버에서 처리한다 (`lib/widgetList.ts`).
 */
type Search = {
  region?: string;
  category?: string;
  limit?: string;
  live?: string;
  /** 가맹점 이름 검색어 */
  q?: string;
  /** 목록 정렬 (widgetList.SortKey) */
  sort?: string;
  /** "off"면 오늘의 추천 카드를 접어 둔다 (사용자가 닫은 상태) */
  today?: string;
};
const DEFAULT_LIST_LIMIT = 12;
const MAX_LIST_LIMIT = 120;

const href = (next: Search, current: Search): string => {
  const merged = { ...current, ...next };
  const params = new URLSearchParams();
  if (merged.region) params.set("region", merged.region);
  if (merged.category) params.set("category", merged.category);
  if (merged.limit) params.set("limit", merged.limit);
  if (merged.q) params.set("q", merged.q);
  // 기본 정렬은 URL에 남기지 않는다 — 공유된 주소가 짧고, 기본값이 바뀌어도 링크가 따라온다
  if (merged.sort && merged.sort !== DEFAULT_SORT) params.set("sort", merged.sort);
  // 닫아 둔 상태는 필터를 눌러도 유지된다 — 눌러서 없앤 카드가 다시 튀어나오면 안 된다
  if (merged.today === "off") params.set("today", "off");
  // 라이브 미리보기(데모)는 필터를 눌러도 꺼지지 않아야 한다
  if (merged.live) params.set("live", merged.live);
  const qs = params.toString();
  return qs ? `/widget?${qs}` : "/widget";
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
  const query = normalizeQuery(sp.q);
  const sort = sortKeyOf(sp.sort);
  const todayClosed = sp.today === "off";
  const current: Search = {
    region,
    category,
    limit: sp.limit ? String(listLimit) : undefined,
    live,
    q: query,
    sort,
    today: todayClosed ? "off" : undefined,
  };
  const filters: Search = {
    region,
    category,
    live,
    q: query,
    sort,
    today: todayClosed ? "off" : undefined,
  };
  /**
   * 목록은 항상 상한까지 받아 온다.
   *
   * 05 §1에 검색·정렬 파라미터가 없어 둘 다 FE에서 처리하는데, 12곳만 받아 놓고 이름으로
   * 걸러 내면 "87곳 중에 없다"가 아니라 "앞 12곳 안에 없다"를 보여 주게 되고, 이름·업종
   * 정렬도 앞 12곳 안에서만 도는 반쪽 정렬이 된다. 서버가 담아 주는 순서(거점 직선거리)가
   * **무엇을 담을지**를 정하고, 담긴 것을 어떤 순서로 볼지는 여기서 정한다.
   */
  const fetchLimit = MAX_LIST_LIMIT;

  const [{ recommendations, total }, dashboard, cand, incentiveRes, usageDaily, weather] =
    await Promise.all([
      api.widget(region, category, fetchLimit),
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

  /**
   * 화면에 실제로 뿌릴 목록 — 이름 검색 → 정렬 → 표시 개수만큼 자르기.
   *
   * `total`은 서버가 센 "조건에 맞는 전체 가맹점 수"다. 검색 중에는 그 숫자가 아니라 이름이
   * 맞는 수를 세는 게 맞다(받아 온 fetchLimit 범위 안에서 센다 — 그 밖은 애초에 없다).
   */
  const matched = query ? filterByName(recommendations, query) : recommendations;
  const sorted = sortRecommendations(matched, sort);
  /**
   * 자르기 **전에** 확충 섹션을 먼저 갈라 낸다 — 이름·업종 정렬을 목록 전체에 적용하면 확충
   * 가맹점이 표시 개수 밖으로 밀려 "이번 분기에 무엇이 새로 생겼는지"가 첫 화면에서 사라진다.
   * 서버가 확충 업종을 우선해 담아 주는 뜻(05 §1 policy_note)을 화면에서도 지키고, 정렬은
   * 각 묶음 안에서만 돌게 한다.
   */
  const fresh = sorted.filter((r) => r.badge).slice(0, listLimit);
  const others = sorted.filter((r) => !r.badge).slice(0, Math.max(0, listLimit - fresh.length));
  const shown = [...fresh, ...others];
  const shownTotal = query ? matched.length : total;

  /** 필터 요약 칩 — 누르면 그 조건만 빠진다 */
  const summaryChips = [
    region ? { label: region, removeHref: href({ region: undefined }, filters) } : null,
    category ? { label: category, removeHref: href({ category: undefined }, filters) } : null,
  ].filter((c): c is { label: string; removeHref: string } => c !== null);

  return (
    <div className="min-h-screen bg-slate-100 py-0 sm:py-8">
      {/* 모바일에서는 한 열, 넓은 화면에서는 레퍼런스(image-2)처럼 필터와 지도를 나란히 둔다. */}
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden bg-visitor-bg shadow-card-hover sm:rounded-[28px] sm:ring-1 sm:ring-black/5">
        {/**
         * 헤더는 로고 한 줄이다. 안내 문구는 히어로 아래 한 문단으로 합쳤다 — 짙은 그린 밴드에
         * 같은 말을 얹으면 화면 첫 인상이 무거워지고 문장도 두 군데로 갈라진다.
         *
         * 로고는 방문객 화면 전용 자산(`-green`)을 쓴다. 원본 락업의 포인트 색이 인디고라
         * 그린 테마 위에서 혼자 다른 계열로 튄다 — 심볼과 "나" 자만 visitor-primary로 옮기고
         * 검정 워드마크는 그대로 둔 파일이다. 담당자 화면은 원본을 계속 쓴다.
         */}
        <header className="flex items-center justify-between gap-3 bg-visitor-primary-soft-deep px-5 py-3.5 sm:rounded-t-[28px] sm:px-8">
          <Image
            src="/brand/sangseng-navigator-lockup-green.png"
            alt="상생 나침반"
            width={144}
            height={28}
            priority
            className="h-[22px] w-auto"
          />
          <span className="flex items-center gap-2">
            {live ? <WidgetLiveRefresh /> : null}
            {/* 두 얼굴(담당자↔방문객) 연결 고리가 최하단에만 있으면 모바일 심사에서 폐루프
                서사를 놓친다 (검토 §3-2) — 하단 줄은 유지하고 헤더에도 짧게 건다 */}
            <Link
              href="/"
              className="text-[11px] font-semibold text-visitor-primary underline underline-offset-2"
            >
              담당자 화면 →
            </Link>
          </span>
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

        {/* 오늘의 추천 — 필터로 내려가기 전에 "오늘 기준"을 한 줄로 준다. 요일 사실을 못 만들면
            통째로 숨기고, 사용자가 닫았으면(today=off) 접어 둔다 */}
        {todayCopy && !todayClosed ? (
          <TodayPick
            copy={todayCopy}
            chipHref={todayHref}
            closeHref={href({ today: "off" }, filters)}
          />
        ) : null}

        <div className="grid gap-6 px-5 py-5 sm:px-8 sm:py-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            {/* 헤더에서 제목을 뺐으므로 이 히어로가 화면의 h1이다 (문서에 h1은 하나여야 한다) */}
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-emerald-950 sm:text-[34px]">
              포인트, 지역에서<br />
              가치로 이어지다
            </h1>
            {/* 헤더 밴드에 있던 안내를 여기로 합쳤다 — 무엇인가 → 어떻게 쓰는가가 한 문단에서
                이어지고, 화면 맨 위는 브랜드만 남는다 */}
            <p className="mt-3 max-w-md break-keep text-[14px] leading-7 text-slate-600">
              로그인 없이 하이원포인트 사용처를 간편하게 찾아보세요. 하이원리조트 주변의 다양한
              맛집과 즐길거리에서 여행의 특별함을 더해보세요!
            </p>
            {/* 검색은 필터보다 위에 온다 — 갈 곳을 이미 아는 사람은 지역·업종을 거치지 않는다.
                limit은 넘기지 않는다: 새 검색은 첫 페이지부터 보는 게 맞다 */}
            <div className="mt-6">
              <WidgetSearch
                q={query}
                hidden={{
                  region,
                  category,
                  live,
                  sort: sort === DEFAULT_SORT ? undefined : sort,
                  today: todayClosed ? "off" : undefined,
                }}
                clearHref={href({ q: undefined }, filters)}
              />
            </div>

            {/* 칩 14개를 늘어놓지 않고 눌러서 목록이 열리는 선택 필드로 준다 (WidgetControls 주석) */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <WidgetSelect
                label="관심 지역"
                options={REGIONS}
                selected={region}
                makeHref={(v) => href({ region: v }, filters)}
                titleOf={(v) => REGION_TOOLTIP[v as keyof typeof REGION_TOOLTIP]}
                countOf={countOfRegion}
              />
              <WidgetSelect
                label="업종"
                options={CATEGORIES}
                selected={category}
                makeHref={(v) => href({ category: v }, filters)}
                countOf={countOfCategory}
              />
            </div>
            <WidgetFilterSummary
              chips={summaryChips}
              resetHref={href({ region: undefined, category: undefined }, filters)}
            />
          </div>

          <KakaoMapView recommendations={shown} region={region} />
        </div>

        <div className="px-5 pb-5 sm:px-8 sm:pb-8">
          {/* 투어 6단계 대체 앵커 — 페이백 배너(widget-payback)가 없는 데모 상태에서도 이 제목 줄은
              추천 0건일 때조차 항상 렌더된다 (tourSteps.ts fallbackAnchor). 앵커를 목록 전체가 아니라
              이 작은 제목 줄에만 붙이는 이유: TourOverlay가 앵커를 `scrollIntoView({block:"center"})`로
              화면 가운데 오게 스크롤하는데, 앵커가 가맹점 카드 그리드 전체처럼 뷰포트보다 훨씬 크면
              "중앙 정렬"의 결과로 앵커 상단이 뷰포트 한참 위로 올라가 안내 카드까지 화면 밖으로
              밀려난다(실측: 데스크톱 -570px, 모바일 -1321px). 제목 줄은 항상 작아 이 문제가 없다. */}
          <div data-tour="widget-recommendations" className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="text-[17px] font-bold text-admin-text">추천 가맹점</h2>
              <span className="rounded-full bg-visitor-primary-soft px-2 py-0.5 text-xs font-semibold text-visitor-primary">
                {shown.length} / {shownTotal}곳
              </span>
            </div>
            <WidgetSort selected={sort} makeHref={(key: SortKey) => href({ sort: key }, current)} />
          </div>
          {/* 나열 순서는 사용자가 고른 정렬이 정본이라 그것만 말한다. 서버의 policy_note는
              "무엇을 담았는지"에 대한 설명이라 여기 붙이면 순서와 어긋난다 — 선정 기준은
              아래 "이 서비스는요" 블록에서 밝힌다 (거리를 "가까운 순"이라 단정하지 않는 것도
              그 자리에서 지킨다 · 05 §1·§4). */}
          {/* 카드마다 붙던 "하이원포인트 사용 가능" 칩을 여기로 올렸다 — 목록 전체에 해당하는
              사실이라 한 번만 말하면 되고, 카드는 그만큼 조용해진다 */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-keep text-xs leading-5 text-admin-text-muted">
            <span className="inline-flex items-center gap-1 font-semibold text-visitor-primary">
              <Icon name="check" size={13} strokeWidth={2} />
              모두 하이원포인트 사용 가능
            </span>
            <span aria-hidden className="text-slate-300">
              ·
            </span>
            {listNote(sort, fresh.length > 0)}
          </p>

          {shown.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-9 text-center">
              {/* 검색으로 0건이 된 것과 필터로 0건이 된 것은 빠져나오는 길이 다르다 */}
              <p className="break-keep text-[15px] font-semibold text-admin-text">
                {query
                  ? `‘${query}’${particle(query, "과", "와")} 이름이 맞는 가맹점이 없어요`
                  : "해당 조건의 가맹점이 아직 없어요"}
              </p>
              <p className="mt-1.5 break-keep text-[13px] text-admin-text-muted">
                {query ? "가게 이름의 일부만 넣어 보세요" : "다른 지역·업종을 선택해 보세요"}
              </p>
              <Link
                href={
                  query
                    ? href({ q: undefined }, filters)
                    : href({ region: undefined, category: undefined }, filters)
                }
                className="mt-4 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-visitor-primary px-4 text-[13px] font-semibold text-white"
              >
                {query ? "검색어 지우기" : "조건 초기화"}
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

          {shownTotal > shown.length ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
              <p className="text-xs leading-5 text-admin-text-muted">
                {query ? "이름이 맞는" : "현재 조건의"} 가맹점 {shownTotal}곳 중 {shown.length}곳을
                보고 있어요.
              </p>
              <Link
                href={href({ limit: String(Math.min(MAX_LIST_LIMIT, listLimit + DEFAULT_LIST_LIMIT)) }, current)}
                className="inline-flex min-h-10 items-center rounded-xl bg-visitor-primary px-3.5 text-[13px] font-bold text-white shadow-[0_6px_16px_-8px_rgb(22_101_52_/_0.75)]"
              >
                가맹점 더 보기
              </Link>
            </div>
          ) : shown.length > DEFAULT_LIST_LIMIT ? (
            <Link
              href={href({}, filters)}
              className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-slate-100 px-3.5 text-[13px] font-bold text-admin-text-muted"
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
                위치 권한을 사용하지 않아요. 목록에 담는 가맹점은 <b>하이원리조트 거점 직선거리</b>를
                기준으로 골라요 — 산악 지형에서는 실제 이동시간과 다를 수 있어서, 화면에 나열하는
                순서는 이름·업종 중에서 직접 고르시게 했어요.
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

/**
 * 추천 가맹점 카드 한 장 — 확충 섹션과 전체 목록이 같은 마크업을 쓴다. pop은 라이브 미리보기 전용.
 *
 * 구조는 위에서 아래로 **누구인가(아이콘·이름·업종) → 무엇인가(한 줄 설명·주소) → 무엇을 할 수
 * 있나(배지·길찾기)** 세 켜다. 정보를 한 덩어리로 쌓아 두면 열두 장이 같은 회색 블록으로 보인다.
 *
 * - 흰 패널 위 흰 카드에 테두리를 두르는 대신 `visitor-surface-sunken`으로 가라앉힌다
 *   (13 §6-1 규칙 2 — 면이 같으면 선이 아니라 면을 옮긴다). 호버는 흰색으로 띄우지 않고 한 단
 *   더 가라앉힌다 — 흰 패널 위에서 흰 카드는 경계가 사라져 오히려 반응이 없는 것처럼 보인다.
 * - "하이원포인트 사용 가능" 칩은 뺐다. 모든 카드에 100% 붙는 문구라 카드마다 되풀이하면 정보가
 *   아니라 무늬가 된다 — 목록 머리에서 한 번만 말한다.
 * - 확충 가맹점은 아이콘 타일에 반짝임 표식을 단다. 지도 핀의 구분(점 ↔ 반짝임)과 같은 규칙이라
 *   목록과 지도가 같은 말을 하게 된다.
 */
function MerchantCard({ r, pop = false }: { r: Recommendation; pop?: boolean }) {
  return (
    <li className="flex h-full flex-col rounded-2xl bg-visitor-surface-sunken p-4 transition-colors hover:bg-visitor-surface-hover">
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <CategoryIcon category={r.category} />
          {r.badge ? (
            <span
              aria-hidden
              className={`absolute -right-1 -top-1 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-state-good text-white ${pop ? "motion-safe:animate-pop" : ""}`}
            >
              <Icon name="sparkle" size={11} strokeWidth={2.4} />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-5 tracking-[-0.01em] text-admin-text">
            {r.name}
          </span>
          <span className="mt-1 block text-[11px] font-medium text-admin-text-muted">
            {r.category}
          </span>
        </span>
      </div>

      <p className="mt-3 break-keep text-[13px] leading-6 text-admin-text-soft">{r.blurb}</p>
      <p className="mb-3.5 mt-1.5 flex items-start gap-1.5 break-keep text-[11px] leading-[18px] text-admin-text-muted">
        <Icon name="pin" size={12} className="mt-[3px]" />
        {r.address}
      </p>

      {/* mt-auto — 한 줄에 놓인 카드들의 액션 줄이 같은 높이에서 만나게 한다 */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-black/[0.06] pt-3">
        {/* 확충 배지는 카드에 달지 않는다 — 이 카드들은 "이번 분기 새로 확충된 업종" 섹션
            안에서만 나오므로 제목이 이미 말하고 있고, 카드에는 아이콘 타일의 반짝임 표식이 있다.
            페이백은 카드마다 있을 수도 없을 수도 있어 여기서 말해야 한다 */}
        <span className="flex min-w-0 flex-wrap gap-1">
          {r.payback ? <PaybackBadge label={`${r.payback.rate}% 페이백`} pop={pop} /> : null}
        </span>
        <a
          href={r.directions_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${r.name} 카카오맵에서 길찾기`}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[12px] font-bold text-visitor-primary transition-colors hover:bg-visitor-primary-soft"
        >
          길찾기
          <Icon name="arrowUpRight" size={13} strokeWidth={2.2} />
        </a>
      </div>
    </li>
  );
}
