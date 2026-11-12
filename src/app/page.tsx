import Link from "next/link";
import { Suspense } from "react";
import { ExplorerView } from "@/features/satellites/explorer-view";
import { Loading } from "@/components/ui/primitives";

/**
 * Home / Explorer — opens directly into a usable satellite explorer with the
 * ISS as the default real-data example. No marketing gate, no sign-in.
 *
 * Suspense boundary: the explorer reads share-link query params
 * (?cat=&t=) via useSearchParams, which must be wrapped for prerendering.
 */
export default function HomePage() {
  return (
    <>
      {/* The fallback reserves a full screen: a one-line placeholder let the
          footer paint in view and then jump (CLS 0.108 on phones). */}
      <Suspense
        fallback={
          <div className="min-h-[calc(100svh-56px)]">
            <Loading label="Loading explorer…" />
          </div>
        }
      >
        <ExplorerView initialSatellite={{ satelliteNumber: "25544", name: "ISS (ZARYA)" }} />
      </Suspense>
      <MoreToExplore />
    </>
  );
}

const DESTINATIONS = [
  {
    href: "/atlas",
    title: "Who's in orbit",
    body: "Every active satellite charted by height and tilt. Starlink's shells, the sun-synchronous band and the geostationary ring, at a glance.",
  },
  {
    href: "/conjunctions",
    title: "Close approaches",
    body: "Screen any satellite against the whole catalog in your browser: time of closest approach, miss distance, closing speed.",
  },
  {
    href: "/passes",
    title: "Pass predictions",
    body: "Rise, peak and set for any satellite from any spot on Earth, with sunlight and sky darkness modelled. Exports to CSV.",
  },
  {
    href: "/methodology",
    title: "How it works",
    body: "Data sources, SGP4 validation against the official test suite, every approximation and limit, stated plainly.",
  },
] as const;

/** Below the fold: the rest of the app, for visitors who came for more than tonight's sky. */
function MoreToExplore() {
  return (
    <section aria-labelledby="explore-title" className="mx-auto max-w-6xl px-4 pt-10">
      <h2 id="explore-title" className="text-[20px] font-semibold">
        More to explore
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DESTINATIONS.map((d) => (
          <li key={d.href}>
            <Link
              href={d.href}
              className="panel group flex h-full flex-col p-4 transition-colors hover:border-[var(--color-accent-dim)]"
            >
              <span className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                {d.title} <span aria-hidden="true" className="text-[var(--color-accent)] transition-transform group-hover:translate-x-0.5">→</span>
              </span>
              <span className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{d.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
