import type { Metadata } from "next";
import Link from "next/link";
import { NewBadge, PaybackBadge } from "@/components/Badge";
import { CategoryIcon } from "@/components/CategoryIcon";
import { api } from "@/lib/api";
import { CATEGORIES, REGIONS, REGION_TOOLTIP, SOURCE_NOTE } from "@/lib/constants";

export const metadata: Metadata = { title: "가맹점 찾기 · 상생 나침반" };

// 카드가 `완료`로 바뀌면 추천 목록이 즉시 달라져야 한다 (데모 마지막 동선) — 캐시하지 않는다
export const dynamic = "force-dynamic";

/**
 * ⑤ 방문객 위젯 (docs/plan/08 F7 · 13 §1 image-2).
 *
 * 로그인 없음. 지역·업종 선택은 쿼리스트링으로 하고 서버에서 필터링한다 —
 * 그래서 mock 모드·실 API 모드 어느 쪽에서도 같은 코드로 동작한다.
 * 담당자 화면(인디고)과 구분되는 그린 브랜딩 + 390px 모바일 프레임 (13 §4·F7).
 */
type Search = { region?: string; category?: string };

const href = (next: Search, current: Search): string => {
  const merged = { ...current, ...next };
  const params = new URLSearchParams();
  if (merged.region) params.set("region", merged.region);
  if (merged.category) params.set("category", merged.category);
  const q = params.toString();
  return q ? `/widget?${q}` : "/widget";
};

