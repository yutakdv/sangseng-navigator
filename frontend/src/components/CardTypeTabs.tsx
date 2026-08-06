import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import type { CardType } from "@/types";

/**
 * 카드 종류 탭 — 공급 측(가맹점 확충) / 수요 측(페이백 인센티브) (docs/plan/08 F3).
 *
 * ⚠ 지금 어느 화면에도 마운트돼 있지 않다. 카드가 2건뿐이라 허브 최상단의 종류 필터가
 *   과잉이었고(우측 대기 목록이 아이콘·라벨로 이미 종류를 가른다), 무엇보다 이 탭의 "전체 2"가
 *   바로 아래 상태 바의 "2 결정 대기"와 나란히 놓여 **세는 축이 다른 두 숫자**로 읽혔다
 *   (종류별 vs 상태별). 그래서 최상단에서 걷어냈다.
 *
 *   카드가 늘어 종류 필터가 다시 필요해지면 **대기 목록 헤더의 `action` 슬롯**에 붙인다 —
 *   필터가 거는 대상(목록) 바로 위라 세는 축이 헷갈리지 않는다:
 *     <WorkQueue id="decision-queue" action={<CardTypeTabs ... />} ... />
 *   건수는 `dashboardView`의 `pendingCounts`가 계속 계산해 두고 있다.
 *
 * 링크 기반이라 **클라이언트 컴포넌트가 아니다** — 선택 상태는 `?type=EXPANSION` 쿼리스트링에
 * 들어가고 서버가 다시 렌더한다. 그래서 허브 페이지는 서버 컴포넌트로 남고,
 * mock JSON(merchants 포함)이 브라우저 번들에 실리지 않는다.
 *
 * 수치는 **승인 대기 건수**다 — 허브의 주 목록이 승인 대기이기 때문이며, 전체 카드 수가 아니다.
 * 알약 3개가 떠 있던 것을 하나의 세그먼트 컨트롤로 묶었다 — 서로 배타적인 필터라는 사실이
 * 형태로 읽히고, 선택된 탭이 흰 표면으로 떠올라 현재 필터가 한눈에 보인다.
 */
const TABS: {
  value: CardType | null;
  label: string;
  icon: IconName;
  href: string;
  note: string;
}[] = [
  { value: null, label: "전체", icon: "cards", href: "/", note: "확충·인센티브 카드 모두" },
  {
    value: "EXPANSION",
    label: "가맹점 확충",
    icon: "store",
    href: "/?type=EXPANSION",
    note: "공급 측 — 하이원포인트 가맹점을 늘릴 후보(읍×업종)",
  },
  {
    value: "INCENTIVE",
    label: "페이백 인센티브",
    icon: "gift",
    href: "/?type=INCENTIVE",
    note: "수요 측 — 지역 결제분 한정 사용 리워드(발행액 증액 없음)",
  },
];

export function CardTypeTabs({
  active = null,
  pendingCounts,
}: {
  /** 현재 선택된 종류. null이면 전체 */
  active?: CardType | null;
  /** 탭별 승인 대기 건수 — 필터와 무관하게 전체 카드에서 센 값 */
  pendingCounts: { all: number; EXPANSION: number; INCENTIVE: number };
}) {
  return (
    <nav
      aria-label="카드 종류 필터"
      className="inline-flex max-w-full flex-wrap gap-1 rounded-[14px] border border-admin-border bg-admin-surface-sunken p-1"
    >
      {TABS.map((t) => {
        const selected = t.value === active;
        const count = t.value === null ? pendingCounts.all : pendingCounts[t.value];
        return (
          <Link
            key={t.label}
            href={t.href}
            title={t.note}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm transition-colors ${
              selected
                ? "bg-admin-surface font-semibold text-admin-primary shadow-card ring-1 ring-inset ring-admin-primary-line"
                : "text-admin-text-muted hover:bg-admin-surface/70 hover:text-admin-text"
            }`}
          >
            <Icon name={t.icon} size={16} />
            {t.label}
            {/* 색만으로 선택 상태를 전달하지 않는다 (13 §4) — 건수는 항상 숫자로 읽힌다 */}
            <span
              className={`inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                selected
                  ? "bg-admin-primary text-white"
                  : "bg-admin-surface text-admin-text-muted ring-1 ring-inset ring-admin-border"
              }`}
              title={`승인 대기 ${count}건`}
            >
              {count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
