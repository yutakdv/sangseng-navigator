"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 사이드바 — 담당자가 먼저 고르는 두 흐름(정책 의사결정 · 지역 소비 분석)만 상위에 둔다.
 *
 * 7라운드에서 다크 남보라를 걷고 lavender-50 위로 옮겼다. 히어로·본문이 이미 밝은 면이라
 * 사이드바만 어두우면 화면이 두 덩어리로 갈렸다.
 *
 * **정렬 규칙은 `NavItem` 한 곳에만 있다.** 예전에는 "추진 기록 입력"만 들여쓰기(`child`)로
 * 밀려 있어 세로로 훑을 때 아이콘 열이 끊겼는데, 하위 관계는 부제 문장이 이미 말하고 있어
 * 들여쓰기를 걷어냈다. 지금은 모든 항목이 예외 없이 같은 x에서 시작한다 —
 * 아이콘 20px·간격 12px·좌우 패딩 12px이 항목마다 동일하다.
 *
 * 데모 동선(허브 → 카드 상세 → 트래킹 → 위젯 → 인센티브, 11 §1)이 사이드바 클릭 1회로
 * 이어져야 하므로 방문객 위젯도 싣되, 대상이 다른 화면이라 구분선 아래로 떼어 놓는다.
 */
type Item = {
  label: string;
  icon: IconName;
  href?: string;
  note: string;
  /**
   * 활성 판정. 없으면 href와 정확히 같은 경로일 때만 활성.
   *
   * 경로만으로는 부족해서 검색 파라미터도 함께 받는다 — 대시보드의 세 항목은 경로가 모두
   * `/dashboard`로 같고 `?demo=`로만 갈린다. 해시(`#`)는 서버 렌더에 오지 않으므로 판정에 쓰지
   * 않는다: `demo` 값이 이미 대상 섹션과 1:1이라 쿼리만으로 충분하다.
   */
  match?: (pathname: string, search: URLSearchParams) => boolean;
  /** 모바일 가로 스트립에서는 감춘다 — 좁은 화면에선 자리만 먹는 보조 진입점이다 */
  desktopOnly?: boolean;
  /** 이 화면 안에서만 쓰는 하위 작업. 연결선으로 부모와 묶어 그린다 */
  children?: Item[];
};

/**
 * 사이드바에 자기 항목이 있는 대시보드 데모 화면. `지역 소비 분석`은 이 값들을 자기 것으로
 * 보지 않고 넘겨준다 — 그러지 않으면 목록에서 먼저 나오는 `지역 소비 분석`이 항상 먼저
 * 걸려 아래 두 항목이 켜질 차례가 오지 않는다. 여기 없는 `demo` 값(`report` 등)은 전용 항목이
 * 없으므로 `지역 소비 분석`이 그대로 활성이다.
 */
const DASHBOARD_DEMO_ITEMS = ["merchant", "data"];

/** 순서가 아니라 담당자가 찾는 업무 객체로 묶는다. 실제 단계는 카드 안에서만 안내한다. */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "정책 업무",
    items: [
      {
        label: "정책 나침반",
        icon: "compass",
        href: "/",
        note: "결정 대기 제안과 오늘 할 일",
        match: (p) => p === "/" || p.startsWith("/proposals/") || p.startsWith("/cards/"),
      },
      {
        label: "추진 경과 리포트",
        icon: "report",
        href: "/tracking",
        note: "진행률·정체·실제 성과 확인",
        match: (p) => p === "/tracking",
        children: [
          {
            label: "추진 기록 입력",
            icon: "workflow",
            href: "/tracking/new",
            note: "경과 메모·다음 행동·실측값 입력",
            match: (p) => p === "/tracking/new",
          },
        ],
      },
      {
        label: "인센티브 정책",
        icon: "gift",
        href: "/incentive",
        note: "페이백 3·5·7% 시나리오 비교",
        match: (p) => p === "/incentive",
      },
    ],
  },
  {
    title: "분석과 전달",
    items: [
      {
        label: "지역 소비 분석",
        icon: "chart",
        href: "/dashboard",
        note: "지역·업종별 소비 신호 진단",
        match: (p, q) => p === "/dashboard" && !DASHBOARD_DEMO_ITEMS.includes(q.get("demo") ?? ""),
      },
      {
        label: "가맹점 후보",
        icon: "store",
        href: "/dashboard?demo=merchant#merchant-candidates",
        note: "후보·기존 가맹점 원본 확인",
        desktopOnly: true,
        match: (p, q) => p === "/dashboard" && q.get("demo") === "merchant",
      },
      {
        label: "데이터 출처",
        icon: "database",
        href: "/dashboard?demo=data#data-demo",
        note: "공개 최신본과 실시간 원천 상태",
        desktopOnly: true,
        match: (p, q) => p === "/dashboard" && q.get("demo") === "data",
      },
    ],
  },
];

