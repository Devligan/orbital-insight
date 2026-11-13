import Link from "next/link";
import { PAGE, PageHeader } from "@/components/ui/page-header";
import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from "@/lib/site";

export const metadata = {
  title: "About · Orbital Insight",
  description:
    "What this site is, what happens when you open it, and the public data and open-source work it's built on.",
};

const HAPPENING = [
  [
    "Every satellite, worked out on your device",
    "The site downloads the published orbits of about 16,000 active satellites and your browser works out where each one is and keeps them moving in real time. Nothing you see on the globe is a live feed; it's all prediction from public data, and usually good to about a kilometre.",
  ],
  [
    "Sunlight decides what you can see",
    "A satellite only shows up at night if it's still in sunlight high above you, after your own sun has set. Every pass is checked for both, so the list on the front page is only the ones you could actually see.",
  ],
  [
    "Your spot stays yours",
    "A place you pick is remembered in this browser only. Town searches and cloud forecasts go straight from your browser to Open-Meteo; there are no accounts and nothing about you is stored on a server.",
  ],
] as const;

const CREDITS = [
  ["CelesTrak", "https://celestrak.org/", "the orbital elements for every satellite, maintained by T.S. Kelso"],
  ["Open-Meteo", "https://open-meteo.com/", "town search (places from GeoNames) and cloud forecasts, CC BY 4.0"],
  ["satellite.js", "https://github.com/shashwatak/satellite-js", "SGP4, ported from David Vallado's reference implementation"],
  ["CesiumJS", "https://cesium.com/platform/cesiumjs/", "the 3D globe"],
  ["NASA 3D Resources", "https://science.nasa.gov/3d-resources/", "the ISS model (credit NASA / Michael D. Carbajal)"],
  ["Natural Earth", "https://www.naturalearthdata.com/", "the map of Earth, public domain"],
  ["IBM Plex", "https://www.ibm.com/plex/", "the typefaces"],
] as const;

export default function AboutPage() {
  return (
    <div className={PAGE}>
      <PageHeader eyebrow="About" title="A sky computed in your browser">
        <p>
          There are thousands of satellites overhead right now, and a few of them are bright enough to see if you know
          when and where to look. This site works that out from their published orbits: what will cross your sky
          tonight, what that moving light you just saw probably was, and where everything in orbit is right now.
        </p>
      </PageHeader>

      <div className="reading max-w-[72ch]">
        <section aria-labelledby="happening-title">
          <h2 id="happening-title" className="text-[20px] font-medium tracking-[-0.01em]">
            What happens when you open it
          </h2>
          <dl className="mt-5 flex flex-col gap-6">
            {HAPPENING.map(([title, body]) => (
              <div key={title}>
                <dt className="text-[16px] font-medium text-[var(--color-text-primary)]">{title}</dt>
                <dd className="mt-1.5 text-[15px] leading-relaxed text-[var(--color-text-secondary)]">{body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-text-secondary)]">
            Every approximation, and where the numbers stop being trustworthy, is written down on{" "}
            <Link href="/methodology" className="link">
              how the numbers are made
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="credits-title" className="mt-12 border-t border-[var(--color-border-hairline)] pt-10">
          <h2 id="credits-title" className="text-[20px] font-medium tracking-[-0.01em]">
            Standing on
          </h2>
          <ul className="mt-5 flex flex-col divide-y divide-[var(--color-border-hairline)]">
            {CREDITS.map(([name, url, what]) => (
              <li key={name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                <a href={url} className="link w-36 shrink-0 text-[15px]" target="_blank" rel="noreferrer">
                  {name}
                </a>
                <span className="min-w-0 flex-1 text-[14px] text-[var(--color-text-secondary)]">{what}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 border-t border-[var(--color-border-hairline)] pt-10">
          <p className="text-[15px] text-[var(--color-text-secondary)]" data-testid="author-credit">
            Made by{" "}
            <a href={AUTHOR_URL} className="link">
              {AUTHOR_NAME}
            </a>
            . The code is on{" "}
            <a href={REPO_URL} className="link">
              GitHub
            </a>
            , along with some notes on what went wrong while building it.
          </p>
        </section>
      </div>
    </div>
  );
}
