import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SORT_OPTIONS, sortLabelOf, type SortKey } from "@/lib/widgetList";

/**
 * 방문객 위젯의 탐색 컨트롤 — 검색 · 선택 필드 · 정렬 (화면 F7).
 *
 * 칩 14개를 두 줄로 늘어놓던 필터를 **눌러서 목록이 열리는 선택 필드**로 바꿨다. 390px에서
 * 칩이 네 줄까지 접히면서 화면의 첫 인상이 필터로 가득 찼고, 정작 목록은 스크롤 아래로
 * 밀려 있었다.
 *
 * 전부 서버 컴포넌트다 — 열고 닫는 상태를 `<details>`에게 맡겼기 때문에 클라이언트 JS가 없다.
 * 세 메뉴에 같은 `name`을 주어(HTML 배타 아코디언) 하나를 열면 나머지가 닫힌다.
 * 항목은 전부 `<Link>`라 선택이 곧 URL 이동이고, 이동하면 새로 그려지며 메뉴는 닫힌 상태가 된다
 * — 그래서 "선택 후 닫기"를 따로 구현하지 않는다.
 *
 * 면(배경색)으로 블록을 구분하는 원칙(CLAUDE.md · 13 §6-1)에 따라 필드·칩에는 테두리를 두르지
 * 않는다. 흰 패널 위에 뜨는 흰 드롭다운만은 선이 유일한 경계라 얇은 ring을 남긴다.
 */

/** 세 메뉴를 하나만 열리게 묶는다 (HTML `details name` 배타 그룹) */
const MENU_GROUP = "widget-menu";

const SUMMARY = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";
const PANEL =
  "absolute z-30 mt-1.5 overflow-hidden rounded-2xl bg-white shadow-card-hover ring-1 ring-black/5";
const ROW = "flex min-h-[46px] items-center gap-2 px-4 text-[14px]";

/** 가맹점 이름 검색 — JS 없이 GET 폼으로 서버에 넘긴다 */
export function WidgetSearch({
  q,
  hidden,
  clearHref,
}: {
  q?: string;
  /** 검색과 함께 유지할 현재 상태(지역·업종·정렬·라이브). `limit`은 일부러 넘기지 않는다 —
   *  새 검색은 첫 페이지부터 보는 게 맞다 */
  hidden: Record<string, string | undefined>;
  clearHref: string;
}) {
  return (
    <form action="/widget" method="get" role="search">
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <div className="flex items-center gap-2.5 rounded-2xl bg-slate-100 px-3.5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-visitor-primary/40">
        <Icon name="search" size={17} className="text-admin-text-muted" />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="가맹점 이름으로 찾기"
          aria-label="가맹점 이름 검색"
          enterKeyHint="search"
          className="min-h-[52px] min-w-0 flex-1 bg-transparent text-[14px] font-medium text-admin-text outline-none placeholder:font-normal placeholder:text-admin-text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <Link
            href={clearHref}
            aria-label="검색어 지우기"
            className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-admin-text-muted"
          >
            <Icon name="close" size={14} strokeWidth={2.2} />
          </Link>
        ) : null}
      </div>
      {/* Enter로 제출되지만, 키보드·스크린리더 사용자를 위해 제출 수단을 명시적으로 남긴다 */}
      <button type="submit" className="sr-only">
        검색
      </button>
    </form>
  );
}

/**
 * 관심 지역·업종 선택 필드 — 누르면 목록이 열리고, **여러 개를 고를 수 있다**.
 *
 * 항목을 누르면 그 값이 켜지거나 꺼진 URL로 이동한다(토글). 다중 선택인데 고를 때마다 목록이
 * 닫히면 두 개째부터는 매번 다시 열어야 하므로, 항목 링크에 `open` 파라미터를 실어 다시 그려질 때
 * 열린 채로 오게 한다 — 클라이언트 상태 없이 "열린 목록에서 계속 고르기"를 만든다.
 */
