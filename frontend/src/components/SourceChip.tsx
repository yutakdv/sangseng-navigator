import { PrivacyBadge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import type { PrivacyMeta } from "@/types";

/**
 * 데이터 출처 칩 — 화면 숫자가 어느 공공데이터에서 왔는지 드러낸다 (심사 "데이터활용성" 근거).
 *
 * 서버 컴포넌트다. 팝오버는 클라이언트 상태 없이 CSS `:hover`/`:focus-within`만으로 연다 —
 * 버튼에 키보드 포커스가 가면 `group-focus-within`이 같은 방식으로 열어 마우스 없이도 확인할 수
 * 있다. 색·보더·라운드는 Badge.tsx의 관보식 톤(그림자·라운드 최소)을 그대로 따른다 — 이 레포에는
 * 브리프가 가정한 `border-line`·`text-sub`·`bg-paper` 같은 토큰이 없어 실제 토큰(`admin.*`)으로
 * 맞췄다(13-design-guide.md §4).
 */
export function SourceChip({
  label,
  datasets,
  baseNote,
  approx,
  version,
  privacy,
}: {
  /** 칩에 보이는 짧은 문구. 예: "하이원포인트 사용현황 · 2025-12 외 2종" */
  label: string;
  /** 팝오버에 나열할 데이터셋 목록 — 화면이 실제로 쓰는 데이터와 일치해야 한다 */
  datasets: string[];
  /** 기준월 문구 (period_note) — 요약·의역 없이 그대로 노출 */
  baseNote: string;
  /** 근사 지표(지역 전환율 등)를 포함하는 화면인지 */
  approx?: boolean;
  /** 데이터셋 버전 (manifest.json dataset_version) */
  version?: string;
  /**
   * 소표본 보호 고지 — 이 화면의 숫자가 억제·반올림을 거쳤다면 넘긴다. 출처를 밝히는 자리에서
   * "어디까지 감췄는지"까지 함께 말해야 출처 표기가 완결된다. 구형 응답에는 없어 옵셔널이다.
   */
  privacy?: PrivacyMeta | null;
}) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-admin-border bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-text-muted transition-colors hover:bg-admin-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary"
        aria-label={`데이터 출처: ${label}`}
      >
        <Icon name="database" size={11} strokeWidth={2} />
        {label}
      </button>
      <span
        role="tooltip"
        // 모바일(기본, <640px)에서는 버튼이 배지 줄 어디에 있든(줄바꿈 위치가 라벨 길이·뷰포트에 따라
        // 달라진다) 팝오버가 화면 밖으로 나가면 안 되므로, 버튼 기준 절대 위치 대신 뷰포트 기준
        // `fixed inset-x-3`으로 고정한다(TourOverlay 카드와 같은 관용구 — 좌우를 모두 지정하면
        // 폭이 뷰포트 너비를 절대 넘지 않는다). 640px 이상에서는 원래의 버튼 하단 앵커 방식으로 되돌린다.
        //
        // 하단 여백 72px는 임의값이 아니다: 허브(`/`)의 모바일 전용 CTA가 `fixed inset-x-3 bottom-3`에
        // `min-h-12`(48px)로 떠 있어 화면 아래 60px를 차지한다(DashboardOverview.tsx). `bottom-3`로 두면
        // 팝오버 하단 약 48px — 하필 k=5 소표본 보호 고지 — 가 그 CTA에 덮이고, CTA가 `<Link>`라 고지를
        // 읽으려 탭하면 카드 상세로 이동해 버린다. 60px + 12px 여백으로 두 요소를 아예 겹치지 않게 띄운다.
        //
        // z-40인 이유: 허브의 `오늘 상태` 스티키 바가 z-30인데, 임팩트 히어로의 칩 팝오버가 같은
        // z-30이면 DOM에서 나중에 오는 상태 바가 위에 그려져 팝오버 상단이 바 뒤로 숨는다.
        // 화면을 덮는 오버레이(투어·지도 팝업, z-50)보다는 아래에 둔다.
        className="invisible fixed inset-x-3 bottom-[72px] z-40 max-h-[70vh] overflow-y-auto rounded-lg border border-admin-border bg-admin-surface p-3 text-[12px] leading-relaxed text-admin-text-soft opacity-0 shadow-card-hover transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-64 sm:max-h-none sm:overflow-visible sm:p-2.5 sm:shadow-card"
      >
        <strong className="block text-admin-text">사용 데이터</strong>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {datasets.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <span className="mt-1.5 block text-admin-text-muted">{baseNote}</span>
        {approx ? <span className="mt-0.5 block text-admin-text-muted">근사 지표 포함</span> : null}
        {version ? (
          <span className="mt-0.5 block text-admin-text-muted">데이터 버전 {version}</span>
        ) : null}
        {privacy ? (
          <span className="mt-1.5 block border-t border-admin-border pt-1.5">
            <PrivacyBadge note={privacy.note} k={privacy.k} />
            <span className="mt-1 block text-admin-text-muted">
              가맹점 {privacy.k}곳 미만인 셀 {privacy.suppressed_cells.length}개(
              {privacy.suppressed_cells.map((c) => `${c.eup} ${c.category}`).join(" · ")})는 건수를
              비공개 처리했고, 영향받는 합계는 {privacy.aggregate_rounding.unit} 단위로 반올림해
              발행합니다.
            </span>
          </span>
        ) : null}
      </span>
    </span>
  );
}
