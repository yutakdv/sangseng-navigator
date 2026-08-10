/**
 * 데이터가 없을 때 차트 자리를 대신하는 블록 (F5 검증 항목 — 빈 배열·0을 지어낸 값으로 채우지 않는다).
 * 전체 지역 현황과 지역 상세 분석 두 화면이 같은 자리를 같은 모양으로 비운다.
 */
export function EmptyChart() {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-admin-border bg-admin-surface-sunken text-[13px] text-admin-text-muted">
      표시할 데이터가 없습니다
    </div>
  );
}

/**
 * 보조 데이터 **호출 실패** 자리 — `EmptyChart`(정말 데이터가 없음)와 구분한다.
 * null(실패)을 빈 배열로 조용히 치환해 같은 빈 상태로 보이면 "0건"이라는 적극적인
 * 거짓 주장이 된다(이 레포에서 반복해서 잡은 결함 패턴 — PR #44 견고성 원칙).
 */
export function FailedChart() {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-state-warn-line bg-state-warn-bg px-4 text-center text-[13px] text-state-warn">
      <span className="font-semibold">이 데이터를 불러오지 못했습니다</span>
      <span className="text-xs text-state-warn/80">페이지의 다른 정보는 그대로 이용할 수 있습니다</span>
    </div>
  );
}
