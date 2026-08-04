import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { AssumptionBadge, AssumptionNote, ProxyBadge } from "@/components/Badge";
import { PaybackCycle } from "@/components/PaybackCycle";
import { ScenarioTable } from "@/components/ScenarioTable";
import { Section } from "@/components/Section";
import { ProgressChip, StatusChip } from "@/components/StatusChip";
import { api } from "@/lib/api";

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

  // "지역 전환율"이 보이는 모든 위치에 붙인다 (절대 규칙 2) — note는 요약 없이 그대로 노출
  const proxyBadge = dashboard.conversion.is_proxy ? (
    <ProxyBadge note={dashboard.conversion.proxy_note} />
  ) : null;

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-admin-text">인센티브 정책 카드</h2>
          <p className="mt-0.5 break-keep text-sm text-admin-text-muted">
            공급 측(가맹점 확충)에 이어 수요 측 카드입니다. AI는 페이백률 3·5·7% 시나리오를 비교해
            제시하고, 확정 페이백률은 담당자가 고른 값만 저장됩니다.
          </p>
        </div>

        {!card ? (
          <Section
            title="인센티브 카드가 아직 없습니다"
            desc="이 화면은 가장 최근에 생성된 INCENTIVE 카드 1장을 보여줍니다."
          >
            <p className="break-keep text-sm leading-6 text-admin-text">
              카드 생성은 허브에서 합니다 — Action Card 허브의 &ldquo;이번 분기 카드 생성&rdquo;에서
              인센티브 카드를 만들면 이 화면에 시나리오 비교 표와 승인 UI가 나타납니다.
            </p>
            <Link
              href="/"
              className="mt-3 inline-block rounded-lg bg-admin-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-admin-sidebar-active"
            >
              Action Card 허브로 가기 →
            </Link>
          </Section>
        ) : (
          <>
            {/* ── 카드 헤더 ─────────────────────────────────────── */}
            <article className="rounded-card border border-black/5 bg-admin-surface p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs tabular-nums text-admin-text-muted">{card.id}</span>
                <h3 className="min-w-0 break-keep text-base font-semibold text-admin-text">
                  {card.title}
                </h3>
                <StatusChip status={card.status} />
                {card.progress ? <ProgressChip progress={card.progress} /> : null}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-admin-text-muted">
                {/* INCENTIVE는 target이 없다 — 전 지역 공통 적용이 기획 원칙 (13 §2-6) */}
                <span>대상 전 지역 공통</span>
                <span>
                  신뢰도 <span className="font-medium text-admin-text">{card.confidence}</span>
                </span>
                <span>생성 {at(card.created_at)}</span>
                {card.decided_at ? <span>결정 {at(card.decided_at)}</span> : null}
                {card.selected_rate ? (
                  <span>
                    확정 페이백률{" "}
                    <span className="font-medium text-admin-text">{card.selected_rate}%</span>
                  </span>
                ) : null}
              </div>

              {/* 05 §2 표현 규칙 — 적립이 아니라 사용 단계 정책임을 카드 최상단에서 못 박는다 */}
              <p className="mt-2 break-keep text-xs leading-5 text-admin-text-muted">
                이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만 붙는{" "}
                <b className="font-medium text-admin-text">사용 단계 리워드</b>입니다. 적립률을
                건드리지 않으므로 콤프 발행액은 늘지 않습니다.
              </p>

              {card.status === "approved" ? (
                <Link
                  href="/tracking"
                  className="mt-3 inline-block text-xs font-medium text-admin-primary underline-offset-2 hover:underline"
                >
                  추진 상태 관리하기 →
                </Link>
              ) : null}
            </article>

            {/* ── 시나리오 비교 + 승인 ──────────────────────────── */}
            <Section
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
                />
              ) : (
                <p className="text-sm text-admin-text-muted">
                  이 카드에는 비교할 시나리오가 없습니다.
                </p>
              )}
            </Section>

            {/* ── 예상 효과 ─────────────────────────────────────── */}
            <Section
              title="예상 효과"
              badge={
                <>
                  <AssumptionBadge />
                  {proxyBadge}
                </>
              }
            >
              <p className="break-keep text-sm leading-6 text-admin-text">
                {card.ai.expected_effect}
              </p>
              <AssumptionNote className="mt-2" />
            </Section>

            {/* ── 순환 구조 ─────────────────────────────────────── */}
            <Section
              title="페이백 순환 구조"
              desc="적립 → 외부 사용 → 페이백 → 재사용. 이 카드가 손대는 구간이 어디인지 보여줍니다."
            >
              <PaybackCycle rate={card.selected_rate ?? null} />
            </Section>

            {/* ── AI 근거 전문 ──────────────────────────────────── */}
            <Section
              title="AI 시나리오 비교문"
              desc="AI 출력은 제안입니다. 확정은 담당자 승인을 거치며, AI의 역할은 의사결정 근거 제공입니다."
            >
              <p className="break-keep text-sm leading-6 text-admin-text">{card.ai.comparison}</p>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="text-xs font-semibold text-admin-text">권고 근거</h4>
                  <ul className="mt-1.5 flex list-disc flex-col gap-1.5 break-keep pl-4 text-xs leading-5 text-admin-text">
                    {card.ai.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-admin-text">리스크</h4>
                  <ul className="mt-1.5 flex list-disc flex-col gap-1.5 break-keep pl-4 text-xs leading-5 text-admin-text">
                    {card.ai.risks.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 정량 순위 병기 원칙(절대 규칙 5)의 예외가 아니라, 병기할 순위가 없는 카드다 */}
              <p className="mt-4 break-keep border-t border-black/5 pt-3 text-[11px] leading-4 text-admin-text-muted">
                이 카드는 후보 간 순위 비교가 아니라 전 지역 공통 시나리오 비교라 정량 순위 표가
                없습니다(`original_ranking` = null, 05 §2). 순위 조정 병기는 가맹점 확충 카드에서
                합니다. 근거 데이터: {card.sources.join(" · ")}
              </p>
            </Section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
