import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 정책 실행 흐름 6단계 (docs/plan/13 §3 — 목업 image-1 하단의 "정책 실행 흐름").
 *
 * 목업에서는 아이콘 여섯 개가 나란한 **그림**이었다. 여기서는 단계마다 실제 라우트와 현재 건수를
 * 붙여 **이동 가능한 진행 표시**로 만든다 — 그림만 있으면 "이 시스템은 이런 절차입니다"라는
 * 설명에 그치지만, 건수가 붙으면 담당자가 지금 어느 단계에 병목이 있는지 바로 읽는다.
 *
 * 문구는 절대 규칙 4를 따른다: AI 단계는 "제안"까지이고, 확정은 담당자 승인 단계에서 일어난다.
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
  counts: { cards: number; pending: number; approved: number; inProgress: number; done: number };
}) {
  const steps: Step[] = [
    {
      icon: "chart",
      title: "데이터 진단",
      desc: "소비 집중도 · 지역 전환율",
      href: "/dashboard",
    },
    {
      icon: "sparkle",
      title: "AI 제안",
      desc: "후보 비교 후 Action Card 생성",
      href: "/?type=EXPANSION#proposal",
      count: { value: counts.cards, unit: "장" },
    },
    {
      icon: "list",
      title: "담당자 검토",
      desc: "근거 · 리스크 · 원 순위 확인",
      href: "/?type=EXPANSION#pending",
      count: { value: counts.pending, unit: "건" },
    },
    {
      icon: "check",
      title: "승인 확정",
      desc: "담당자 승인으로만 확정",
      href: "/?type=EXPANSION#pending",
      count: { value: counts.approved, unit: "건" },
    },
    {
      icon: "workflow",
      title: "추진 기록",
      desc: "검토중 · 추진중 · 보류 · 완료",
      href: "/tracking",
      count: { value: counts.inProgress, unit: "건" },
    },
    {
      icon: "phone",
      title: "방문객 반영",
      desc: "완료 카드가 위젯 추천에 반영",
      href: "/widget",
      count: { value: counts.done, unit: "건" },
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
            className="animate-fade-up flex h-full min-w-0 flex-col rounded-2xl bg-admin-surface-sunken p-4 transition-colors hover:bg-admin-primary-soft"
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
