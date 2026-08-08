import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { AssumptionBadge, AssumptionNote, NarrativeSourceChip, ProxyBadge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PaybackCycle } from "@/components/PaybackCycle";
import { PolicyOutcomeGuide } from "@/components/PolicyOutcomeGuide";
import { ScenarioTable } from "@/components/ScenarioTable";
import { Section } from "@/components/Section";
import { ProgressChip, StatusChip } from "@/components/StatusChip";
import { api } from "@/lib/api";
import { cardNarrativeSource } from "@/lib/aiSource";

export const metadata: Metadata = { title: "인센티브 정책 · 상생 나침반" };

// 승인 → 트래킹 → 위젯이 한 루프라 매 요청 최신 카드 상태를 읽는다 (캐시 금지)
export const dynamic = "force-dynamic";

/** KST ISO8601 → "2026-08-04 07:00" (05 §8 — 타임스탬프는 모두 KST) */
const at = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/**
 * ④ 인센티브 정책 카드 (docs/plan/08 F6 · 13 §2-6·§2-13 · 11 데모 8단계).
 *
 * 서버 컴포넌트다 — 카드 데이터는 여기서 읽어 props로 내려주고, 라디오 상태를 드는
 * `ScenarioTable`만 클라이언트다. 승인은 그 안의 `DecisionActions`(Server Action) 경로로만 간다.
 *
 * 수요 측 카드라 EXPANSION과 다른 점이 둘 있다:
 * - `original_ranking`이 null이다 — 후보 순위 비교가 아니라 전 지역 공통 시나리오 비교라서
 *   정량 순위 표를 렌더하지 않는다 (05 §2). 그 사실을 화면에 문장으로 밝힌다
 * - 승인에 `selected_rate`(3|5|7)가 필수다 — 미선택이면 승인 버튼이 비활성이다
 */
