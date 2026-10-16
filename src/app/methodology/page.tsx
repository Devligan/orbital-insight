import Link from "next/link";

export const metadata = {
  title: "Methodology and validation — Orbital Insight",
};

const SECTIONS = [
  {
    id: "sources",
    heading: "Data sources",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Orbital element sets come from{" "}
          <a className="text-[var(--color-accent)] hover:underline" href="https://celestrak.org/" target="_blank" rel="noreferrer">
            CelesTrak&apos;s current GP data interface
          </a>{" "}
          (GP `gp.php` queries in the documented TLE output format) — a free public service maintained by T.S. Kelso.
          We fetch only bounded curated groups (crewed stations, GNSS constellations, scientific satellites) plus
          single-object lookups, never the full active catalog (~11k elements), to respect the provider.
        </li>
        <li>
          Requests are cached server-side for 2 hours; when the provider is unreachable, previously fetched data is
          served and clearly labelled &ldquo;cached&rdquo; or &ldquo;stale — provider unavailable&rdquo;. The
          application never fabricates a response when the provider is down.
        </li>
        <li>
          CelesTrak states its data is free for public use with attribution and asks bulk consumers to cache politely;
          our client throttles its own outbound requests (≥ 2 s spacing) and times out at 15 s. Review CelesTrak&apos;s
          current terms before altering request patterns.
        </li>
        <li>
          The NORAD satellite catalog identifier (column 3–7 of the TLE) is the join key across all features. Names,
          COSPAR designators, and classifications accompany each element set from the provider response itself.
        </li>
      </ul>
    ),
  },
  {
    id: "elements",
    heading: "Orbital elements and their epoch",
    body: (
      <p>
        An element set (TLE) is a snapshot of a satellite&apos;s orbit at its <strong>epoch</strong> — the TLE&apos;s
        instant (line 1, columns 19–32, with the fractional day-of-year). Every derived quantity in this application
        (position, ground track, pass times) inherits the epoch, and we display it alongside every result. Each fetch
        records the retrieval time so &ldquo;how old is this data&rdquo; always has an exact answer. Elements older
        than 36 hours are flagged in the UI — a conservative operational-difference warning from the SGP4 maintenance
        model, not an asserted universal accuracy cutoff.
      </p>
    ),
  },
  {
    id: "sgp4",
    heading: "SGP4 propagation",
    body: (
      <p>
        Positions are propagated with <strong>SGP4</strong> — the Simplified General Perturbations model (coded here via
        the maintained <code>satellite.js</code> implementation). SGP4 models secular and periodic perturbations
        (J2/J4, atmospheric drag via B*, resonant terms) near Earth, and SDP4-style deep-space corrections for orbits
        beyond ~225 minutes of period. It is the standard model trained to consume NORAD element sets; results are in
        the <strong>TEME</strong> frame in kilometres and km/s, exactly what the element sets were fit to. This
        application never substitutes a simplified Kepler orbit for SGP4.
      </p>
    ),
  },
  {
    id: "frames",
    heading: "Coordinate frames and time",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          All timestamps are <strong>UTC</strong>; the application performs no local-time arithmetic internally and
          labels displayed timestamps with UTC explicitly.
        </li>
        <li>
          SGP4 output (TEME) is converted to earth-fixed (ECEF) using the Greenwich sidereal time (GMST) for each
          sample, then to WGS-72 geodetic coordinates (the same ellipsoid the element set model uses internally).
          Differences between WGS-72 and WGS-84 geodetic coordinates are bounded by ~180 m — smaller than the
          prediction error budget — and documented rather than silently mixed.
        </li>
        <li>
          Pass calculations use topocentric azimuth/elevation from the observer&apos;s WGS-72 geodetic location
          (height treated as above-mean-sea-level; the geoid-vs-ellipsoid difference of up to ~100 m shifts pass
          timing by well under a second at LEO rates).
        </li>
      </ul>
    ),
  },
  {
    id: "tracks-passes",
    heading: "Ground tracks and pass predictions",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Ground tracks sample SGP4 positions at bounded intervals (default 240 samples over 24 h). Samples are split
          into segments at the ±180° antimeridian so plots never draw a false line across the map; the split edge
          point is interpolated where a track crosses it.
        </li>
        <li>
          Pass predictions probe the elevation angle every 30°·s of time (30 s steps), find above-threshold crossings,
          refine each rise/set crossing with bisection to &lt; 1 s, and refine the maximum-elevation instant with a
          ternary search. Passes that are already above threshold when the window opens (or never set inside it) are
          reported with an explicit <em>truncated</em> marker rather than invented boundary times.
        </li>
        <li>
          The search window is validated server-side (≤ 30 days) and bounded to at most 25 satellites per request —
          one SGP4 sweep per satellite per request, ~2,880 evaluations for 24 h; cheap enough for the free tier while
          remaining bounded.
        </li>
      </ul>
    ),
  },
  {
    id: "limitations",
    heading: "Prediction limitations (read this before mission planning)",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Predictions, not measurements.</strong> Everything labelled &ldquo;position&rdquo; here is an SGP4
          propagation from a published element set — never a live telemetry feed from the satellite.
        </li>
        <li>
          <strong>Accuracy decays from the epoch.</strong> SGP4+TLE is historically good to very roughly ~1 km at
          epoch for well-tracked LEO objects, growing with prediction duration; GEO and highly-dragged objects differ.
          Exact figures depend on the specific object, the fit quality, and weather in the upper atmosphere — we show
          element age and let you judge against the guidelines linked below.
        </li>
        <li>
          <strong>Passes ≠ visibility.</strong> A predicted pass is orbital geometry relative to your coordinates.
          Visual-visibility judgements model <em>sunlight geometry</em> — the satellite must be lit (cylindrical
          shadow test) and the observer&apos;s sky must be past civil twilight (sun below −6°) — plus a
          phase-corrected apparent-magnitude estimate. That estimate carries roughly ±1.5 magnitudes of
          uncertainty (object sizes are not in the catalog), and clouds, weather, and eyesight are not modeled,
          so this still is not an observing forecast.
        </li>
        <li>
          <strong>The visible window.</strong> Each pass is sampled 24 times between rise and set; the first and
          last visible samples bracket when it can actually be seen, and each edge is refined by bisection to about
          a second (finer would be false precision — the shadow model itself is good to seconds). The window is
          assumed contiguous: within one pass the sky only darkens or brightens, and the satellite crosses the
          shadow boundary at most once. An edge in mid-sky has only two possible causes under this model, and the
          home page names which: Earth&apos;s shadow (&ldquo;fades into Earth&apos;s shadow 25° up in the E&rdquo;)
          or twilight (&ldquo;lost in the brightening sky&rdquo;). The home
          page lists only passes with a visible window still ahead; every geometric pass remains one click away.
        </li>
        <li>
          <strong>Light-model approximations.</strong> The sun position is the low-precision Astronomical
          Almanac approximation (~0.01°, far coarser than we need for the lit/unlit decisions); shadow timing
          ignores penumbra and atmospheric refraction (seconds of difference); brightness scales with range²
          and the illuminated fraction (1 + cos φ)/2 of phase angle φ — a simpler stand-in for a diffuse
          sphere&apos;s phase function — from a default reference magnitude of 0 at 1 000 km and full phase.
          Standards for a plan-outside tool, not for photometry.
        </li>
        <li>
          <strong>Manoeuvring objects</strong> (spacecraft with thrusters, de-orbit schedules, dodging debris) can
          depart from published elements quickly after manoeuvre; predictions for such objects deserve extra caution.
        </li>
        <li>
          <strong>Not for collision avoidance, safety-of-life, or operational mission planning.</strong> This is an
          educational/analysis product. Use dedicated professional services for those cases.
        </li>
      </ul>
    ),
  },
  {
    id: "validation",
    heading: "Automated validation",
    body: (
      <>
        <p>
          The SGP4 integration is validated against the <strong>official SGP4 verification suite</strong>
          {" "}published with Vallado&apos;s reference implementation (`SGP4-VER.TLE` + `tcppver.out`, mirrored by
          the python-sgp4 project). Our test regenerates the expected 700 output rows and compares the first seven
          numeric fields (TEME km, km/s) against the file at a tolerance of <code>2e-7</code> — the same bound the
          python-sgp4 project uses — across all 33 element sets, including the known SGP4 failure cases.
        </p>
        <p className="mt-2">
          Additional suites cover: TLE parsing/checksum rejection, coordinate conversions, ground-track antimeridian
          splitting, pass-finding bracket/bisection behaviour (including onset-at-window-start edge cases), the
          CelesTrak client against malformed/timeout/rate-limit fixtures, API validation and bounds, and snapshot
          persistence when configured. Run everything with <code>npm test</code>; the e2e flows live under
          <code> tests/e2e</code> (Playwright).
        </p>
      </>
    ),
  },
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-4xl p-4">
      <h1 className="text-[18px] font-semibold">Methodology &amp; validation</h1>
      <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
        What this application computes, from which sources, with which limits — stated so you can make your own
        judgement about the numbers.
      </p>

      <nav aria-label="Sections" className="panel-inset mt-3 flex flex-wrap gap-2 p-2 text-[12px]">
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="text-[var(--color-accent)] hover:underline">
            {section.heading}
          </a>
        ))}
      </nav>

      {SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="panel mt-3 scroll-mt-14 p-4">
          <h2 className="mb-2 text-[14px] font-semibold">{section.heading}</h2>
          <div className="space-y-2 text-[13px] text-[var(--color-text-secondary)]">{section.body}</div>
        </section>
      ))}

      <p className="mt-4 text-[12px] text-[var(--color-text-muted)]">
        See also the <Link href="/" className="text-[var(--color-accent)] hover:underline">explorer</Link> and the
        repository README for run/validation instructions.
      </p>
    </div>
  );
}
