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