const VISITOR: Item = {
  label: "방문객 위젯",
  icon: "phone",
  href: "/widget",
  note: "방문객이 보는 가맹점 추천 화면",
  match: (p) => p === "/widget",
};

/**
 * 항목 하나의 골격 — 모든 항목이 이 문자열 하나를 공유한다. 여기 없는 여백·정렬은
 * 어떤 항목에도 붙이지 않는다 (그래야 세로로 훑을 때 아이콘 열이 자로 잰 듯 맞는다).
 */
const ITEM =
  "group flex min-h-11 shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-[13px] transition-colors lg:w-full lg:items-start lg:whitespace-normal lg:text-sm";

/** 부모·하위를 한 줄로 편 목록 — 하위 항목도 활성 판정 대상이다 */
const flatten = (items: Item[]): Item[] =>
  items.flatMap((item) => [item, ...flatten(item.children ?? [])]);

/**
 * 현재 경로에 해당하는 항목은 **정확히 하나**여야 한다 — 처음 일치한 것만 활성으로 본다.
 * 하위가 활성일 때 부모까지 함께 켜지 않는다: 어디에 속한 화면인지는 연결선이 이미 말한다.
 */
function activeLabelFor(pathname: string, search: URLSearchParams): string | null {
  const all = [...flatten(GROUPS.flatMap((group) => group.items)), VISITOR];
  const hit = all.find((item) =>
    item.match ? item.match(pathname, search) : item.href === pathname,
  );
  return hit?.label ?? null;
}