export default async function WidgetPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Next 15+ 에서 params·searchParams 는 Promise 다 — await 없이 접근하면 런타임 에러
  const sp = await searchParams;
  // 계약에 없는 값이 쿼리로 들어오면 무시한다 (필터는 6지역·표시 6분류로 고정)
  const region = REGIONS.includes(sp.region as never) ? sp.region : undefined;
  const category = CATEGORIES.includes(sp.category as never) ? sp.category : undefined;
  const current: Search = { region, category };

  const [{ recommendations, policy_note }, dashboard] = await Promise.all([
    api.widget(region, category),
    api.dashboard(),
  ]);

  return (
    <div className="min-h-screen bg-slate-100 py-0 sm:py-8">
      {/* 모바일 프레임 — "방문객 화면"임을 시각적으로 구분 (F7) */}
      <div className="mx-auto w-full max-w-[390px] bg-visitor-bg shadow-card sm:rounded-2xl sm:ring-1 sm:ring-black/5">
        <header className="rounded-t-none bg-visitor-primary px-4 py-4 text-white sm:rounded-t-2xl">
          <p className="text-[11px] text-white/70">강원랜드 지역상생</p>
          <h1 className="mt-0.5 text-lg font-bold">내 주변 하이원포인트 가맹점</h1>
          <p className="mt-1 text-xs leading-5 text-white/80">
            관심 지역과 업종을 고르면 하이원포인트를 쓸 수 있는 곳을 알려드려요. 로그인은 필요 없어요.
          </p>
        </header>

        <div className="px-4 py-4">
          <Filter
            label="관심 지역"
            options={REGIONS}
            selected={region}
            makeHref={(v) => href({ region: v }, current)}
            titleOf={(v) => REGION_TOOLTIP[v as keyof typeof REGION_TOOLTIP]}
          />
          <Filter
            label="업종"
            options={CATEGORIES}
            selected={category}
            makeHref={(v) => href({ category: v }, current)}
            className="mt-3"
          />

          <div className="mt-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-admin-text">추천 가맹점</h2>
            <span className="text-[11px] text-admin-text-muted">{recommendations.length}곳</span>
          </div>
          {/* 추천 순서는 거점 직선거리 오름차순이지만 "가까운 순"으로 라벨링하지 않는다 —
              직선거리가 산악 지형에서 실제 접근성과 역전되기 때문 (05 §1·§4). policy_note만 그대로 노출한다 */}
          <p className="mt-1 text-[11px] leading-4 text-admin-text-muted">{policy_note}</p>

          {recommendations.length === 0 ? (
            <div className="mt-4 rounded-card bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-medium text-admin-text">
                해당 조건의 가맹점이 아직 없어요
              </p>
              <p className="mt-1 text-xs text-admin-text-muted">다른 지역·업종을 선택해 보세요</p>
              <Link
                href="/widget"
                className="mt-3 inline-block rounded-full bg-visitor-primary px-3 py-1.5 text-xs font-medium text-white"
              >
                조건 초기화
              </Link>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {recommendations.map((r) => (
                <li
                  key={`${r.name}-${r.address}`}
                  className="rounded-card border border-black/5 bg-white p-3 shadow-card"
                >
                  <div className="flex gap-3">
                    <CategoryIcon category={r.category} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-admin-text">{r.name}</span>
                        {r.badge === "신규" ? <NewBadge /> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-admin-text-muted">{r.category}</p>
                      <p className="mt-1 break-keep text-xs leading-5 text-admin-text">{r.blurb}</p>
                      <p className="mt-1 break-keep text-[11px] leading-4 text-admin-text-muted">
                        {r.address}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center rounded-full bg-visitor-primary-soft px-2 py-0.5 text-[11px] font-medium text-visitor-primary">
                          하이원포인트 사용 가능
                        </span>
                        {r.payback ? <PaybackBadge label={r.payback.label} /> : null}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section className="mt-6 rounded-card bg-visitor-primary-soft px-4 py-4">
            <h3 className="text-sm font-semibold text-visitor-primary">이 서비스는요</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs leading-5 text-admin-text">
              <li>
                하이원포인트로 결제할 수 있는 <b>지역 가맹점</b>을 지역·업종으로 찾아볼 수 있어요.
              </li>
              <li>
                <b>신규</b> 배지는 지역상생팀이 이번 분기에 확충을 완료한 업종의 가맹점이에요.
              </li>
              <li>
                페이백 배지는 담당자가 승인·적용한 <b>지역 결제 리워드</b>가 있을 때만 보여요. 이미
                적립된 포인트를 지역에서 쓸 때 붙는 혜택이라, 포인트가 더 적립되는 건 아니에요.
              </li>
            </ul>
          </section>

          <p className="mt-4 text-[10px] leading-4 text-admin-text-muted">
            영업시간·영업 상태 정보는 제공하지 않아요. 방문 전 가맹점에 확인해 주세요.
          </p>
          <footer className="mt-3 border-t border-black/5 pt-3 text-[10px] leading-4 text-admin-text-muted">
            <p>{SOURCE_NOTE}</p>
            <p>데이터 기준: {dashboard.period_note}</p>
          </footer>
        </div>
      </div>

      {/* 위젯에는 담당자 사이드바가 없다(13 §3) — 그래서 돌아갈 길이 이 줄뿐이다.
          모바일에서 숨기면 심사위원이 휴대폰으로 위젯에 들어온 순간 막다른 길이 되고,
          데모 7→8단계(위젯 → 인센티브)도 한 번에 못 넘어간다 (11 §1) */}
      <p className="mx-auto mt-4 max-w-[390px] px-2 text-center text-[11px] leading-5 text-slate-500">
        방문객이 보는 화면입니다 · 담당자 화면{" "}
        <Link href="/" className="underline">
          Action Card 허브
        </Link>
        {" · "}
        <Link href="/incentive" className="underline">
          인센티브 정책
        </Link>
      </p>
    </div>
  );
}

function Filter({
  label,
  options,
  selected,
  makeHref,
  titleOf,
  className = "",
}: {
  label: string;
  options: readonly string[];
  selected?: string;
  makeHref: (value?: string) => string;
  titleOf?: (value: string) => string | undefined;
  className?: string;
}) {
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs transition-colors ${
      active
        ? "bg-visitor-primary font-medium text-white"
        : "bg-slate-100 text-admin-text hover:bg-slate-200"
    }`;

  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-medium text-admin-text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <Link href={makeHref(undefined)} className={chip(!selected)}>
          전체
        </Link>
        {options.map((o) => (
          <Link key={o} href={makeHref(o)} title={titleOf?.(o)} className={chip(selected === o)}>
            {o}
          </Link>
        ))}
      </div>
    </div>
  );
}
