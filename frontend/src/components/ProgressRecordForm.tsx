"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProgressRecordAction } from "@/app/actions";
import { Icon } from "@/components/Icon";
import { WorkflowChip } from "@/components/StatusChip";
import { normalizedProgress, progressOptions } from "@/lib/cardWorkflow";
import { isDemoReadOnly } from "@/lib/runtime";
import type {
  Card,
  CardProgress,
  ProgressMetricKey,
  ProgressMetrics,
  ProgressRecordInput,
} from "@/types";

const FIELD =
  "mt-1.5 w-full rounded-xl border border-admin-border bg-admin-surface px-3 py-2.5 text-sm text-admin-text shadow-card transition-colors placeholder:text-admin-text-muted/70 hover:border-admin-primary/45 focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/20 disabled:cursor-not-allowed disabled:opacity-55";

const METRIC_FIELDS: {
  key: ProgressMetricKey;
  label: string;
  unit: string;
  step: string;
  max?: number;
  hint: string;
}[] = [
  {
    key: "usage_count",
    label: "지역 사용 건수",
    unit: "건",
    step: "1",
    hint: "해당 카드 대상 지역·기간의 실제 사용 건수",
  },
  {
    key: "conversion_rate_pct",
    label: "지역 전환율",
    unit: "%",
    step: "0.1",
    max: 100,
    hint: "같은 산식과 기간으로 반복 관측한 비율",
  },
  {
    key: "active_merchant_count",
    label: "활성 가맹점 수",
    unit: "곳",
    step: "1",
    hint: "실제로 운영 중인 확인 가맹점 수",
  },
  {
    key: "spend_krw",
    label: "지역 사용액",
    unit: "원",
    step: "1",
    hint: "같은 범위에서 집계한 실제 사용액",
  },
  {
    key: "concentration_index",
    label: "소비 집중도",
    unit: "점",
    step: "0.1",
    max: 100,
    hint: "0~100 지수이며 낮아지면 분산이 개선된 것",
  },
];

const EMPTY_METRICS: Record<ProgressMetricKey, string> = {
  usage_count: "",
  conversion_rate_pct: "",
  active_merchant_count: "",
  spend_krw: "",
  concentration_index: "",
};

const cardProgress = (card: Card): CardProgress =>
  normalizedProgress(card) ?? (card.type === "EXPANSION" ? "후보 접촉·검토 시작" : "검토중");

const targetText = (card: Card): string =>
  card.target ? `${card.target.eup} · ${card.target.category}` : "전 지역 공통";

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
  const [metrics, setMetrics] = useState<Record<ProgressMetricKey, string>>(EMPTY_METRICS);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const retryRef = useRef<{ signature: string; key: string } | null>(null);

  const selectedCard = cards.find((card) => card.id === cardId) ?? firstCard;
  const options = useMemo(
    () => (selectedCard ? progressOptions(selectedCard) : []),
    [selectedCard],
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
  };

  const chooseProgress = (next: CardProgress) => {
    setProgress(next);
    if (next === "완료") setProgressPct("100");
    retryRef.current = null;
  };

  const updateMetric = (key: ProgressMetricKey, value: string) => {
    setMetrics((current) => ({ ...current, [key]: value }));
    retryRef.current = null;
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

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

    const metricValues: ProgressMetrics = {
      usage_count: optionalNumber(metrics.usage_count),
      conversion_rate_pct: optionalNumber(metrics.conversion_rate_pct),
      active_merchant_count: optionalNumber(metrics.active_merchant_count),
      spend_krw: optionalNumber(metrics.spend_krw),
      concentration_index: optionalNumber(metrics.concentration_index),
    };
    for (const field of METRIC_FIELDS) {
      const value = metricValues[field.key];
      if (value === undefined || value === null) continue;
      if (!Number.isFinite(value) || value < 0 || (field.max !== undefined && value > field.max)) {
        setError(`${field.label} 값을 ${field.max ? `0~${field.max}` : "0 이상"}으로 입력해 주세요.`);
        return;
      }
      if (["usage_count", "active_merchant_count", "spend_krw"].includes(field.key) && !Number.isInteger(value)) {
        setError(`${field.label}은 정수로 입력해 주세요.`);
        return;
      }
    }

    const cleanMetrics = Object.fromEntries(
      Object.entries(metricValues).filter(([, value]) => value !== undefined),
    ) as ProgressMetrics;
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
          setNote("");
          setBlocker("");
          setNextAction("");
          setSource("");
          setMetrics(EMPTY_METRICS);
          retryRef.current = null;
          router.refresh();
        })
        .catch(() => setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."))
        .finally(() => setBusy(false));
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={working}>
      <section className="rounded-panel border border-admin-border bg-admin-surface p-4 shadow-card sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-primary-soft text-admin-primary ring-1 ring-inset ring-admin-primary-line">
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
              {options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.value}{option.disabled ? " · 적격성 확인 필요" : ""}
                </option>
              ))}
            </select>
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

      <section className="rounded-panel border border-admin-border bg-admin-surface p-4 shadow-card sm:p-5">
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

      <section className="rounded-panel border border-admin-border bg-admin-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="u-h2">실제 관측 성과</h2>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-admin-text-muted">
              선택 입력입니다. 같은 카드에 같은 산식으로 두 번 이상 입력된 지표만 기초값 대비 변화로 리포트합니다.
            </p>
          </div>
          <span className="rounded-full bg-state-notice-bg px-2.5 py-1 text-[11px] font-semibold text-state-notice ring-1 ring-inset ring-state-notice-line">
            예상값 입력 금지
          </span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {METRIC_FIELDS.map((field) => (
            <label key={field.key} className="text-[13px] font-semibold text-admin-text">
              {field.label}
              <span className="relative mt-1.5 block">
                <input
                  type="number"
                  min={0}
                  max={field.max}
                  step={field.step}
                  value={metrics[field.key]}
                  onChange={(event) => updateMetric(field.key, event.target.value)}
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
          ))}
        </div>
      </section>

      {isDemoReadOnly ? (
        <p className="rounded-xl bg-state-notice-bg px-4 py-3 text-[13px] leading-5 text-state-notice ring-1 ring-inset ring-state-notice-line">
          공개 데모는 읽기 전용입니다. 운영 권한이 연결된 환경에서 기록할 수 있습니다.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl bg-state-warn-bg px-4 py-3 text-[13px] leading-5 text-state-warn ring-1 ring-inset ring-state-warn-line">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="rounded-xl bg-state-good-bg px-4 py-3 text-[13px] leading-5 text-state-good ring-1 ring-inset ring-state-good-line">
          {success}
        </p>
      ) : null}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-admin-border bg-admin-surface/95 p-3 shadow-lift backdrop-blur sm:px-4">
        <p className="text-xs leading-5 text-admin-text-muted">
          저장하면 카드 상태와 경과 리포트가 함께 갱신됩니다.
        </p>
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
