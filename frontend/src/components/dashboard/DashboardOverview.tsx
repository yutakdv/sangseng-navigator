import Link from "next/link";
import { AssumptionBadge, ProxyBadge } from "@/components/Badge";
import { GenerateCardButton } from "@/components/GenerateCardButton";
import { Icon } from "@/components/Icon";
import { Act, PanelLink } from "@/components/Panel";
import { QuarterDiagnostics } from "@/components/dashboard/QuarterDiagnostics";
import { StatusBar } from "@/components/dashboard/StatusBar";
import { WorkQueue } from "@/components/dashboard/WorkQueue";
import { ProposalSummary } from "@/components/proposals/ProposalSummary";
import { SourceChip } from "@/components/SourceChip";
import { datasetVersion, isMockMode } from "@/lib/api";
import { isExecutionStage, isStartStage, sampleQuality } from "@/lib/cardWorkflow";
import { dataFreshness } from "@/lib/dataFreshness";
import { operatorGreeting } from "@/lib/operator";
import type { Card, CardType, Dashboard, EupScore, Kpi } from "@/types";

type StatusCounts = { waiting: number; running: number; done: number; held: number; rejected: number };

/**
 * 허브 상단 — "판단하고 움직이는" 두 층.
 *
 *   1층  얇은 sticky 상태 바 + 전환율 헤드라인 + 접이식 분기 진단  ← 몇 건 남았나 + 분기 맥락 한 줄
 *   2층  좌 60% 미리보기 / 우 40% 작업 목록 3단계      ← 마스터-디테일
 *   3층  결정 이력 · 실행 현황 (`children`으로 받는다)   ← 모니터링
 *
 * **2층이 마스터-디테일이다.** 우측 목록의 줄을 누르면 페이지가 바뀌는 게 아니라 좌측
 * 미리보기가 그 카드로 갈린다(`?selected=`). 담당자가 대기 건을 나란히 비교하는 것이 이
 * 화면의 목적이라, 상세로 들어갔다 나오는 왕복을 없앴다. 상세로 가는 길은 좌측 카드의
 * "근거·전망 검토하기" 버튼 하나뿐이다.
 *
 * 3층을 `children`으로 받는 이유는 레이아웃 때문이다: `position: sticky`는 부모 박스 안에서만
 * 붙어 있으므로, 상태 바가 페이지 끝까지 따라오려면 1·2·3층이 **한 섹션 안**에 있어야 한다.
 */