export function SideNav() {
  const pathname = usePathname();
  // 담당자 화면은 전부 force-dynamic이라 서버 렌더에서도 실제 쿼리가 들어온다 —
  // 첫 페인트부터 올바른 항목이 켜지고, 활성 표시가 수화 뒤에 늦게 바뀌지 않는다.
  const search = useSearchParams();
  const activeLabel = activeLabelFor(pathname, search);

  // 다른 경로의 긴 섹션으로 이동할 때는 해시가 먼저 적용되고 본문이 나중에 수화될 수 있다.
  // 대상이 생길 때까지 짧게 재시도해 사이드바 메뉴가 URL만 바꾸고 멈추지 않게 한다.
  useEffect(() => {
    let frame = 0;
    let attempts = 0;
    let cancelled = false;

    const scrollToHash = () => {
      if (cancelled) return;
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }
      if (attempts < 24) {
        attempts += 1;
        frame = window.requestAnimationFrame(scrollToHash);
      }
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, [pathname]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="주 메뉴"
        className="flex gap-1.5 overflow-x-auto px-3 py-2 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:px-4 lg:py-1"
      >
        {GROUPS.map((group) => (
          <div key={group.title} className="contents lg:block">
            {/* 묶음 라벨은 데스크톱에서만 — 모바일 가로 스트립에서는 자리를 먹기만 한다.
                그룹 간 간격(mt-6)을 항목 간 간격(gap-1)보다 크게 둬 묶음이 형태로 읽히게 한다 */}
            <p className="mb-1.5 mt-6 hidden px-3 text-xs font-semibold uppercase tracking-[0.14em] text-admin-text-soft first:mt-2 lg:block">
              {group.title}
            </p>
            <div className="contents lg:flex lg:flex-col lg:gap-1">
              {group.items.map((item) => (
                <NavBranch key={item.label} item={item} activeLabel={activeLabel} />
              ))}
            </div>
          </div>
        ))}

        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 self-center bg-admin-border lg:hidden" />
        <span className="lg:hidden">
          <NavItem item={VISITOR} active={VISITOR.label === activeLabel} visitor />
        </span>
      </nav>

      {/* 방문객 위젯은 대상이 다른 화면이라 담당자 메뉴와 선으로 가른다 (작업 3) */}
      <div className="hidden shrink-0 border-t border-admin-border px-4 py-3 lg:block">
        <NavItem item={VISITOR} active={VISITOR.label === activeLabel} visitor />
      </div>
    </div>
  );
}

/**
 * 항목 하나와 그 하위 묶음 — **맥락 기반 노출**.
 *
 * 하위는 그 작업 영역 안에 있을 때만 나타난다: 부모나 하위 중 하나가 현재 화면이면 펼치고,
 * 그 밖에서는 부모만 남긴다. 접기/펴기 버튼을 달지 않은 이유는 하위가 부모 하나에 한 개뿐이라
 * 아끼는 것이 한 행인데, 행 하나가 이동과 펼침 두 가지 클릭 대상을 겸하게 되는 비용이 더
 * 크기 때문이다. 하위가 현재 화면일 때는 어차피 펼쳐야 하므로, 토글이 실제로 감춰 주는
 * 경우는 "그 영역 밖에 있을 때"뿐이고 그건 이 규칙이 클릭 0회로 해 준다.
 *
 * 감춰도 진입로는 끊기지 않는다 — `/tracking` 화면이 `/tracking/new`로 여러 곳에서 링크한다.
 *
 * 하위는 임의로 밀어 놓지 않는다: **부모 아이콘 중심(x=22px)에서 내려오는 세로 연결선**에
 * 걸어 둔다. 들여쓰기만 주면 정렬이 어긋난 것처럼 보이지만, 선이 있으면 "이 화면에 속한
 * 작업"으로 읽힌다. 항목 자체의 여백·아이콘 규격은 여전히 `ITEM` 한 곳에서 온다.
 *
 * 모바일 가로 스트립에서는 `contents`로 상자를 지워 평평한 한 줄로 되돌린다.
 */
function NavBranch({ item, activeLabel }: { item: Item; activeLabel: string | null }) {
  const kids = item.children ?? [];
  const self = <NavItem item={item} active={item.label === activeLabel} />;
  if (!kids.length) return self;

  // 이 작업 영역 안인가 — 부모가 현재 화면이거나, 하위 중 하나가 현재 화면일 때
  const inArea = item.label === activeLabel || kids.some((child) => child.label === activeLabel);
  if (!inArea) return self;

  return (
    <div className="contents lg:flex lg:flex-col lg:gap-1">
      {self}
      <div
        role="group"
        aria-label={`${item.label} 하위 작업`}
        className="contents lg:ml-[22px] lg:flex lg:flex-col lg:gap-1 lg:border-l lg:border-lavender-200 lg:pl-1"
      >
        {kids.map((child) => (
          <NavItem key={child.label} item={child} active={child.label === activeLabel} />
        ))}
      </div>
    </div>
  );
}

function NavItem({
  item,
  active,
  visitor = false,
}: {
  item: Item;
  /** 상위에서 계산해 내려준다 — 항목이 스스로 판정하면 동시에 여러 개가 켜질 수 있다 */
  active: boolean;
  visitor?: boolean;
}) {
  const hidden = item.desktopOnly ? "hidden lg:flex" : "";

  if (!item.href) {
    return (
      <span
        title={item.note}
        aria-disabled="true"
        className={`${ITEM} ${hidden} cursor-not-allowed text-admin-text-muted`}
      >
        <Icon name={item.icon} size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">{item.label}</span>
        <span className="rounded-full bg-admin-surface px-1.5 py-0.5 text-xs font-medium text-admin-text-muted">
          로드맵
        </span>
      </span>
    );
  }

  // 활성은 배경 틴트 + 굵기 + aria-current 세 겹으로 알린다 — 색 하나에 기대지 않는다 (13 §4)
  const className = `${ITEM} ${hidden} ${
    active
      ? "bg-lavender-100 font-semibold text-lavender-700"
      : "text-admin-text hover:bg-lavender-100/50"
  }`;

  const body = (
    <>
      <Icon
        name={item.icon}
        size={20}
        className={`shrink-0 lg:mt-px ${active ? "text-lavender-700" : "text-admin-text-soft"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block leading-5">{item.label}</span>
        <span
          className={`mt-0.5 hidden line-clamp-1 text-xs font-normal leading-4 lg:block ${
            active ? "text-lavender-700/75" : "text-admin-text-soft"
          }`}
        >
          {item.note}
        </span>
      </span>
      {visitor ? (
        <span className="shrink-0 self-center rounded-full bg-visitor-primary-soft px-1.5 py-0.5 text-xs font-semibold text-visitor-primary">
          방문객
        </span>
      ) : null}
    </>
  );

  // 링크는 표준 해시 URL을 유지하고, SideNav의 수화 후 스크롤 보정이 실제 대상까지 이동시킨다.
  if (item.href.includes("#")) {
    return (
      <a href={item.href} title={item.note} aria-current={active ? "page" : undefined} className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={item.href} title={item.note} aria-current={active ? "page" : undefined} className={className}>
      {body}
    </Link>
  );
}
