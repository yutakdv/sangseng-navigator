import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { AssumptionBadge, AssumptionNote, ProxyBadge } from "@/components/Badge";
import { DecisionActions } from "@/components/DecisionActions";
import { MapView } from "@/components/MapView";
import { OriginalRankingTable } from "@/components/OriginalRankingTable";
import { Section } from "@/components/Section";
import { SimulateButton } from "@/components/SimulateButton";
import { ProgressChip, StatusChip } from "@/components/StatusChip";
import { BarRank } from "@/components/charts/BarRank";
import { api } from "@/lib/api";
import { ANCHOR, PRIMARY } from "@/lib/constants";
import { ApiError } from "@/lib/errors";
import { range } from "@/lib/format";
import type { Candidate } from "@/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id} 제안 근거 · 상생 나침반` };
}

/**
 * ② 카드 상세 (docs/plan/08 F4 · 03 문서 구조) — 데모 3·4·5단계.
 *
 * 서버 컴포넌트다. mock JSON(merchants 330KB)은 서버에서만 읽고, 지도·시뮬레이션 버튼처럼
 * 브라우저가 필요한 조각만 클라이언트 컴포넌트로 내려보낸다. 지도에는 **이 읍의 가맹점만**
 * 걸러서 넘긴다 — 1,678건 전체를 넘기면 그대로 RSC 페이로드가 된다.
 *
 * 화면 순서는 "AI가 무엇을 왜 제안했는가(근거 전문 → 원 Score 순위) → 어디인가(지도 → 후보 상세)
 * → 그래서 어떤 효과인가(예상 효과) → 애초에 왜 이 지역인가(1단계 진단)"다.
 */
