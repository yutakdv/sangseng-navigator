/**
 * 인앱 가이드 투어 6단계 정의 (v4.1 Phase 7-1 · D2).
 *
 * 문구·순서는 심사 보강 계획서에서 확정한 값을 그대로 쓴다 — 바꾸려면 코드가 아니라
 * `.superpowers/sdd/2026-08-10-judging-boost-v41/task-D2-brief.md`를 먼저 고친다.
 *
 * `TourOverlay`가 이 배열만 보고 동작한다: `path`로 "지금 이 스텝이 사는 화면인지" 판정하고
 * (`/proposals/`처럼 `/`로 끝나면 동적 id 하위 경로까지 접두 일치), `anchor`로
 * `[data-tour=...]` 요소를 찾는다. `nextHrefFromAnchor`가 있는 스텝은 "다음"을 누를 때
 * 다음 스텝의 고정 `path` 대신 **지금 스텝 앵커 요소의 `href`**를 다음 목적지로 쓴다 —
 * 결정 대기 1순위 카드의 id가 매 분기 달라지기 때문이다.
 */
export type TourStep = {
  /** 이 스텝이 사는 페이지. "/proposals/"처럼 "/"로 끝나면 동적 하위 경로(카드 id)까지 접두 일치. */
  path: string;
  /** [data-tour=...] 셀렉터 값 */
  anchor: string;
  title: string;
  body: string;
  /** true면 "다음"이 다음 스텝의 path가 아니라 지금 앵커 요소의 href를 다음 목적지로 쓴다(동적 카드 id) */
  nextHrefFromAnchor?: boolean;
};

export const TOUR_STEPS: TourStep[] = [
  { path: "/", anchor: "impact-hero", title: "무엇을 얼마나 바꾸나",
    body: "전환율 1%p 개선의 연간 효과를 서버 계산값으로 보여줍니다. 모든 숫자는 출처 칩에서 역추적됩니다." },
  { path: "/", anchor: "first-proposal", title: "이번 분기 제안",
    body: "AI가 아니라 서버가 대상을 확정합니다. 클릭해 근거를 보세요.", nextHrefFromAnchor: true },
  { path: "/proposals/", anchor: "dissent", title: "반대 관점",
    body: "AI가 스스로 제안을 반박합니다 — 승인 전 확인 장치입니다." },
  { path: "/proposals/", anchor: "decision", title: "담당자 승인",
    body: "AI는 제안만, 확정은 담당자가 합니다. (지금 누르지 않아도 됩니다)" },
  { path: "/incentive?preset=flip", anchor: "flip", title: "반전 장면",
    body: "β 슬라이더를 한 칸 올려 보세요 — 부하가 높은 셀에서는 처방이 확충으로 뒤집힙니다." },
  { path: "/widget", anchor: "widget-payback", title: "방문객 화면 반영",
    body: "승인된 페이백이 방문객 위젯에 그대로 나타납니다." },
];
