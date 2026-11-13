import Link from "next/link";
import { AUTHOR_NAME, AUTHOR_URL, REPO_URL } from "@/lib/site";

export const metadata = {
  title: "How it's built — Orbital Insight",
  description:
    "The engineering behind Orbital Insight: SGP4 validated against the official reference suite, client-side conjunction screening, a CI/CD pipeline that smoke-tests every deployment, and the bugs that shaped it.",
};



const NUMBERS = [
  { value: "~16,000", label: "satellites propagated with SGP4 in your browser, live" },
  { value: "700 / 700", label: "rows of the official SGP4 test suite reproduced within 2 × 10⁻⁷" },
  { value: "~2.5 s", label: "to screen the ISS against every active satellite for 24 h" },
  { value: "320+", label: "automated tests, from orbital maths to real-browser journeys" },
] as const;

const STORIES = [
  {
    title: "The globe worked everywhere except production",
    problem:
      "A Cesium dependency embedded a WASM string that the production minifier turned into invalid JavaScript. Every test passed; visitors got a blank globe and a SyntaxError.",
    decision:
      "Alias the unused module away, judge visual work only against production builds, and smoke-test every deployment at its own URL with one headline assertion: no uncaught page errors.",
    evidence: "tests/e2e/smoke.spec.ts runs on every Vercel deployment (post-deploy.yml).",
  },
  {
    title: "The provider refused our servers, not our users",
    problem:
      "CelesTrak answered Vercel's functions with HTTP 500 for the full-catalog query while answering other networks. The globe's sky, the atlas and the screener all went empty.",
    decision:
      "Each deployment carries its own validated copy of the catalog, served at once with its real age and refreshed in the background. A scheduled job keeps it fresh; past a week it is refused, not served.",
    evidence: "Five service tests cover fresh, refreshing, stale-labelled, expired and newest-copy-wins cases.",
  },
  {
    title: "Screening took 10 seconds",
    problem:
      "Starlink lowered a shell to ~480 km, inside the ISS's screening band, and 7,385 candidates survived the radius filter: 11.5 million SGP4 propagations.",
    decision:
      "Two objects can't close faster than 16 km/s, so from separation d nothing gets within the threshold for (d − threshold) / 16 km/s. The sweep jumps ahead by exactly that much.",
    evidence: "2.4 M propagations in ~2.5 s with identical results, and a test proving equivalence with the brute-force sweep.",
  },
  {
    title: "The ISS was drawn inside the Earth",
    problem:
      "Positions in kilometres were handed to Cesium, which expects metres. A readout-only test had passed while the time slider moved nothing on the globe.",
    decision:
      "Unit conversions live in one module, and the globe publishes what Cesium actually holds (its clock, the satellite's altitude) so tests assert on the rendered truth.",
    evidence: "The e2e journey reads the ISS altitude back from Cesium and requires 350–460 km.",
  },
  {
    title: "A test that failed by itself",
    problem:
      "A service test compared the real clock against a checked-in data snapshot, and began failing a week after the file was written, with no code change.",
    decision:
      "Time is pinned relative to the snapshot, and the opposite edge (past the horizon, the service must refuse) got its own test.",
    evidence: "tests/integration/satellite-service.test.ts.",
  },
  {
    title: "A 27 kB validator for a 1 kB answer",
    problem:
      "Town search and the cloud forecast validated their small responses with Zod in the browser. The home page's JavaScript jumped from 122 kB to 150 kB, a hair under its budget, and every visitor would have paid for it.",
    decision:
      "The server keeps Zod; the two browser clients check the same rules by hand with three small guards. The budget gate stays as the alarm.",
    evidence: "Home back to 126 kB; CI's bundle-budget step fails any page over its limit, and the rejection tests still cover every malformed shape.",
  },
] as const;

const PIPELINE = [
  ["Pull request", "Types, zero-warning lint, 280+ unit and integration tests, production build, bundle-size budget, 35+ browser journeys"],
  ["Preview deployment", "Vercel builds the branch; the smoke suite runs against the preview URL"],
  ["Merge to main", "Production deploys; smoke suite and Lighthouse run against production"],
  ["Every two days", "A runner refreshes the bundled orbital data and commits it, which redeploys"],
] as const;

