import Link from "next/link";
import { Section } from "@/components/Section";

/**
 * 아직 화면을 만들지 않은 라우트의 자리표시자.
 * 밑작업 범위(대시보드·방문객 위젯) 밖의 화면은 FE 담당이 08 문서 태스크대로 채운다 —
 * 여기서는 사이드바 네비게이션이 404로 끊기지 않게만 하고, 어떤 데이터가 이미 연결돼 있는지 적어 둔다.
 */
export function RoutePlaceholder({
  task,
  title,
  summary,
  ready,
  todo,
}: {
  task: string;
  title: string;
  summary: string;
  /** 이 화면에서 바로 쓸 수 있는 데이터 접근 함수 (lib/api.ts) */
  ready: string[];
  todo: string[];
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <span className="rounded-full bg-admin-primary-soft px-2 py-0.5 text-[11px] font-medium text-admin-primary">
          {task} · 화면 미구현
        </span>
        <h2 className="mt-2 text-lg font-bold text-admin-text">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-admin-text-muted">{summary}</p>
      </div>

      <Section title="이미 연결된 데이터" desc="lib/api.ts만 호출하면 mock·실 API 어느 쪽에서도 동작한다.">
        <ul className="flex flex-col gap-1 text-sm text-admin-text">
          {ready.map((r) => (
            <li key={r} className="flex gap-2">
              <span className="text-admin-primary">·</span>
              <code className="text-xs">{r}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="남은 작업" desc="docs/plan/08-frontend-tasks.md의 해당 태스크가 정본이다.">
        <ul className="flex flex-col gap-1 text-sm text-admin-text">
          {todo.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-admin-text-muted">·</span>
              <span className="break-keep">{t}</span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/dashboard"
          className="rounded-lg bg-admin-primary px-3 py-2 font-medium text-white"
        >
          지역 소비 분석 보기
        </Link>
        <Link
          href="/widget"
          className="rounded-lg bg-admin-surface px-3 py-2 font-medium text-admin-text shadow-card"
        >
          방문객 위젯 보기
        </Link>
      </div>
    </div>
  );
}
