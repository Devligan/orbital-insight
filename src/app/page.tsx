import Link from "next/link";
import { ExplorerView } from "@/features/satellites/explorer-view";

/**
 * Home / Explorer: opens directly into a usable satellite explorer with the
 * ISS as the default real-data example. No marketing gate, no sign-in.
 *
 * A shared link's ?cat= and ?t= are read here on the server and passed down,
 * so the page is rendered as real HTML (the hero, the tonight panel) rather
 * than a client-only shell that says "Loading" until JavaScript runs.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string | string[]; t?: string | string[] }>;
}) {
  const { cat, t } = await searchParams;
  return (
    <>
      <ExplorerView
        initialSatellite={{ satelliteNumber: "25544", name: "ISS (ZARYA)" }}
        initialCat={typeof cat === "string" ? cat : null}
        initialTime={typeof t === "string" ? t : null}
      />
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
    body: "Every active satellite placed by how high and how tilted its orbit is. Starlink's shells and the geostationary ring jump right out.",
  },
  {
    href: "/conjunctions",
    title: "Close approaches",
    body: "Pick a satellite and find everything that will pass within a few kilometres of it over the next days, and how fast.",
  },
  {
    href: "/passes",
    title: "Pass predictions",
    body: "Every pass of any satellite over any place, visible or not, with a chart of where it crosses your sky.",
  },
  {
    href: "/about",
    title: "About this sky",
    body: "What happens when you open the site, why most passes can't be seen, and the public data it's all built on.",
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
