import type { Metadata } from "next";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { ProgressRecordForm } from "@/components/ProgressRecordForm";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "추진 기록 입력 · 상생 나침반" };
export const dynamic = "force-dynamic";

const kstLocalNow = (): string =>
  new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16);

export default async function NewProgressRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ card_id?: string | string[] }>;
}) {
  const query = await searchParams;
  const requestedId = Array.isArray(query.card_id) ? query.card_id[0] : query.card_id;
  const [dashboard, result] = await Promise.all([
    api.dashboard(),
    api.cards({ status: "approved" }),
  ]);
  const cards = [...result.cards].sort((a, b) =>
    (b.last_progress_record_at ?? b.decided_at ?? b.created_at).localeCompare(
      a.last_progress_record_at ?? a.decided_at ?? a.created_at,
    ),
  );
  const initialCardId = cards.some((card) => card.id === requestedId) ? requestedId : cards[0]?.id;

  return (
    <AdminShell dashboard={dashboard}>
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Link
          href="/tracking"
          className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-admin-text-muted underline-offset-4 hover:text-admin-primary hover:underline"
        >
          <Icon name="chevronRight" size={14} strokeWidth={2} className="rotate-180" />
          추진 경과 리포트로
        </Link>

        <PageHeader
          icon="workflow"
          eyebrow="운영 기록"
          title="추진 기록 입력"
          lede="상태 변경의 근거와 다음 행동, 실제 관측 성과를 한 번에 남깁니다. 입력값은 카드 타임라인과 경과 리포트에 그대로 반영됩니다."
          actions={
            <Link
              href="/tracking"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text shadow-card transition-colors hover:border-admin-primary-line hover:text-admin-primary"
            >
              <Icon name="report" size={15} />
              리포트 보기
            </Link>
          }
        />

        {cards.length ? (
          <ProgressRecordForm
            cards={cards}
            initialCardId={initialCardId}
            initialRecordedAt={kstLocalNow()}
          />
        ) : (
          <section className="rounded-panel border border-dashed border-admin-border bg-admin-surface px-5 py-14 text-center shadow-card">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-admin-surface-sunken text-admin-text-muted">
              <Icon name="cards" size={21} />
            </span>
            <h2 className="mt-4 text-lg font-bold text-admin-text">기록할 승인 카드가 없습니다</h2>
            <p className="mx-auto mt-2 max-w-lg break-keep text-sm leading-6 text-admin-text-muted">
              정책 나침반에서 제안 근거를 검토하고 담당자 결정을 완료하면 추진 기록을 입력할 수 있습니다.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-admin-primary px-4 py-2 text-sm font-bold text-white hover:bg-admin-primary-strong"
            >
              정책 나침반으로
              <Icon name="arrowRight" size={15} />
            </Link>
          </section>
        )}
      </div>
    </AdminShell>
  );
}
