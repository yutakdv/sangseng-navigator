import Link from "next/link";

/**
 * 404 화면 (docs/plan/08 F9).
 *
 * 도달 경로는 둘이다: ① 없는 주소로 직접 접속 ② 카드 상세(`/cards/[id]`)가 실 API에서 404를
 * 받아 `notFound()`를 부른 경우 — 없는 카드 id는 장애가 아니라 정상적인 도메인 신호라
 * 에러 화면이 아닌 이 화면으로 온다 (05 §8).
 *
 * 서버 컴포넌트지만 데이터를 부르지 않는다: 404를 그리는 김에 API를 한 번 더 때리면
 * 백엔드가 느린 상황에서 404조차 늦게 뜬다.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-admin-bg px-5 py-10">
      <div className="w-full max-w-lg rounded-card bg-admin-surface p-6 shadow-card">
        <p className="text-xs font-medium text-admin-primary">상생 나침반</p>
        <h1 className="mt-1 text-xl font-bold text-admin-text">
          요청하신 화면을 찾을 수 없습니다
        </h1>
        <p className="mt-2 break-keep text-sm leading-6 text-admin-text-muted">
          주소가 바뀌었거나, 존재하지 않는 카드 번호일 수 있습니다. 아래에서 원하는 화면으로
          이동해 주세요.
        </p>

        <ul className="mt-5 flex flex-col gap-2">
          <NavItem href="/" title="Action Card 허브" desc="이번 분기 승인 대기 제안 목록 (첫 화면)" />
          <NavItem href="/tracking" title="정책 카드 관리" desc="승인된 카드의 추진 상태 4단계" />
          {/* 이 화면은 AdminShell 밖이라 헤더의 `근사 지표` 배지가 없다 — 배지 없이 "지역 전환율"이
              노출되지 않도록 설명을 다른 진단 지표로 적는다 (절대 규칙 2, 13 §9) */}
          <NavItem
            href="/dashboard"
            title="지역 소비 분석"
            desc="지역 소비 집중도·업종별 소비 분산도 등 진단 지표"
          />
          <NavItem href="/incentive" title="인센티브 정책" desc="페이백률 3·5·7% 시나리오 비교" />
          <NavItem href="/widget" title="방문객 위젯" desc="방문객이 보는 가맹점 추천 화면" />
        </ul>
      </div>
    </main>
  );
}

function NavItem({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-black/5 px-3 py-2 transition-colors hover:bg-admin-primary-soft"
      >
        <span className="text-sm font-medium text-admin-primary">{title}</span>
        <span className="break-keep text-xs text-admin-text-muted">{desc}</span>
      </Link>
    </li>
  );
}
