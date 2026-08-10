import type { ReactNode } from "react";

/**
 * 마침표마다 줄을 나눈다 — 설명 문단은 **문장이 끝났을 때만** 줄이 바뀌어야 한다.
 *
 * 폭 제한(max-w-*)을 걷어내도 긴 문단은 여전히 상자 끝에서 접히는데, 그 지점은 문장과
 * 아무 상관이 없어 "…예상값은 실제 성과에 섞지 / 않습니다."처럼 어색하게 끊긴다.
 * 문장 단위로 미리 나눠 두면 줄바꿈 지점이 뜻의 경계와 같아진다. 한 문장이 상자보다 길면
 * 그 문장 안에서는 평소처럼 접힌다(문장을 가로로 잘라 내지는 않는다).
 *
 * 문장 끝 판정: 마침표 + 공백 + 숫자가 아닌 글자. 뒤가 숫자면 자르지 않는다 —
 * 날짜("2026. 07. 20.")와 소수("0.5")가 한 문장 안에서 쪼개지는 것을 막는 조건이다.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== ".") continue;
    const rest = text.slice(i + 1);
    const space = /^\s+/.exec(rest);
    if (!space) continue;
    const next = rest[space[0].length];
    if (!next || /[0-9]/.test(next)) continue;
    out.push(text.slice(start, i + 1));
    start = i + 1 + space[0].length;
    i = start - 1;
  }
  out.push(text.slice(start));
  return out.filter((s) => s.trim().length > 0);
}

/**
 * 설명 슬롯(`lede`·`desc`)용 렌더 헬퍼. 문자열이면 문장마다 한 줄로 쪼개고,
 * JSX면 그대로 돌려준다 — 호출부가 이미 구조를 잡은 경우(강조·링크 포함)라 건드리지 않는다.
 */
export function sentenceLines(node: ReactNode): ReactNode {
  if (typeof node !== "string") return node;
  const parts = splitSentences(node);
  if (parts.length < 2) return node;
  return parts.map((sentence) => (
    <span key={sentence} className="block">
      {sentence}
    </span>
  ));
}
