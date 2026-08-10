import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SOURCE_NOTE } from "@/lib/constants";

/**
 * 담당자 화면 공통 푸터 (docs/plan/13 §9) — AdminShell이 모든 담당자 화면에 싣는다.
 * 공공데이터 출처 표기 + OSM attribution은 의무 사항이라 화면에서 빼지 않는다.
 * 갱신 주기 문구("매일 06:00 업데이트" 등)는 정적 배치 데이터라 쓰지 않는다 (13 §2-4).
 *
 * 상세(데이터셋별 규모·컬럼·산출 버전·비공개 내역)는 `/data`가 정본이다. 여기서는 의무 표기만
 * 하고 그리로 가는 길을 둔다 — 화면마다 출처를 길게 되풀이하면 어느 쪽이 정본인지 흐려진다.
 * 방문객 위젯은 이 컴포넌트를 쓰지 않는다(지도·출처가 다르고 담당자 화면 링크도 두지 않는다).
 */
export function Footer({ periodNote }: { periodNote?: string }) {
  return (
    <footer id="sources" className="mt-2 scroll-mt-28 border-t border-admin-border px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5 text-xs leading-5 text-admin-text-muted">
        <Icon name="database" size={14} className="mt-0.5" />
        <div className="min-w-0 break-keep">
          <p className="font-semibold text-admin-text">데이터 관리 · 출처와 기준</p>
          <p>{SOURCE_NOTE}</p>
          {periodNote ? (
            <p className="mt-0.5">
              데이터 기준: <span className="font-medium text-admin-text-soft">{periodNote}</span>
            </p>
          ) : null}
          <Link
            href="/data"
            className="mt-1 inline-flex items-center gap-1 font-semibold text-admin-primary underline-offset-4 hover:underline"
          >
            데이터 활용 정보 — 원본 규모·사용 컬럼·산출 버전
            <Icon name="arrowRight" size={12} strokeWidth={2} />
          </Link>
        </div>
      </div>
    </footer>
  );
}
