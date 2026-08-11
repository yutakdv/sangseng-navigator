/**
 * 한국어 조사 선택 — 값이 끼워진 문장에서 조사가 어긋나는 것을 막는다.
 *
 * 화면 문장은 대부분 "지역 사용 건수" "0.48" "영월군"처럼 **런타임에 정해지는 값** 뒤에 조사를
 * 붙인다. 조사를 하나로 고정하면 "지역 사용 건수은" "Score 0.48를"처럼 읽혀, 숫자를 다루는
 * 화면이 정작 한국어를 못 다루는 인상을 준다. 문자열을 짓는 자리마다 받침을 따지지 않도록
 * 이 모듈 하나로 모은다.
 *
 * 판정은 "마지막에 **소리 나는** 글자에 받침이 있는가" 하나다. 규칙은 아래 네 갈래다.
 *
 * 1. **꼬리 기호는 무시한다** — 공백·괄호·따옴표·문장부호는 소리가 없으므로 걷어 내고 그 앞
 *    글자로 판정한다. "(Score 0.57)" → "0.57" → 칠 → 받침 있음.
 * 2. **한글**은 유니코드 종성으로 판정한다. 종성 8번이 ㄹ이라, ㄹ만 따로 구분한다
 *    ("(으)로"는 ㄹ 받침 뒤에서 "로"를 쓴다 — 서울로, 0.48로).
 * 3. **숫자는 읽어서** 판정한다. 자릿수 이름의 마지막 음절이 받침을 결정한다.
 *    - 소수부가 있으면 한 자리씩 읽으므로 **마지막 자리 숫자**가 곧 마지막 음절이다.
 *      0.48 → 영점사팔 → 팔(ㄹ) → "0.48을 / 0.48로".
 *    - 정수는 **끝자리가 0이 아니면** 그 숫자 이름이 마지막 음절이다.
 *      1,552 → 천오백오십이 → 이(받침 없음) → "1,552를 / 1,552로".
 *    - 정수 끝에 0이 이어지면 마지막 0이 아닌 자리의 **자릿수 이름**이 마지막 음절이다.
 *      100 → 백, 1,500 → 천오백 → 백, 10,000 → 만, 100,000 → 십만 → 만.
 *    받침 있음: 영·일·삼·육·칠·팔 + 십·백·천·만·억·경. 받침 없음: 이·사·오·구 + 조.
 *    (6은 "육"이라 받침이 있다 — 숫자 판정에서 가장 자주 틀리는 자리다.)
 * 4. **로마자**는 글자 이름으로 읽는다. 받침이 있는 것은 l(엘)·m(엠)·n(엔) 셋뿐이고,
 *    그중 l만 ㄹ이다.
 *
 * 그 밖의 문자(기호·한자·이모지)는 받침 없음으로 둔다. 특히 "%"는 "퍼센트", "%p"는
 * "퍼센트포인트"로 읽혀 실제로 받침이 없으므로 이 기본값이 맞다 — 5%를, 0.48%p로.
 */

/** 마지막 음절의 받침 종류. "(으)로"만 ㄹ을 따로 봐야 해서 셋으로 나눈다 */
export type FinalConsonant = "none" | "rieul" | "other";

/** 지원하는 조사 쌍 — 왼쪽이 받침 있을 때, 오른쪽이 받침 없을 때 */
export type JosaPair = "을/를" | "은/는" | "이/가" | "와/과" | "으로/로" | "이나/나";

const JOSA: Record<JosaPair, { withFinal: string; withoutFinal: string }> = {
  // "와/과"만 받침 있을 때 오른쪽(과)을 쓴다 — 표기 순서와 규칙이 반대인 유일한 쌍이다
  "을/를": { withFinal: "을", withoutFinal: "를" },
  "은/는": { withFinal: "은", withoutFinal: "는" },
  "이/가": { withFinal: "이", withoutFinal: "가" },
  "와/과": { withFinal: "과", withoutFinal: "와" },
  "으로/로": { withFinal: "으로", withoutFinal: "로" },
  "이나/나": { withFinal: "이나", withoutFinal: "나" },
};