export default function EngineeringPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-12">
      <header className="pt-8 pb-6">
        <h1 className="heading-display text-[30px] md:text-[40px]">How it&apos;s built</h1>
        <p className="lede mt-2 max-w-2xl text-[16px]">
          Real orbital data, maths checked against published references, every limitation stated, and nothing shipped
          without passing the same gates every time.
        </p>
        <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]" data-testid="author-credit">
          Designed and built by{" "}
          <a href={AUTHOR_URL} className="font-semibold text-[var(--color-text-primary)] hover:underline">
            {AUTHOR_NAME}
          </a>
          .
        </p>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
          <a href={REPO_URL} className="text-[var(--color-accent)] hover:underline">
            Source on GitHub →
          </a>
          <Link href="/methodology" className="text-[var(--color-accent)] hover:underline">
            Methodology and limits →
          </Link>
        </p>
      </header>

      <section aria-label="In numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {NUMBERS.map((n) => (
          <div key={n.label} className="panel px-4 py-3">
            <div className="text-[24px] font-bold tracking-tight md:text-[28px]">{n.value}</div>
            <div className="text-[13px] text-[var(--color-text-secondary)]">{n.label}</div>
          </div>
        ))}
      </section>

      <section className="mt-10" aria-labelledby="arch-title">
        <h2 id="arch-title" className="text-[20px] font-semibold">
          Where the work happens
        </h2>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--color-text-secondary)]">
          The heavy computation runs on your device; the server only fetches, validates and caches public data.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
          <ArchColumn
            title="Your browser"
            items={[
              ["Sky worker", "SGP4 for every active satellite; positions handed over as zero-copy typed arrays"],
              ["Screening worker", "Radius filter → sampled sweep with time skipping → millisecond TCA"],
              ["Cesium globe", "Loads only when visible; shader compiles forced during load, not mid-drag"],
            ]}
          />
          <Arrow />
          <ArchColumn
            title="Vercel"
            items={[
              ["CDN", "Caches the catalog for hours, revalidates in the background"],
              ["Route handlers", "Validate with Zod → call a service → typed errors to HTTP statuses"],
              ["Pure domain", "Orbits, passes, sunlight, screening: no React, no HTTP, unit-tested"],
              ["Bundled snapshots", "The deployment's own copy of the catalog, with its real age"],
            ]}
          />
          <Arrow />
          <ArchColumn
            title="Public data"
            items={[
              ["CelesTrak GP data", "Asked by the server, politely: ≥ 2 s between requests, 15 s timeout, back-off after failures"],
              [
                "Open-Meteo",
                "Town search and cloud forecasts, asked by your browser directly: its free tier is limited per IP, which a shared server address would exhaust",
              ],
            ]}
          />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="stories-title">
        <h2 id="stories-title" className="text-[20px] font-semibold">
          Problems that shaped it
        </h2>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--color-text-secondary)]">
          Each of these was a real failure in this project. Each one left behind a fix and a test that keeps it fixed.
        </p>
        <ol className="mt-4 grid gap-3 md:grid-cols-2">
          {STORIES.map((story) => (
            <li key={story.title} className="panel p-4">
              <h3 className="text-[16px] font-semibold">{story.title}</h3>
              <dl className="mt-2 space-y-2 text-[13px]">
                <div>
                  <dt className="label">What went wrong</dt>
                  <dd className="text-[var(--color-text-secondary)]">{story.problem}</dd>
                </div>
                <div>
                  <dt className="label">What changed</dt>
                  <dd className="text-[var(--color-text-secondary)]">{story.decision}</dd>
                </div>
                <div>
                  <dt className="label">How we know</dt>
                  <dd className="text-[var(--color-text-secondary)]">{story.evidence}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="pipeline-title">
        <h2 id="pipeline-title" className="text-[20px] font-semibold">
          How a change reaches you
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-4">
          {PIPELINE.map(([step, detail], i) => (
            <li key={step} className="panel p-4">
              <div className="font-mono text-[12px] text-[var(--color-accent)]">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-1 text-[15px] font-semibold">{step}</div>
              <div className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{detail}</div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10" aria-labelledby="stack-title">
        <h2 id="stack-title" className="text-[20px] font-semibold">
          Stack
        </h2>
        <p className="mt-2 max-w-3xl text-[14px] text-[var(--color-text-secondary)]">
          Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · satellite.js (SGP4) · CesiumJS · Zod ·
          Web Workers · Vitest · Playwright · GitHub Actions · Vercel.
        </p>
      </section>
    </div>
  );
}

function ArchColumn({ title, items }: { title: string; items: readonly (readonly [string, string])[] }) {
  return (
    <div className="panel p-4">
      <div className="label uppercase tracking-wide">{title}</div>
      <ul className="mt-2 space-y-2">
        {items.map(([name, detail]) => (
          <li key={name} className="panel-inset px-3 py-2">
            <div className="text-[14px] font-semibold">{name}</div>
            <div className="text-[12px] text-[var(--color-text-secondary)]">{detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Arrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-[22px] text-[var(--color-text-muted)]">
      <span className="hidden md:inline">⇄</span>
      <span className="md:hidden">⇅</span>
    </div>
  );
}