export function DashboardOverview({
  dashboard,
  kpi,
  selected,
  heroId,
  queue,
  inProgress,
  completed,
  ranking,
  regionInsight,
  scoreTopLine,
  activeType,
  generateType,
  statusCounts,
  children,
}: {
  dashboard: Dashboard;
  kpi: Kpi;
  /** 지금 좌측에 뜬 카드 — `?selected=`가 없으면 오늘 검토 1순위 */
  selected?: Card;
  /** 오늘 검토 1순위 카드 id — 선택과 무관하게 목록에서 배지로 표시한다 */
  heroId?: string;
  /** 대기 중 카드 전체 — 결정 블록이 그리는 목록이자 statusCounts.waiting의 근거 */
  queue: Card[];
  /** 승인 후 완료 전 — 실행 관리 블록이자 statusCounts.running의 근거 */
  inProgress: Card[];
  /** 완료 — 방문객 화면에 반영되는 카드이자 statusCounts.done의 근거 */
  completed: Card[];
  ranking: EupScore[];
  /** 선택된 카드 기준 판독 문장 — 허브에서는 이 한 줄이 차트를 대신한다 */
  regionInsight: string;
  /** 읍·시 스코어 상위 3곳 한 줄 요약 (1단계 지역 진단 — 절대 규칙 5의 텍스트 병기) */
  scoreTopLine: string;
  activeType: CardType | null;
  generateType: CardType;
  statusCounts: StatusCounts;
  /** 3층(결정 이력·실행 현황) — sticky 상태 바의 부모 박스를 페이지 전체로 넓히기 위해 여기서 받는다 */
  children?: React.ReactNode;
}) {
  const totalUses = (dashboard.region_share ?? []).reduce((sum, row) => sum + row.count, 0);
  const freshness = dataFreshness(dashboard.period_note);
  const quality = sampleQuality(kpi.counts.decided);
  const qualityLabel = quality === "demo" ? "예시 데이터" : quality === "limited" ? "표본 보강 필요" : "운영 표본";
  const filterNote =
    activeType === "EXPANSION"
      ? "가맹점 확충 카드만 보고 있습니다."
      : activeType === "INCENTIVE"
        ? "페이백 인센티브 카드만 보고 있습니다."
        : "확충·인센티브 카드 모두.";

  /** 줄을 눌렀을 때 갈아 끼울 쿼리 — 종류 필터가 걸려 있으면 함께 보존한다 */
  const hrefFor = (cardId: string) => {
    const params = new URLSearchParams();
    if (activeType) params.set("type", activeType);
    params.set("selected", cardId);
    return `/?${params.toString()}`;
  };

  const isLead = selected?.id === heroId;
  const isExpansion = selected?.type === "EXPANSION";

  // 6스텝 흐름의 STEP4(검토 시작)·STEP5(적격성·실행)가 둘 다 이 목록으로 떨어진다.
  // 목록 설명에 같은 기준으로 나눈 건수를 적어, 스텝 배지 숫자를 도착지에서 확인할 수 있게 한다.
  const startStageCount = inProgress.filter(isStartStage).length;
  const executionStageCount = inProgress.filter(isExecutionStage).length;

  return (
    <section aria-labelledby="dashboard-title" className="flex flex-col gap-6">
      {/* ── 문서 머리말 — 관보식 상단 괘선 + 발행 정보 ── */}
      <header className="border-t-2 border-lavender-950">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-admin-border py-3">
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs font-bold text-admin-text">
            상생 나침반
            <span className="font-semibold text-admin-text-muted">분기 지역상생 의사결정 브리프</span>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-admin-text-muted">
            <span className="tabular-nums">기준 {dashboard.period_note}</span>
            <span className="rounded-full border border-lavender-200 bg-lavender-50 px-2.5 py-0.5 font-bold text-lavender-700">
              {isMockMode ? "데모 운영" : "실시간 운영"}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-5 pt-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            {/* 인사 줄과 본문 줄은 크기·굵기·색이 같은 한 덩어리의 제목이라 h1 안에 함께 둔다 */}
            <h1
              id="dashboard-title"
              className="break-keep text-[27px] font-bold leading-[1.25] tracking-[-0.035em] text-lavender-950 sm:text-[32px] xl:text-[36px]"
            >
              <span className="block">{operatorGreeting}</span>
              오늘 결정할 사안을 확인합니다
            </h1>
            <p className="mt-2.5 max-w-2xl break-keep text-sm leading-7 text-admin-text-soft sm:text-[15px]">
              강원랜드 하이원포인트(방문객이 적립해 지역 가맹점에서 쓰는 포인트)의 소비가
              석탄산업전환지역(구 폐광지역) 4개 시군 어디에 쏠렸는지 진단하고, 이번 분기 가맹점 확충과 인센티브를 결정합니다.
            </p>
            <p className="mt-1.5 max-w-2xl break-keep text-[13px] leading-6 text-admin-text-muted">
              AI 제안은 결론이 아닙니다 — 근거와 예상 효과를 상세에서 확인한 뒤 담당자가 결정합니다.
              포인트 적립률·발행액은 그대로 두고, 이미 적립된 포인트의 지역 사용만 다룹니다.
            </p>

            {/* 임팩트 히어로 — 심사위원이 30초 안에 "무엇을 얼마나 바꾸나"를 읽는 한 줄 (v4.1 Phase 4).
                화면에 그리는 숫자는 impact_meta.per_pp_additional_uses 하나뿐이다. 구형 응답에는
                필드가 없을 수 있어 가드로 감싼다. */}
            {dashboard.impact_meta ? (
              // <p>가 아니라 <div>다 — 애초에 flex 컨테이너로 쓰고 있어 의미상으로도 맞고,
              // 안의 SourceChip 팝오버가 <ul>을 그려 <p> 자식으로 두면 브라우저가 <p>를 조기
              // 종료시켜 하이드레이션이 깨진다(HTML은 <p> 안에 <ul>을 허용하지 않는다).
              <div
                data-tour="impact-hero"
                className="mt-3 flex max-w-2xl flex-wrap items-center gap-2 break-keep text-[15px] leading-relaxed text-admin-text"
              >
                <span>
                  지역 전환율을 <strong className="font-bold">1%p</strong> 끌어올리면 연간 지역 사용이
                  약{" "}
                  <strong
                    className="font-bold text-admin-primary"
                    title={dashboard.impact_meta.note}
                  >
                    +{(dashboard.impact_meta.per_pp_additional_uses / 10000).toFixed(1)}만 건
                  </strong>{" "}
                  늘어날 것으로 추정됩니다
                </span>
                <ProxyBadge note={dashboard.conversion.proxy_note} />
                <AssumptionBadge />
                <SourceChip
                  label={`하이원포인트 사용현황 · ${freshness.sourceMonth ?? dashboard.period_note} 외 2종`}
                  datasets={["하이원포인트 사용현황(월별)", "일자별 카지노 입장객", "가맹점 상세정보"]}
                  baseNote={dashboard.period_note}
                  approx
                  version={datasetVersion()}
                  privacy={dashboard.privacy_meta}
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-col items-start gap-3 xl:shrink-0 xl:items-end">
            <GenerateCardButton
              type={generateType}
              label={generateType === "INCENTIVE" ? "실시간 인센티브 제안 생성" : "실시간 확충 제안 생성"}
            />
            <p className="text-xs text-admin-text-muted">대표 사례와 별도로 현재 데이터에서 새 제안을 만듭니다.</p>
          </div>
        </div>
      </header>

      {/* ── 1층 — 얇은 sticky 상태 바 + 접이식 분기 진단 ── */}
      <StatusBar
        waiting={statusCounts.waiting}
        running={statusCounts.running}
        done={statusCounts.done}
        held={statusCounts.held}
        rejected={statusCounts.rejected}
        /* 전환율은 접힘 상태에서도 보여야 한다 (01 문서 "절대 자르지 않는 것" · 데모 1단계).
           숫자와 `근사 지표` 배지는 한 inline-flex에 묶어 줄바꿈에서도 떨어지지 않게 한다 (절대 규칙 2) */
        headline={
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="text-admin-text-muted">지역 전환율</span>
            <span className="inline-flex items-center gap-x-1.5 whitespace-nowrap">
              <span className="text-[15px] font-bold leading-none tabular-nums text-admin-text">
                {dashboard.conversion.headline_rate.toFixed(1)}%
              </span>
              {dashboard.conversion.is_proxy ? <ProxyBadge note={dashboard.conversion.proxy_note} /> : null}
            </span>
          </span>
        }
        diagnostics={<QuarterDiagnostics dashboard={dashboard} kpi={kpi} totalUses={totalUses} />}
      />

      {/* ── 2층 — 좌 60% 미리보기 / 우 40% 작업 목록 ── */}
      {/* #proposal — PolicyFlow의 "제안 검토" 스텝이 돌아오는 앵커 */}
      <div id="proposal" className="scroll-mt-24">
        <Act no="01" phase="결정" question="오늘 무엇을 처리하는가" title="최우선 제안과 대기 목록">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* self-start — 우측 목록이 3블록으로 길어져도 이 카드가 늘어나 빈 면이 생기지 않게 한다 */}
            <article
              aria-live="polite"
              className="relative min-w-0 overflow-hidden rounded-panel bg-admin-surface shadow-lift lg:col-span-3 lg:self-start"
            >
              {selected ? (
                <div className="p-5 sm:p-7">
                  <ProposalSummary
                    card={selected}
                    ranking={ranking}
                    dashboard={dashboard}
                    leadBadge={
                      isLead ? (
                        <span className="rounded-md bg-admin-primary px-2.5 py-1 text-xs font-bold text-white">
                          오늘 검토 1순위
                        </span>
                      ) : (
                        <span className="rounded-md border border-lavender-200 bg-lavender-50 px-2.5 py-1 text-xs font-bold text-lavender-700">
                          선택한 제안
                        </span>
                      )
                    }
                  />

                  {/* 근거 미리보기 — 지역·업종 판독은 대상 지점이 있는 확충 카드에만 뜻이 있다.
                      인센티브는 위 시나리오 요약이 그 역할을 한다 */}
                  {isExpansion ? (
                    <div className="mt-5 border-t border-lavender-100 pt-4">
                      <p className="text-xs font-bold text-admin-text-muted">근거 미리보기 · 차트와 지도는 상세에서</p>
                      <ul className="mt-2 space-y-1.5">
                        <li className="flex items-start gap-2 break-keep text-[13px] leading-6 text-admin-text-soft">
                          <Icon name="bolt" size={14} strokeWidth={2} className="mt-1 shrink-0 text-admin-primary" />
                          <span>{regionInsight}</span>
                        </li>
                        <li className="flex items-start gap-2 break-keep text-[13px] leading-6 text-admin-text-soft">
                          <Icon name="scatter" size={14} strokeWidth={2} className="mt-1 shrink-0 text-admin-primary" />
                          <span>
                            읍·시 스코어 상위:{" "}
                            <span className="font-semibold tabular-nums text-admin-text">
                              {scoreTopLine || "산출 전"}
                            </span>
                          </span>
                        </li>
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-lavender-100 pt-5">
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-bold text-admin-text-muted">상세에서 확인할 내용</p>
                        <AssumptionBadge />
                      </div>
                      <p className="mt-1 break-keep text-sm font-semibold leading-6 text-admin-text">
                        {isExpansion
                          ? "근거 차트 → 원 후보 스코어 순위 → 전망 시나리오 → 담당자 결정"
                          : "근거 차트 → 3·5·7% 시나리오 비교 → 담당자 결정"}
                      </p>
                    </div>
                    {/* 상세로 가는 유일한 경로 — 가이드 투어 2단계가 이 href를 읽어 다음 목적지로 쓴다(카드 id가 동적이라
                        nextHrefFromAnchor 방식이 필요하다). WorkQueue 줄은 `?selected=`만 갈아 끼울 뿐 상세로 가지 않는다. */}
                    <Link
                      href={`/proposals/${selected.id}`}
                      data-tour="first-proposal"
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-admin-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-admin-primary-strong"
                    >
                      근거·전망 검토하기
                      <Icon name="arrowRight" size={15} />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[340px] flex-col items-center justify-center p-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-admin-primary text-white">
                    <Icon name="sparkle" size={24} />
                  </span>
                  <h2 className="mt-5 text-2xl font-bold tracking-[-0.02em] text-lavender-950">
                    결정 대기 제안이 없습니다
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-admin-text-muted">
                    새 제안을 만들면 근거, 리스크, 예상 변화가 한 장에 정리됩니다.
                  </p>
                </div>
              )}
            </article>

            {/* 우측 작업 목록 — 결정 → 실행 → 완료. 각 블록의 줄 수 = 상단 띠의 같은 이름 숫자 */}
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
              <WorkQueue
                id="decision-queue"
                title="결정 대기"
                cards={queue}
                leadId={heroId}
                selectedId={selected?.id}
                hrefFor={hrefFor}
                /* 이 목록만 왼쪽 세로 강조 바를 끈다 — 연보라 배경과 우측 체크로 선택이 충분히 읽힌다.
                   실행 관리·완료 목록은 기본값(바 있음)을 그대로 쓴다 */
                accentBar={false}
                badge={
                  <span className="rounded-full bg-state-warn-bg px-2.5 py-1 text-xs font-bold text-state-warn">
                    {qualityLabel}
                  </span>
                }
                /* 종류 필터를 최상단에서 걷어냈으므로, `?type=` 딥링크로 들어온 담당자가
                   필터에 갇히지 않도록 해제 경로를 대기 목록 헤더에 둔다 */
                action={
                  activeType ? (
                    <Link
                      href="/"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-admin-primary transition-colors hover:bg-admin-primary-soft"
                    >
                      <Icon name="cards" size={14} strokeWidth={2} />
                      전체 카드 보기
                    </Link>
                  ) : undefined
                }
                desc={`${filterNote} 줄을 누르면 왼쪽에서 미리볼 수 있습니다.`}
                empty={{
                  title: "결정 대기 카드가 없습니다",
                  body: "위에서 새 제안을 생성하면 이 블록에 쌓입니다.",
                }}
              />

              <WorkQueue
                id="work-queue"
                title="실행 관리"
                cards={inProgress}
                selectedId={selected?.id}
                hrefFor={hrefFor}
                action={<PanelLink href="/tracking">추진 상태 기록</PanelLink>}
                desc={`승인 후 완료 전 카드입니다. 검토 시작 ${startStageCount}건 · 적격성·가맹 심사·추진중 ${executionStageCount}건. 줄을 누르면 왼쪽에서 미리볼 수 있습니다.`}
                empty={{
                  title: "실행 중인 카드가 없습니다",
                  body: "결정 대기 카드를 승인하면 여기로 넘어옵니다.",
                }}
              />

              <WorkQueue
                id="done-queue"
                title="이번 분기 완료"
                cards={completed}
                selectedId={selected?.id}
                hrefFor={hrefFor}
                action={<PanelLink href="/widget">방문객 화면에서 확인</PanelLink>}
                desc="완료된 정책만 방문객 추천·혜택 화면에 노출됩니다."
                empty={{
                  title: "아직 완료된 정책이 없습니다",
                  body: (
                    <>
                      방문객 화면에는 거리순 추천만 노출됩니다.{" "}
                      <Link href="/widget" className="font-semibold text-admin-primary hover:underline">
                        지금 상태 확인하기 →
                      </Link>
                    </>
                  ),
                }}
              />

              <section className="rounded-card bg-admin-surface shadow-card">
                <div className="flex items-center gap-2 border-b border-admin-border px-5 py-4">
                  <Icon name="database" size={16} className="text-admin-primary" />
                  <h2 className="text-[15px] font-bold text-admin-text">데이터 원천 · 공공데이터 6종</h2>
                </div>
                <div className="divide-y divide-admin-border px-5">
                  <SourceRow
                    label="하이원포인트 사용"
                    value={freshness.label}
                    href="https://www.data.go.kr/data/15106402/fileData.do"
                  />
                  <SourceRow
                    label="하이원포인트 가맹점"
                    value="실시간 API 갱신"
                    href="https://www.data.go.kr/data/15133571/openapi.do"
                  />
                  <SourceRow label="상권 후보 원천" value="기준월 · 2026.06" />
                  <SourceRow label="카지노 입장객 (전환율 분모)" value="교대 합산 연인원" />
                  {/* 진단 참고용 배경 정보 — 순위·경고 뉘앙스를 붙이지 않는다 (절대 규칙 6) */}
                  <SourceRow label="국세청 사업자현황 (존속연수별)" value="진단 참고용" />
                  <SourceRow label="기상청 초단기실황" value="방문객 위젯 전용" />
                </div>
                {/* 산출 시각·지역 소비 분석 링크는 상단 진단 블록이 이미 싣는다 — 여기서 반복하지 않는다 */}
              </section>
            </div>
          </div>
        </Act>
      </div>

      {/* ── 3층 — 결정 이력·실행 현황 (page.tsx가 넘긴다) ── */}
      {children}

      {selected ? (
        <Link
          href={`/proposals/${selected.id}`}
          className="fixed inset-x-3 bottom-3 z-40 flex min-h-12 items-center justify-between rounded-2xl bg-admin-primary px-4 text-sm font-bold text-white shadow-hero md:hidden"
        >
          <span className="text-white/70">다음 단계</span>
          <span>근거·전망 검토하기 →</span>
        </Link>
      ) : null}
    </section>
  );
}

function SourceRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-admin-text-muted">{label}</span>
      <span className="ml-auto text-right text-xs font-bold text-admin-text">{value}</span>
      {href ? <Icon name="arrowUpRight" size={13} className="text-admin-primary" /> : null}
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-11 items-center gap-2 py-2 hover:text-admin-primary"
    >
      {body}
    </a>
  ) : (
    <div className="flex min-h-11 items-center gap-2 py-2">{body}</div>
  );
}
