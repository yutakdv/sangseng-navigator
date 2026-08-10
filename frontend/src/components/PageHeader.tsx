import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 화면 제목 블록 (docs/plan/13 §6).
 *
 * 화면마다 제목 크기가 제각각이면 "지금 어느 화면인지"가 매번 다시 읽힌다.
 * 담당자 화면 5개가 전부 이 컴포넌트로 제목을 낸다 — 아이콘 + 22~26px 제목 + 설명 한 단락.
 */
export function PageHeader({
  icon,
  eyebrow,
  title,
  lede,
  badge,
  actions,
  children,
}: {
  icon: IconName;
  /** 제목 위 한 줄 — 화면의 역할("진단"·"의사결정"처럼) */
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  /** 제목 옆 고지 배지 (`근사 지표` 등) */
  badge?: ReactNode;
  /** 오른쪽 액션 (카드 생성 버튼 등) */
  actions?: ReactNode;
  /** 설명 아래 추가 줄 (데이터 기준 등) */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary ring-1 ring-inset ring-admin-primary-line">
            <Icon name={icon} size={19} />
          </span>
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-admin-primary">
                {eyebrow}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="u-title">{title}</h1>
              {badge}
            </div>
          </div>
        </div>
        {/* 폭 제한을 걸지 않는다 — 페이지 컨테이너(max-w-6xl·5xl)가 이미 행길이를 정한다.
            여기에 max-w를 한 번 더 두면 오른쪽에 공간이 남는데도 문장이 중간에서 접혀,
            문장이 끝나서가 아니라 상자가 좁아서 줄이 바뀌는 것처럼 보인다. */}
        {lede ? <p className="u-lede mt-2.5">{lede}</p> : null}
        {children}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  );
}
