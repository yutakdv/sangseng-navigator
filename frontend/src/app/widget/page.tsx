import type { Metadata } from "next";
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
// 조사는 레포 공용 유틸을 쓴다 (main에서 들어온 lib/korean.ts) — 화면마다 따로 판정하지 않는다
import { particle } from "@/lib/korean";
import {
  DEFAULT_SORT,
  filterByName,
  listNote,
  normalizeQuery,
  sortKeyOf,
  sortRecommendations,
  type SortKey,
} from "@/lib/widgetList";
import type { DisplayCategory, Recommendation, Region } from "@/types";

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
  /** 선택된 지역들 — 쉼표로 잇는다 (`고한읍,사북읍`) */
  region?: string;
  /** 선택된 업종들 — 쉼표로 잇는다 */
  category?: string;
  limit?: string;
  live?: string;
  /** 가맹점 이름 검색어 */
  q?: string;
  /** 목록 정렬 (widgetList.SortKey) */
  sort?: string;
  /** "off"면 오늘의 추천 카드를 접어 둔다 (사용자가 닫은 상태) */
  today?: string;
  /** 다시 그려질 때 열어 둘 선택 목록 ("region" | "category") — 다중 선택용 */
  open?: string;
};
const DEFAULT_LIST_LIMIT = 12;
const MAX_LIST_LIMIT = 120;

/**
 * 쿼리의 목록 값을 읽는다 — 계약에 없는 값은 버리고, 정본 순서(REGIONS·CATEGORIES)로 정렬한다.
 * 전부 고른 상태는 "전체"와 같으므로 빈 목록으로 접는다 — 조회 조합 수도 줄고 URL도 짧아진다.
 */
const parseList = (raw: string | undefined, allowed: readonly string[]): string[] => {
  if (!raw) return [];
  const picked = new Set(raw.split(",").map((v) => v.trim()));
  const valid = allowed.filter((a) => picked.has(a));
  return valid.length === allowed.length ? [] : valid;
};

/** 항목 하나를 켜고 끈다 */
const toggle = (list: string[], value: string, allowed: readonly string[]): string[] => {
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return allowed.filter((a) => next.includes(a));
};

