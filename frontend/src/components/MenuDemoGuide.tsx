import { Icon, type IconName } from "@/components/Icon";

/** 사이드바의 앵커 목적지를 처음 여는 담당자에게, 현재 시드 데이터로 읽을 순서를 안내한다. */
export function MenuDemoGuide({
  icon,
  title,
  description,
  steps,
}: {
  icon: IconName;
  title: string;
  description: string;
  steps: string[];
}) {
  return (
    <section className="mb-4 rounded-2xl bg-admin-primary-soft p-4 ring-1 ring-inset ring-admin-primary-line sm:p-5" aria-label={`${title} 데모 안내`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-admin-primary text-white shadow-[0_5px_14px_-7px_rgb(79_70_229)]">
          <Icon name={icon} size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-admin-primary">데모 시뮬레이션</p>
          <h3 className="mt-1 text-[15px] font-bold text-admin-text">{title}</h3>
          <p className="mt-1 break-keep text-[12px] leading-5 text-admin-text-muted">{description}</p>
        </div>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2 rounded-xl bg-white/75 px-3 py-2 text-[11px] leading-4 text-admin-text-soft ring-1 ring-inset ring-white">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-admin-primary text-[9px] font-bold text-white">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
