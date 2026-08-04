import { PageSkeleton } from "@/components/PageSkeleton";

/**
 * 허브(`/`) 로딩 스켈레톤.
 *
 * `app/loading.tsx`는 하위 라우트에도 상속되므로, 나머지 담당자 화면 네 곳은 각자
 * `loading.tsx`에서 `variant="page"`를 쓴다 — 허브만 본문 폭이 1600px이고 상단 구성이 다르다.
 * 골격 자체는 `components/PageSkeleton.tsx`에 있다(왜 스피너가 아닌지도 그 파일 주석 참고).
 * 테마가 다른 방문객 위젯은 `app/widget/loading.tsx`가 따로 덮는다.
 */
export default function Loading() {
  return <PageSkeleton variant="hub" />;
}
