import { CATEGORIES } from "@/lib/constants";
import type { Recommendation } from "@/types";

/**
 * 방문객 위젯 목록의 검색·정렬 (화면 F7).
 *
 * BE `/api/widget/recommend`는 `region`·`category`·`limit`만 받는다(05 §1) — 이름 검색과 정렬
 * 파라미터가 없다. 그래서 목록을 넉넉히 받아 **여기서** 좁히고 다시 정렬한다. 계약을 바꾸지 않고
 * 화면 기능을 붙이는 쪽을 택한 것이고, 그 대가로 검색·정렬의 사정거리가 받아온 목록(최대
 * MAX_LIST_LIMIT)까지로 제한된다 — 그 이상이 필요해지면 BE에 파라미터를 추가해야 한다.
 */
export type SortKey = "name" | "category";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  // 첫 항목이 기본값이다
  { key: "name", label: "가나다순" },
  { key: "category", label: "업종순" },
];

/** 기본 정렬 — URL에 sort가 없거나 계약에 없는 값이 오면 이걸로 본다 */
export const DEFAULT_SORT: SortKey = SORT_OPTIONS[0].key;

export const sortKeyOf = (raw?: string): SortKey =>
  SORT_OPTIONS.some((o) => o.key === raw) ? (raw as SortKey) : DEFAULT_SORT;

export const sortLabelOf = (key: SortKey): string =>
  SORT_OPTIONS.find((o) => o.key === key)?.label ?? SORT_OPTIONS[0].label;

/**
 * 검색어 정규화. 쿼리스트링으로 오는 값이라 길이를 자르고 공백을 접는다
 * (빈 문자열은 `undefined`로 만들어 `?q=` 같은 빈 파라미터가 링크에 붙지 않게 한다).
 */
export const normalizeQuery = (raw?: string): string | undefined => {
  const q = raw?.replace(/\s+/g, " ").trim();
  return q ? q.slice(0, 40) : undefined;
};

/** "고한 카페"로 "고한카페"를 찾을 수 있게 공백을 지우고 비교한다 */
const fold = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

/** 이름으로만 찾는다 — 검색창 placeholder가 약속하는 범위를 넘지 않는다 */
export const filterByName = (list: Recommendation[], q: string): Recommendation[] =>
  list.filter((r) => fold(r.name).includes(fold(q)));

/**
 * 검색어에 붙일 조사를 고른다 — 사용자가 입력한 말이 그대로 문장에 들어가는 자리라
 * "‘없는가게이름’와"처럼 어긋나면 안 된다. 한글 음절의 종성 유무로 판단하고,
 * 한글이 아닌 글자(영문·숫자)로 끝나면 받침 없는 쪽을 쓴다.
 */
export function particle(word: string, withJong: string, withoutJong: string): string {
  const last = word.trim().slice(-1).charCodeAt(0);
  const isHangulSyllable = last >= 0xac00 && last <= 0xd7a3;
  return isHangulSyllable && (last - 0xac00) % 28 !== 0 ? withJong : withoutJong;
}

/** 업종 정렬은 사전순이 아니라 화면 필터와 같은 표시 순서를 따른다 (constants.CATEGORIES) */
const CATEGORY_ORDER = new Map<string, number>(CATEGORIES.map((c, i) => [c as string, i]));

export function sortRecommendations(list: Recommendation[], key: SortKey): Recommendation[] {
  const byName = (a: Recommendation, b: Recommendation) => a.name.localeCompare(b.name, "ko");
  if (key === "name") return [...list].sort(byName);
  return [...list].sort((a, b) => {
    const d = (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
    return d !== 0 ? d : byName(a, b);
  });
}

/**
 * 목록 아래 한 줄 설명 — 지금 무슨 순서로 보고 있는지만 말한다.
 *
 * 서버가 주는 `policy_note`("완료된 확충 업종 우선 · 그 외 거점 직선거리 기준")는 쓰지 않는다.
 * 그건 **어느 가맹점을 골라 담았는지**에 대한 설명인데, 화면의 나열 순서는 사용자가 고른
 * 정렬이라 그대로 붙이면 순서와 문구가 어긋난다. 선정 기준은 "이 서비스는요" 블록에서 말한다.
 */
export function listNote(key: SortKey, hasFresh: boolean): string {
  const freshClause = hasFresh ? " · 완료된 확충 업종은 위에 따로 모아 보여드려요" : "";
  return key === "name"
    ? `가맹점 이름 가나다순${freshClause}`
    : `업종 순서대로 모아 보기${freshClause}`;
}
