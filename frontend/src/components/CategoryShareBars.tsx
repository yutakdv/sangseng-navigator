import { Icon } from "@/components/Icon";
import { CATEGORY_COLORS } from "@/lib/constants";
import { num } from "@/lib/format";

/**
 * 업종별 사용 비중 — 가로 막대 (05 §1 `category_share`).
 *
 * 도넛을 쓰지 않는 이유: 이 패널이 답해야 하는 질문은 "구성비가 어떻게 생겼나"가 아니라
 * **"이번 제안이 겨눈 업종이 큰 업종인가"** 다. 도넛은 조각 각도를 눈으로 비교해야 해서 그 판단이
 * 느리고, 두 번째·세 번째 업종의 대소가 특히 잘 안 읽힌다. 같은 값을 길이로 옮기면 즉시 비교된다.
 * (도넛은 구성비 자체가 주제인 `/dashboard`에 그대로 둔다 — 화면마다 질문이 다르다)
 *
 * 색은 업종 6분류 고정 팔레트를 그대로 쓴다 — 여기서는 색이 **정체성**을 지므로 13 §5의
 * "색은 항목에 고정" 규칙이 그대로 적용된다. 대비가 3:1 미만인 슬롯이 있어 값(건수·%)을
 * 막대마다 직접 표기해 색에만 기대지 않는다.
 *
 * Recharts를 쓰지 않아 이 패널은 서버 컴포넌트로 남고 브라우저 JS가 0이다.
 */
export function CategoryShareBars({
  data,
  /** 이번 분기 제안이 겨눈 업종 — 목록에서 문구로 표시한다 */
  targetCategory,
}: {
  data: { category: string; count: number; share: number }[];
  targetCategory: string | null;
}) {
  const rows = [...data].sort((a, b) => b.share - a.share);
  const max = Math.max(...rows.map((r) => r.share), 0.0001);
  const total = rows.reduce((a, b) => a + b.count, 0);

  return (
    <div className="min-w-0">
      <ul className="flex flex-col gap-2.5">
        {rows.map((r, i) => {
          const isTarget = r.category === targetCategory;
          return (
            // 그리드 3열 — 배지가 막대·숫자 사이에 끼면 배지 행만 막대가 사라지고 숫자 열이
            // 밀린다. 배지를 이름 셀에 넣고 열 폭을 행마다 고정해 정렬이 어긋날 수 없게 한다.
            // 이름 열 126px = 색점+업종명(3자)+배지가 잘리지 않는 최소 폭 (업종 6분류는 전부 2~3자)
            <li
              key={r.category}
              className="grid grid-cols-[126px_minmax(1.5rem,1fr)_116px] items-center gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: CATEGORY_COLORS[r.category] ?? "#94a3b8" }}
                />
                <span
                  className={`min-w-0 truncate text-[13px] ${
                    isTarget ? "font-bold text-admin-text" : "font-medium text-admin-text-soft"
                  }`}
                >
                  {r.category}
                </span>
                {/* 색만으로 제안 업종을 전달하지 않는다 (13 §4) */}
                {isTarget ? (
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-admin-primary px-2 py-0.5 text-[10px] font-bold text-white">
                    제안 업종
                  </span>
                ) : null}
              </span>

              <span className="h-3 min-w-0 overflow-hidden rounded-full bg-admin-surface-sunken">
                <span
                  style={{
                    width: `${Math.max(2, (r.share / max) * 100)}%`,
                    background: CATEGORY_COLORS[r.category] ?? "#94a3b8",
                    animationDelay: `${i * 70}ms`,
                  }}
                  className="block h-full origin-left animate-grow rounded-full"
                />
              </span>

              <span className="whitespace-nowrap text-right text-[13px] font-bold tabular-nums text-admin-text">
                {Math.round(r.share * 100)}%
                <span className="ml-1.5 text-[11px] font-medium text-admin-text-muted">
                  {num(r.count)}건
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="u-note mt-3 flex items-start gap-1.5 border-t border-admin-border pt-3">
        <Icon name="info" size={13} strokeWidth={2} className="mt-[3px]" />
        <span>
          표시 6분류 기준 · 전 기간 누적 {num(total)}건. 업종 분류 롤업 정본은 파이프라인의
          업종 매핑표입니다.
        </span>
      </p>
    </div>
  );
}