/** 0~9를 한 자리로 읽었을 때의 받침 — 영 일 이 삼 사 오 육 칠 팔 구 */
const DIGIT_FINAL: FinalConsonant[] = [
  "other", // 0 영 (ㅇ)
  "rieul", // 1 일 (ㄹ)
  "none", //  2 이
  "other", // 3 삼 (ㅁ)
  "none", //  4 사
  "none", //  5 오
  "other", // 6 육 (ㄱ)
  "rieul", // 7 칠 (ㄹ)
  "rieul", // 8 팔 (ㄹ)
  "none", //  9 구
];

/** 만 미만 자릿수 이름의 받침 — [미사용, 십(ㅂ), 백(ㄱ), 천(ㄴ)] */
const SMALL_UNIT_FINAL: FinalConsonant[] = ["none", "other", "other", "other"];

/** 만 이상 자릿수 이름의 받침 — [미사용, 만(ㄴ), 억(ㄱ), 조(없음), 경(ㅇ)] */
const MYRIAD_FINAL: FinalConsonant[] = ["none", "other", "other", "none", "other"];

/** 소리가 없어 받침 판정에서 걷어 내는 꼬리 — 공백·괄호·따옴표·문장부호 */
const SILENT_TAIL = /[\s"'“”‘’()[\]{}<>「」『』《》〈〉.,;:!?~\-–—·…]+$/;

/** 문자열 끝의 숫자 토큰 — 자릿수 구분 쉼표를 포함하고, 소수부를 따로 잡는다 */
const TRAILING_NUMBER = /(\d[\d,]*)(?:\.(\d+))?$/;

function numberFinal(integerPart: string, fractionPart?: string): FinalConsonant {
  // 소수부는 한 자리씩 읽는다 — 0.40도 "영점사영"이라 마지막 자리 그대로가 답이다
  if (fractionPart) return DIGIT_FINAL[Number(fractionPart[fractionPart.length - 1])];

  const digits = integerPart.replace(/,/g, "");
  // 끝에서부터 0이 아닌 자리를 찾는다 — zeros가 그 자리의 자릿수(0=일의 자리)다
  let zeros = -1;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    if (digits[i] !== "0") {
      zeros = digits.length - 1 - i;
      break;
    }
  }
  if (zeros < 0) return DIGIT_FINAL[0]; // 0, 00 → "영"
  if (zeros === 0) return DIGIT_FINAL[Number(digits[digits.length - 1])];
  if (zeros < 4) return SMALL_UNIT_FINAL[zeros];
  // 만 이상은 자릿수 이름이 뒤에 붙어 끝난다 — 100,000은 "십만"이라 끝 음절이 만이다
  return MYRIAD_FINAL[Math.floor(zeros / 4)] ?? "other";
}

/** 마지막에 소리 나는 글자의 받침을 판정한다 (규칙은 파일 상단 주석) */
export function finalConsonant(text: string): FinalConsonant {
  const spoken = text.replace(SILENT_TAIL, "");
  if (!spoken) return "none";

  const numeric = TRAILING_NUMBER.exec(spoken);
  if (numeric) return numberFinal(numeric[1], numeric[2]);

  const last = spoken[spoken.length - 1];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jongseong = (code - 0xac00) % 28;
    return jongseong === 0 ? "none" : jongseong === 8 ? "rieul" : "other";
  }
  if (/[A-Za-z]/.test(last)) {
    const letter = last.toLowerCase();
    if (letter === "l") return "rieul";
    return letter === "m" || letter === "n" ? "other" : "none";
  }
  return "none";
}

/** 앞말에 맞는 조사만 돌려준다 — 값과 조사 사이에 다른 마크업이 끼는 자리에서 쓴다 */
export function particle(text: string, pair: JosaPair): string {
  const final = finalConsonant(text);
  // ㄹ 받침 뒤의 "(으)로"만 예외다 — 서울로·0.48로. 나머지 쌍은 ㄹ도 받침으로 센다
  if (pair === "으로/로" && final === "rieul") return JOSA[pair].withoutFinal;
  return final === "none" ? JOSA[pair].withoutFinal : JOSA[pair].withFinal;
}

/** 앞말 + 조사 — 화면 문장에서 가장 흔히 쓰는 형태 */
export const josa = (text: string, pair: JosaPair): string => `${text}${particle(text, pair)}`;
