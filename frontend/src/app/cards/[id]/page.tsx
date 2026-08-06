import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { AssumptionBadge, AssumptionNote, ProxyBadge } from "@/components/Badge";
import { CandidateVerification } from "@/components/CandidateVerification";
import { DecisionActions } from "@/components/DecisionActions";
import { DeltaValue } from "@/components/DeltaValue";
import { Icon } from "@/components/Icon";
import { MapView } from "@/components/MapView";
import { OriginalRankingTable } from "@/components/OriginalRankingTable";
import { ProgressRecordTimeline } from "@/components/ProgressRecordTimeline";
import { ProgressSelect } from "@/components/ProgressSelect";
import { RankTrace } from "@/components/RankTrace";
import { Section } from "@/components/Section";
import { SimulateButton } from "@/components/SimulateButton";
import { WorkflowChip } from "@/components/StatusChip";
import { BarRank } from "@/components/charts/BarRank";
import { api } from "@/lib/api";
import { ANCHOR, PRIMARY } from "@/lib/constants";
import { ApiError } from "@/lib/errors";
import type { Candidate, Card } from "@/types";

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

  const [dashboard, cand, card, progressResult] = await Promise.all([
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
    api.progressRecords(id).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        return { records: [], next_cursor: null };
      }
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
  const isExpansion = card.type === "EXPANSION";

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
    (cand.eup_ranking ?? []).map((e) => [e.eup, e.eup === target?.eup ? PRIMARY : "#D6CEF8"]),
  );

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-admin-text-muted underline-offset-4 hover:text-admin-primary hover:underline"
        >
          <Icon name="chevronRight" size={14} strokeWidth={2} className="rotate-180" />
          제안 목록으로
        </Link>

        <nav aria-label="카드 검토 순서" className="rounded-panel bg-admin-surface p-2 shadow-card">
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            <ReviewStep
              href={isExpansion ? "#diagnosis" : "#evidence"}
              step="01"
              label={isExpansion ? "지역 진단" : "근거 확인"}
              note={isExpansion ? "왜 이 지역인가" : "정책 근거와 리스크"}
            />
            {isExpansion ? (
              <ReviewStep href="#evidence" step="02" label="후보 비교" note="정량 순위와 중복 제외" />
            ) : (
              <ReviewStep href="#scenarios" step="02" label="옵션 비교" note="3·5·7% 시나리오" />
            )}
            {isExpansion ? (
              <ReviewStep href="#location" step="03" label="위치·효과" note="반경 500m와 전환 가정" />
            ) : (
              <ReviewStep href="#evidence" step="03" label="리스크 확인" note="재원·약관·연동" />
            )}
            <ReviewStep
              href={card.status === "pending" ? "#decision" : "#execution"}
              step="04"
              label={card.status === "pending" ? "담당자 결정" : "실행 기록"}
              note={card.status === "pending" ? "검토 후 승인·보류·반려" : "적격성·심사·추진 관리"}
            />
          </ol>
        </nav>

        {/* ── 카드 요약 + 결정 ─────────────────────────────────── */}
        <div className="u-panel overflow-hidden">
          <div className="border-b border-admin-border bg-admin-surface-sunken p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-md bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-admin-text-muted ring-1 ring-inset ring-admin-border">
                {card.id}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
                {isExpansion ? "가맹점 확충" : "페이백 인센티브"}
              </span>
              <WorkflowChip card={card} />
            </div>

            <h1 className="mt-2 break-keep text-[22px] font-bold leading-8 tracking-[-0.01em] text-admin-text sm:text-[26px] sm:leading-9">
              {card.title}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-admin-text-muted">
              <span className="flex items-center gap-1.5">
                <Icon name="pin" size={14} />
                대상{" "}
                <b className="font-semibold text-admin-text">
                  {target ? `${target.eup} · ${target.category}` : "전 지역 공통"}
                </b>
              </span>
              <span className="flex items-center gap-1.5">
                <Icon name="shield" size={14} />
                신뢰도 <b className="font-semibold text-admin-text">{card.confidence}</b>
              </span>
              <span className="flex items-center gap-1.5 tabular-nums">
                <Icon name="clock" size={14} />
                생성 {dateText(card.created_at)}
              </span>
              {card.decided_at ? (
                <span className="tabular-nums">결정 {dateText(card.decided_at)}</span>
              ) : null}
              {card.selected_rate ? (
                <span className="flex items-center gap-1.5">
                  <Icon name="gift" size={14} />
                  확정 페이백률{" "}
                  <b className="font-semibold text-admin-text">{card.selected_rate}%</b>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 p-4 sm:p-6">
            {/* 정량 순위 병기 — 조정 여부와 무관하게 항상 노출 (절대 규칙 5) */}
            {showRank ? <RankTrace card={card} size="md" /> : null}

            {card.ai.grounding?.status === "verified" ? (
              <p className="flex items-start gap-2 rounded-xl bg-state-good-bg px-3.5 py-3 text-xs leading-5 text-state-good ring-1 ring-inset ring-state-good-line">
                <Icon name="check" size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                서버가 정량 규칙으로 고른 대상과 화면의 후보명·Score·순위·추진 상태·도로 시간을
                정본 데이터로 다시 검증했습니다. AI는 비정량 리스크 설명만 보조합니다.
              </p>
            ) : null}

            {isExpansion && card.status !== "pending" ? (
              <>
                <CandidateVerification
                  cardId={card.id}
                  verification={card.candidate_verification}
                  editable={card.status === "approved"}
                />
                <OperationsSummary card={card} />
              </>
            ) : null}

            {card.status === "approved" ? (
              <section id="execution" aria-labelledby={`execution-${card.id}`} className="scroll-mt-24 rounded-xl border border-admin-primary-line bg-admin-primary-soft p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-xl">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-admin-primary text-white">
                        <Icon name="workflow" size={16} />
                      </span>
                      <div>
                        <h2 id={`execution-${card.id}`} className="text-sm font-bold text-admin-text">추진 상태 기록</h2>
                        <p className="mt-0.5 text-[11px] leading-4 text-admin-text-muted">결정 이후의 적격성·심사·추진·완료 상태를 기록합니다.</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link
                        href={`/tracking/new?card_id=${encodeURIComponent(card.id)}`}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-admin-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-admin-primary-strong"
                      >
                        경과·실측값 입력 <Icon name="arrowRight" size={13} />
                      </Link>
                      <Link href="/tracking" className="inline-flex items-center gap-1 text-xs font-semibold text-admin-primary underline-offset-4 hover:underline">
                        전체 리포트 보기 <Icon name="arrowRight" size={13} />
                      </Link>
                    </div>
                  </div>
                  <div className="w-full rounded-xl bg-admin-surface p-3 ring-1 ring-inset ring-admin-border sm:w-60">
                    <ProgressSelect
                      cardId={card.id}
                      cardType={card.type}
                      progress={card.progress}
                      verificationStatus={card.candidate_verification?.status}
                    />
                  </div>
                </div>
              </section>
            ) : null}

          </div>
        </div>

        {card.status === "approved" ? (
          <Section
            id="progress-history"
            icon="report"
            title={`추진 경과 기록 · ${progressResult.records.length}건`}
            desc="상태 변경 근거, 장애 요인, 다음 행동과 실제 관측 성과를 최신 기록부터 보여 줍니다. 빠른 상태 변경은 메모 없음으로 구분합니다."
            right={
              <Link
                href={`/tracking/new?card_id=${encodeURIComponent(card.id)}`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-admin-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-admin-primary-strong"
              >
                기록 입력 <Icon name="arrowRight" size={13} />
              </Link>
            }
          >
            <ProgressRecordTimeline records={progressResult.records} cardId={card.id} />
            {progressResult.next_cursor ? (
              <p className="u-note mt-3 border-t border-admin-border pt-3">
                최신 50건을 표시했습니다. 이전 기록은 추후 페이지네이션으로 이어서 확인할 수 있습니다.
              </p>
            ) : null}
          </Section>
        ) : null}

        {/* ── 1단계 진단 근거 ─────────────────────────────────── */}
        {/* 전 지역 공통 카드(INCENTIVE)에는 "왜 이 지역인가"가 성립하지 않아 싣지 않는다 */}
        {target && eupBars.length ? (
          <Section
            id="diagnosis"
            icon="compass"
            title="1단계 지역 진단 — 왜 이 지역인가"
            desc="소비저조도·소비증감을 0~1로 정규화해 합산한 지역 스코어다. 후보 선정보다 한 단계 앞선 정량 근거이며, 순위는 화면에서 감추지 않는다."
          >
            <BarRank data={eupBars} colors={eupColors} height={200} />
            <p className="u-note mt-3 border-t border-admin-border pt-2.5">
              제안 대상 지역 {target.eup}만 진한 색으로 표시했다. 막대 길이는 지역 스코어이며, 값이
              클수록 소비가 저조하거나 감소 폭이 크다는 뜻이다.
            </p>
          </Section>
        ) : null}

        {/* ── 결정론적 추천 근거와 보조 설명 ───────────────────── */}
        <Section
          id="evidence"
          icon="sparkle"
          title="추천 근거와 리스크 설명"
          desc="서버가 진행 중인 업무가 없는 후보 중 정량 Score 최상위를 결정론적으로 선택합니다. AI는 비정량 리스크 설명만 보조하며, 숫자·순위·상태는 정본 데이터로 다시 검증합니다."
        >
          <div className="flex flex-col gap-4">
            <Block title="후보 비교">
              <p className="break-keep text-[15px] leading-7 text-admin-text">
                {card.ai.comparison}
              </p>
            </Block>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {card.ai.reasons?.length ? (
                <div className="rounded-xl bg-admin-surface-sunken p-4">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-admin-text">
                    <Icon name="check" size={15} className="text-state-good" />
                    근거
                  </h3>
                  <ul className="mt-2 flex list-disc flex-col gap-2 pl-4">
                    {card.ai.reasons.map((r, i) => (
                      <li key={i} className="break-keep text-[13px] leading-6 text-admin-text-soft">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {card.ai.risks?.length ? (
                <div className="rounded-xl bg-admin-surface-sunken p-4">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-admin-text">
                    <Icon name="warn" size={15} className="text-state-warn" />
                    리스크
                  </h3>
                  <ul className="mt-2 flex list-disc flex-col gap-2 pl-4">
                    {card.ai.risks.map((r, i) => (
                      <li key={i} className="break-keep text-[13px] leading-6 text-admin-text-soft">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* 예상 효과는 시뮬레이션 계열 출력이라 배지 + 고지 문구를 붙인다 (절대 규칙 3) */}
            <div className="rounded-xl bg-admin-primary-soft p-4 ring-1 ring-inset ring-admin-primary-line">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-bold text-admin-primary">예상 효과</h3>
                <AssumptionBadge />
                {proxyBadge}
              </div>
              <p className="mt-2 break-keep text-[15px] leading-7 text-admin-text">
                {card.ai.expected_effect}
              </p>
              <AssumptionNote className="mt-2" />
            </div>
          </div>
        </Section>

        {/* ── 원 Score 순위 (절대 규칙 5) ──────────────────────── */}
        {card.ai.original_ranking?.length ? (
          <Section
            icon="scale"
            title="원 Score 순위 (정량 기준)"
            desc="2단계 후보 스코어의 원래 순위입니다. 진행 중인 업무로 제외된 상위 후보와 최종 선택 가능한 후보를 함께 보여 줍니다."
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
            id="location"
            icon="pin"
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
            <p className="u-note mt-3 border-t border-admin-border pt-2.5">
              {target.eup} 하이원포인트 가맹점 {eupMerchants.length}곳 (그중 {target.category}{" "}
              {sameCategoryMerchants}곳) · 후보 반경 500m 내 동일 업종 가맹점{" "}
              {targetCandidate.nearby_merchants}곳 / 동일 업종 상가 {targetCandidate.nearby_same_category_stores}곳.
              지도 표기는 {ANCHOR.name} 기준이며, 지도 저작자 표시는 화면 오른쪽 아래에 있다.
            </p>
          </Section>
        ) : null}

        {/* ── 후보 상세 (거리 병기) ────────────────────────────── */}
        {eupCandidates.length ? (
          <Section
            icon="store"
            title="후보 상세"
            desc="선정 지역의 업종별 대표 후보입니다. 업종공백도는 반경 500m 내 동일 업종 상가를 분모로 베이지안 보정하며, 순서는 정량 Score 순이고 도로 값으로 다시 정렬하지 않습니다."
          >
            <div className="u-scroll-x">
              <table className="u-table min-w-[680px]">
                <thead>
                  <tr>
                    <th scope="col">후보</th>
                    <th scope="col" className="text-right">
                      Score
                    </th>
                    <th scope="col" className="text-right">
                      업종공백도 / 커버리지
                    </th>
                    <th scope="col" className="text-right">
                      표본 신뢰도
                    </th>
                    <th scope="col" className="text-right">
                      동선근접도
                    </th>
                    <th scope="col" className="text-right">
                      기존가맹포화도
                    </th>
                    <th scope="col" className="text-right">
                      반경 500m 내 (동일 업종 가맹점 / 동일 업종 상가)
                    </th>
                    <th scope="col">거점에서의 거리</th>
                  </tr>
                </thead>
                <tbody>
                  {eupCandidates.map((c) => {
                    const isTarget = c.id === targetCandidate?.id;
                    return (
                      <tr key={c.id} data-highlight={isTarget ? "true" : undefined}>
                        <td>
                          <div
                            className={
                              isTarget ? "font-bold text-admin-primary" : "font-semibold text-admin-text"
                            }
                          >
                            {c.category}
                            {isTarget ? (
                              <span className="ml-1.5 whitespace-nowrap rounded-full bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line">
                                이번 제안 후보
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-xs text-admin-text-muted">
                            {c.eup} · {c.name}
                          </div>
                        </td>
                        <td className="text-right font-semibold tabular-nums">
                          {c.score.toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          <span className="block font-semibold text-admin-text">{c.gap.toFixed(2)}</span>
                          <span className="block text-[11px]">커버리지 {(c.market_coverage * 100).toFixed(0)}%</span>
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          {(c.gap_confidence * 100).toFixed(0)}%
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          {c.proximity.toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          {c.saturation.toFixed(2)}
                        </td>
                        <td className="text-right tabular-nums text-admin-text-muted">
                          {c.nearby_merchants}곳 / {c.nearby_same_category_stores}곳
                        </td>
                        {/* 직선·도로를 항상 함께 적는다 — 한쪽만 쓰면 "가장 가깝다"는 오독이 생긴다 (05 §1) */}
                        <td className="whitespace-nowrap tabular-nums">{distanceText(c)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="u-note mt-3 border-t border-admin-border pt-2.5">
              직선거리는 {ANCHOR.name} 좌표와 후보 좌표로 계산한 값이고, 도로 거리·소요시간은 공개
              라우팅 API 추정치로 비포장·임도 구간이 포함될 수 있다. 두 값은 절대 수치가 아니라 후보
              간 상대 비교로만 읽으며, 어느 후보도 “거점에서 가장 가깝다”고 단정하지 않는다.
              동선근접도는 직선거리 기반이라 산악 지형에서 실제 접근성과 역전될 수 있어 도로 값을
              함께 싣는다.
            </p>
          </Section>
        ) : null}

        {/* ── 가맹 전환 시 예상 효과 (EXPANSION 전용) ──────────── */}
        {card.type === "EXPANSION" ? (
          <Section
            id="simulation"
            icon="trend"
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
            id="scenarios"
            icon="gift"
            title="페이백 시나리오 비교"
            badge={
              <>
                <AssumptionBadge />
                {proxyBadge}
              </>
            }
            desc="AI는 세 시나리오를 비교해 제시할 뿐이고, 적용할 페이백률은 담당자가 승인할 때 고른 값만 확정된다."
          >
            <div className="u-scroll-x">
              <table className="u-table min-w-[440px]">
                <thead>
                  <tr>
                    <th scope="col">페이백률</th>
                    {/* 무엇의 개선폭인지 열 이름에 밝힌다 — 인센티브 화면(ScenarioTable)과 같은 라벨 */}
                    <th scope="col">예상 지역 전환율 개선폭</th>
                    <th scope="col">재원 부담</th>
                  </tr>
                </thead>
                <tbody>
                  {card.scenarios.map((s) => (
                    <tr
                      key={s.rate}
                      data-highlight={card.selected_rate === s.rate ? "true" : undefined}
                    >
                      <td className="font-semibold tabular-nums">
                        {s.rate}%
                        {card.selected_rate === s.rate ? (
                          <span className="ml-1.5 whitespace-nowrap rounded-full bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-primary ring-1 ring-inset ring-admin-primary-line">
                            담당자 확정
                          </span>
                        ) : null}
                      </td>
                      {/* delta_pp는 소수 1자리 고정 — 저장소 왕복에서 1.0이 1로 돌아올 여지가 있다 (05 §2) */}
                      <td>
                        <DeltaValue
                          value={s.delta_pp}
                          unit="%p"
                          variant="text"
                          className="font-semibold"
                        />
                      </td>
                      <td className="text-admin-text-muted">{s.budget_note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {card.assumption_note ? (
              <p className="u-note mt-3">{card.assumption_note}</p>
            ) : null}
            <AssumptionNote className="mt-1.5" />
          </Section>
        ) : null}

        {card.status === "pending" ? (
          <Section
            id="decision"
            icon="check"
            title="담당자 결정"
            desc="앞의 근거·위치·효과를 확인한 뒤 결정합니다. AI는 후보와 근거만 제시하며 승인하지 않습니다."
          >
            <div className="rounded-xl bg-admin-primary-soft p-4 ring-1 ring-inset ring-admin-primary-line">
              <p className="mb-3 flex items-start gap-2 text-[13px] leading-6 text-admin-text-soft">
                <Icon name="info" size={14} strokeWidth={2} className="mt-1 shrink-0 text-admin-primary" />
                <span>
                  {card.type === "EXPANSION"
                    ? "검토 시작은 가맹 확정이 아닙니다. 결정 후 정책 카드 관리에서 후보 적격성 5개 항목과 가맹 심사를 이어갑니다."
                    : "확정 페이백률은 담당자가 고른 값만 저장되며, 완료 후에만 방문객 화면의 혜택 배지에 반영됩니다."}
                </span>
              </p>
              <DecisionActions
                cardId={card.id}
                cardType={card.type}
                requireRate={card.type === "INCENTIVE"}
                selectedRate={card.selected_rate ?? null}
              />
              {card.type === "INCENTIVE" ? (
                <p className="u-note mt-2">
                  페이백률(3·5·7%) 선택은{" "}
                  <Link href="/incentive" className="font-semibold text-admin-primary underline-offset-4 hover:underline">
                    인센티브 정책 화면
                  </Link>
                  에서 합니다.
                </p>
              ) : null}
            </div>
          </Section>
        ) : null}

        {/* ── 출처·이력 ───────────────────────────────────────── */}
        <Section
          icon="database"
          title="근거 데이터와 처리 이력"
          desc="이 카드가 어떤 데이터로 만들어졌고 언제 어떤 결정을 거쳤는지."
        >
          <div className="flex flex-wrap gap-1.5">
            {card.sources.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded-full border border-admin-border bg-admin-surface-sunken px-2.5 py-1 text-xs font-medium text-admin-text-muted"
              >
                {s}
              </span>
            ))}
          </div>
          {card.events?.length ? (
            <ol className="mt-4 flex flex-col gap-2 border-l-2 border-admin-border pl-4">
              {card.events.map((e, i) => (
                <li key={i} className="relative flex flex-wrap items-baseline gap-x-2.5 text-[13px]">
                  <span
                    aria-hidden
                    className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-admin-primary-line ring-2 ring-admin-surface"
                  />
                  <span className="tabular-nums text-admin-text-muted">{timeText(e.at)}</span>
                  <span className="font-medium text-admin-text">{eventLabel(e.action)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Section>
      </div>
    </AdminShell>
  );
}

function ReviewStep({ href, step, label, note }: { href: string; step: string; label: string; note: string }) {
  return (
    <li>
      <Link href={href} className="group flex min-h-[68px] items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-admin-primary-soft">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-admin-primary-soft text-xs font-bold text-admin-primary ring-1 ring-inset ring-admin-primary-line">
          {step}
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-admin-text group-hover:text-admin-primary">{label}</span>
          <span className="mt-0.5 block text-[10px] leading-4 text-admin-text-muted">{note}</span>
        </span>
      </Link>
    </li>
  );
}

function OperationsSummary({ card }: { card: Card }) {
  const operations = card.operations;
  const fields = [
    ["담당자", operations?.owner],
    ["목표일", operations?.target_date],
    ["예상 비용", operations?.expected_cost],
    ["접촉 결과", operations?.contact_result],
    ["부적격 사유", operations?.ineligible_reason],
    ["완료 후 실제 성과", operations?.actual_outcome],
  ] as const;
  return (
    <section aria-labelledby={`operations-${card.id}`} className="border-t border-admin-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`operations-${card.id}`} className="text-sm font-bold text-admin-text">운영 기록</h2>
        <span className="u-note">예상 효과와 실제 성과를 분리해 기록합니다.</span>
      </div>
      <dl className="mt-3 grid grid-cols-1 border-y border-admin-border sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([label, value], index) => (
          <div
            key={label}
            className={`min-w-0 py-3 sm:px-3 ${index === 0 ? "sm:pl-0" : ""} ${index % 3 !== 2 ? "lg:border-r lg:border-admin-border" : ""}`}
          >
            <dt className="text-xs font-semibold text-admin-text-muted">{label}</dt>
            <dd className={`mt-1 break-keep text-[13px] ${value ? "font-medium text-admin-text" : "text-admin-text-muted"}`}>
              {value || "아직 입력되지 않음"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
        {title}
      </h3>
      <div className="mt-1.5">{children}</div>
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
  const canonicalStraight = Number.isFinite(c.straight_distance_km)
    ? c.straight_distance_km
    : anchorKm(c.lat, c.lng);
  const straight = `직선 ${canonicalStraight.toFixed(2)}km`;
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
