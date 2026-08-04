import { CATEGORY_COLORS } from "@/lib/constants";

/**
 * 업종 아이콘 placeholder (docs/plan/13 §2-10).
 * 실데이터에 점포 사진이 없으므로 스톡 사진으로 실존 점포를 연출하지 않는다 —
 * 표시 6분류와 1:1 대응하는 도형 아이콘만 쓴다. 색은 13 §5 팔레트 고정.
 */
const PATHS: Record<string, string> = {
  카페: "M4 7h11v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7Zm11 1h2a2 2 0 1 1 0 4h-2M3 19h13",
  음식점: "M6 3v8m0 0v10M4 3v5a2 2 0 0 0 4 0V3M15 21V3c2.5 1 4 3.5 4 7s-1.5 4-4 4",
  편의점: "M4 8h16l-1 11H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2",
  숙박업: "M3 18v-9m0 5h18m0 4v-7a3 3 0 0 0-3-3h-6v6M6.5 10.5h.01",
  소매점: "M3 6h18l-1.5 4.5A3 3 0 0 1 16.7 12H7.3a3 3 0 0 1-2.8-1.5L3 6Zm2 6v7h14v-7",
  기타: "M12 5v14M5 12h14",
};

export function CategoryIcon({ category, size = 44 }: { category: string; size?: number }) {
  const color = CATEGORY_COLORS[category] ?? "#94a3b8";
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, background: `${color}1a` }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={PATHS[category] ?? PATHS["기타"]} />
      </svg>
    </div>
  );
}
