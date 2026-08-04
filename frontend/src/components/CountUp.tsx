"use client";

import { useEffect, useRef, useState } from "react";

/**
 * KPI 값 카운트업 (허브 전용).
 *
 * 서버가 **최종 값을 그대로 렌더**하고, 마운트 후에만 0→값 애니메이션을 다시 태운다.
 * 순서가 반대면(0을 렌더하고 JS로 채우면) JS가 꺼진 환경·크롤러·hydration 실패 시 화면에
 * "0"이 남는다 — 지표 화면에서 이건 그냥 오보다.
 *
 * `prefers-reduced-motion`이면 애니메이션을 아예 시작하지 않는다. globals.css의 전역 규칙은
 * CSS 애니메이션만 끄므로 rAF는 여기서 직접 막아야 한다.
 *
 * 숫자 폭이 흔들리지 않도록 호출부에서 `tabular-nums`를 함께 준다.
 */
export function CountUp({
  value,
  /** 소수 자릿수 — 20.5%는 1, 정수 지표는 0 */
  digits = 0,
  /** 값 뒤에 붙는 기호 (% 등). 단위 라벨이 별도 요소면 비워 둔다 */
  suffix = "",
  className = "",
  duration = 950,
}: {
  value: number;
  digits?: number;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const done = useRef(false);

  useEffect(() => {
    // 값이 바뀌어 다시 렌더될 때(승인 → KPI 갱신) 애니메이션을 반복하지 않는다 —
    // 담당자가 방금 누른 버튼의 결과를 확인하는 순간에 숫자가 0부터 다시 세면 방해만 된다
    if (done.current) {
      setShown(value);
      return;
    }
    done.current = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4); // ease-out quart — 끝에서 부드럽게 멈춘다
      setShown(value * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else setShown(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className}>
      {shown.toLocaleString("ko-KR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}
      {suffix}
    </span>
  );
}
