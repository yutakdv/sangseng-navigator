import type { ReactNode } from "react";
import Link from "next/link";
import { AssumptionBadge, AssumptionNote, ProxyBadge } from "@/components/Badge";
import { DecisionActions } from "@/components/DecisionActions";
import { Icon } from "@/components/Icon";
import { RankTrace } from "@/components/RankTrace";
import { RegionDiagnosticMap } from "@/components/RegionDiagnosticMap";
import type { RegionCenter } from "@/lib/geo";
import type { Card, EupScore } from "@/types";

/**
 * "이번 분기 핵심 제안" 히어로 (docs/plan/13 §3 — 목업 image-1의 히어로 블록).
 *
 * 허브의 승인 대기 1순위 카드를 목록 위로 승격시킨다. 목록만 있던 화면에서는 "지금 무엇을
 * 결정해야 하는가"가 카드 여덟 장 중 하나로 묻혀 있었다.
 *
 * 면 처리를 어둡게 하지 않은 이유: 목업 히어로는 연보라 그라디언트 위 검은 글자다.
 * 히어로를 다크로 깔면 그 안의 지역 개념도가 인디고 밝기 램프(13 §7)를 쓸 수 없고,
 * 40px 헤드라인·근거·결정 버튼이 한 카드에 모여 있는 블록에서 대비를 두 번 뒤집게 된다.
 * **크기(8/12 열·화면 첫 장의 40%)와 타이포로 지배**하고 색은 절제한다.
 *
 * 규정 유지:
 * - 정량 순위 병기(절대 규칙 5)는 히어로에서도 그대로 (`RankTrace`)
 * - 예상 효과 블록에는 `가정 기반 전망` 배지 + 고지 문구 고정 (절대 규칙 3)
 * - 결정 버튼 옆에 "AI는 제안까지" 고지 고정 (절대 규칙 4)
 * - `근사 지표`는 INCENTIVE 카드에서만 — EXPANSION의 예상 효과는 지역 소비 집중도라
 *   같은 배지를 붙이면 다른 지표에 근사 고지를 다는 셈이 된다 (카드 상세와 동일한 판단)
 */
