/**
 * 공개 데모 읽기 전용 플래그.
 *
 * ⚠ 이 모듈은 "use client" 컴포넌트(승인·상태 변경 버튼들)에서 import 된다.
 * `NEXT_PUBLIC_` 접두사가 없는 env는 브라우저 번들에 인라인되지 않아, 서버 전용
 * `DEMO_READ_ONLY`를 함께 읽으면 SSR은 true·클라이언트는 false로 갈라져
 * 하이드레이션이 어긋나고 버튼 잠금이 풀린다. 그래서 **NEXT_PUBLIC_ 변수 하나만** 본다
 * (next.config.mjs가 이 값을 클라이언트로 전달한다). 서버 액션 쪽 최종 가드는
 * app/actions.ts의 isDemoReadOnly 검사(403)가 그대로 막는다.
 */
export const isDemoReadOnly = process.env.NEXT_PUBLIC_DEMO_READ_ONLY === "true";
