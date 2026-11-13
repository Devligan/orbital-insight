"use client";

/**
 * "What did I just see?" A person saw a steady light glide across the sky;
 * this names the candidates. Three plain questions (when, which way, how
 * high), then the whole active catalog is searched in a Web Worker.
 *
 * The answer is honest about its limits: a sky that was too bright, nothing
 * nearby, and objects the public catalog doesn't carry are all said out loud,
 * along with the usual non-satellite explanations.
 */

import { PAGE, PageHeader } from "@/components/ui/page-header";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { HeightBand, LaunchGroup, SightingCandidate, SightingResult } from "@/domain/sighting/identify";
import { DARK_SKY_SUN_ELEVATION_DEG } from "@/domain/sighting/identify";
import { constellationOf, constellationRule, type ConstellationId } from "@/domain/catalog/atlas";
import { PlaceSearch } from "@/features/observer/place-search";
import { useObserverLocation } from "@/features/observer/use-observer-location";
import { brightnessWord, compassPoint } from "@/features/pass-prediction/sky-words";
import { heightWords } from "@/features/tonight/visible-tonight";
import type { CatalogRow, IdentifyRequest, IdentifyWorkerMessage } from "./identify-worker";
import { SightingChart } from "./sighting-chart";

/** People's "about 9:40" is rarely better than this. */
const HALF_WINDOW_MINUTES = 4;
/** One compass point either side of the direction picked. */
const MAX_SEPARATION_DEG = 25;
const SHOWN_AT_FIRST = 6;
const CHARTED = 5;

const WHEN_CHOICES = [
  { label: "Just now", minutesAgo: 0 },
  { label: "5 min ago", minutesAgo: 5 },
  { label: "15 min ago", minutesAgo: 15 },
  { label: "30 min ago", minutesAgo: 30 },
  { label: "1 hour ago", minutesAgo: 60 },
] as const;

/** A compass rose laid out as people picture it: N at the top, "not sure" in the middle. */
const ROSE: readonly (readonly [string, number | null])[] = [
  ["NW", 315],
  ["N", 0],
  ["NE", 45],
  ["W", 270],
  ["Not sure", null],
  ["E", 90],
  ["SW", 225],
  ["S", 180],
  ["SE", 135],
];

const ARROWS: Readonly<Record<string, string>> = { N: "↑", NE: "↗", E: "→", SE: "↘", S: "↓", SW: "↙", W: "←", NW: "↖" };

const HEIGHTS: readonly (readonly [HeightBand | null, string])[] = [
  ["low", "Low, just above the trees"],
  ["mid", "Halfway up"],
  ["high", "Nearly overhead"],
  [null, "Not sure"],
];

/** "at": a picked time; `latest` caps the picker at the moment it was opened. */
type When = { kind: "ago"; minutesAgo: number } | { kind: "at"; local: string; latest: string };

type Search =
  | { status: "idle" }
  | { status: "loading-catalog" }
  | { status: "searching"; done: number; total: number }
  | {
      status: "done";
      result: SightingResult;
      reportMs: number;
      azimuthDeg: number | null;
      height: HeightBand | null;
      travelDeg: number | null;
      elapsedMs: number;
      propagations: number;
      catalogAge: string;
    }
  | { status: "failed"; message: string };

function clock(ms: number, seconds = false): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}

/** "2026-11-13T21:40" for a datetime-local input, in the device's zone. */
function localInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reportTime(when: When, nowMs: number): number | null {
  if (when.kind === "ago") return nowMs - when.minutesAgo * 60_000;
  const ms = new Date(when.local).getTime(); // datetime-local parses as device-local time
  return Number.isFinite(ms) ? ms : null;
}