const href = (next: Search, current: Search): string => {
  const merged = { ...current, ...next };
  const params = new URLSearchParams();
  if (merged.region) params.set("region", merged.region);
  if (merged.category) params.set("category", merged.category);
  if (merged.open) params.set("open", merged.open);
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
  const regions = parseList(sp.region, REGIONS);
  const categories = parseList(sp.category, CATEGORIES);
  const openMenu = sp.open === "region" || sp.open === "category" ? sp.open : undefined;
  const requestedLimit = Number(sp.limit);
  const listLimit = Number.isFinite(requestedLimit)
    ? Math.max(DEFAULT_LIST_LIMIT, Math.min(MAX_LIST_LIMIT, Math.floor(requestedLimit)))
    : DEFAULT_LIST_LIMIT;
  const live = sp.live === "1" ? "1" : undefined;
  const query = normalizeQuery(sp.q);
  const sort = sortKeyOf(sp.sort);
  const todayClosed = sp.today === "off";
  // 링크가 물고 다닐 현재 상태. `open`은 일부러 넣지 않는다 — 선택 목록 안의 항목 링크만
  // 그 값을 실어 열린 채로 돌아오고, 나머지 링크(칩·정렬·검색)는 목록을 닫은 채 이동해야 한다.
  const regionParam = regions.join(",") || undefined;
  const categoryParam = categories.join(",") || undefined;
  const current: Search = {
    region: regionParam,
    category: categoryParam,
    limit: sp.limit ? String(listLimit) : undefined,
    live,
    q: query,
    sort,
    today: todayClosed ? "off" : undefined,
  };
  const filters: Search = {
    region: regionParam,
    category: categoryParam,
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
  /**
   * 다중 선택 조회 — `/api/widget/recommend`는 region·category를 **하나씩만** 받는다(05 §1).
   * 그래서 고른 값들의 조합마다 한 번씩 부르고 합친다. 조합은 (지역 × 업종)이라 서로 겹치지
   * 않으므로 total은 그냥 더하면 되고, 그래도 같은 가맹점이 두 번 오면 이름+주소로 거른다.
   * 6지역·6업종을 다 고른 상태는 parseList가 "전체"로 접기 때문에 최대 조합은 5×5다.
   */
  const combos = (regions.length ? regions : [undefined]).flatMap((r) =>
    (categories.length ? categories : [undefined]).map((c) => ({ r, c })),
  );

  const [widgetResults, dashboard, cand, usageDaily, weather] =
    await Promise.all([
      Promise.all(combos.map(({ r, c }) => api.widget(r, c, fetchLimit))),
      // 푸터 "데이터 기준" 한 줄 전용 — 이 엔드포인트만 죽어도 방문객 위젯 전체가 에러 화면이
      // 되면 안 된다 (아래 candidates와 같은 방어 관용구).
      api.dashboard().catch(() => null),
      // 필터 칩의 가맹점 수 표기용 — merchants는 candidates 응답에 함께 실려 온다 (05 §1).
      // 칩 숫자는 장식이라, 이 엔드포인트가 503이어도 방문객 위젯 자체는 떠야 한다.
      api.candidates().catch(() => null),
      // 오늘의 추천 근거 — BE 엔드포인트가 없는 파이프라인 정적 산출물이다 (05 §6)
      api.usageDaily(),
      // 기상청 실황은 있으면 좋은 곁들임이다 — 실패해도 요일 문구는 그대로 나와야 한다.
      // fetchNowcast는 던지지 않도록 구현했지만 위 candidates와 같은 방어 관용구를 맞춘다.
      // 날씨는 지역 하나일 때만 그 지역 격자로 본다 — 여러 곳을 고르면 거점 격자로 말한다
      fetchNowcast(regions.length === 1 ? (regions[0] as Region) : undefined).catch(() => null),
    ]);

  const seenMerchant = new Set<string>();
  const recommendations: Recommendation[] = [];
  for (const result of widgetResults) {
    for (const rec of result.recommendations) {
      const key = `${rec.name}|${rec.address}`;
      if (seenMerchant.has(key)) continue;
      seenMerchant.add(key);
      recommendations.push(rec);
    }
  }
  const total = widgetResults.reduce((sum, r) => sum + r.total, 0);

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
  /**
   * 항목 옆 숫자 = "그 항목까지 켰을 때 걸리는 가맹점 수". 반대편 필터가 여러 개면 그 값들의
   * 합이다(지역×업종 칸은 서로 겹치지 않는다). candidates를 못 받았으면 countOf를 아예
   * 내리지 않는다 — 숫자가 전부 0으로 보이는 오표기 방지.
   */
  const sumOver = (values: string[], count: (v?: string) => number): number =>
    values.length ? values.reduce((sum, v) => sum + count(v), 0) : count(undefined);
  const countOfRegion = merchants.length
    ? (v?: string) => sumOver(categories, (c) => countMerchants(v, c))
    : undefined;
  const countOfCategory = merchants.length
    ? (v?: string) => sumOver(regions, (r) => countMerchants(r, v))
    : undefined;

  /**
   * 페이백 배너 — **서버 응답이 유일한 근거다.**
   *
   * 예전에는 추천이 0건일 때를 메우려고 여기서 카드 목록을 따로 읽어 매칭 규칙
   * (`완료` + 확정 페이백률)을 독자 복제했다. 규칙이 한 글자라도 갈리면 같은 위젯 안에서
   * 배너와 카드 배지가 서로 다른 근거로 뜬다 — 방문객에게는 둘 다 사실로 읽히므로 복제를 걷어냈다.
   * 추천이 0건이면 배너도 뜨지 않는다(붙일 가맹점 자체가 없는 화면이다).
   */
  const payback = recommendations.find((r) => r.payback)?.payback ?? null;
  /**
   * 오늘의 추천 — 요일 실측이 주근거, 날씨는 상황 설명이다(추천 업종을 바꾸지 않는다).
   * 지역·업종을 여러 개 골랐으면 한 지역/한 업종의 사실로 말할 수 없으므로 "전체" 축으로 돌아간다
   * (한 개만 고른 경우에만 그 축을 쓴다).
   */
  const soleRegion = regions.length === 1 ? (regions[0] as Region) : undefined;
  const soleCategory = categories.length === 1 ? (categories[0] as DisplayCategory) : undefined;
  const fact = weekdayFact(usageDaily, soleRegion ?? "전체", kstWeekdayIndex(), {
    // 방문객이 업종을 이미 골랐으면 그 업종 사실만 말한다 — 다른 업종을 들이밀지 않는다
    only: soleCategory,
    // 지름길 칩이 빈 목록으로 이어지지 않게. candidates를 못 받았으면(merchants 0) 거르지 않는다
    isAvailable: merchants.length ? (c) => sumOver(regions, (r) => countMerchants(r, c)) > 0 : undefined,
  });
  const todayCopy = fact ? todayPickCopy(fact, soleRegion ?? null, weather) : null;
  // 그 업종이 이미 켜져 있으면 칩이 현재 필터와 같아진다 — 그때는 칩을 내리지 않는다
  const todayHref =
    fact && !categories.includes(fact.category)
      ? href({ category: toggle(categories, fact.category, CATEGORIES).join(",") || undefined }, filters)
      : null;

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

  /** 필터 요약 칩 — 고른 값마다 하나씩, 누르면 그 값만 빠진다 */
  const summaryChips = [
    ...regions.map((v) => ({
      label: v,
      removeHref: href({ region: toggle(regions, v, REGIONS).join(",") || undefined }, filters),
    })),
    ...categories.map((v) => ({
      label: v,
      removeHref: href(
        { category: toggle(categories, v, CATEGORIES).join(",") || undefined },
        filters,
      ),
    })),
  ];

  return (
    // 방문객 화면은 AdminShell 밖이라 랜드마크가 없다 — 본문을 main으로 감싼다 (13 §4 접근성)
    <main className="min-h-screen bg-admin-bg py-0 sm:py-8">
      {/* 모바일에서는 한 열, 넓은 화면에서는 레퍼런스(image-2)처럼 필터와 지도를 나란히 둔다. */}
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden bg-visitor-bg shadow-card-hover sm:rounded-[28px] sm:ring-1 sm:ring-black/5">
        {/**
         * 로고 바를 두지 않는다 — 방문객은 브랜드를 확인하러 오는 게 아니라 쓸 곳을 찾으러 온다.
         * 다만 두 얼굴(담당자↔방문객)을 잇는 고리가 최하단에만 있으면 모바일 심사에서 폐루프
         * 서사를 놓치므로(검토 §3-2), 색 면 없이 링크 한 줄만 남긴다.
         */}
        <div className="flex items-center justify-end gap-2 px-5 pt-4 sm:px-8">
          {live ? <WidgetLiveRefresh /> : null}
          <Link
            href="/"
            className="text-[11px] font-semibold text-admin-text-muted underline underline-offset-2 transition-colors hover:text-visitor-primary"
          >
            담당자 화면 →
          </Link>
        </div>

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
              로그인 없이 하이원포인트 사용처를 간편하게 찾아보세요. 평소엔 가보지 못했던
              하이원리조트 주변의 숨겨진 맛집과 즐길거리에서 여행의 특별함을 더해보세요!
            </p>
            {/* 검색은 필터보다 위에 온다 — 갈 곳을 이미 아는 사람은 지역·업종을 거치지 않는다.
                limit은 넘기지 않는다: 새 검색은 첫 페이지부터 보는 게 맞다 */}
            <div className="mt-6">
              <WidgetSearch
                q={query}
                hidden={{
                  region: regionParam,
                  category: categoryParam,
                  live,
                  sort: sort === DEFAULT_SORT ? undefined : sort,
                  today: todayClosed ? "off" : undefined,
                }}
                clearHref={href({ q: undefined }, filters)}
              />
            </div>

            {/* 칩 14개를 늘어놓지 않고 눌러서 목록이 열리는 선택 필드로 준다 (WidgetControls 주석).
                항목 링크에는 `open`을 실어, 여러 개를 고르는 동안 목록이 닫히지 않게 한다 */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <WidgetSelect
                label="관심 지역"
                options={REGIONS}
                selected={regions}
                makeHref={(v) =>
                  href(
                    { region: toggle(regions, v, REGIONS).join(",") || undefined, open: "region" },
                    filters,
                  )
                }
                clearHref={href({ region: undefined, open: "region" }, filters)}
                titleOf={(v) => REGION_TOOLTIP[v as keyof typeof REGION_TOOLTIP]}
                countOf={countOfRegion}
                open={openMenu === "region"}
              />
              <WidgetSelect
                label="업종"
                options={CATEGORIES}
                selected={categories}
                makeHref={(v) =>
                  href(
                    {
                      category: toggle(categories, v, CATEGORIES).join(",") || undefined,
                      open: "category",
                    },
                    filters,
                  )
                }
                clearHref={href({ category: undefined, open: "category" }, filters)}
                countOf={countOfCategory}
                open={openMenu === "category"}
              />
            </div>
            <WidgetFilterSummary
              chips={summaryChips}
              resetHref={href({ region: undefined, category: undefined }, filters)}
            />
          </div>

          {/* 지도 제목 칩은 지역을 하나만 골랐을 때만 그 이름을 말한다 (여러 곳이면 거점 기준) */}
          <KakaoMapView recommendations={shown} region={soleRegion} />
        </div>

        <div className="px-5 pb-5 sm:px-8 sm:pb-8">
          {/* 오늘의 추천 — 지도와 목록 사이에 둔다. 목록을 훑기 직전에 "오늘 기준"을 한 줄로
              주는 지름길이라 목록 바로 위가 제자리다. 요일 사실을 못 만들면 통째로 숨기고,
              사용자가 닫았으면(today=off) 접어 둔다 */}
          {todayCopy && !todayClosed ? (
            <div className="mb-6">
              <TodayPick
                copy={todayCopy}
                chipHref={todayHref}
                closeHref={href({ today: "off" }, filters)}
              />
            </div>
          ) : null}

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
                  ? `‘${query}’${particle(query, "와/과")} 이름이 맞는 가맹점이 없어요`
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
              {/* 확충 완료 매칭 항목은 이미 정렬 최상단이다 — 섹션으로 갈라 먼저 읽히게 한다.
                  배지는 업종 단위 사실이라 개별 가맹점에 붙이면 신규 개점으로 오독된다.
                  캠페인 배너 한 장으로만 말하고 카드에는 표식을 두지 않는다. */}
              {fresh.length ? (
                <section aria-label="이번 분기 확충 완료 업종" className="mt-4">
                  <div className="rounded-2xl bg-state-good-bg px-4 py-3">
                    <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-state-good">
                      <Icon name="sparkle" size={15} strokeWidth={2} />
                      이번 분기 확충 완료:{" "}
                      {[...new Set(fresh.map((r) => r.category))].join(" · ")} 업종
                    </h3>
                    <p className="mt-0.5 break-keep text-xs leading-5 text-admin-text-muted">
                      지역상생팀이 이 업종의 가맹점 확충을 완료했어요. 아래 목록은 신규 개점이
                      아니라 해당 업종에서 지금 하이원포인트를 쓸 수 있는 가맹점이에요.
                    </p>
                  </div>
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
                scroll={false}
                className="inline-flex min-h-10 items-center rounded-xl bg-visitor-primary px-3.5 text-[13px] font-bold text-white shadow-[0_6px_16px_-8px_rgb(22_101_52_/_0.75)]"
              >
                가맹점 더 보기
              </Link>
            </div>
          ) : shown.length > DEFAULT_LIST_LIMIT ? (
            <Link
              href={href({}, filters)}
              scroll={false}
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
                <b>이번 분기 확충 완료</b> 섹션은 지역상생팀이 확충을 완료한 <b>업종</b>의
                가맹점이에요 — 개별 가맹점이 새로 생겼다는 뜻은 아니에요.
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
    </main>
  );
}

/**
 * 추천 가맹점 카드 한 장 — 확충 섹션과 전체 목록이 같은 마크업을 쓴다. pop은 라이브 미리보기 전용.
 *
 * 첫 줄이 **누구인가(아이콘·이름·업종)와 할 일(길찾기)**을 함께 말하고, 그 아래가 **무엇인가
 * (한 줄 설명·주소·혜택)**다. 정보를 한 덩어리로 쌓아 두면 열두 장이 같은 회색 블록으로 보인다.
 * 길찾기를 아래 구분선 칸에 따로 두었더니 칸은 늘 비어 있고 버튼은 작아, 이름 옆으로 올렸다.
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
    <li className="rounded-2xl bg-visitor-surface-sunken p-4 transition-colors hover:bg-visitor-surface-hover">
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
        {/* 길찾기는 이 카드에서 유일한 행동이라 이름 옆(우측 상단)에 상시 버튼으로 둔다.
            가라앉은 카드 면 위의 흰 알약이라 테두리 없이도 버튼으로 읽힌다 (13 §6-1) */}
        <a
          href={r.directions_url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${r.name} 카카오맵에서 길찾기`}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-white px-3 text-[12px] font-bold text-visitor-primary shadow-[0_1px_2px_rgb(15_23_42_/_0.08)] transition-colors hover:bg-visitor-primary hover:text-white"
        >
          길찾기
          <Icon name="arrowUpRight" size={13} strokeWidth={2.2} />
        </a>
      </div>

      <p className="mt-3 break-keep text-[13px] leading-6 text-admin-text-soft">{r.blurb}</p>
      <p className="mt-1.5 flex items-start gap-1.5 break-keep text-[11px] leading-[18px] text-admin-text-muted">
        <Icon name="pin" size={12} className="mt-[3px]" />
        {r.address}
      </p>

      {/* 확충 배지는 카드에 달지 않는다 — 이 카드들은 "이번 분기 새로 확충된 업종" 섹션 안에서만
          나오므로 제목이 이미 말하고 있고, 카드에는 아이콘 타일의 반짝임 표식이 있다.
          페이백은 카드마다 있을 수도 없을 수도 있어 있을 때만 한 줄 더 쓴다 */}
      {r.payback ? (
        <p className="mt-2.5">
          <PaybackBadge label={`${r.payback.rate}% 페이백`} pop={pop} />
        </p>
      ) : null}
    </li>
  );
}
