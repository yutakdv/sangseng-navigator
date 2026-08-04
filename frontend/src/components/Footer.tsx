import { Icon } from "@/components/Icon";
import { SOURCE_NOTE } from "@/lib/constants";

/**
 * 전 화면 공통 푸터 (docs/plan/13 §9).
 * 공공데이터 출처 표기 + OSM attribution은 의무 사항이라 화면에서 빼지 않는다.
 * 갱신 주기 문구("매일 06:00 업데이트" 등)는 정적 배치 데이터라 쓰지 않는다 (13 §2-4).
 */
export function Footer({ periodNote }: { periodNote?: string }) {
  return (
    <footer className="mt-2 border-t border-admin-border px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5 text-xs leading-5 text-admin-text-muted">
        <Icon name="database" size={14} className="mt-0.5" />
        <div className="min-w-0 break-keep">
          <p>{SOURCE_NOTE}</p>
          {periodNote ? (
            <p className="mt-0.5">
              데이터 기준: <span className="font-medium text-admin-text-soft">{periodNote}</span>
            </p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
