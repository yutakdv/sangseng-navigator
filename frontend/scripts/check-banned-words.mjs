/**
 * 금칙어 검사 — docs/plan/13 §9 (F2 검증 항목).
 *
 * 절대 규칙 1(집중도 산식 용어 UI 비노출)·4("실행" 대신 "의사결정 근거 제공")의 회귀를 막고,
 * 내부 표기(문서 절 번호·API 필드명)가 심사위원 화면에 그대로 새는 것도 함께 잡는다.
 * src/ 아래 .ts/.tsx 전체를 훑되, **주석과 import 경로는 제외**하고 화면에 나갈 수 있는
 * 문자열 리터럴·JSX 텍스트만 본다 (계산 근거를 적은 코드 주석까지 막으면 문서화가 불가능해진다).
 *
 * 사용: npm run check:banned
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = ["지니", "Gini", "GINI", "HHI", "실행하겠습니다"];
/**
 * 내부 표기 금칙 패턴 — 문서 절 번호·문서 경로·API 필드명이 화면 문자열로 나가는 것을 막는다.
 * 주석에는 근거 문서 번호를 적는 것이 이 레포의 관례라, 아래 stripNonUi를 반드시 먼저 태운
 * 뒤에만 검사한다(주석을 검사하면 문서화가 불가능해진다).
 */
const BANNED_PATTERNS = [
  { label: "문서 절 표기(§)", re: /§/ },
  { label: "문서 경로", re: /docs\/plan/ },
  // "05 문서 §2"처럼 근거 문서를 화면 문장에서 인용하는 형태. `\b`를 붙이면 뒤 글자가 한글이라
  // 자바스크립트 단어 경계가 성립하지 않아 영영 매치되지 않는다 — 경계 없이 쓴다.
  { label: "문서 번호 인용", re: /\d{2}\s*문서/ },
  // `original_ranking` 처럼 백틱으로 감싼 코드 식별자. 보간(${…})이나 공백을 포함하는 템플릿
  // 리터럴은 식별자 문자만 허용하는 이 패턴에 걸리지 않는다 — src 전체에서 오탐 0건 확인.
  { label: "백틱 감싼 코드 식별자", re: /`[a-zA-Z_][a-zA-Z0-9_.]*`/ },
];
const ROOT = new URL("../src", import.meta.url).pathname;

/** 줄 수를 유지한 채 지운다 — 통째로 제거하면 아래 hits의 줄 번호가 실제 파일과 어긋난다 */
const blank = (text) => text.replace(/[^\n]/g, " ");

/** 블록 주석·줄 끝 주석·import 구문을 지운 뒤 검사한다 */
function stripNonUi(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1") // 줄 끝 주석 (URL의 `://`는 건드리지 않는다)
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?$/gm, blank);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const lines = stripNonUi(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    for (const word of BANNED) {
      if (line.includes(word)) hits.push(`${file}:${i + 1}  ${word}  ${line.trim()}`);
    }
    for (const { label, re } of BANNED_PATTERNS) {
      const match = line.match(re);
      if (match) hits.push(`${file}:${i + 1}  ${label}(${match[0]})  ${line.trim()}`);
    }
  });
}

if (hits.length) {
  console.error("금칙어 검사 실패 — UI 문자열에 아래 단어가 있습니다 (13 §9):");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`금칙어 검사 통과 (${BANNED.join(", ")} + 패턴 ${BANNED_PATTERNS.length}종)`);
