import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 정책 실행 흐름 6단계 (docs/plan/13 §3 — 목업 image-1 하단의 "정책 실행 흐름").
 *
 * 목업에서는 아이콘 여섯 개가 나란한 **그림**이었다. 여기서는 단계마다 실제 라우트와 현재 건수를
 * 붙여 **이동 가능한 진행 표시**로 만든다 — 그림만 있으면 "이 시스템은 이런 절차입니다"라는
 * 설명에 그치지만, 건수가 붙으면 담당자가 지금 어느 단계에 병목이 있는지 바로 읽는다.
 *
 * 문구는 절대 규칙 4를 따른다: AI 단계는 "제안"까지이고, 가맹 확정은 적격성·가맹 심사 뒤에만 가능하다.
 *
 * 건수의 정의는 `DashboardDetailSections`가 넘긴다 — STEP4·5·6은 승인 카드를 겹치지 않게 나눈 값이라
 * 셋을 더하면 승인 카드 총수가 된다.
 */
type Step = {
  icon: IconName;
  title: string;
  desc: string;
  href: string;
  /** 이 단계에 실제로 걸려 있는 건수 — 없으면 표시하지 않는다 (지어낸 수치 금지) */
  count?: { value: number; unit: string };
};

export function PolicyFlow({
  counts,
}: {
  counts: {
    /** STEP2 — 생성된 카드 전체. null이면 KPI 호출 실패 — 0으로 지어내지 않고 배지를 아예 뺀다 */
    cards: number | null;
    /** STEP3 — 결정 대기. null이면 KPI 호출 실패 */
    pending: number | null;
    /** STEP4 — 승인 카드 중 **검토 시작 단계에 머문** 것 (승인 총수가 아니다) — cards 배열에서 직접 센 값이라 KPI와 무관하게 항상 있다 */
    approved: number;
    /** STEP5 — 승인 카드 중 적격성 확인·가맹 심사·추진중 — 위와 같은 이유로 항상 있다 */
    inProgress: number;
    /** STEP6 — 완료. null이면 KPI 호출 실패 */
    done: number | null;
  };
}) {
  /**
   * 각 스텝의 링크는 **그 건수를 세는 목록의 앵커**로만 간다. 종류 필터(`?type=`)는 붙이지 않는다 —
   * 건수는 전 종류를 세는데 링크가 확충만 남기면 "2건"을 눌렀는데 1줄만 보이는 어긋남이 생긴다.
   * 앵커 id의 정본은 DashboardOverview(`#proposal`·`#decision-queue`·`#work-queue`)이고,
   * WorkQueue 주석이 밝히듯 id를 바꾸면 이 링크가 조용히 끊긴다.
   * STEP4·STEP5의 카드는 둘 다 허브 "실행 관리" 목록 안에 있어, 그 목록 설명이 두 단계 건수를
   * 다시 한 번 나눠 적는다 — 배지 숫자와 도착지 숫자가 서로를 확인한다.
   */
  const steps: Step[] = [
    {
      icon: "chart",
      title: "데이터 진단",
      desc: "지역 소비 집중도 · 지역 전환율",
      href: "/dashboard",
    },
    {
      icon: "sparkle",
      title: "AI 제안",
      desc: "후보 비교 후 Action Card 생성",
      href: "/#proposal",
      count: counts.cards !== null ? { value: counts.cards, unit: "장" } : undefined,
    },
    {
      icon: "list",
      title: "담당자 검토",
      desc: "근거 · 리스크 · 원 순위 확인",
      href: "/#decision-queue",
      count: counts.pending !== null ? { value: counts.pending, unit: "건" } : undefined,
    },
    {
      icon: "check",
      title: "검토 시작",
      desc: "후보 접촉 · 아직 가맹 확정 아님",
      href: "/#work-queue",
      count: { value: counts.approved, unit: "건" },
    },
    {
      icon: "workflow",
      title: "적격성·실행",
      desc: "5항목 확인 · 가맹 심사 · 추진",
      href: "/tracking",
      count: { value: counts.inProgress, unit: "건" },
    },
    {
      icon: "phone",
      title: "방문객 반영",
      desc: "완료 카드가 위젯 추천에 반영",
      href: "/widget",
      count: counts.done !== null ? { value: counts.done, unit: "건" } : undefined,
    },
  ];

  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {steps.map((s, i) => (
        <li key={s.title} className="relative min-w-0">
          {/* 단계 사이 연결선 — 마지막 칸에는 붙이지 않는다 */}
          {i < steps.length - 1 ? (
            <span
              aria-hidden
              className="absolute right-[-9px] top-1/2 hidden -translate-y-1/2 text-admin-border xl:block"
            >
              <Icon name="chevronRight" size={16} strokeWidth={2.4} />
            </span>
          ) : null}
          <Link
            href={s.href}
            style={{ animationDelay: `${i * 60}ms` }}
            /* 이 카드는 흰 패널 **안에** 놓인다 — 부모가 이미 흰 면이라 테두리를 지우면서
               표면을 한 단 올릴 수가 없다. 그래서 대비 방향을 뒤집어 낮은 면(sunken)을 쓴다 */
            className="animate-fade-up flex h-full min-w-0 flex-col bg-admin-surface-sunken p-4 transition-colors hover:bg-lavender-50"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-admin-surface text-admin-primary shadow-card">
                <Icon name={s.icon} size={16} />
              </span>
              <span className="text-[10px] font-bold tabular-nums tracking-[0.14em] text-admin-text-muted">
                STEP {i + 1}
              </span>
            </span>
            <span className="mt-2.5 break-keep text-[14px] font-bold leading-5 text-admin-text">
              {s.title}
            </span>
            <span className="mt-0.5 break-keep text-[11px] leading-4 text-admin-text-muted">
              {s.desc}
            </span>
            {s.count ? (
              <span className="mt-2 inline-flex w-fit items-baseline gap-0.5 rounded-full bg-admin-surface px-2 py-0.5 text-[11px] font-bold text-admin-text ring-1 ring-inset ring-admin-border">
                <span className="tabular-nums">{s.count.value}</span>
                <span className="font-semibold text-admin-text-muted">{s.count.unit}</span>
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ol>
  );
}
