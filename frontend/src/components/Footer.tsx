import { SOURCE_NOTE } from "@/lib/constants";

/**
 * 전 화면 공통 푸터 (docs/plan/13 §9).
 * 공공데이터 출처 표기 + OSM attribution은 의무 사항이라 화면에서 빼지 않는다.
 * 갱신 주기 문구("매일 06:00 업데이트" 등)는 정적 배치 데이터라 쓰지 않는다 (13 §2-4).
 */
export function Footer({ periodNote }: { periodNote?: string }) {
  return (
    <footer className="border-t border-black/5 px-5 py-4 text-[11px] leading-5 text-admin-text-muted">
      <p>{SOURCE_NOTE}</p>
      {periodNote ? <p>데이터 기준: {periodNote}</p> : null}
    </footer>
  );
}