export function HeroProposal({
  card,
  proxyNote,
  ranking,
  selectedEups,
  shares,
  centers,
}: {
  card: Card;
  proxyNote?: string;
  ranking: EupScore[];
  selectedEups: string[];
  shares: Record<string, number>;
  /** 지역 6종 지도 좌표 — 가맹점 좌표의 중심 (lib/geo.ts). 서버에서 6개로 줄여 넘긴다 */
  centers: RegionCenter[];
}) {
  const isExpansion = card.type === "EXPANSION";
  const proxyBadge = !isExpansion && proxyNote ? <ProxyBadge note={proxyNote} /> : null;
  const original = card.ai.original_ranking ?? [];
  // `original_ranking[].candidate`는 "영월군 음식점" 형식이라 target으로 같은 문자열을 만든다
  const targetLabel = card.target ? `${card.target.eup} ${card.target.category}` : null;

  return (
    <section
      aria-label="이번 분기 핵심 제안"
      className="animate-rise relative isolate overflow-hidden rounded-hero bg-gradient-to-br from-admin-primary-soft via-admin-surface to-admin-surface shadow-float ring-1 ring-inset ring-admin-primary-line lg:col-span-8"
    >
      {/* 은은한 인디고 광원 — 히어로가 다른 패널과 같은 흰 면으로 읽히지 않게 하는 최소 장치 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-32 -z-10 h-80 w-80 rounded-full bg-admin-primary/15 blur-3xl"
      />

      <div className="grid grid-cols-1 gap-x-8 gap-y-7 p-6 sm:p-8 2xl:p-10 lg:grid-cols-12">
        {/* ── 결정 대상 ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-primary px-3 py-1 text-xs font-bold text-white shadow-[0_6px_16px_-6px_rgb(79_70_229)]">
              <Icon name="sparkle" size={13} strokeWidth={2} />
              이번 분기 핵심 제안
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-admin-surface px-2.5 py-1 text-xs font-semibold text-admin-text-muted ring-1 ring-inset ring-admin-border">
              <Icon name={isExpansion ? "store" : "gift"} size={13} />
              {isExpansion ? "공급 측 · 가맹점 확충" : "수요 측 · 페이백 인센티브"}
            </span>
            <span className="rounded-md bg-admin-surface px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-admin-text-muted ring-1 ring-inset ring-admin-border">
              {card.id}
            </span>
          </div>

          <h2 className="u-hero-title mt-4 text-admin-text">{card.title}</h2>

          {/* 후보 비교 요약 — 문장을 잘라 헤드라인처럼 쓰지 않는다. AI가 쓴 문단임이 라벨로 읽혀야
              담당자가 "이건 AI의 서술"과 "이건 계약 필드 값"을 구분한다 */}
          {card.ai.comparison ? (
            <div className="mt-3.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-admin-text-muted">
                <Icon name="sparkle" size={12} strokeWidth={2} />
                AI 후보 비교 요약
              </h3>
              <p className="u-copy mt-1.5 line-clamp-3 max-w-[62ch]">{card.ai.comparison}</p>
            </div>
          ) : null}

          <dl className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[13px]">
            <HeroMeta icon="pin" label="대상">
              {card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통"}
            </HeroMeta>
            {/* 카드별 상/중/하 — 13 §2-3이 금지한 화면 전체 "AI 신뢰도 N%"와 다른 값이라 라벨을 분리한다 */}
            <HeroMeta icon="shield" label="신뢰도">
              {card.confidence}
            </HeroMeta>
            <HeroMeta icon="database" label="근거 데이터">
              {card.sources.length}종
            </HeroMeta>
          </dl>

          {/* 절대 규칙 5 — 원래 정량 순위를 히어로에서도 감추지 않는다 */}
          <div className="mt-5">
            <RankTrace card={card} size="md" />
          </div>

          {card.ai.expected_effect ? (
            <div className="mt-4 rounded-2xl bg-admin-surface p-4 shadow-card ring-1 ring-inset ring-admin-primary-line 2xl:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-admin-primary">
                  <Icon name="bolt" size={13} strokeWidth={2} />
                  따르면 어떻게 되는가
                </h3>
                <AssumptionBadge />
                {proxyBadge}
              </div>
              <p className="mt-2.5 break-keep text-[15px] font-medium leading-[1.7] text-admin-text 2xl:text-base">
                {card.ai.expected_effect}
              </p>
              <AssumptionNote className="mt-2.5" />
            </div>
          ) : null}

          {/* ── 결정 ──────────────────────────────────────────── */}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-admin-border pt-5">
            {/* INCENTIVE 승인은 페이백률 선택이 필수라 허브에서 바로 승인할 수 없다 (05 §2) */}
            {isExpansion ? (
              <DecisionActions cardId={card.id} />
            ) : (
              <Link
                href="/incentive"
                className="inline-flex items-center gap-1.5 rounded-xl bg-admin-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-8px_rgb(79_70_229)] transition-colors hover:bg-admin-primary-strong"
              >
                페이백률 고르고 승인하기
                <Icon name="arrowRight" size={16} strokeWidth={2} />
              </Link>
            )}
            <Link
              href={`/cards/${card.id}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-admin-surface px-4 py-2.5 text-sm font-bold text-admin-primary ring-1 ring-inset ring-admin-primary-line transition-colors hover:bg-admin-primary-soft"
            >
              AI 제안 상세 보기
              <Icon name="arrowRight" size={16} strokeWidth={2} />
            </Link>
          </div>

          {/* 절대 규칙 4 — AI 출력이 곧바로 확정되지 않는다는 사실을 결정 버튼 옆에 고정한다 */}
          <p className="u-note mt-3 flex items-start gap-1.5">
            <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
            <span>
              AI는 후보 비교와 근거까지만 제시합니다. 카드는 담당자 승인을 거쳐야 확정되며, 이 화면의
              수치·문구는 의사결정 근거로 쓰입니다.
            </span>
          </p>
        </div>

        {/* ── 어디가 문제인가 ───────────────────────────────────── */}
        <div className="flex min-w-0 flex-col lg:col-span-5">
          <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-admin-text-muted">
            <Icon name="map" size={14} strokeWidth={2} />
            어디가 문제인가 · 1단계 진단
          </h3>
          <div className="mt-3.5">
            <RegionDiagnosticMap
              ranking={ranking}
              selectedEups={selectedEups}
              targetEup={card.target?.eup ?? null}
              shares={shares}
              centers={centers}
            />
          </div>

          {/*
           * 절대 규칙 5 — 히어로는 화면에서 가장 오래 보는 카드이므로 `정량 2위 → AI 1위` 요약뿐
           * 아니라 **원 순위 전체**를 여기서 함께 낸다. 목록의 다른 카드들은 이 표를 이미 병기하고
           * 있는데 정작 1순위 카드만 요약형이면, 가장 검증이 필요한 제안의 근거가 가장 얕아진다.
           */}
          {original.length ? (
            <div className="mt-5 rounded-2xl bg-admin-surface/70 p-4 ring-1 ring-inset ring-admin-border">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-admin-text-muted">
                  원래 정량 Score 순위
                </h4>
                <span className="text-[11px] font-semibold text-admin-text-muted">
                  2단계 후보 스코어 기준
                </span>
              </div>
              <ol className="mt-2.5 flex flex-col gap-1.5">
                {original.map((r) => {
                  const isPick = targetLabel
                    ? r.candidate === targetLabel
                    : r.rank === card.score_rank;
                  return (
                    <li
                      key={`${r.rank}-${r.candidate}`}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] ${
                        isPick ? "bg-admin-primary-soft ring-1 ring-inset ring-admin-primary-line" : ""
                      }`}
                    >
                      <span className="w-4 shrink-0 text-right font-bold tabular-nums text-admin-text-muted">
                        {r.rank}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          isPick ? "font-bold text-admin-primary" : "text-admin-text-soft"
                        }`}
                      >
                        {r.candidate}
                      </span>
                      {/* 색·굵기만으로 구분하지 않는다 (13 §4) — 조정 대상은 문자로도 적는다 */}
                      {isPick && card.ai_rank !== null ? (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-admin-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                          AI 제안 {card.ai_rank}위
                        </span>
                      ) : null}
                      <span className="w-9 shrink-0 text-right font-bold tabular-nums text-admin-text">
                        {r.score.toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function HeroMeta({
  icon,
  label,
  children,
}: {
  icon: "pin" | "shield" | "database";
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} size={15} className="text-admin-text-muted" />
      <dt className="text-admin-text-muted">{label}</dt>
      <dd className="font-bold text-admin-text">{children}</dd>
    </div>
  );
}