export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 15+ 에서 params·searchParams 는 Promise 다 — await 없이 접근하면 런타임 에러
  const { id } = await params;

  const [dashboard, cand, card] = await Promise.all([
    api.dashboard(),
    api.candidates(),
    api
      .card(id)
      .then((r) => r.card)
      // 실 API의 404는 장애가 아니라 "없는 카드"다 — 에러 화면 대신 Next의 not-found로 넘긴다
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) return undefined;
        throw error;
      }),
  ]);

  if (!card) notFound();

  const target = card.target;
  const eupCandidates = target ? cand.candidates.filter((c) => c.eup === target.eup) : [];
  const targetCandidate = target
    ? (eupCandidates.find((c) => c.category === target.category) ?? null)
    : null;
  const eupMerchants = target ? cand.merchants.filter((m) => m.eup === target.eup) : [];
  const sameCategoryMerchants = target
    ? eupMerchants.filter((m) => m.category === target.category).length
    : 0;

  const showRank = card.score_rank !== null && card.ai_rank !== null;
  const targetLabel = target ? `${target.eup} ${target.category}` : null;

  /**
   * `근사 지표` 배지 — "지역 전환율"이 보이는 **모든 위치**에 붙인다 (절대 규칙 2, 13 §9).
   * INCENTIVE 카드에서만 쓴다: 이 카드의 `scenarios[].delta_pp`와 `expected_effect`가
   * 지역 전환율 개선폭이기 때문이다 (05 §2). EXPANSION의 예상 효과는 지역 소비 집중도라
   * 같은 배지를 붙이면 오히려 다른 지표에 근사 고지를 다는 셈이 된다.
   */
  const proxyBadge =
    card.type === "INCENTIVE" && dashboard.conversion.is_proxy ? (
      <ProxyBadge note={dashboard.conversion.proxy_note} />
    ) : null;

  // 1단계 진단 근거 — 값 순 재정렬 없이 rank 순서 그대로, 대상 지역만 진한 색 (13 §5·§7)
  const eupBars = (cand.eup_ranking ?? []).map((e) => ({
    label: e.eup,
    value: e.score,
    note: `${e.rank}위`,
  }));
  const eupColors = Object.fromEntries(
    (cand.eup_ranking ?? []).map((e) => [e.eup, e.eup === target?.eup ? PRIMARY : "#c7d2fe"]),
  );

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        {/* ── 카드 요약 + 결정 ─────────────────────────────────── */}
        <div className="rounded-card bg-admin-surface p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href="/"
              className="text-xs font-medium text-admin-primary underline-offset-2 hover:underline"
            >
              ← 제안 목록
            </Link>
            <span className="text-xs tabular-nums text-admin-text-muted">{card.id}</span>
            <StatusChip status={card.status} />
            {card.progress ? <ProgressChip progress={card.progress} /> : null}
          </div>

          <h2 className="mt-1.5 break-keep text-lg font-bold leading-7 text-admin-text">
            {card.title}
          </h2>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-text-muted">
            <span>
              대상{" "}
              <span className="font-medium text-admin-text">
                {target ? `${target.eup} · ${target.category}` : "전 지역 공통"}
              </span>
            </span>
            <span>
              신뢰도 <span className="font-medium text-admin-text">{card.confidence}</span>
            </span>
            <span>생성 {dateText(card.created_at)}</span>
            {card.decided_at ? <span>결정 {dateText(card.decided_at)}</span> : null}
            {card.selected_rate ? (
              <span>
                확정 페이백률{" "}
                <span className="font-medium text-admin-text">{card.selected_rate}%</span>
              </span>
            ) : null}
          </div>

          {/* 정량 순위 병기 — 조정 여부와 무관하게 항상 노출 (절대 규칙 5) */}
          {showRank ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-lg px-2.5 py-1.5 text-sm tabular-nums ${
                  card.ai.adjusted
                    ? "bg-admin-primary-soft font-semibold text-admin-primary"
                    : "bg-admin-bg text-admin-text"
                }`}
              >
                Score {card.score_rank}위 → AI 제안 {card.ai_rank}위
              </span>
              {card.ai.adjusted ? (
                <span className="inline-flex items-center rounded-full bg-state-notice-bg px-2 py-0.5 text-[11px] font-medium text-state-notice">
                  AI 조정 제안
                </span>
              ) : (
                <span className="text-[11px] text-admin-text-muted">정량 1순위와 동일</span>
              )}
            </div>
          ) : null}

          {card.status === "pending" ? (
            <div className="mt-4 border-t border-black/5 pt-3">
              <p className="mb-2 break-keep text-xs leading-5 text-admin-text-muted">
                AI는 후보 비교와 근거까지만 제시합니다. 아래 버튼을 거쳐야 카드가 확정되며, 이
                화면의 수치·문구는 담당자 의사결정 근거로 쓰입니다.
              </p>
              <DecisionActions
                cardId={card.id}
                requireRate={card.type === "INCENTIVE"}
                selectedRate={card.selected_rate ?? null}
              />
              {card.type === "INCENTIVE" ? (
                <p className="mt-1.5 text-xs text-admin-text-muted">
                  페이백률(3·5·7%) 선택은{" "}
                  <Link href="/incentive" className="text-admin-primary hover:underline">
                    인센티브 정책 화면
                  </Link>
                  에서 합니다.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── AI 조정 근거 전문 ────────────────────────────────── */}
        <Section
          title="AI 조정 근거"
          desc="AI가 후보를 비교한 내용을 요약하지 않고 그대로 싣는다. 담당자가 판단 근거를 직접 확인할 수 있어야 하기 때문이다."
        >
          <div className="flex flex-col gap-4">
            <Block title="후보 비교">
              <p className="break-keep text-sm leading-6 text-admin-text">{card.ai.comparison}</p>
            </Block>

            {card.ai.reasons?.length ? (
              <Block title="근거">
                <ul className="flex list-disc flex-col gap-1.5 pl-4">
                  {card.ai.reasons.map((r, i) => (
                    <li key={i} className="break-keep text-sm leading-6 text-admin-text">
                      {r}
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}

            {card.ai.risks?.length ? (
              <Block title="리스크">
                <ul className="flex list-disc flex-col gap-1.5 pl-4">
                  {card.ai.risks.map((r, i) => (
                    <li key={i} className="break-keep text-sm leading-6 text-admin-text">
                      {r}
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}

            {/* 예상 효과는 시뮬레이션 계열 출력이라 배지 + 고지 문구를 붙인다 (절대 규칙 3) */}
            <div className="rounded-lg bg-admin-primary-soft p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-admin-primary">예상 효과</h3>
                <AssumptionBadge />
                {proxyBadge}
              </div>
              <p className="mt-1 break-keep text-sm leading-6 text-admin-text">
                {card.ai.expected_effect}
              </p>
              <AssumptionNote className="mt-1.5" />
            </div>
          </div>
        </Section>

        {/* ── 원 Score 순위 (절대 규칙 5) ──────────────────────── */}
        {card.ai.original_ranking?.length ? (
          <Section
            title="원 Score 순위 (정량 기준)"
            desc="2단계 후보 스코어의 원래 순위다. AI 제안 순위와 나란히 두어 조정 내역을 감출 수 없게 한다."
          >
            <OriginalRankingTable
              rows={card.ai.original_ranking}
              targetLabel={targetLabel}
              scoreRank={card.score_rank}
              aiRank={card.ai_rank}
              adjusted={card.ai.adjusted}
            />
          </Section>
        ) : null}

        {/* ── 지도 ─────────────────────────────────────────────── */}
        {targetCandidate && target ? (
          <Section
            title="후보 위치와 반경 500m"
            desc={`제안 후보를 중심으로 반경 500m를 그리고, ${target.eup}의 하이원포인트 가맹점을 업종 색으로 찍었다. 거점 마커는 후보까지의 거리·소요시간 기준점이다.`}
          >
            {/* 지도는 이 컴포넌트 하나에 격리돼 있다 — Safari 렌더 문제 시 이 줄만 걷어내면
                아래 "후보 상세" 표가 같은 근거(거점 거리·반경 내 가맹점 수)를 그대로 담는다 (02 문서 폴백) */}
            <MapView
              center={{ lat: targetCandidate.lat, lng: targetCandidate.lng }}
              sameCategory={target.category}
              candidates={eupCandidates.map((c) => ({
                id: c.id,
                name: c.name,
                category: c.category,
                lat: c.lat,
                lng: c.lng,
                isTarget: c.id === targetCandidate.id,
              }))}
              merchants={eupMerchants.map((m) => ({
                name: m.name,
                category: m.category,
                lat: m.lat,
                lng: m.lng,
                address: m.address,
              }))}
            />
            <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
              {target.eup} 하이원포인트 가맹점 {eupMerchants.length}곳 (그중 {target.category}{" "}
              {sameCategoryMerchants}곳) · 후보 반경 500m 내 동일 업종 가맹점{" "}
              {targetCandidate.nearby_merchants}곳 / 전체 상가 {targetCandidate.nearby_stores}곳.
              지도 표기는 {ANCHOR.name} 기준이며, 지도 저작자 표시는 화면 오른쪽 아래에 있다.
            </p>
          </Section>
        ) : null}

        {/* ── 후보 상세 (거리 병기) ────────────────────────────── */}
        {eupCandidates.length ? (
          <Section
            title="후보 상세"
            desc="같은 읍에서 업종별로 뽑힌 대표 후보다. 순서는 정량 Score 순이며, 도로 값으로 다시 정렬하지 않는다."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs text-admin-text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      후보
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Score
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      업종공백도
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      동선근접도
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      기존가맹포화도
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      반경 500m 내 (동일 업종 가맹점 / 전체 상가)
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      거점에서의 거리
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eupCandidates.map((c) => {
                    const isTarget = c.id === targetCandidate?.id;
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-black/5 last:border-0 ${
                          isTarget ? "bg-admin-primary-soft" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">
                          <div
                            className={
                              isTarget ? "font-semibold text-admin-primary" : "font-medium text-admin-text"
                            }
                          >
                            {c.category}
                            {isTarget ? (
                              <span className="ml-1.5 text-[11px] font-normal">이번 제안 후보</span>
                            ) : null}
                          </div>
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
                        <td className="py-2 pr-3 text-right tabular-nums text-admin-text-muted">
                          {c.saturation.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-admin-text-muted">
                          {c.nearby_merchants}곳 / {c.nearby_stores}곳
                        </td>
                        {/* 직선·도로를 항상 함께 적는다 — 한쪽만 쓰면 "가장 가깝다"는 오독이 생긴다 (05 §1) */}
                        <td className="py-2 tabular-nums text-admin-text">{distanceText(c)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
              직선거리는 {ANCHOR.name} 좌표와 후보 좌표로 계산한 값이고, 도로 거리·소요시간은 공개
              라우팅 API 추정치로 비포장·임도 구간이 포함될 수 있다. 두 값은 절대 수치가 아니라 후보
              간 상대 비교로만 읽으며, 어느 후보도 “거점에서 가장 가깝다”고 단정하지 않는다. 동선근접도는
              직선거리 기반이라 산악 지형에서 실제 접근성과 역전될 수 있어 도로 값을 함께 싣는다.
            </p>
          </Section>
        ) : null}

        {/* ── 가맹 전환 시 예상 효과 (EXPANSION 전용) ──────────── */}
        {card.type === "EXPANSION" ? (
          <Section
            title="가맹 전환 시 예상 효과"
            badge={<AssumptionBadge />}
            desc="이 후보가 하이원포인트 가맹점으로 전환됐다고 가정하고 지역 소비 집중도를 다시 계산한다. 결과는 확정이 아니라 의사결정 근거로만 쓴다."
          >
            <SimulateButton cardId={card.id} />
          </Section>
        ) : null}

        {/* ── 인센티브 시나리오 (INCENTIVE 전용) ───────────────── */}
        {card.scenarios?.length ? (
          <Section
            title="페이백 시나리오 비교"
            badge={
              <>
                <AssumptionBadge />
                {proxyBadge}
              </>
            }
            desc="AI는 세 시나리오를 비교해 제시할 뿐이고, 적용할 페이백률은 담당자가 승인할 때 고른 값만 확정된다."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs text-admin-text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      페이백률
                    </th>
                    {/* 무엇의 개선폭인지 열 이름에 밝힌다 — 인센티브 화면(ScenarioTable)과 같은 라벨 */}
                    <th scope="col" className="py-2 pr-3 font-medium">
                      예상 지역 전환율 개선폭
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      재원 부담
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {card.scenarios.map((s) => (
                    <tr
                      key={s.rate}
                      className={`border-b border-black/5 last:border-0 ${
                        card.selected_rate === s.rate ? "bg-admin-primary-soft" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 tabular-nums font-medium">
                        {s.rate}%
                        {card.selected_rate === s.rate ? (
                          <span className="ml-1.5 text-[11px] font-normal text-admin-primary">
                            담당자 확정
                          </span>
                        ) : null}
                      </td>
                      {/* delta_pp는 소수 1자리 고정 — 저장소 왕복에서 1.0이 1로 돌아올 여지가 있다 (05 §2) */}
                      <td className="py-2 pr-3 tabular-nums text-admin-text">
                        {range(s.delta_pp)}
                      </td>
                      <td className="py-2 text-admin-text-muted">{s.budget_note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {card.assumption_note ? (
              <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
                {card.assumption_note}
              </p>
            ) : null}
            <AssumptionNote className="mt-1" />
          </Section>
        ) : null}

        {/* ── 1단계 진단 근거 ─────────────────────────────────── */}
        {/* 전 지역 공통 카드(INCENTIVE)에는 "왜 이 지역인가"가 성립하지 않아 싣지 않는다 */}
        {target && eupBars.length ? (
          <Section
            title="1단계 지역 진단 — 왜 이 지역인가"
            desc="소비저조도·소비증감을 0~1로 정규화해 합산한 지역 스코어다. 후보 선정보다 한 단계 앞선 정량 근거이며, 순위는 화면에서 감추지 않는다."
          >
            <BarRank data={eupBars} colors={eupColors} height={200} />
            <p className="mt-2 break-keep text-[11px] leading-4 text-admin-text-muted">
              제안 대상 지역 {target.eup}만 진한 색으로 표시했다. 막대 길이는 지역 스코어이며, 값이
              클수록 소비가 저조하거나 감소 폭이 크다는 뜻이다.
            </p>
          </Section>
        ) : null}

        {/* ── 출처·이력 ───────────────────────────────────────── */}
        <Section title="근거 데이터와 처리 이력" desc="이 카드가 어떤 데이터로 만들어졌고 언제 어떤 결정을 거쳤는지.">
          <div className="flex flex-wrap gap-1.5">
            {card.sources.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded-full bg-admin-bg px-2 py-0.5 text-[11px] text-admin-text-muted"
              >
                {s}
              </span>
            ))}
          </div>
          {card.events?.length ? (
            <ol className="mt-3 flex flex-col gap-1.5">
              {card.events.map((e, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="tabular-nums text-admin-text-muted">{timeText(e.at)}</span>
                  <span className="text-admin-text">{eventLabel(e.action)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Section>
      </div>
    </AdminShell>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold text-admin-text-muted">{title}</h3>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * 거점(ANCHOR)까지의 직선거리(km) — `mocks/store.ts`의 `anchorKm`과 같은 haversine 식이다
 * (그 함수는 모듈 내부용이라 여기서 같은 식을 쓴다).
 */
function anchorKm(lat: number, lng: number): number {
  const R = 6371;
  const p1 = (ANCHOR.lat * Math.PI) / 180;
  const p2 = (lat * Math.PI) / 180;
  const a =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin((((lng - ANCHOR.lng) * Math.PI) / 180) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * "직선 7.57km / 도로 25.8km·33.9분" — 두 값을 항상 함께, 도로 값이 없으면 도로 항목만 `—` (05 §1).
 *
 * 직선거리는 **소수 2자리**다 — 파이프라인(`p6_scoring.py`)이 같은 값을 `:.2f`로 찍고, AI 근거
 * 문구·데모 대본이 그 값을 반올림해 인용하기 때문이다(숙박업 후보 5.55km → 문구는 "직선 5.6km").
 * 소수 1자리로 줄이면 화면에 5.5km가 찍혀 같은 화면의 AI 문구(5.6km)와 어긋나 보인다.
 * 도로 값은 계약대로 소수 1자리 그대로 쓴다 (05 §1).
 */
function distanceText(c: Candidate): string {
  const straight = `직선 ${anchorKm(c.lat, c.lng).toFixed(2)}km`;
  if (c.road_distance_km === null && c.road_minutes === null) return `${straight} / 도로 —`;
  const km = c.road_distance_km === null ? "—" : `${c.road_distance_km.toFixed(1)}km`;
  const min = c.road_minutes === null ? "—" : `${c.road_minutes.toFixed(1)}분`;
  return `${straight} / 도로 ${km}·${min}`;
}

/** "2026-08-04T09:00:00+09:00" → "2026-08-04" (KST 표기 그대로, 재해석하지 않는다) */
const dateText = (iso: string): string => iso.slice(0, 10);
const timeText = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** events의 action 값을 화면 문구로 (05 §7 — `approved` · `progress:완료` 형태) */
function eventLabel(action: string): string {
  const MAP: Record<string, string> = {
    generated: "AI 제안 카드 생성",
    approved: "담당자 승인",
    rejected: "담당자 반려",
    held: "담당자 보류",
  };
  if (action.startsWith("progress:")) return `추진 상태 변경 → ${action.slice("progress:".length)}`;
  return MAP[action] ?? action;
}
