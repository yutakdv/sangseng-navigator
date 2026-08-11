"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createProgressRecordAction } from "@/app/actions";
import { ProxyBadge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { WorkflowChip } from "@/components/StatusChip";
import { PROXY_NOTE } from "@/lib/constants";
import { normalizedProgress, progressOptions } from "@/lib/cardWorkflow";
import { josa } from "@/lib/korean";
import { measurementOf, metricUnit } from "@/lib/progressMetrics";
import { isDemoReadOnly } from "@/lib/runtime";
import type {
  Card,
  CardProgress,
  CompletionEvidence,
  ProgressMeasurementInput,
  ProgressMetricKey,
  ProgressMetricsInput,
  ProgressRecordInput,
} from "@/types";

const FIELD =
  "mt-1.5 w-full rounded-xl border border-admin-border bg-admin-surface px-3 py-2.5 text-sm text-admin-text shadow-card transition-colors placeholder:text-admin-text-muted/70 hover:border-admin-primary/45 focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/20 disabled:cursor-not-allowed disabled:opacity-55";

/** digits는 ProgressRecordTimeline의 METRICS와 같은 값 — 저장 확인 칩과 타임라인 표기가 어긋나면 안 된다 */
const METRIC_FIELDS: {
  key: ProgressMetricKey;
  label: string;
  unit: string;
  step: string;
  digits: number;
  max?: number;
  hint: string;
}[] = [
  {
    key: "usage_count",
    label: "지역 사용 건수",
    unit: "건",
    step: "1",
    digits: 0,
    hint: "해당 카드 대상 지역·기간의 실제 사용 건수",
  },
  {
    key: "conversion_rate_pct",
    label: "지역 전환율",
    unit: "%",
    step: "0.1",
    digits: 2,
    max: 100,
    hint: "같은 계산 기준과 기간으로 반복 관측한 비율",
  },
  {
    key: "active_merchant_count",
    label: "활성 가맹점 수",
    unit: "곳",
    step: "1",
    digits: 0,
    hint: "실제로 운영 중인 확인 가맹점 수",
  },
  {
    key: "spend_krw",
    label: "지역 사용액",
    unit: "원",
    step: "1",
    digits: 0,
    hint: "같은 범위에서 집계한 실제 사용액",
  },
  {
    key: "concentration_index",
    label: "지역 소비 집중도",
    unit: "점",
    step: "0.1",
    digits: 2,
    max: 100,
    hint: "0~100 지수이며 낮아지면 분산이 개선된 것",
  },
];

/**
 * 관측값 한 칸의 입력 상태 — 값과 함께 **무엇을 언제 어디서 쟀는지**를 받는다.
 *
 * 값만 받던 시절에는 기간·출처 없는 숫자가 리포트 수치로 올라가, 나중에 무엇을 잰 값인지
 * 되짚을 수 없고 서로 다른 범위의 값이 한 리포트에서 비교되는 사고도 막지 못했다.
 * 서버가 네 필드를 전부 요구하며 누락은 422다. **단위는 받지 않는다** — 서버가 채운다.
 */
type MetricDraft = { value: string; from: string; to: string; source: string; scope: string };

const EMPTY_METRIC: MetricDraft = { value: "", from: "", to: "", source: "", scope: "" };

const EMPTY_METRICS: Record<ProgressMetricKey, MetricDraft> = {
  usage_count: { ...EMPTY_METRIC },
  conversion_rate_pct: { ...EMPTY_METRIC },
  active_merchant_count: { ...EMPTY_METRIC },
  spend_krw: { ...EMPTY_METRIC },
  concentration_index: { ...EMPTY_METRIC },
};

const INTEGER_METRICS: ProgressMetricKey[] = ["usage_count", "active_merchant_count", "spend_krw"];

const cardProgress = (card: Card): CardProgress =>
  normalizedProgress(card) ?? (card.type === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");

const targetText = (card: Card): string =>
  card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통";

/** 측정 범위 칸의 예시 — 카드 타깃을 그대로 제안해 "무엇을 잰 값인가"를 처음부터 좁혀 준다 */
const scopePlaceholder = (card?: Card): string =>
  card?.target ? `예: ${card.target.eup} ${card.target.category} 가맹점 전체` : "예: 6개 지역 전체";

const idempotencyKey = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `progress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const toKstIso = (value: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00+09:00`;
  return Number.isFinite(new Date(iso).getTime()) ? iso : null;
};

const toKstLocal = (iso?: string | null): string | undefined => {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms + 9 * 3_600_000).toISOString().slice(0, 16);
};