export function IdentifyView() {
  const location = useObserverLocation();
  const { observer } = location;
  const [when, setWhen] = useState<When>({ kind: "ago", minutesAgo: 0 });
  const [azimuthDeg, setAzimuthDeg] = useState<number | null>(null);
  const [height, setHeight] = useState<HeightBand | null>(null);
  const [travelDeg, setTravelDeg] = useState<number | null>(null);
  const [search, setSearch] = useState<Search>({ status: "idle" });
  const catalogRef = useRef<{ rows: CatalogRow[]; generatedAt: string } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  async function loadCatalog(): Promise<{ rows: CatalogRow[]; generatedAt: string }> {
    if (catalogRef.current) return catalogRef.current;
    const res = await fetch("/api/sky/catalog");
    const body = (await res.json()) as {
      ok: boolean;
      data?: { generatedAt: string; entries: CatalogRow[] };
      error?: { message: string };
    };
    if (!body.ok || !body.data) throw new Error(body.error?.message ?? "The satellite catalog is unavailable right now.");
    catalogRef.current = { rows: body.data.entries, generatedAt: body.data.generatedAt };
    return catalogRef.current;
  }

  async function identify() {
    if (!observer) return;
    const reportMs = reportTime(when, Date.now());
    if (reportMs === null) {
      setSearch({ status: "failed", message: "Pick a date and time." });
      return;
    }
    if (reportMs > Date.now() + 60_000) {
      setSearch({ status: "failed", message: "That time is in the future. For what's coming, see tonight's passes." });
      return;
    }
    setSearch({ status: "loading-catalog" });
    let catalog: { rows: CatalogRow[]; generatedAt: string };
    try {
      catalog = await loadCatalog();
    } catch (error) {
      setSearch({ status: "failed", message: error instanceof Error ? error.message : "The satellite catalog is unavailable." });
      return;
    }
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./identify-worker.ts", import.meta.url));
    workerRef.current = worker;
    const query = { azimuthDeg, height, travelDeg, maxSeparationDeg: MAX_SEPARATION_DEG };
    worker.onmessage = (event: MessageEvent<IdentifyWorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        setSearch({ status: "searching", done: message.done, total: message.total });
      } else if (message.type === "result") {
        setSearch({
          status: "done",
          result: message.result,
          reportMs,
          azimuthDeg,
          height,
          travelDeg,
          elapsedMs: message.elapsedMs,
          propagations: message.propagations,
          catalogAge: catalog.generatedAt,
        });
        worker.terminate();
      } else {
        setSearch({ status: "failed", message: message.message });
        worker.terminate();
      }
    };
    setSearch({ status: "searching", done: 0, total: catalog.rows.length });
    const request: IdentifyRequest = {
      type: "identify",
      catalog: catalog.rows,
      observer: { latitudeDeg: observer.lat, longitudeDeg: observer.lon },
      reportMs,
      halfWindowMinutes: HALF_WINDOW_MINUTES,
      query,
    };
    worker.postMessage(request);
  }

  const busy = search.status === "loading-catalog" || search.status === "searching";

  return (
    <div className={`${PAGE} flex flex-col gap-6`}>
      <PageHeader eyebrow="Identify" title="What did I just see?">
        A steady light gliding across the night sky is usually a satellite catching the sun. Say when and where you saw
        it, and every satellite in the public catalog is checked against your sky, right here in your browser.
      </PageHeader>

      <section aria-label="Your sighting" className="panel flex flex-col gap-5 p-4">
        <Question number={1} title="Where were you?">
          {observer ? (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="badge badge-good max-w-full truncate" data-testid="identify-spot">
                {observer.label ??
                  `${Math.abs(observer.lat).toFixed(1)}°${observer.lat >= 0 ? "N" : "S"}, ${Math.abs(observer.lon).toFixed(1)}°${observer.lon >= 0 ? "E" : "W"}`}
              </span>
              <button className="text-[var(--color-accent)] hover:underline" onClick={location.clear}>
                change spot
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button className="btn btn-secondary self-start" onClick={location.locate} disabled={location.locating}>
                {location.locating ? "Finding your spot…" : "Use my location"}
              </button>
              <PlaceSearch onChoose={location.choose} />
              {location.error ? <p className="text-[13px] text-[var(--color-status-warn)]">{location.error.message}</p> : null}
            </div>
          )}
        </Question>

        <Question number={2} title="When?">
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="When you saw it">
            {WHEN_CHOICES.map((choice) => (
              <Chip
                key={choice.label}
                selected={when.kind === "ago" && when.minutesAgo === choice.minutesAgo}
                onClick={() => setWhen({ kind: "ago", minutesAgo: choice.minutesAgo })}
              >
                {choice.label}
              </Chip>
            ))}
            <Chip
              selected={when.kind === "at"}
              onClick={() => {
                const now = Date.now();
                setWhen({ kind: "at", local: localInputValue(now - 2 * 3_600_000), latest: localInputValue(now) });
              }}
            >
              Earlier…
            </Chip>
            {when.kind === "at" ? (
              <input
                type="datetime-local"
                className="input w-auto"
                aria-label="Date and time you saw it"
                value={when.local}
                max={when.latest}
                onChange={(e) => setWhen({ kind: "at", local: e.target.value, latest: when.latest })}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            Searched {HALF_WINDOW_MINUTES} minutes either side, on this device&apos;s clock.
          </p>
        </Question>

        <Question number={3} title="Which way were you looking?">
          <div className="grid w-[264px] grid-cols-3 gap-1.5" role="radiogroup" aria-label="Direction you were looking">
            {ROSE.map(([label, az]) => (
              <Chip key={label} selected={azimuthDeg === az} onClick={() => setAzimuthDeg(az)} wide>
                {label}
              </Chip>
            ))}
          </div>
        </Question>

        <Question number={4} title="How high was it?">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How high it was">
            {HEIGHTS.map(([band, label]) => (
              <Chip key={label} selected={height === band} onClick={() => setHeight(band)}>
                {label}
              </Chip>
            ))}
          </div>
        </Question>

        <Question number={5} title="Which way was it moving? (optional)">
          <div className="grid w-[264px] grid-cols-3 gap-1.5" role="radiogroup" aria-label="Direction it was moving">
            {ROSE.map(([label, az]) => (
              <Chip key={label} selected={travelDeg === az} onClick={() => setTravelDeg(az)} wide>
                {az === null ? label : `${ARROWS[label] ?? ""} ${label}`}
              </Chip>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            The direction it was heading, as seen against the sky. This narrows a busy sky the most.
          </p>
        </Question>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn btn-primary"
            onClick={() => void identify()}
            disabled={!observer || busy}
            data-testid="identify-submit"
          >
            {busy ? "Checking the sky…" : "What was it?"}
          </button>
          {!observer ? <span className="text-[13px] text-[var(--color-text-muted)]">Pick your spot first.</span> : null}
          {search.status === "searching" && search.total > 0 ? (
            <progress
              className="h-1.5 w-40 accent-[var(--color-accent)]"
              max={search.total}
              value={search.done}
              aria-label="Satellites checked"
            />
          ) : null}
          {search.status === "loading-catalog" ? (
            <span className="text-[13px] text-[var(--color-text-muted)]">Fetching the catalog…</span>
          ) : null}
        </div>
      </section>

      {search.status === "failed" ? (
        <p className="text-[14px] text-[var(--color-status-warn)]" role="alert">
          {search.message}
        </p>
      ) : null}
      {search.status === "done" ? <Answer search={search} /> : null}
    </div>
  );
}

function Question({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2.5 flex items-baseline gap-3 text-[15px] font-medium">
        <span className="eyebrow w-5 shrink-0">{String(number).padStart(2, "0")}</span>
        {title}
      </h2>
      <div className="sm:pl-8">{children}</div>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
  wide = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={"choice " + (wide ? "w-full text-center" : "")}
    >
      {children}
    </button>
  );
}

function Answer({ search }: { search: Extract<Search, { status: "done" }> }) {
  const { result, reportMs, azimuthDeg, height, travelDeg } = search;
  const [showAll, setShowAll] = useState(false);
  const where = [
    azimuthDeg === null ? null : `in the ${compassPoint(azimuthDeg)}`,
    height ? HEIGHT_PHRASE[height] : null,
    travelDeg === null ? null : `heading ${compassPoint(travelDeg)}`,
  ]
    .filter(Boolean)
    .join(", ");

  if (result.sunElevationDeg > DARK_SKY_SUN_ELEVATION_DEG) {
    const sunWords =
      result.sunElevationDeg > 0
        ? `the sun was up (${Math.round(result.sunElevationDeg)}° above your horizon)`
        : `the sun was only ${Math.abs(Math.round(result.sunElevationDeg))}° below your horizon`;
    return (
      <section aria-label="The answer" className="flex flex-col gap-2" data-testid="identify-bright-sky">
        <h2 className="text-[20px] font-semibold">Too bright for satellites</h2>
        <p className="max-w-2xl text-[14px] text-[var(--color-text-secondary)]">
          At {clock(reportMs)}, {sunWords}. Satellites only stand out once the sky is properly dark (the sun 6° or more
          below the horizon), so nothing in the catalog is a likely match. A bright moving light in daylight or early
          twilight is more often an aircraft catching the sun, or a planet such as Venus if it wasn&apos;t moving.
        </p>
        <NotASatellite />
      </section>
    );
  }

  const singles = result.candidates;
  const total = singles.length + result.groups.length;
  const shown = showAll ? singles : singles.slice(0, SHOWN_AT_FIRST);
  const charted = [...result.groups.map((g) => g.representative), ...singles].slice(0, CHARTED);

  return (
    <section aria-label="The answer" className="flex flex-col gap-4" data-testid="identify-answer">
      <div>
        <h2 className="text-[20px] font-semibold">
          {total === 0
            ? "No catalogued satellite fits"
            : total === 1
              ? "One satellite fits"
              : `${total} ${result.groups.length > 0 ? "matches" : "satellites fit"}, best first`}
        </h2>
        <p className="mt-1 max-w-3xl text-[14px] text-[var(--color-text-secondary)]">
          Between {clock(reportMs - HALF_WINDOW_MINUTES * 60_000)} and {clock(reportMs + HALF_WINDOW_MINUTES * 60_000)},{" "}
          {result.seeableAnywhere.toLocaleString()} satellites were sunlit and moving above your dark sky somewhere
          {where ? `; these came within about ${MAX_SEPARATION_DEG}° of where you looked (${where})` : ""}.
          {composition(result, travelDeg !== null) ? ` ${composition(result, travelDeg !== null)}` : ""}
        </p>
      </div>

      {total > 0 ? (
        <div className="grid gap-4 md:grid-cols-[1fr_300px]">
          <ol className="flex flex-col gap-2" data-testid="identify-candidates">
            {result.groups.map((group) => (
              <GroupCard key={group.launch} group={group} rank={charted.indexOf(group.representative) + 1} />
            ))}
            {shown.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} rank={charted.indexOf(candidate) + 1} />
            ))}
            {!showAll && singles.length > SHOWN_AT_FIRST ? (
              <li>
                <button className="text-[13px] text-[var(--color-accent)] hover:underline" onClick={() => setShowAll(true)}>
                  Show {singles.length - SHOWN_AT_FIRST} more
                </button>
              </li>
            ) : null}
          </ol>
          <div className="flex flex-col items-center gap-2">
            <SightingChart candidates={charted} azimuthDeg={azimuthDeg} height={height} />
            <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Your sky from below: straight up in the centre, the horizon on the rim, east on the left. Shaded: where
              you looked. Solid lines: when each could be seen; numbers: closest to your report.
            </p>
          </div>
        </div>
      ) : (
        <p className="max-w-2xl text-[14px] text-[var(--color-text-secondary)]">
          Nothing in the public catalog was sunlit, moving and near that part of your sky then. Try &ldquo;Not sure&rdquo;
          for direction or height, or a different time: people often remember times a few minutes off.
        </p>
      )}

      <NotASatellite />
      <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        {search.propagations.toLocaleString()} SGP4 propagations in {(search.elapsedMs / 1000).toFixed(1)} s on this
        device, every {10} s across the window, from orbital elements published{" "}
        {new Date(search.catalogAge).toLocaleDateString()}. A match is a satellite that was at least 10° up, in
        sunlight, crossing at least 1° a minute, while your sun was 6° or more below the horizon. Brightness is
        estimated only where a published standard magnitude exists.{" "}
        <Link href="/methodology#identify" className="hover:underline">
          How this works
        </Link>
      </p>
    </section>
  );
}

/**
 * "Most are Starlink (232 of 245)." when one constellation dominates, with
 * what that means for the person: the crowd is real, and a direction of travel
 * is what narrows it.
 */
function composition(result: SightingResult, travelKnown: boolean): string | null {
  const all = [...result.candidates, ...result.groups.map((g) => g.representative)];
  const total = result.candidates.length + result.groups.reduce((sum, g) => sum + g.count, 0);
  if (total < 10) return null;
  const counts = new Map<ConstellationId, number>();
  for (const c of result.candidates) counts.set(constellationOf(c.name), (counts.get(constellationOf(c.name)) ?? 0) + 1);
  for (const g of result.groups) {
    const id = constellationOf(g.representative.name);
    counts.set(id, (counts.get(id) ?? 0) + g.count);
  }
  const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? (["other", 0] as const);
  if (topId === "other" || topCount * 2 < total || all.length === 0) return null;
  const crowd = `Most are ${constellationRule(topId).label} satellites (${topCount} of ${total}): many are sunlit at once around dusk and dawn.`;
  return travelKnown ? crowd : `${crowd} If you remember which way it was moving, add that above; it narrows the list the most.`;
}

const HEIGHT_PHRASE: Record<HeightBand, string> = {
  low: "low in the sky",
  mid: "halfway up",
  high: "nearly overhead",
};

function brightnessLine(magnitude: number | null): string {
  return magnitude === null
    ? "brightness unknown (no published standard magnitude)"
    : `≈ magnitude ${magnitude.toFixed(1)} · ${brightnessWord(magnitude)}`;
}

function whereLine(c: SightingCandidate): string {
  return `${Math.round(c.best.elevationDeg)}° up in the ${compassPoint(c.best.azimuthDeg)} (${heightWords(c.best.elevationDeg)})`;
}

function CandidateCard({ candidate, rank }: { candidate: SightingCandidate; rank: number }) {
  const moving = `heading ${compassPoint(candidate.headingDeg)}`;
  return (
    <li className="panel p-3.5" data-testid="identify-candidate">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="flex items-baseline gap-2">
          {rank > 0 ? <span className="font-mono text-[12px] text-[var(--color-accent)]">{rank}</span> : null}
          <Link href={`/satellites/${candidate.id}`} className="text-[15px] font-semibold hover:underline">
            {candidate.name}
          </Link>
        </span>
        <span className="text-[12px] text-[var(--color-text-muted)]">
          {Math.round(candidate.separationDeg) <= 2 ? "right where you looked" : `about ${Math.round(candidate.separationDeg)}° from where you looked`}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
        At {clock(candidate.best.tMs, true)} it was {whereLine(candidate)}, {moving}.
      </p>
      <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
        {brightnessLine(candidate.estimatedMagnitude)} · {Math.round(candidate.best.rangeKm).toLocaleString()} km away ·
        crossing {candidate.angularRateDegPerSec >= 0.1 ? `${candidate.angularRateDegPerSec.toFixed(1)}° a second` : `${(candidate.angularRateDegPerSec * 60).toFixed(0)}° a minute`}
      </p>
    </li>
  );
}

function GroupCard({ group, rank }: { group: LaunchGroup; rank: number }) {
  const family = group.representative.name.replace(/[-\s]?\d+$/, "");
  return (
    <li className="panel border-[var(--color-accent-dim)] p-3.5" data-testid="identify-group">
      <div className="flex items-baseline gap-2">
        {rank > 0 ? <span className="font-mono text-[12px] text-[var(--color-accent)]">{rank}</span> : null}
        <span className="text-[15px] font-semibold">
          {group.count} {family || "satellites"} from one launch ({group.launch})
        </span>
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
        They crossed that part of your sky together; the closest, {group.representative.name}, was {whereLine(group.representative)} at{" "}
        {clock(group.representative.best.tMs, true)}. Batches like this are the &ldquo;satellite trains&rdquo; people
        report: a line of lights in single file, most striking in the weeks after a launch, before they spread out to
        their working orbits.
      </p>
    </li>
  );
}

function NotASatellite() {
  return (
    <details className="text-[13px] text-[var(--color-text-secondary)]">
      <summary className="cursor-pointer select-none font-semibold hover:text-[var(--color-text-primary)]">
        If it doesn&apos;t fit any of these
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Blinking or coloured lights, or a sound: an aircraft.</li>
        <li>A streak lasting a second or two: a meteor.</li>
        <li>A light that didn&apos;t move against the stars: a planet or a bright star.</li>
        <li>
          A satellite missing from the public catalog: classified objects aren&apos;t published, and newly launched
          ones can take a day or two to appear.
        </li>
      </ul>
    </details>
  );
}
