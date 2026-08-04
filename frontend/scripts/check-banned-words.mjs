/**
 * 금칙어 검사 — docs/plan/13 §9 (F2 검증 항목).
 *
 * 절대 규칙 1(집중도 산식 용어 UI 비노출)·4("실행" 대신 "의사결정 근거 제공")의 회귀를 막는다.
 * src/ 아래 .ts/.tsx 전체를 훑되, **주석과 import 경로는 제외**하고 화면에 나갈 수 있는
 * 문자열 리터럴·JSX 텍스트만 본다 (계산 근거를 적은 코드 주석까지 막으면 문서화가 불가능해진다).
 *
 * 사용: npm run check:banned
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BANNED = ["지니", "Gini", "GINI", "HHI", "실행하겠습니다"];
const ROOT = new URL("../src", import.meta.url).pathname;

/** 한 줄 주석·블록 주석·import 구문을 지운 뒤 검사한다 */
function stripNonUi(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");
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
  });
}

if (hits.length) {
  console.error("금칙어 검사 실패 — UI 문자열에 아래 단어가 있습니다 (13 §9):");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`금칙어 검사 통과 (${BANNED.join(", ")})`);
