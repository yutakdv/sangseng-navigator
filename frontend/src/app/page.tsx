import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { CardItem } from "@/components/CardItem";
import { CardTypeTabs } from "@/components/CardTypeTabs";
import { DecisionActions } from "@/components/DecisionActions";
import { GenerateCardButton } from "@/components/GenerateCardButton";
import { Section } from "@/components/Section";
import { api } from "@/lib/api";
import type { Card, CardType } from "@/types";

// 승인·생성이 곧바로 목록에 반영돼야 하는 화면이라 캐시하지 않는다 (데모 5단계·2-b 단계)
export const dynamic = "force-dynamic";

/**
 * ① Action Card 허브 — 첫 화면 (docs/plan/08 F3 · 13 §3).
 *
 * 서비스 정체성은 "시각화"가 아니라 "의사결정 지원"이라 `/`는 차트가 아니라 카드 목록이다.
 * 상단 헤드라인(지역 전환율 + `근사 지표` 배지)은 `AdminShell`이 전 화면 공통으로 렌더하므로
 * 여기서 다시 만들지 않는다 (중복 표기 금지, 13 §9).
 *
 * 서버 컴포넌트다 — `lib/api.ts`는 mock JSON을 정적 import 하므로 서버에서만 호출한다.
 * 상태를 바꾸는 버튼(승인·생성)만 클라이언트 컴포넌트이며 `app/actions.ts`의 서버 액션을 부른다.
 */
type Search = { type?: string };

const isCardType = (v: string | undefined): v is CardType =>
  v === "EXPANSION" || v === "INCENTIVE";

/**
 * 승인 대기 정렬: **AI 조정 카드 먼저**, 그다음 생성 순서(오래된 것부터).
 * - 앞: 정량 순위를 바꾼 제안은 담당자가 원 순위와 함께 먼저 확인해야 하는 카드다 (절대 규칙 5)
 * - 뒤: 새로 생성한 카드가 목록 맨 위를 밀어내지 않아야 "카드 생성"을 눌러도 앞선 카드의 위치가
 *   그대로 남는다 (11 §1 — 2-b 단계에서 목록이 늘어나는 것만 보이고 3단계 클릭 대상은 고정)
 */
const byPendingOrder = (a: Card, b: Card): number =>
  Number(b.ai.adjusted) - Number(a.ai.adjusted) || a.created_at.localeCompare(b.created_at);

/** 최근 결정: 마지막에 처리한 카드가 위로 — "방금 뭘 했는지"를 잃지 않게 하는 순서 */
const byDecidedDesc = (a: Card, b: Card): number =>
  (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at);

/** KST ISO8601 문자열을 그대로 잘라 쓴다 — Date로 재파싱하면 브라우저 타임존이 끼어든다 (05 §8) */
const stamp = (iso: string | null): string =>
  iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : "—";

