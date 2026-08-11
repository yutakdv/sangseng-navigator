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
export type SortKey = "dist" | "name" | "category";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  // 첫 항목이 기본값 — 서버가 주는 순서 그대로다
  { key: "dist", label: "거점 직선거리순" },
  { key: "name", label: "가나다순" },
  { key: "category", label: "업종순" },
];

/** 쿼리로 들어온 값이 계약에 없으면 기본 정렬로 되돌린다 */
export const sortKeyOf = (raw?: string): SortKey =>
  SORT_OPTIONS.some((o) => o.key === raw) ? (raw as SortKey) : "dist";

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
  // 거리 정렬은 서버 응답 순서가 곧 정답이다 — `Recommendation`에 distance 필드가 없어
  // FE가 다시 계산할 수도 없고, 할 필요도 없다 (backend/app/routes/widget.py의 haversine 정렬)
  if (key === "dist") return list;
  const byName = (a: Recommendation, b: Recommendation) => a.name.localeCompare(b.name, "ko");
  if (key === "name") return [...list].sort(byName);
  return [...list].sort((a, b) => {
    const d = (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
    return d !== 0 ? d : byName(a, b);
  });
}

/**
 * 목록 아래 한 줄 설명.
 *
 * 기본 정렬에서는 서버가 준 `policy_note`가 정본이다. 사용자가 정렬을 바꾸면 그 문구
 * ("… 거점 직선거리 기준")가 화면 순서와 어긋나므로 현재 정렬을 말하는 문장으로 바꾼다.
 */
export function listNote(key: SortKey, policyNote: string, hasFresh: boolean): string {
  if (key === "dist") return policyNote;
  const freshClause = hasFresh ? " · 완료된 확충 업종은 위에 따로 모아 보여드려요" : "";
  return key === "name"
    ? `가맹점 이름 가나다순${freshClause}`
    : `업종 순서대로 모아 보기${freshClause}`;
}
