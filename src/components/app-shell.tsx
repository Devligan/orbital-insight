"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CatalogSearch } from "@/components/catalog-search";

const NAV = [
  { href: "/", label: "Explorer", hint: "Live satellite explorer" },
  { href: "/passes", label: "Passes", hint: "Pass predictions" },
  { href: "/compare", label: "Compare", hint: "Orbital comparison" },
  { href: "/watchlist", label: "Watchlist", hint: "Saved satellites" },
  { href: "/methodology", label: "Methodology", hint: "Data & calculations" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar rail (desktop) */}
      <nav
        aria-label="Primary"
        className="hidden w-44 shrink-0 flex-col border-r border-[var(--color-border-hairline)] bg-[var(--color-bg-panel)] md:flex"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full border border-[var(--color-accent)]" />
          <Link href="/" className="text-[13px] font-semibold tracking-wide text-[var(--color-text-primary)]">
            ORBITAL&nbsp;INSIGHT
          </Link>
        </div>
        <ul className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={item.hint}
                  className={
                    "flex items-center gap-2 rounded-[3px] px-3 py-2 text-[13px] " +
                    (active
                      ? "bg-[var(--color-bg-inset)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-inset)] hover:text-[var(--color-text-primary)]")
                  }
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto px-4 py-4 text-[11px] leading-4 text-[var(--color-text-muted)]">
          <p>Data: CelesTrak GP</p>
          <p>Propagation: SGP4</p>
          <p className="mt-1">Predictions only — not live telemetry.</p>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border-hairline)] bg-[var(--color-bg-panel)] px-3">
          <CatalogSearch
            onSelect={(sat) => router.push(`/satellites/${sat.satelliteNumber}`)}
          />
          <span className="ml-auto hidden text-[11px] text-[var(--color-text-muted)] sm:inline">
            SGP4 predictions · UTC
          </span>
        </header>

        <nav aria-label="Primary (compact)" className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-hairline)] bg-[var(--color-bg-panel)] px-2 py-1.5 md:hidden">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "shrink-0 rounded-[3px] px-3 py-1.5 text-[12px] " +
                  (active
                    ? "bg-[var(--color-bg-inset)] text-[var(--color-accent)]"
                    : "text-[var(--color-text-secondary)]")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
