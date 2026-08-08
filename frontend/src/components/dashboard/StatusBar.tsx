import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 얇은 상태 바 — 스크롤 내내 상단에 붙어 "몇 건 남았는지"를 놓치지 않게 한다.
 *
 * 4라운드의 큰 3블록(숫자 + 라벨 + 부제)을 한 줄로 압축했다. 부제("근거 확인 후 승인·반려"
 * 등)는 우측 작업 열의 각 블록이 이미 설명하므로 여기서 반복하지 않는다 — 같은 문장을 두 곳에
 * 두면 어느 쪽이 정본인지 흐려진다.
 *
 * 각 항목은 **해당 블록 앵커로만** 간다. 숫자를 눌렀는데 카드 한 장짜리 상세가 열리면
 * 세는 단위와 화면 단위가 어긋난다 (4라운드에서 잡은 원칙).
 *
 * `position: fixed`가 아니라 `sticky`다 — 문서 흐름에 남아 있어야 본문이 바 뒤로 밀려
 * 잘리지 않는다. 전체 페이지에서 붙어 있으려면 이 바의 부모가 페이지 전체를 감싸야 하므로,
 * 허브의 1·2·3층이 모두 `DashboardOverview`의 한 섹션 안에 들어간다.
 *
 * ⚠ `body`에 `overflow-x: hidden`이 있으면 body가 스크롤 컨테이너가 돼 이 sticky가 죽는다
 *   (globals.css의 body 규칙 주석 참고).
 *
 * 접이 요약줄에는 **지역 전환율만** 상시 노출한다 (`headline`). 01 문서의 "절대 자르지 않는 것"과
 * 데모 1단계가 이 숫자를 첫 화면에서 요구하는데, 진단 4지표를 통째로 접으면서 함께 사라졌던 것을
 * 되돌린 것이다. 나머지 세 지표는 접은 채로 둔다 — 분기에 한 번 바뀌는 배경 맥락이라는 판단(18 §3②)은
 * 그대로다. 숫자가 보이는 자리이므로 `근사 지표` 배지도 이 줄에 함께 온다 (절대 규칙 2).
 *
 * 서버 컴포넌트 — 진단 펼침은 네이티브 `<details>`라 클라이언트 JS가 필요 없다.
 */
export function StatusBar({
  waiting,
  running,
  done,
  held,
  rejected,
  headline,
  diagnostics,
}: {
  waiting: number;
  running: number;
  done: number;
  held: number;
  rejected: number;
  /**
   * 접이 **요약줄 안**에 상시 노출할 핵심 지표. 접힘/펼침 어느 상태에서도 보여야 하는 값만 넣는다.
   * 지역 전환율이 여기 오므로 호출부는 `근사 지표` 배지를 이 노드 안에 함께 넣어야 한다 (절대 규칙 2).
   */
  headline?: ReactNode;
  /** 펼쳤을 때 바 아래로 내려오는 압축 진단 블록 */
  diagnostics?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-30 flex flex-wrap items-center gap-y-1 border-y border-admin-border bg-admin-surface px-3 py-2 sm:px-4">
      <span className="mr-2 shrink-0 text-xs font-bold text-admin-text-muted">오늘 상태</span>

      <Stat href="#decision-queue" value={waiting} label="결정 대기" tone="lead" />
      <Sep />
      <Stat href="#work-queue" value={running} label="실행 관리" />
      <Sep />
      <Stat href="#done-queue" value={done} label="완료" tone={done > 0 ? "ink" : "muted"} />
      {held > 0 ? (
        <>
          <Sep />
          <Stat href="#recent-decisions" value={held} label="보류" />
        </>
      ) : null}
      {rejected > 0 ? (
        <>
          <Sep />
          <Stat href="#recent-decisions" value={rejected} label="반려" />
        </>
      ) : null}

      {diagnostics ? (
        <details className="ml-auto min-w-0">
          {/* `u-disclosure`에 flex-row-reverse가 걸려 ::before(꺾쇠)가 오른쪽 끝에 온다 —
              요약 내용은 span 하나로 감싸야 DOM 순서 그대로 왼쪽부터 읽힌다.
              감싸지 않고 형제로 나열하면 "이번 분기 진단 → 20.5%" 순으로 뒤집힌다 */}
          <summary className="u-disclosure flex-row-reverse rounded-md px-2 py-1.5 text-[13px] font-semibold text-admin-text-soft transition-colors hover:text-admin-primary">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {headline}
              <span>이번 분기 진단</span>
            </span>
          </summary>
          {/* 바가 sticky(=positioned)라 이 패널은 바 바로 아래에 겹쳐 내려온다 —
              펼칠 때 본문이 밀려 스크롤 위치가 튀지 않게 하려는 배치다 */}
          <div className="absolute inset-x-0 top-full border-b border-admin-border bg-admin-surface px-4 py-4 shadow-float sm:px-5">
            {diagnostics}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden className="px-0.5 text-admin-text-muted">
      ·
    </span>
  );
}

function Stat({
  href,
  value,
  label,
  tone = "ink",
}: {
  href: string;
  value: number;
  label: string;
  /** lead = 지금 판단이 필요한 숫자(화면의 유일한 채움색) · muted = 0건이라 눈길이 갈 필요 없음 */
  tone?: "lead" | "ink" | "muted";
}) {
  const valueTone =
    tone === "lead" ? "text-admin-primary" : tone === "muted" ? "text-admin-text-muted" : "text-admin-text";

  return (
    <Link
      href={href}
      className="group inline-flex min-h-9 items-center gap-1.5 rounded-md px-1.5 transition-colors hover:bg-lavender-50"
    >
      <span className={`text-[15px] font-bold leading-none tabular-nums ${valueTone}`}>{value}</span>
      <span className="text-[13px] text-admin-text-soft group-hover:text-admin-primary">{label}</span>
    </Link>
  );
}
