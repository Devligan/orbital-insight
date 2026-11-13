"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from "@/lib/site";
import type { ReactNode } from "react";
import { CatalogSearch } from "@/components/catalog-search";

/**
 * App shell - consumer-app framing.
 *
 * One unobtrusive top bar (brand → search → nav) and an honest footer for the
 * engineering fine print. The old sidebar rail advertised SGP4/CelesTrak
 * above the fold; that vocabulary belongs in the footer, where curious
 * people can find it and everyone else can ignore it.
 */

const NAV = [
  { href: "/", label: "Sky" },
  { href: "/identify", label: "Identify" },
  { href: "/atlas", label: "Atlas" },
  { href: "/conjunctions", label: "Conjunctions" },
  { href: "/passes", label: "Passes" },
  { href: "/compare", label: "Compare" },
  { href: "/watchlist", label: "Watchlist" },
] as const;

/** The mark: an inclined orbit, and the one point on it that's lit. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="var(--color-text-primary)" strokeWidth="1.4" />
      <ellipse
        cx="12"
        cy="12"
        rx="10.5"
        ry="4.3"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="1.1"
        transform="rotate(-28 12 12)"
      />
      <circle cx="20.6" cy="7.3" r="1.9" fill="var(--color-accent)" />
    </svg>
  );
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-4 border-b border-[var(--color-border-hairline)] bg-[color-mix(in_oklab,var(--color-bg-root)_90%,transparent)] px-4 backdrop-blur">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]"
        >
          <Mark />
          Orbital Insight
        </Link>

        <div className="mx-auto w-full max-w-md">
          <CatalogSearch onSelect={(sat) => router.push(`/satellites/${sat.satelliteNumber}`)} />
        </div>

        <nav aria-label="Primary" className="hidden h-full items-stretch md:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center border-b-2 px-2.5 text-[14px] transition-colors lg:px-3 " +
                  (active
                    ? "border-[var(--color-accent)] text-[var(--color-text-primary)]"
                    : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Phone nav: the same links, scrolling sideways under the top bar. */}
      <nav
        aria-label="Primary (compact)"
        className="flex overflow-x-auto border-b border-[var(--color-border-hairline)] px-2 md:hidden"
      >
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "shrink-0 border-b-2 px-3 py-2.5 text-[13px] " +
                (active
                  ? "border-[var(--color-accent)] text-[var(--color-text-primary)]"
                  : "border-transparent text-[var(--color-text-secondary)]")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <main className="min-w-0 flex-1">{children}</main>

      <footer className="mt-12 border-t border-[var(--color-border-hairline)] px-4 py-8">
        <div className="mx-auto grid max-w-6xl gap-6 text-[13px] text-[var(--color-text-muted)] sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Mark />
              <span>
                Orbital Insight, built by{" "}
                <a href={AUTHOR_URL} className="link">
                  {AUTHOR_NAME}
                </a>
                .{" "}
                <a href={REPO_URL} className="link">
                  Source
                </a>
              </span>
            </span>
            <span>
              Orbital elements from CelesTrak, propagated with SGP4. Predictions, never live telemetry. Not for
              navigation, safety or collision avoidance.
            </span>
          </div>
          <nav aria-label="About" className="flex gap-5 sm:flex-col sm:items-end sm:gap-1.5">
            <Link href="/methodology" className="hover:text-[var(--color-text-primary)]">
              How this works
            </Link>
            <Link href="/engineering" className="hover:text-[var(--color-text-primary)]">
              How it&apos;s built
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}