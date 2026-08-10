import Link from "next/link";

/**
 * 전체 지역 현황의 뷰 전환 탭.
 *
 * **진짜 탭 위젯이 아니라 링크다.** 누르면 클라이언트에서 패널만 갈아 끼우는 게 아니라
 * URL이 바뀌고 서버가 그 뷰만 다시 그린다. 그래서 `role="tab"`을 붙이지 않는다 —
 * 스크린리더에 "탭"이라고 말해 놓고 실제로는 페이지를 이동하면 거짓말이 된다.
 * `<nav>` + `aria-current="page"`가 지금 동작을 정확히 설명한다.
 *
 * URL을 상태로 쓰는 이유(이 레포의 지역 필터·기간 필터와 같은 규칙):
 *   - 새로고침·뒤로가기·북마크·공유가 그대로 산다
 *   - 심사가 무안내 URL 접속 방식이라(21 문서) 특정 뷰로 바로 보내는 링크가 필요하다
 *   - 사이드바의 `가맹점 후보`처럼 다른 화면에서 특정 뷰의 특정 섹션을 가리킬 수 있다
 *
 * 서버 컴포넌트 — 클라이언트 JS가 없다. 예전 스크롤 하이라이트 목차(DashboardToc)가
 * 하던 일을 URL이 대신하므로 스크롤 감지 리스너도 사라졌다.
 */
export type DashboardView = "overview" | "trends" | "evidence";

export const DASHBOARD_VIEWS: {
  id: DashboardView;
  label: string;
  /** 이 뷰가 답하는 질문 — 탭 아래 한 줄로 깔아 "무엇을 보고 있는지"를 못 박는다 */
  question: string;
}[] = [
  { id: "overview", label: "현황", question: "지금 어떤 상태인가" },
  { id: "trends", label: "추이 · 분포", question: "어떻게 변해왔나" },
  { id: "evidence", label: "제안 근거", question: "그래서 어디에 처방하나" },
];

const DEFAULT_VIEW: DashboardView = "overview";

/** 쿼리 문자열을 뷰로 — 모르는 값은 기본 뷰로 떨어뜨린다 (잘못된 링크로 빈 화면이 되지 않게) */
export function resolveView(raw?: string): DashboardView {
  return DASHBOARD_VIEWS.some((v) => v.id === raw) ? (raw as DashboardView) : DEFAULT_VIEW;
}

/** 다음 뷰 — 마지막 뷰면 null. 탭을 누르지 않고 훑는 사람도 순서대로 따라갈 수 있게 한다 */
export function nextView(view: DashboardView) {
  const i = DASHBOARD_VIEWS.findIndex((v) => v.id === view);
  return DASHBOARD_VIEWS[i + 1] ?? null;
}

export function DashboardTabs({ view }: { view: DashboardView }) {
  return (
    <nav
      aria-label="전체 지역 현황 보기 전환"
      className="-mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-admin-border bg-admin-surface p-1.5"
    >
      {DASHBOARD_VIEWS.map((v) => {
        const active = v.id === view;
        return (
          <Link
            key={v.id}
            href={v.id === DEFAULT_VIEW ? "/dashboard" : `/dashboard?view=${v.id}`}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-colors ${
              active
                ? "bg-lavender-100 text-lavender-700"
                : "text-admin-text-muted hover:bg-admin-surface-sunken hover:text-admin-text"
            }`}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * 뷰 끝의 다음 단계 안내. 탭이 가진 유일한 실질 위험 — "안 눌러서 못 봄" — 을 막는 장치라,
 * 마지막 뷰에서도 빈손으로 끝내지 않고 데이터 출처로 이어 준다.
 */
export function NextViewLink({ view }: { view: DashboardView }) {
  const next = nextView(view);

  if (!next) {
    return (
      <Link
        href="/data"
        className="inline-flex items-center gap-1.5 self-start rounded-xl border border-admin-border bg-admin-surface px-4 py-2.5 text-[13px] font-semibold text-admin-primary transition-colors hover:bg-lavender-50"
      >
        이 값들이 나온 데이터 출처 확인 — 데이터 활용 정보 →
      </Link>
    );
  }

  return (
    <Link
      href={`/dashboard?view=${next.id}`}
      className="inline-flex items-center gap-1.5 self-start rounded-xl border border-admin-border bg-admin-surface px-4 py-2.5 text-[13px] font-semibold text-admin-primary transition-colors hover:bg-lavender-50"
    >
      다음: {next.label} — {next.question} →
    </Link>
  );
}
