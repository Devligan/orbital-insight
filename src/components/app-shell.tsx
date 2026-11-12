"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CatalogSearch } from "@/components/catalog-search";

/**
 * App shell — consumer-app framing.
 *
 * One unobtrusive top bar (brand → search → nav) and an honest footer for the
 * engineering fine print. The old sidebar rail advertised SGP4/CelesTrak
 * above the fold; that vocabulary belongs in the footer, where curious
 * people can find it and everyone else can ignore it.
 */

const NAV = [
  { href: "/", label: "Sky" },
  { href: "/atlas", label: "Atlas" },
  { href: "/conjunctions", label: "Conjunctions" },
  { href: "/passes", label: "Passes" },
  { href: "/compare", label: "Compare" },
  { href: "/watchlist", label: "Watchlist" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border-hairline)] bg-[color-mix(in_oklab,var(--color-bg-panel)_88%,transparent)] px-4 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-[var(--color-text-primary)]">
          <span aria-hidden="true" className="inline-block size-3 rounded-full bg-[var(--color-accent)] opacity-80" />
          Orbital<span className="text-[var(--color-accent)]">Insight</span>
        </Link>

        <div className="mx-auto w-full max-w-md">
          <CatalogSearch onSelect={(sat) => router.push(`/satellites/${sat.satelliteNumber}`)} />
        </div>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-lg px-3 py-1.5 text-[14px] transition-colors " +
                  (active
                    ? "bg-[var(--color-bg-inset)] font-semibold text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-inset)] hover:text-[var(--color-text-primary)]")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Phone nav: same links, scrollable chips under the top bar. */}
      <nav aria-label="Primary (compact)" className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-hairline)] bg-[var(--color-bg-panel)] px-3 py-2 md:hidden">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "shrink-0 rounded-lg px-3 py-1.5 text-[13px] " +
                (active
                  ? "bg-[var(--color-bg-inset)] font-semibold text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)]")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="min-w-0 flex-1">{children}</main>

      <footer className="mt-8 border-t border-[var(--color-border-hairline)] px-4 py-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[var(--color-text-muted)]">
          <span>Real orbital elements from CelesTrak · predictions by SGP4 · never live telemetry.</span>
          <Link href="/methodology" className="text-[var(--color-accent)] hover:underline">
            How this works
          </Link>
          <span className="ml-auto">Not for navigation, safety, or collision avoidance.</span>
        </div>
      </footer>
    </div>
  );
}
