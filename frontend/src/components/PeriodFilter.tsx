import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PERIOD_PRESETS, periodHref } from "@/lib/progressReportView";

/**
 * 추진 경과 리포트의 기간 필터. 선택 상태는 URL에 남겨 새로고침·공유에도 유지된다
 * (RegionFilter와 같은 규칙 — 서버 컴포넌트 + 쿼리스트링, 클라이언트 상태 없음).
 *
 * 조회 한도는 BE가 정한다: 종료일은 KST 오늘까지, 구간은 최대 366일 (05 §8 · routes/progress.py).
 * 프리셋은 그 한도 안에서만 만들고, 사람이 URL을 고쳐 넣어 벗어나면 화면이 죽는 대신
 * 기본 90일로 되돌린 사실을 알린다.
 *
 * 표시하는 from/to는 **응답의 report.period**여야 한다 — 요청값을 그리면 폴백이 일어난 뒤
 * 화면이 실제로 집계한 구간과 다른 말을 한다.
 */
export function PeriodFilter({
  from,
  to,
  days,
  activePresetId,
  invalid,
  today,
}: {
  from: string;
  to: string;
  days: number;
  activePresetId: string | null;
  invalid: boolean;
  /** 페이지에서 한 번 계산한 KST 오늘 — 컴포넌트마다 다시 읽으면 자정 경계에서 링크가 갈린다 */
  today: string;
}) {
  return (
    <div>
      <nav
        aria-label="리포트 기간 필터"
        className="flex flex-wrap items-center gap-2 rounded-2xl bg-admin-surface p-2 shadow-card ring-1 ring-inset ring-admin-border"
      >
        <span className="mr-1 inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-admin-text-muted">
          <Icon name="calendar" size={14} />
          기간
        </span>
        {PERIOD_PRESETS.map((preset) => (
          <Link
            key={preset.id}
            href={periodHref(preset, today)}
            title={preset.hint}
            aria-current={activePresetId === preset.id ? "page" : undefined}
            className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${
              activePresetId === preset.id
                ? "bg-admin-primary text-white shadow-[0_5px_12px_-6px_rgb(79_70_229)]"
                : "text-admin-text-muted hover:bg-admin-surface-sunken hover:text-admin-text"
            }`}
          >
            {preset.label}
          </Link>
        ))}
      </nav>

      <p
        className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-admin-text-muted"
        aria-live="polite"
      >
        <Icon name="info" size={13} />
        <span className="tabular-nums">
          {from} ~ {to} · {days}일 · KST 기준
        </span>
        {activePresetId === null ? <span>· 사용자 지정 기간</span> : null}
      </p>

      {invalid ? (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-xl bg-state-notice-bg px-3.5 py-2.5 text-xs leading-5 text-state-notice ring-1 ring-inset ring-state-notice-line"
        >
          <Icon name="warn" size={13} className="mt-0.5" />
          요청한 기간을 사용할 수 없어 최근 90일로 되돌렸습니다 — 종료일은 오늘(KST)까지, 조회 구간은
          최대 366일입니다.
        </p>
      ) : null}
    </div>
  );
}
