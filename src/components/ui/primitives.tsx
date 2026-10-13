import type { ReactNode } from "react";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel p-4 ${className}`}>{children}</section>;
}

export function PanelHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-hairline)] pb-2 mb-3">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
        {title}
      </h2>
      {right}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const cls = tone === "good" ? "badge-good" : tone === "warn" ? "badge-warn" : tone === "bad" ? "badge-bad" : "";
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function DataField({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 border-b border-[var(--color-bg-inset)]">
      <span className="label w-40 shrink-0">{label}</span>
      <span className="data-value text-right">
        {value}
        {unit ? <span className="text-[var(--color-text-muted)]"> {unit}</span> : null}
      </span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <p className="text-[var(--color-text-secondary)]" style={{ fontSize: 13 }}>{title}</p>
      {hint ? <p className="text-[var(--color-text-muted)]" style={{ fontSize: 12 }}>{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ title, message, retry }: { title: string; message?: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <p className="text-[var(--color-status-bad)]" style={{ fontSize: 13 }}>{title}</p>
      {message ? <p className="text-[var(--color-text-muted)]" style={{ fontSize: 12 }}>{message}</p> : null}
      {retry ? (
        <button className="btn btn-secondary" onClick={retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10" role="status">
      <span
        aria-hidden="true"
        className="inline-block size-3 animate-pulse rounded-full bg-[var(--color-accent-dim)]"
      />
      <span className="text-[var(--color-text-muted)]" style={{ fontSize: 12 }}>
        {label ?? "Loading…"}
      </span>
    </div>
  );
}
