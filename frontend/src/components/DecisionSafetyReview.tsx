"use client";

/**
 * 승인 직전의 단일 안전 확인.
 *
 * 보안·AI 윤리를 별도 설정 화면이나 홍보 문구로 떼지 않고, 실제 결정이 일어나는 지점에 둔다.
 * 체크 한 번이지만 서버가 누락을 거부하고 기준 버전·범위를 감사 기록에 남기므로 장식이 아니다.
 *
 * 면만으로 구분한다 — 형제인 `DecisionReasonPanel`과 같은 sunken 면을 쓰고, 확인되면 면 색이
 * 통과 색으로 바뀐다. 테두리를 겹치지 않는 이유는 13 문서 §6-1(면이 있으면 선을 두르지 않는다).
 */
export function DecisionSafetyReview({
  id,
  checked,
  onChange,
  disabled = false,
  compact = false,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl transition-colors ${
        checked ? "bg-state-good-bg" : "bg-admin-surface-sunken"
      } ${compact ? "p-3" : "p-3.5"} ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        aria-required
        className="mt-0.5 h-4 w-4 shrink-0 accent-admin-primary"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-admin-text">
          결정 안전 검토
          <span className="ml-1 text-state-warn">필수</span>
        </span>
        <span className="mt-0.5 block break-keep text-[11px] leading-5 text-admin-text-muted">
          소표본 보호를 포함한 데이터 보호 범위와 서버 검증 근거, AI 비교·반대 관점을 확인했으며 편향·윤리 영향은 담당자가 최종 판단합니다.
        </span>
      </span>
    </label>
  );
}
