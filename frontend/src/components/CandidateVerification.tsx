"use client";

import { useState, useTransition } from "react";
import { verificationAction } from "@/app/actions";
import { normalizeEligibility } from "@/lib/cardWorkflow";
import { isDemoReadOnly } from "@/lib/runtime";
import type { CandidateVerification as Verification, EligibilityCheck, EligibilityCheckStatus } from "@/types";

const LABEL: Record<EligibilityCheckStatus, string> = {
  unverified: "미확인",
  verified: "충족",
  failed: "미충족",
};

export function CandidateVerification({
  cardId,
  verification,
  editable,
}: {
  cardId: string;
  verification?: Verification;
  editable: boolean;
}) {
  const initial = normalizeEligibility(verification);
  const [checks, setChecks] = useState<EligibilityCheck[]>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const update = (key: string, status: EligibilityCheckStatus) => {
    const before = checks;
    const next = checks.map((check) => (check.key === key ? { ...check, status } : check));
    setChecks(next);
    setError(null);
    startTransition(() => {
      verificationAction(cardId, next)
        .then((result) => {
          if (!result.ok) {
            setChecks(before);
            setError(result.detail);
          }
        })
        .catch(() => {
          setChecks(before);
          setError("적격성 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        });
    });
  };

  return (
    <section aria-labelledby={`verification-${cardId}`} className="border-t border-admin-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`verification-${cardId}`} className="text-sm font-bold text-admin-text">
            후보 적격성 확인
          </h2>
          <p className="u-note mt-1">
            5개 항목을 모두 충족해야 가맹 심사·추진·완료 단계로 이동할 수 있습니다.
          </p>
        </div>
        <span className="border border-admin-border bg-admin-surface px-2 py-1 text-xs font-semibold text-admin-text-muted">
          {verification?.status === "verified"
            ? "5 / 5 충족"
            : verification?.status === "ineligible"
              ? "미충족 있음"
              : `${checks.filter((check) => check.status === "verified").length} / 5 충족`}
        </span>
      </div>

      <div className="mt-3 divide-y divide-admin-border border-y border-admin-border">
        {checks.map((check) => (
          <div key={check.key} className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-3 py-2.5">
            <label htmlFor={`${cardId}-${check.key}`} className="text-[13px] font-medium text-admin-text">
              {check.label}
            </label>
            <select
              id={`${cardId}-${check.key}`}
              aria-label={`${cardId} ${check.label} 적격성`}
              value={check.status}
              disabled={!editable || pending || isDemoReadOnly}
              onChange={(event) => update(check.key, event.target.value as EligibilityCheckStatus)}
              className="min-h-9 w-full border border-admin-border bg-admin-surface px-2 text-xs font-semibold text-admin-text focus:border-admin-primary disabled:cursor-not-allowed disabled:bg-admin-surface-sunken disabled:text-admin-text-muted"
            >
              {(Object.keys(LABEL) as EligibilityCheckStatus[]).map((status) => (
                <option key={status} value={status}>
                  {LABEL[status]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!editable ? (
        <p className="u-note mt-2">먼저 “후보 접촉·검토 시작”을 결정한 뒤 확인 항목을 기록할 수 있습니다.</p>
      ) : null}
      {isDemoReadOnly ? <p className="u-note mt-2">공개 데모 읽기 전용 · 적격성 기록이 잠겨 있습니다.</p> : null}
      {pending ? <p className="u-note mt-2" aria-live="polite">저장 중…</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-state-warn">{error}</p> : null}
    </section>
  );
}