export default async function IncentivePage() {
  const [dashboard, { cards }] = await Promise.all([
    api.dashboard(),
    api.cards({ type: "INCENTIVE" }),
  ]);

  // 최신 1장 = 생성 시각 내림차순 첫 카드 (허브에서 새로 생성하면 그 카드가 이 화면의 대상이 된다)
  const card = [...cards].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

  // 비교문·근거 문장을 누가 썼는지 (05 §2) — 카드가 없으면 표기할 문장 자체가 없다
  const narrativeSource = card ? cardNarrativeSource(card) : null;

  // 손익 대비 패널용 — 최근 3개월 평균 입장 연인원(교대 합산). 개선폭(%p)을 월 건수로 환산하는 분모다.
  // 정확히 3개월이 안 되면 패널을 그리지 않는다 — "최근 3개월 평균"이라는 문구가 거짓이 되기 때문.
  // 기간 라벨은 연-월을 온전히 적는다: 연도를 자르면 해가 바뀌는 창(2025-11~2026-01)이 거꾸로 읽힌다.
  const recentMonthly = (dashboard.conversion.monthly ?? []).slice(-3);
  const avgVisitors =
    recentMonthly.length === 3
      ? recentMonthly.reduce((a, m) => a + m.visitors, 0) / recentMonthly.length
      : null;
  const visitorsBasis =
    recentMonthly.length === 3 ? `${recentMonthly[0].month}~${recentMonthly[2].month}` : "";

  // "지역 전환율"이 보이는 모든 위치에 붙인다 (절대 규칙 2) — note는 요약 없이 그대로 노출
  const proxyBadge = dashboard.conversion.is_proxy ? (
    <ProxyBadge note={dashboard.conversion.proxy_note} />
  ) : null;

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <PageHeader
          icon="gift"
          eyebrow="수요 측 정책"
          title="인센티브 정책 카드"
          lede="공급 측(가맹점 확충)에 이어 수요 측 카드입니다. AI는 페이백률 3·5·7% 시나리오를 비교해 제시하고, 확정 페이백률은 담당자가 고른 값만 저장됩니다."
        />

        {!card ? (
          <Section
            icon="gift"
            title="인센티브 카드가 아직 없습니다"
            desc="이 화면은 가장 최근에 생성된 INCENTIVE 카드 1장을 보여줍니다."
          >
            <p className="u-body">
              카드 생성은 허브에서 합니다 — Action Card 허브의 &ldquo;이번 분기 카드 생성&rdquo;에서
              인센티브 카드를 만들면 이 화면에 시나리오 비교 표와 승인 UI가 나타납니다.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-admin-primary-strong"
            >
              Action Card 허브로 가기
              <Icon name="arrowRight" size={15} strokeWidth={2} />
            </Link>
          </Section>
        ) : (
          <>
            {/* ── 카드 헤더 ─────────────────────────────────────── */}
            <article className="u-panel overflow-hidden">
              <div className="border-b border-admin-border bg-admin-surface-sunken p-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-md bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-admin-text-muted ring-1 ring-inset ring-admin-border">
                    {card.id}
                  </span>
                  <StatusChip status={card.status} />
                  {card.progress ? <ProgressChip progress={card.progress} /> : null}
                </div>

                <h2 className="mt-2 break-keep text-[20px] font-bold leading-7 text-admin-text sm:text-[22px] sm:leading-8">
                  {card.title}
                </h2>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-admin-text-muted">
                  {/* INCENTIVE는 target이 없다 — 전 지역 공통 적용이 기획 원칙 (13 §2-6) */}
                  <span className="flex items-center gap-1.5">
                    <Icon name="pin" size={14} />
                    대상 <b className="font-semibold text-admin-text">전 지역 공통</b>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon name="shield" size={14} />
                    신뢰도 <b className="font-semibold text-admin-text">{card.confidence}</b>
                  </span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <Icon name="clock" size={14} />
                    생성 {at(card.created_at)}
                  </span>
                  {card.decided_at ? (
                    <span className="tabular-nums">결정 {at(card.decided_at)}</span>
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

              <div className="p-4 sm:p-6">
                {/* 05 §2 표현 규칙 — 적립이 아니라 사용 단계 정책임을 카드 최상단에서 못 박는다 */}
                <p className="u-body">
                  이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만 붙는{" "}
                  <b className="font-semibold">사용 단계 리워드</b>입니다. 적립률을 건드리지 않으므로
                  콤프 발행액은 늘지 않습니다.
                </p>

                {card.status === "approved" ? (
                  <Link
                    href="/tracking"
                    className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-admin-primary underline-offset-4 hover:underline"
                  >
                    추진 상태 관리하기
                    <Icon name="arrowRight" size={14} strokeWidth={2} />
                  </Link>
                ) : null}
              </div>
            </article>

            {/* ── 시나리오 비교 + 승인 ──────────────────────────── */}
            <Section
              icon="scale"
              title="페이백률 시나리오 비교"
              badge={
                <>
                  <AssumptionBadge />
                  {proxyBadge}
                </>
              }
              desc="세 시나리오는 전 지역 공통 적용을 전제로 합니다. 개선폭은 단정하지 않고 범위로 적으며, 재원 부담은 정성 표기입니다(원천 데이터에 금액 필드가 없어 예산·ROI는 산출하지 않습니다)."
            >
              {card.scenarios?.length ? (
                <ScenarioTable
                  cardId={card.id}
                  scenarios={card.scenarios}
                  status={card.status}
                  selectedRate={card.selected_rate ?? null}
                  assumptionNote={card.assumption_note}
                  avgVisitors={avgVisitors}
                  visitorsBasis={visitorsBasis}
                  proxyNote={dashboard.conversion.is_proxy ? dashboard.conversion.proxy_note : undefined}
                />
              ) : (
                <p className="u-body text-admin-text-muted">이 카드에는 비교할 시나리오가 없습니다.</p>
              )}
              <PolicyOutcomeGuide card={card} headlineRate={dashboard.conversion.headline_rate} />
            </Section>

            {/* ── 예상 효과 ─────────────────────────────────────── */}
            <Section
              icon="trend"
              title="예상 효과"
              badge={
                <>
                  <AssumptionBadge />
                  {proxyBadge}
                </>
              }
            >
              <div className="rounded-xl bg-admin-primary-soft p-4 ring-1 ring-inset ring-admin-primary-line">
                <p className="break-keep text-[15px] leading-7 text-admin-text">
                  {card.ai.expected_effect}
                </p>
                <AssumptionNote className="mt-2" dedupeWith={card.ai.expected_effect} />
              </div>
            </Section>

            {/* ── 순환 구조 ─────────────────────────────────────── */}
            <Section
              icon="compass"
              title="페이백 순환 구조"
              desc="적립 → 외부 사용 → 페이백 → 재사용. 이 카드가 손대는 구간이 어디인지 보여줍니다."
            >
              <PaybackCycle rate={card.selected_rate ?? null} />
            </Section>

            {/* ── 근거 전문 ─────────────────────────────────────── */}
            {/* 제목이 출처를 단정하지 않는다 — 시드·폴백 카드의 비교문은 AI가 쓴 문장이 아니다.
                출처는 칩 하나가 말하고, 설명 문단은 그 값에 따라 갈린다 (05 §2) */}
            <Section
              icon="sparkle"
              title="시나리오 비교문"
              badge={<NarrativeSourceChip kind={narrativeSource} />}
              desc={
                narrativeSource === "ai" || narrativeSource === "ai_partial"
                  ? "AI 출력은 제안입니다. 확정은 담당자 승인을 거치며, AI의 역할은 의사결정 근거 제공입니다."
                  : "이 비교문은 서버 규칙으로 작성했습니다. 확정은 담당자 승인을 거치며, 시스템의 역할은 의사결정 근거 제공입니다."
              }
            >
              <p className="u-body">{card.ai.comparison}</p>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-xl bg-admin-surface-sunken p-4">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-admin-text">
                    <Icon name="check" size={15} className="text-state-good" />
                    권고 근거
                  </h3>
                  <ul className="mt-2 flex list-disc flex-col gap-2 break-keep pl-4 text-[13px] leading-6 text-admin-text-soft">
                    {/* LLM 출력이라 중복 문자열이 가능 — 내용 키 대신 인덱스 키 (cards/[id]와 동일) */}
                    {card.ai.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-admin-surface-sunken p-4">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-admin-text">
                    <Icon name="warn" size={15} className="text-state-warn" />
                    리스크
                  </h3>
                  <ul className="mt-2 flex list-disc flex-col gap-2 break-keep pl-4 text-[13px] leading-6 text-admin-text-soft">
                    {card.ai.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 정량 순위 병기 원칙(절대 규칙 5)의 예외가 아니라, 병기할 순위가 없는 카드다 */}
              <p className="u-note mt-4 border-t border-admin-border pt-3">
                이 카드는 후보 간 순위 비교가 아니라 전 지역 공통 시나리오 비교라 정량 순위 표가
                없습니다. 순위 병기는 대상 후보가 있는 가맹점 확충 카드에서 합니다. 근거 데이터:{" "}
                {card.sources.join(" · ")}
              </p>
            </Section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