export default async function HubPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Next 15+ 에서 searchParams는 Promise다 — await 없이 접근하면 런타임 에러
  const sp = await searchParams;
  const type = isCardType(sp.type) ? sp.type : null; // 계약에 없는 값은 무시하고 전체로 본다

  // 탭 건수를 함께 보여줘야 해서 목록은 전체를 한 번만 받아 메모리에서 나눈다
  const [dashboard, { cards }] = await Promise.all([api.dashboard(), api.cards()]);

  const pendingAll = cards.filter((c) => c.status === "pending");
  const pendingCounts = {
    all: pendingAll.length,
    EXPANSION: pendingAll.filter((c) => c.type === "EXPANSION").length,
    INCENTIVE: pendingAll.filter((c) => c.type === "INCENTIVE").length,
  };

  const visible = type ? cards.filter((c) => c.type === type) : cards;
  const pending = visible.filter((c) => c.status === "pending").sort(byPendingOrder);
  // 결정된 카드도 남긴다 — 승인 직후 카드가 사라지면 담당자가 방금 한 일을 잃는다
  const decided = visible.filter((c) => c.status !== "pending").sort(byDecidedDesc);

  const generateType: CardType = type ?? "EXPANSION";

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-admin-text">이번 분기 제안</h2>
            {/* 절대 규칙 4·5 — AI의 역할과 감사 가능성을 첫 화면에서 한 줄로 밝힌다 */}
            <p className="mt-0.5 max-w-2xl break-keep text-sm leading-6 text-admin-text-muted">
              AI는 후보를 비교해 <b className="font-semibold text-admin-text">제안</b>까지 하고,
              확정은 담당자 승인으로만 이뤄집니다. AI가 순위를 조정한 카드에는 원래 정량 Score
              순위를 항상 함께 표기합니다.
            </p>
          </div>
          <GenerateCardButton
            type={generateType}
            label={
              generateType === "INCENTIVE" ? "이번 분기 인센티브 카드 생성" : "이번 분기 카드 생성"
            }
          />
        </div>

        <CardTypeTabs active={type} pendingCounts={pendingCounts} />

        <Section
          title={`승인 대기 ${pending.length}건`}
          desc="카드를 열지 않고 여기서 바로 승인·반려·보류할 수 있습니다. 승인한 카드만 실행 상태 트래킹으로 넘어갑니다."
        >
          {pending.length === 0 ? (
            <div className="rounded-lg bg-admin-bg px-4 py-8 text-center">
              <p className="text-sm font-medium text-admin-text">
                이번 분기 승인 대기 카드가 없습니다
              </p>
              <p className="mx-auto mt-1 max-w-md break-keep text-xs leading-5 text-admin-text-muted">
                상단의 <b className="font-semibold text-admin-text">카드 생성</b> 버튼을 누르면 AI가
                후보를 비교해 새 제안을 만듭니다. 후보가 전부 추진중·완료 상태라면 새 제안 대신
                안내 문구가 표시됩니다.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((c) => (
                <li
                  key={c.id}
                  // AI 조정 카드는 프레임으로 한 번 더 띄운다 — 데모 2단계 해설이 붙는 카드다
                  className={
                    c.ai.adjusted
                      ? "rounded-[20px] bg-admin-primary-soft p-1.5 ring-1 ring-admin-primary/15"
                      : ""
                  }
                >
                  {c.ai.adjusted ? (
                    <div className="px-2 pb-1.5 pt-0.5">
                      {/* 데모 2단계 해설이 붙는 문장이라 빔프로젝터(1920×1080)에서도 읽히게
                          각주 크기(11px)가 아닌 본문 보조 크기(12px)로 둔다 (08 F9 발표 폴리시) */}
                      <p className="break-keep text-xs font-medium leading-5 text-admin-primary">
                        AI가 정량 순위를 조정한 제안입니다 — 원래 Score 순위를 함께 표기합니다.
                      </p>
                      {/* 감사 가능성 (절대 규칙 5) — 조정 카드에는 원 순위 전체를 목록에서도 병기한다 */}
                      {c.ai.original_ranking?.length ? (
                        <p className="mt-1 break-keep text-xs leading-5 text-admin-text-muted">
                          원래 Score 순위{" "}
                          {c.ai.original_ranking.map((r) => (
                            <span
                              key={r.rank}
                              className={`mr-2 whitespace-nowrap ${
                                r.rank === c.score_rank ? "font-semibold text-admin-text" : ""
                              }`}
                            >
                              {r.rank}. {r.candidate} {r.score.toFixed(2)}
                              {/* 색·굵기만으로 구분하지 않는다 (13 §4) — 조정 대상은 문자로도 적는다 */}
                              {r.rank === c.score_rank ? ` ← AI 제안 ${c.ai_rank}위` : ""}
                            </span>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <CardItem card={c}>
                    <div className="flex flex-col items-start gap-1.5">
                      {/* INCENTIVE 승인은 페이백률 선택이 필수라 허브에서 바로 승인할 수 없다 (05 §2) */}
                      {c.type === "INCENTIVE" ? (
                        <Link
                          href="/incentive"
                          className="text-xs font-medium text-admin-primary underline-offset-2 hover:underline"
                        >
                          페이백률 고르고 승인하기 →
                        </Link>
                      ) : null}
                      <DecisionActions cardId={c.id} requireRate={c.type === "INCENTIVE"} />
                    </div>
                  </CardItem>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {decided.length ? (
          <Section
            title={`최근 결정 ${decided.length}건`}
            desc="이미 결정한 카드입니다. 결정 버튼 대신 상태 칩만 표시되며, 추진 상태 변경은 트래킹 화면에서 합니다."
            right={
              <Link
                href="/tracking"
                className="text-xs font-medium text-admin-primary underline-offset-2 hover:underline"
              >
                실행 상태 트래킹 →
              </Link>
            }
          >
            <ul className="flex flex-col gap-3">
              {decided.map((c) => (
                <li key={c.id}>
                  <CardItem card={c}>
                    <span className="whitespace-nowrap text-xs tabular-nums text-admin-text-muted">
                      결정 {stamp(c.decided_at)}
                    </span>
                  </CardItem>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </AdminShell>
  );
}