const optionalNumber = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Number(value);

/** `YYYY-MM-DDTHH:mm` → `YYYY-MM-DD`. 측정 종료일이 기록 시각보다 미래인지 보는 데 쓴다 */
const datePart = (localDateTime: string): string => localDateTime.slice(0, 10);

export function ProgressRecordForm({
  cards,
  initialCardId,
  initialRecordedAt,
}: {
  cards: Card[];
  initialCardId?: string;
  /** `YYYY-MM-DDTHH:mm`, KST 현지 시각. */
  initialRecordedAt: string;
}) {
  const router = useRouter();
  const firstCard = cards.find((card) => card.id === initialCardId) ?? cards[0];
  const [cardId, setCardId] = useState(firstCard?.id ?? "");
  const [progress, setProgress] = useState<CardProgress>(
    firstCard ? cardProgress(firstCard) : "검토중",
  );
  const [recordedAt, setRecordedAt] = useState(initialRecordedAt);
  const [progressPct, setProgressPct] = useState(
    firstCard && cardProgress(firstCard) === "완료" ? "100" : "",
  );
  const [note, setNote] = useState("");
  const [blocker, setBlocker] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [owner, setOwner] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [source, setSource] = useState("");
  const [metrics, setMetrics] = useState<Record<ProgressMetricKey, MetricDraft>>(EMPTY_METRICS);
  /** 완료 증빙 — `완료` 기록에만 쓰이고 타입별로 요구가 다르다 (05 §2) */
  const [merchantRegistrationId, setMerchantRegistrationId] = useState("");
  const [evidenceDocument, setEvidenceDocument] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [evidenceOwner, setEvidenceOwner] = useState("");
  const [budgetCapConfirmed, setBudgetCapConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** 직전 저장 성공의 요약 — 어떤 관측 지표가 이 기록으로 갱신됐는지 즉시 보여준다 */
  const [savedSummary, setSavedSummary] = useState<{
    cardId: string;
    metrics: { label: string; text: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const retryRef = useRef<{ signature: string; key: string } | null>(null);

  const selectedCard = cards.find((card) => card.id === cardId) ?? firstCard;
  const options = useMemo(
    () => (selectedCard ? progressOptions(selectedCard) : []),
    [selectedCard],
  );
  // 같은 이유가 여러 단계에 붙는 경우가 많아 문장 단위로 접어 보여 준다 (ProgressSelect와 같은 관용구)
  const blockedProgressReasons = useMemo(
    () => [
      ...new Set(
        options
          .filter((option) => !option.allowed && option.reason)
          .map((option) => option.reason as string),
      ),
    ],
    [options],
  );
  const earliestRecordedAt = selectedCard
    ? toKstLocal(selectedCard.last_progress_record_at) ?? toKstLocal(selectedCard.created_at)
    : undefined;
  const working = busy || pending;

  const chooseCard = (nextId: string) => {
    const nextCard = cards.find((card) => card.id === nextId);
    setCardId(nextId);
    if (nextCard) {
      const nextProgress = cardProgress(nextCard);
      setProgress(nextProgress);
      setProgressPct(nextProgress === "완료" ? "100" : "");
    }
    retryRef.current = null;
    setError(null);
    setSuccess(null);
    setSavedSummary(null);
  };

  const chooseProgress = (next: CardProgress) => {
    setProgress(next);
    if (next === "완료") setProgressPct("100");
    retryRef.current = null;
  };

  const updateMetric = (key: ProgressMetricKey, patch: Partial<MetricDraft>) => {
    setMetrics((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    retryRef.current = null;
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSavedSummary(null);

    if (!selectedCard) {
      setError("기록할 정책 카드를 선택해 주세요.");
      return;
    }
    const cleanNote = note.trim();
    if (!cleanNote) {
      setError("추진 경과 메모를 입력해 주세요.");
      return;
    }
    const recordedIso = toKstIso(recordedAt);
    if (!recordedIso) {
      setError("기록 시각을 올바른 KST 날짜와 시간으로 입력해 주세요.");
      return;
    }
    const pct = optionalNumber(progressPct);
    if (pct !== undefined && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      setError("진행률은 0~100 사이여야 합니다.");
      return;
    }
    if (progress === "완료" && pct !== undefined && pct !== 100) {
      setError("완료 상태의 진행률을 입력할 때는 100%여야 합니다.");
      return;
    }

    // 값을 적은 지표만 보낸다. 값이 있으면 측정 기간·출처·범위가 **전부 필수**다 —
    // 서버가 422로 막지만, 무엇이 빠졌는지는 여기서 먼저 짚어 줘야 다시 적으러 갈 수 있다.
    const measurements: Partial<Record<ProgressMetricKey, ProgressMeasurementInput>> = {};
    const recordedDate = datePart(recordedAt);
    for (const field of METRIC_FIELDS) {
      const draft = metrics[field.key];
      const value = optionalNumber(draft.value);
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0 || (field.max !== undefined && value > field.max)) {
        const range = field.max ? `0~${field.max}` : "0 이상";
        setError(`${field.label} 값을 ${josa(range, "으로/로")} 입력해 주세요.`);
        return;
      }
      if (INTEGER_METRICS.includes(field.key) && !Number.isInteger(value)) {
        setError(`${josa(field.label, "은/는")} 정수로 입력해 주세요.`);
        return;
      }
      const scope = draft.scope.trim();
      const metricSource = draft.source.trim();
      if (!draft.from || !draft.to || !metricSource || !scope) {
        setError(`${field.label}의 측정 기간·출처·범위를 모두 입력해 주세요.`);
        return;
      }
      if (draft.from > draft.to) {
        setError(`${field.label}의 측정 시작일은 종료일보다 늦을 수 없습니다.`);
        return;
      }
      if (draft.to > recordedDate) {
        setError(`${field.label}의 측정 종료일은 기록 시각보다 미래일 수 없습니다.`);
        return;
      }
      measurements[field.key] = {
        value,
        measured_from: draft.from,
        measured_to: draft.to,
        source: metricSource,
        scope,
      };
    }
    const cleanMetrics = measurements as ProgressMetricsInput;

    // 완료는 위젯 확충 배지·실행 전환율에 직결되므로 근거 없이 만들어져서는 안 된다 (05 §2)
    let completionEvidence: CompletionEvidence | undefined;
    if (progress === "완료") {
      if (selectedCard.type === "EXPANSION") {
        const registration = merchantRegistrationId.trim();
        const document = evidenceDocument.trim();
        if (!registration && !document) {
          setError("확충 완료에는 가맹 등록 ID 또는 증빙 문서가 필요합니다.");
          return;
        }
        completionEvidence = {
          ...(registration ? { merchant_registration_id: registration } : {}),
          ...(document ? { document } : {}),
        };
      } else {
        const owner = evidenceOwner.trim();
        if (!appliedFrom || !appliedTo || !owner) {
          setError("인센티브 완료에는 적용 기간과 책임자가 필요합니다.");
          return;
        }
        if (appliedFrom > appliedTo) {
          setError("적용 시작일은 종료일보다 늦을 수 없습니다.");
          return;
        }
        if (!budgetCapConfirmed) {
          setError("예산 한도 확인 없이는 완료로 넘어갈 수 없습니다.");
          return;
        }
        completionEvidence = {
          applied_from: appliedFrom,
          applied_to: appliedTo,
          owner,
          budget_cap_confirmed: true,
        };
      }
    }

    const baseInput: Omit<ProgressRecordInput, "idempotency_key"> = {
      progress,
      recorded_at: recordedIso,
      ...(pct === undefined ? {} : { progress_pct: pct }),
      note: cleanNote,
      ...(blocker.trim() ? { blocker: blocker.trim() } : {}),
      ...(nextAction.trim() ? { next_action: nextAction.trim() } : {}),
      ...(owner.trim() ? { owner: owner.trim() } : {}),
      ...(dueAt ? { due_at: dueAt } : {}),
      ...(source.trim() ? { source: source.trim() } : {}),
      ...(Object.keys(cleanMetrics).length ? { metrics: cleanMetrics } : {}),
      ...(completionEvidence ? { completion_evidence: completionEvidence } : {}),
    };
    const signature = JSON.stringify({ cardId: selectedCard.id, ...baseInput });
    if (retryRef.current?.signature !== signature) {
      retryRef.current = { signature, key: idempotencyKey() };
    }
    const input: ProgressRecordInput = {
      ...baseInput,
      idempotency_key: retryRef.current.key,
    };

    setBusy(true);
    startTransition(() => {
      createProgressRecordAction(selectedCard.id, input)
        .then((result) => {
          if (!result.ok) {
            setError(result.detail);
            return;
          }
          setSuccess(
            result.data.created
              ? "추진 경과 기록을 저장했습니다. 리포트와 카드 이력에 반영됩니다."
              : "같은 요청이 이미 저장되어 기존 기록을 확인했습니다.",
          );
          const saved = result.data.record;
          setSavedSummary({
            cardId: selectedCard.id,
            metrics: METRIC_FIELDS.flatMap((field) => {
              const observed = measurementOf(saved.metrics, field.key);
              if (!observed) return [];
              return [
                {
                  label: field.label,
                  // 단위는 서버가 지표 정의에서 채운 값을 그대로 쓴다 (화면 표는 폴백일 뿐)
                  text: `${observed.value.toLocaleString("ko-KR", {
                    minimumFractionDigits: field.digits,
                    maximumFractionDigits: field.digits,
                  })}${metricUnit(field.key, observed)}${
                    observed.measured_from && observed.measured_to
                      ? ` · ${observed.measured_from}~${observed.measured_to}`
                      : ""
                  }`,
                },
              ];
            }),
          });
          setNote("");
          setBlocker("");
          setNextAction("");
          setSource("");
          setMetrics(EMPTY_METRICS);
          setMerchantRegistrationId("");
          setEvidenceDocument("");
          retryRef.current = null;
          router.refresh();
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(false));
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={working}>
      <section className="rounded-panel bg-admin-surface p-4 shadow-card sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary">
            <Icon name="workflow" size={17} />
          </span>
          <div>
            <h2 className="u-h2">기록 대상과 상태</h2>
            <p className="mt-1 text-[13px] leading-5 text-admin-text-muted">
              승인된 카드만 기록할 수 있으며, 상태 변경과 메모가 한 이력으로 저장됩니다.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-[13px] font-semibold text-admin-text">
            정책 카드 <span className="text-state-warn">필수</span>
            <select
              value={cardId}
              onChange={(event) => chooseCard(event.target.value)}
              disabled={working || isDemoReadOnly}
              className={FIELD}
              required
            >
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.id} · {card.title}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[13px] font-semibold text-admin-text">
            추진 상태 <span className="text-state-warn">필수</span>
            <select
              value={progress}
              onChange={(event) => chooseProgress(event.target.value as CardProgress)}
              disabled={working || isDemoReadOnly}
              className={FIELD}
              required
            >
              {/* 고를 수 있는 단계의 정본은 서버다 — 화면은 순서만 입히고 판정하지 않는다 */}
              {options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={!option.allowed && option.value !== progress}
                >
                  {option.value}
                  {!option.allowed && option.value !== progress ? " · 선택 불가" : ""}
                </option>
              ))}
            </select>
            {blockedProgressReasons.length ? (
              <span className="mt-1.5 flex flex-col gap-0.5">
                {blockedProgressReasons.map((reason) => (
                  <span
                    key={reason}
                    className="block text-[11px] font-normal leading-4 text-admin-text-muted"
                  >
                    {reason}
                  </span>
                ))}
              </span>
            ) : null}
          </label>
        </div>

        {selectedCard ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-admin-surface-sunken px-3.5 py-3 text-[13px] text-admin-text-muted">
            <WorkflowChip card={selectedCard} />
            <span className="font-semibold text-admin-text">{targetText(selectedCard)}</span>
            <span className="min-w-0 break-keep">{selectedCard.title}</span>
          </div>
        ) : null}
      </section>

      <section className="rounded-panel bg-admin-surface p-4 shadow-card sm:p-5">
        <h2 className="u-h2">경과와 다음 행동</h2>
        <p className="mt-1 text-[13px] leading-5 text-admin-text-muted">
          무엇을 확인했고 무엇이 막혀 있는지 남기면 다음 담당자가 같은 맥락에서 이어갈 수 있습니다.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-[13px] font-semibold text-admin-text">
            기록 시각 (KST) <span className="text-state-warn">필수</span>
            <input
              type="datetime-local"
              value={recordedAt}
              min={earliestRecordedAt}
              max={initialRecordedAt}
              onChange={(event) => {
                setRecordedAt(event.target.value);
                retryRef.current = null;
              }}
              disabled={working || isDemoReadOnly}
              className={FIELD}
              required
            />
            <span className="mt-1 block text-[11px] font-normal leading-4 text-admin-text-muted">
              이미 저장된 최신 기록보다 이른 시각은 저장할 수 없습니다.
            </span>
          </label>

          <label className="text-[13px] font-semibold text-admin-text">
            진행률
            <span className="relative mt-1.5 block">
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={progressPct}
                onChange={(event) => {
                  setProgressPct(event.target.value);
                  retryRef.current = null;
                }}
                disabled={working || isDemoReadOnly}
                placeholder="미입력"
                className={`${FIELD} mt-0 pr-10`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-admin-text-muted">%</span>
            </span>
          </label>
        </div>

        <label className="mt-4 block text-[13px] font-semibold text-admin-text">
          추진 경과 메모 <span className="text-state-warn">필수</span>
          <textarea
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              retryRef.current = null;
            }}
            disabled={working || isDemoReadOnly}
            maxLength={2000}
            rows={5}
            placeholder="확인한 사실, 의사결정 근거, 상대방 회신 등 실제 경과를 적어 주세요."
            className={`${FIELD} resize-y leading-6`}
            required
          />
          <span className="mt-1 block text-right text-[11px] font-normal tabular-nums text-admin-text-muted">
            {note.length} / 2,000
          </span>
        </label>

        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <label className="text-[13px] font-semibold text-admin-text">
            장애 요인
            <textarea
              value={blocker}
              onChange={(event) => {
                setBlocker(event.target.value);
                retryRef.current = null;
              }}
              disabled={working || isDemoReadOnly}
              maxLength={1000}
              rows={3}
              placeholder="없으면 비워 둡니다."
              className={`${FIELD} resize-y leading-6`}
            />
          </label>
          <label className="text-[13px] font-semibold text-admin-text">
            다음 행동
            <textarea
              value={nextAction}
              onChange={(event) => {
                setNextAction(event.target.value);
                retryRef.current = null;
              }}
              disabled={working || isDemoReadOnly}
              maxLength={1000}
              rows={3}
              placeholder="다음 확인·접촉·심사 일정을 적어 주세요."
              className={`${FIELD} resize-y leading-6`}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-[13px] font-semibold text-admin-text">
            담당자
            <input
              value={owner}
              onChange={(event) => {
                setOwner(event.target.value);
                retryRef.current = null;
              }}
              disabled={working || isDemoReadOnly}
              maxLength={100}
              placeholder="이름 또는 팀"
              className={FIELD}
            />
          </label>
          <label className="text-[13px] font-semibold text-admin-text">
            목표일
            <input
              type="date"
              value={dueAt}
              onChange={(event) => {
                setDueAt(event.target.value);
                retryRef.current = null;
              }}
              disabled={working || isDemoReadOnly}
              className={FIELD}
            />
          </label>
          <label className="text-[13px] font-semibold text-admin-text">
            자료 출처
            <input
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                retryRef.current = null;
              }}
              disabled={working || isDemoReadOnly}
              maxLength={200}
              placeholder="예: 현장 확인, 운영 DB"
              className={FIELD}
            />
          </label>
        </div>
      </section>

      <section className="rounded-panel bg-admin-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {/* "실제 성과"라고 부르면 이 정책이 만든 효과로 읽힌다 — 담당자가 적어 넣은 관측값일
                뿐이고 인과는 이 화면이 판정하지 않는다 (대조군 없음) */}
            <h2 className="u-h2">담당자 입력 관측값</h2>
            <p className="mt-1 text-[13px] leading-5 text-admin-text-muted">
              선택 입력입니다. 같은 카드에 같은 계산 기준으로 두 번 이상 입력된 지표만 기초값 대비 변화로 리포트합니다.
              같은 기간의 다른 요인과 분리하지 않으므로 <b className="font-semibold">정책의 인과 효과가 아닙니다</b>.
            </p>
          </div>
          <span className="rounded-full bg-state-notice-bg px-2.5 py-1 text-[11px] font-semibold text-state-notice">
            예상값 입력 금지
          </span>
        </div>

        {/* 값을 적은 지표에만 측정 기간·출처·범위 칸이 열린다 — 다섯 지표에 네 칸씩 늘 펼쳐 두면
            실제로는 한둘만 적는 폼이 스무 칸짜리 벽이 된다. 값이 없으면 서버도 요구하지 않는다 */}
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {METRIC_FIELDS.map((field) => {
            const draft = metrics[field.key];
            const active = draft.value.trim() !== "";
            return (
              <div key={field.key} className="rounded-xl bg-admin-surface-sunken p-3.5">
                <label className="block text-[13px] font-semibold text-admin-text">
                  {field.label}
                  {/* 절대 규칙 2 — 지역 전환율이 보이는 모든 화면에 근사 지표 배지 병기 */}
                  {field.key === "conversion_rate_pct" ? (
                    <span className="ml-1.5 inline-flex align-middle">
                      <ProxyBadge note={PROXY_NOTE} />
                    </span>
                  ) : null}
                  <span className="relative mt-1.5 block">
                    <input
                      type="number"
                      min={0}
                      max={field.max}
                      step={field.step}
                      value={draft.value}
                      onChange={(event) => updateMetric(field.key, { value: event.target.value })}
                      disabled={working || isDemoReadOnly}
                      placeholder="미입력"
                      className={`${FIELD} mt-0 pr-10`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-admin-text-muted">
                      {field.unit}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[11px] font-normal leading-4 text-admin-text-muted">
                    {field.hint}
                  </span>
                </label>

                {active ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-[12px] font-semibold text-admin-text">
                      측정 시작일 <span className="text-state-warn">필수</span>
                      <input
                        type="date"
                        value={draft.from}
                        max={draft.to || datePart(recordedAt)}
                        onChange={(event) => updateMetric(field.key, { from: event.target.value })}
                        disabled={working || isDemoReadOnly}
                        className={FIELD}
                        required
                      />
                    </label>
                    <label className="text-[12px] font-semibold text-admin-text">
                      측정 종료일 <span className="text-state-warn">필수</span>
                      <input
                        type="date"
                        value={draft.to}
                        min={draft.from || undefined}
                        max={datePart(recordedAt)}
                        onChange={(event) => updateMetric(field.key, { to: event.target.value })}
                        disabled={working || isDemoReadOnly}
                        className={FIELD}
                        required
                      />
                    </label>
                    <label className="text-[12px] font-semibold text-admin-text">
                      관측 출처 <span className="text-state-warn">필수</span>
                      <input
                        value={draft.source}
                        onChange={(event) => updateMetric(field.key, { source: event.target.value })}
                        disabled={working || isDemoReadOnly}
                        maxLength={200}
                        placeholder="예: 하이원포인트 운영 DB 월 마감"
                        className={FIELD}
                        required
                      />
                    </label>
                    <label className="text-[12px] font-semibold text-admin-text">
                      측정 범위 <span className="text-state-warn">필수</span>
                      <input
                        value={draft.scope}
                        onChange={(event) => updateMetric(field.key, { scope: event.target.value })}
                        disabled={working || isDemoReadOnly}
                        maxLength={200}
                        placeholder={scopePlaceholder(selectedCard)}
                        className={FIELD}
                        required
                      />
                    </label>
                    <p className="text-[11px] leading-4 text-admin-text-muted sm:col-span-2">
                      기간·출처·범위 없는 숫자는 나중에 무엇을 잰 값인지 되짚을 수 없고, 범위가 다른
                      값이 한 리포트에서 나란히 비교되는 것도 막지 못합니다. 단위는 서버가 지표
                      정의에서 채웁니다.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* 완료 증빙 — `완료` 기록에만 나타난다. 완료는 방문객 위젯 배지·실행 전환율에 직결되므로
          근거 없이 만들어져서는 안 되고, 빠른 상태 변경으로는 아예 완료를 만들 수 없다 (05 §2·§8) */}
      {progress === "완료" && selectedCard ? (
        <section className="rounded-panel bg-admin-surface p-4 shadow-card sm:p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-state-good-bg text-state-good">
              <Icon name="check" size={17} />
            </span>
            <div>
              <h2 className="u-h2">완료 증빙</h2>
              <p className="mt-1 break-keep text-[13px] leading-5 text-admin-text-muted">
                {selectedCard.type === "EXPANSION"
                  ? "가맹 등록 ID 또는 증빙 문서 중 최소 하나가 필요합니다. 등록 ID를 적으면 그 가맹점에 방문객 위젯의 확충 업종 배지가 붙고, 문서만 적으면 카드는 완료되지만 위젯 반영은 대기로 남습니다."
                  : "적용 기간·책임자·예산 한도 확인이 모두 필요합니다. 예산 한도를 확인하지 않으면 완료로 넘어갈 수 없습니다."}
              </p>
            </div>
          </div>

          {selectedCard.type === "EXPANSION" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-[13px] font-semibold text-admin-text">
                가맹 등록 ID
                <input
                  value={merchantRegistrationId}
                  onChange={(event) => {
                    setMerchantRegistrationId(event.target.value);
                    retryRef.current = null;
                  }}
                  disabled={working || isDemoReadOnly}
                  maxLength={64}
                  placeholder="하이원포인트 가맹점 등록번호"
                  className={FIELD}
                />
                <span className="mt-1 block text-[11px] font-normal leading-4 text-admin-text-muted">
                  이 값이 있어야 방문객 위젯이 어느 가맹점을 확충 결과로 표시할지 알 수 있습니다.
                </span>
              </label>
              <label className="text-[13px] font-semibold text-admin-text">
                증빙 문서
                <input
                  value={evidenceDocument}
                  onChange={(event) => {
                    setEvidenceDocument(event.target.value);
                    retryRef.current = null;
                  }}
                  disabled={working || isDemoReadOnly}
                  maxLength={500}
                  placeholder="예: 가맹 계약서 사본 2026-08-11"
                  className={FIELD}
                />
              </label>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-[13px] font-semibold text-admin-text">
                적용 시작일 <span className="text-state-warn">필수</span>
                <input
                  type="date"
                  value={appliedFrom}
                  max={appliedTo || undefined}
                  onChange={(event) => {
                    setAppliedFrom(event.target.value);
                    retryRef.current = null;
                  }}
                  disabled={working || isDemoReadOnly}
                  className={FIELD}
                  required
                />
              </label>
              <label className="text-[13px] font-semibold text-admin-text">
                적용 종료일 <span className="text-state-warn">필수</span>
                <input
                  type="date"
                  value={appliedTo}
                  min={appliedFrom || undefined}
                  onChange={(event) => {
                    setAppliedTo(event.target.value);
                    retryRef.current = null;
                  }}
                  disabled={working || isDemoReadOnly}
                  className={FIELD}
                  required
                />
              </label>
              <label className="text-[13px] font-semibold text-admin-text">
                책임자 <span className="text-state-warn">필수</span>
                <input
                  value={evidenceOwner}
                  onChange={(event) => {
                    setEvidenceOwner(event.target.value);
                    retryRef.current = null;
                  }}
                  disabled={working || isDemoReadOnly}
                  maxLength={100}
                  placeholder="예: 지역상생팀 김지수"
                  className={FIELD}
                  required
                />
              </label>
              <label className="flex items-start gap-2.5 rounded-xl bg-admin-surface-sunken p-3.5 text-[13px] font-semibold text-admin-text">
                <input
                  type="checkbox"
                  checked={budgetCapConfirmed}
                  onChange={(event) => {
                    setBudgetCapConfirmed(event.target.checked);
                    retryRef.current = null;
                  }}
                  disabled={working || isDemoReadOnly}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-admin-primary"
                />
                <span className="min-w-0">
                  예산 한도 확인
                  <span className="ml-1 text-state-warn">필수</span>
                  <span className="mt-0.5 block break-keep text-[11px] font-normal leading-4 text-admin-text-muted">
                    재원 부담이 예산 부서와 확인된 한도 안에 있음을 확인했습니다.
                  </span>
                </span>
              </label>
            </div>
          )}
        </section>
      ) : null}

      {isDemoReadOnly ? (
        <p className="rounded-xl bg-state-notice-bg px-4 py-3 text-[13px] leading-5 text-state-notice">
          공개 데모는 읽기 전용입니다. 운영 권한이 연결된 환경에서 기록할 수 있습니다.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-state-warn-bg px-4 py-3 text-[13px] leading-5 text-state-warn">
          {error}
        </p>
      ) : null}
      {success ? (
        <div role="status" className="rounded-xl bg-state-good-bg px-4 py-3">
          <p className="text-[13px] leading-5 text-state-good">{success}</p>
          {savedSummary?.metrics.length ? (
            <>
              <p className="mt-2.5 text-[11px] font-bold text-state-good">
                이 기록으로 갱신된 관측값
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {savedSummary.metrics.map((metric) => (
                  <li
                    key={metric.label}
                    className="rounded-full bg-admin-surface px-2.5 py-1 text-[11px] font-semibold tabular-nums text-admin-text"
                  >
                    {metric.label} {metric.text}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {savedSummary ? (
            <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-semibold">
              {/* `?from=tracking` — 이 폼은 /tracking/new에서만 쓰이므로 되돌아갈 곳이 항상 트래킹이다.
                  path segment만 인코딩하고 쿼리는 정적 문자열이라 인코딩이 필요 없다 (11 §1 D4) */}
              <Link
                href={`/cards/${encodeURIComponent(savedSummary.cardId)}?from=tracking`}
                className="text-admin-primary underline-offset-4 hover:underline"
              >
                카드 이력에서 직전 대비 변화 보기
              </Link>
              <Link
                href="/tracking"
                className="text-admin-primary underline-offset-4 hover:underline"
              >
                경과 리포트 보기
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-admin-border bg-admin-surface/95 p-3 shadow-lift backdrop-blur sm:px-4">
        {/* 저장 버튼이 있는 이 바가 유일하게 항상 시야에 있다 — 결과 피드백도 여기서 바로 보여준다.
            상세(갱신된 지표·링크)는 위의 success 블록이 계속 담당한다 */}
        {success ? (
          <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold leading-5 text-state-good">
            <span>{success}</span>
            <Link href="/tracking" className="text-admin-primary underline-offset-4 hover:underline">
              경과 리포트 보기
            </Link>
          </p>
        ) : error ? (
          <p className="text-xs font-semibold leading-5 text-state-warn">
            저장하지 못했습니다 — {error}
          </p>
        ) : (
          <p className="text-xs leading-5 text-admin-text-muted">
            저장하면 카드 상태와 경과 리포트가 함께 갱신됩니다.
          </p>
        )}
        <button
          type="submit"
          disabled={working || isDemoReadOnly || !selectedCard}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-admin-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-admin-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name={working ? "clock" : "check"} size={16} />
          {working ? "저장 중…" : "추진 기록 저장"}
        </button>
      </div>
    </form>
  );
}