export function WidgetSelect({
  label,
  selected,
  options,
  makeHref,
  clearHref,
  countOf,
  titleOf,
  open = false,
}: {
  label: string;
  /** 선택된 값들 (빈 배열 = 전체) */
  selected: string[];
  options: readonly string[];
  /** 그 값을 토글한 주소 */
  makeHref: (value: string) => string;
  /** "전체" — 이 필터를 통째로 비운 주소 */
  clearHref: string;
  /** 그 항목까지 켰을 때 걸리는 가맹점 수 — 반대편 활성 필터가 반영된 값이어야 한다 */
  countOf?: (value?: string) => number;
  titleOf?: (value: string) => string | undefined;
  open?: boolean;
}) {
  const summaryText =
    selected.length === 0
      ? "전체"
      : selected.length === 1
        ? selected[0]
        : `${selected[0]} 외 ${selected.length - 1}`;

  return (
    <details name={MENU_GROUP} open={open} className="group relative">
      <summary
        className={`${SUMMARY} flex min-h-[52px] items-center gap-2 rounded-2xl bg-slate-100 px-3.5`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold leading-4 text-admin-text-muted">
            {label}
          </span>
          <span
            className={`block truncate text-[14px] font-bold leading-5 ${
              selected.length ? "text-visitor-primary" : "text-admin-text"
            }`}
          >
            {summaryText}
          </span>
        </span>
        <Icon
          name="chevronDown"
          size={16}
          className="text-admin-text-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <div className={`${PANEL} inset-x-0`}>
        <p className="px-4 pb-1 pt-3 text-[11px] font-semibold text-admin-text-muted">
          {label} <span className="font-medium">· 여러 개 고를 수 있어요</span>
        </p>
        <ul className="max-h-[292px] divide-y divide-slate-100 overflow-y-auto pb-1">
          <li>
            <Link
              href={clearHref}
              aria-current={selected.length === 0 ? "true" : undefined}
              className={`${ROW} ${selected.length === 0 ? "font-bold text-visitor-primary" : "text-admin-text"}`}
            >
              {selected.length === 0 ? (
                <Icon name="check" size={15} strokeWidth={2} />
              ) : (
                <span aria-hidden className="w-[15px]" />
              )}
              <span className="min-w-0 flex-1 truncate">전체</span>
              {countOf ? (
                <span className="text-[11px] font-semibold tabular-nums text-admin-text-muted">
                  {countOf(undefined)}
                </span>
              ) : null}
            </Link>
          </li>
          {options.map((value) => {
            const active = selected.includes(value);
            return (
              <li key={value}>
                <Link
                  href={makeHref(value)}
                  title={titleOf?.(value)}
                  aria-current={active ? "true" : undefined}
                  className={`${ROW} ${active ? "font-bold text-visitor-primary" : "text-admin-text"}`}
                >
                  {active ? (
                    <Icon name="check" size={15} strokeWidth={2} />
                  ) : (
                    <span aria-hidden className="w-[15px]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{value}</span>
                  {countOf ? (
                    <span className="text-[11px] font-semibold tabular-nums text-admin-text-muted">
                      {countOf(value)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

/** 선택된 필터 요약 — 필드를 접어 둔 채로도 현재 조건이 읽히게 한다 */
export function WidgetFilterSummary({
  chips,
  resetHref,
}: {
  chips: { label: string; removeHref: string }[];
  resetHref: string;
}) {
  if (!chips.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.label}
          href={c.removeHref}
          aria-label={`${c.label} 조건 해제`}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-visitor-primary-soft px-3 text-xs font-semibold text-visitor-primary"
        >
          {c.label}
          <Icon name="close" size={12} strokeWidth={2.4} />
        </Link>
      ))}
      <Link
        href={resetHref}
        className="ml-1 text-xs font-semibold text-admin-text-muted underline underline-offset-2"
      >
        초기화
      </Link>
    </div>
  );
}

/** 목록 정렬 — 필터와 같은 목록 패턴이지만 면 없이 텍스트만 (목록 제목 줄에 얹히는 컨트롤이라) */
export function WidgetSort({
  selected,
  makeHref,
}: {
  selected: SortKey;
  makeHref: (key: SortKey) => string;
}) {
  return (
    <details name={MENU_GROUP} className="group relative shrink-0">
      <summary
        className={`${SUMMARY} flex items-center gap-1 py-1 text-xs font-semibold text-admin-text-muted`}
      >
        정렬
        <span className="text-visitor-primary">{sortLabelOf(selected)}</span>
        <Icon
          name="chevronDown"
          size={13}
          strokeWidth={2.2}
          className="transition-transform group-open:rotate-180"
        />
      </summary>
      <div className={`${PANEL} right-0 w-[188px]`}>
        <ul className="divide-y divide-slate-100 py-1">
          {SORT_OPTIONS.map((o) => {
            const active = o.key === selected;
            return (
              <li key={o.key}>
                <Link
                  href={makeHref(o.key)}
                  aria-current={active ? "true" : undefined}
                  className={`${ROW} ${active ? "font-bold text-visitor-primary" : "text-admin-text"}`}
                >
                  {active ? (
                    <Icon name="check" size={15} strokeWidth={2} />
                  ) : (
                    <span aria-hidden className="w-[15px]" />
                  )}
                  {o.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
