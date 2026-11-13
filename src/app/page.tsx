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
    href: "/identify",
    title: "What did I just see?",
    body: "Saw a light glide across the sky? Say when and which way you looked, and every catalogued satellite is checked against your sky.",
  },
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
    href: "/engineering",
    title: "How it's built",
    body: "SGP4 checked against the official test suite, the screening algorithm, the delivery pipeline, and the bugs that shaped it.",
  },
] as const;

/** Below the fold: the rest of the app, for visitors who came for more than tonight's sky. */
function MoreToExplore() {
  return (
    <section aria-labelledby="explore-title" className="mx-auto max-w-6xl px-4 pt-14">
      <h2 id="explore-title" className="eyebrow">
        Also here
      </h2>
      <ul className="mt-3 grid border-t border-[var(--color-border-hairline)] sm:grid-cols-2 lg:grid-cols-5">
        {DESTINATIONS.map((d, i) => (
          <li key={d.href} className="border-b border-[var(--color-border-hairline)] lg:border-b-0 lg:border-r lg:pl-5 lg:first:pl-0 lg:last:border-r-0">
            <Link href={d.href} className="group flex h-full flex-col gap-1.5 py-5 pr-5">
              <span className="font-mono text-[11px] text-[var(--color-text-muted)]">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[16px] font-medium text-[var(--color-text-primary)] decoration-[var(--color-accent)] underline-offset-4 group-hover:underline">
                {d.title}
              </span>
              <span className="text-[13.5px] leading-relaxed text-[var(--color-text-secondary)]">{d.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
