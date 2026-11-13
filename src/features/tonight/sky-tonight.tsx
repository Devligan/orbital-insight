"use client";

/**
 * SkyTonight — the product's answer to the only question most people arrive
 * with: "what can I see from my spot, tonight?"
 *
 * One location ask (device or manual fallback) feeds both computations:
 *  - "You can actually see": the next 24 h of passes for the curated bright
 *    stations, filtered to the ones the server judged *visible* (sunlit
 *    satellite against a dark sky), soonest first, with where to look
 *    (the /api/passes computation + ./visible-tonight selection)
 *  - "Right now": those stations above 15° elevation at this instant —
 *    geometry only (the /api/overhead computation)
 *
 * Times read on the observer's wall clock (zone resolved server-side from
 * the coordinates), so typing Tokyo's coordinates from New York shows Tokyo
 * times — labelled as such.
 *
 * Refresh cadence: "right now" every minute; the 24 h pass search every 10
 * minutes (passes don't change faster than that); countdowns tick every 30 s.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PassResultDto } from "@/contracts/orbital";
import type { ObserverLocationState } from "@/features/observer/use-observer-location";
import { PlaceSearch } from "@/features/observer/place-search";
import { PassCard } from "@/features/pass-prediction/pass-cards";
import { SkyChart } from "@/features/pass-prediction/sky-chart";
import { brightnessWord, observerClock, observerZoneNote } from "@/features/pass-prediction/sky-words";
import { downloadFile } from "@/lib/download";
import { passEventFileName, visiblePassesIcs } from "./pass-calendar";
import { countdownTo, noneVisibleReason, skyPath, summarizeTonight, timeUntil, type VisiblePass } from "./visible-tonight";

interface OverheadEntry {
  satelliteNumber: string;
  name: string;
  elevationDeg: number;
  direction: string;
  lineage: string;
}

interface OverheadData {
  visible: OverheadEntry[];
}

interface PassesData {
  results: PassResultDto[];
  windowStart: string;
  observerTimeZone: string | null;
}

const TONIGHT_TARGETS = [
  { satelliteNumber: "25544", label: "ISS (ZARYA)" },
  { satelliteNumber: "48274", label: "CSS (TIANHE)" },
];

const OVERHEAD_REFRESH_MS = 60_000;
const PASSES_REFRESH_MS = 10 * 60_000;
const CLOCK_TICK_MS = 30_000;

/** "ISS" from "ISS (ZARYA)" — the name people actually say. */
function shortLabel(satelliteNumber: string, fallbackName: string): string {
  const label = TONIGHT_TARGETS.find((t) => t.satelliteNumber === satelliteNumber)?.label ?? fallbackName;
  return label.replace(/\s*\(.*\)$/, "") || `NORAD ${satelliteNumber}`;
}

/** 40.7°N, 74.0°W — how coordinates read to people. */
function formatSpot(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}

/** The place name when one was picked; coordinates otherwise. */
function spotName(observer: { lat: number; lon: number; label: string | null }): string {
  return observer.label ?? formatSpot(observer.lat, observer.lon);
}

function SkyHeading() {
  return (
    <div>
      <h1 className="heading-display text-[30px] sm:text-[38px]">What&apos;s flying over you tonight?</h1>
      <p className="lede mt-2 max-w-xl">
        One tap and you&apos;ll know which space stations cross your dark sky while sunlit — when, and exactly where
        to look. Real orbits, no account.
      </p>
    </div>
  );
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{children}</h2>
      {sub ? <p className="text-[13px] text-[var(--color-text-secondary)]">{sub}</p> : null}
    </div>
  );
}

function VisiblePassRow({
  item,
  nowMs,
  timeZone,
  spot,
}: {
  item: VisiblePass;
  nowMs: number;
  timeZone: string | null;
  spot: string;
}) {
  const { window } = item;
  const startMs = Date.parse(window.start.timeIso);
  const minutes = Math.max(1, Math.round((Date.parse(window.end.timeIso) - startMs) / 60_000));
  const countdown = countdownTo(window.start.timeIso, window.end.timeIso, nowMs);
  const soon = countdown === "visible now" || startMs - nowMs < 30 * 60_000;

  function addToCalendar() {
    const ics = visiblePassesIcs([item], { nowMs: Date.now(), origin: globalThis.location.origin, spot });
    downloadFile(ics, passEventFileName(item), "text/calendar;charset=utf-8");
  }

  return (
    <li className="panel p-3.5" data-testid="tonight-visible-pass">
      {/* When, how bright, and the chart side by side; the words for where to look run full width below. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Link href={`/satellites/${item.satelliteNumber}`} className="text-[15px] font-semibold hover:underline">
              {item.label}
            </Link>
            <span className={"badge shrink-0 " + (soon ? "badge-good" : "text-[var(--color-text-secondary)]")}>{countdown}</span>
          </div>
          <p className="mt-1 text-[18px] font-semibold leading-tight tabular-nums text-[var(--color-text-primary)] sm:text-[20px]">
            <span className="whitespace-nowrap">{observerClock(window.start.timeIso, timeZone)}</span>{" "}
            <span className="whitespace-nowrap">– {observerClock(window.end.timeIso, timeZone, false)}</span>
            <span className="ml-2 whitespace-nowrap text-[13px] font-normal text-[var(--color-text-muted)]">{minutes} min</span>
          </p>
          <p className="mt-1.5 text-[12px] text-[var(--color-text-muted)]">
            {item.magnitude !== null
              ? `≈ magnitude ${item.magnitude.toFixed(1)} · ${brightnessWord(item.magnitude)}`
              : "brightness unknown (no published standard magnitude)"}
            {item.lineage === "provider-unavailable-stale" ? (
              <span className="ml-2 text-[var(--color-status-warn)]">older orbit data — times may drift</span>
            ) : null}
          </p>
        </div>
        <SkyChart pass={item.pass} size={96} />
      </div>
      <ol className="mt-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
        {skyPath(item.pass, window).map((step, i) => (
          <li key={step} className="inline">
            {i > 0 ? (
              <span aria-hidden className="mx-1.5 text-[var(--color-text-muted)]">
                →
              </span>
            ) : null}
            {step}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={addToCalendar}
        className="mt-1.5 text-[12px] font-medium text-[var(--color-accent)] hover:underline"
        data-testid="tonight-add-to-calendar"
      >
        Add to calendar · 10-min reminder
      </button>
    </li>
  );
}

function VisibleTonight({ data, nowMs, spot }: { data: PassesData; nowMs: number; spot: string }) {
  const summary = summarizeTonight(data.results, nowMs, shortLabel);
  const zoneNote = observerZoneNote(
    data.observerTimeZone,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date(nowMs),
  );
  const missing =
    summary.unavailable.length > 0 ? (
      <p className="text-[13px] text-[var(--color-status-warn)]">
        Orbit data for {summary.unavailable.join(" and ")} is unavailable right now, so this list may be incomplete.
      </p>
    ) : null;

  switch (summary.kind) {
    case "visible":
      return (
        <div className="flex flex-col gap-2">
          <SectionTitle
            sub={
              <>
                {summary.passes.length} {summary.passes.length === 1 ? "pass" : "passes"} in the next 24 hours, soonest
                first.{zoneNote ? ` ${zoneNote}` : ""}
              </>
            }
          >
            You can actually see
          </SectionTitle>
          <ul className="flex flex-col gap-2" data-testid="tonight-visible-list">
            {summary.passes.map((item) => (
              <VisiblePassRow
                key={`${item.satelliteNumber}-${item.window.start.timeIso}`}
                item={item}
                nowMs={nowMs}
                timeZone={data.observerTimeZone}
                spot={spot}
              />
            ))}
          </ul>
          {missing}
        </div>
      );
    case "none-visible":
      return (
        <div className="flex flex-col gap-2" data-testid="tonight-visible-empty">
          <SectionTitle>You can actually see</SectionTitle>
          <p className="text-[14px] text-[var(--color-text-secondary)]">{noneVisibleReason(summary)}</p>
          {missing}
        </div>
      );
    case "no-passes":
      return (
        <div className="flex flex-col gap-2" data-testid="tonight-visible-empty">
          <SectionTitle>You can actually see</SectionTitle>
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Neither station clears 10° above your horizon in the next 24 hours, so there is nothing to see from here
            today.
          </p>
          {missing}
        </div>
      );
    case "unavailable":
      return (
        <div className="flex flex-col gap-2" data-testid="tonight-visible-empty">
          <SectionTitle>You can actually see</SectionTitle>
          <p className="text-[13px] text-[var(--color-status-warn)]">
            Orbit data for {summary.unavailable.join(" and ")} is unavailable right now, so we can&apos;t say
            what&apos;s visible. Try again shortly.
          </p>
        </div>
      );
  }
}

export function SkyTonight({ location }: { location: ObserverLocationState }) {
  const { observer, locating, error: locationError, locate, choose, clear } = location;
  const [overhead, setOverhead] = useState<OverheadData | null>(null);
  const [passes, setPasses] = useState<PassesData | null>(null);
  const [passesError, setPassesError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  // Responses for a spot the user has since left are dropped on arrival.
  const spotRef = useRef<string | null>(null);

  const lat = observer?.lat;
  const lon = observer?.lon;

  const loadOverhead = useCallback(async (obLat: number, obLon: number, spot: string) => {
    try {
      const res = await fetch(`/api/overhead?latDeg=${obLat}&lonDeg=${obLon}`);
      const body = (await res.json()) as { ok: boolean; data?: OverheadData };
      if (spotRef.current === spot && body.ok && body.data) setOverhead(body.data);
    } catch {
      /* "right now" is a nicety; the pass list carries its own error state */
    }
  }, []);

  const loadPasses = useCallback(async (obLat: number, obLon: number, spot: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          satelliteNumbers: TONIGHT_TARGETS.map((t) => t.satelliteNumber),
          observer: { latitudeDeg: obLat, longitudeDeg: obLon, altitudeMeters: 0 },
          windowStartIso: new Date().toISOString(),
          windowHours: 24,
          minElevationDeg: 10,
        }),
      });
      const body = (await res.json()) as { ok: boolean; data?: PassesData; error?: { message: string } };
      if (spotRef.current !== spot) return;
      if (body.ok && body.data) {
        setPasses(body.data);
        setPassesError(null);
      } else {
        setPassesError(body.error?.message ?? "Pass predictions are briefly unavailable — try again shortly.");
      }
    } catch {
      if (spotRef.current === spot) setPassesError("Could not reach the analysis service — check your connection.");
    } finally {
      if (spotRef.current === spot) {
        setNowMs(Date.now());
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const spot = `${lat},${lon}`;
    spotRef.current = spot;
    const first = setTimeout(() => {
      void loadOverhead(lat, lon, spot);
      void loadPasses(lat, lon, spot);
    }, 0);
    const overheadTimer = setInterval(() => void loadOverhead(lat, lon, spot), OVERHEAD_REFRESH_MS);
    const passesTimer = setInterval(() => void loadPasses(lat, lon, spot), PASSES_REFRESH_MS);
    const clock = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(overheadTimer);
      clearInterval(passesTimer);
      clearInterval(clock);
    };
  }, [lat, lon, loadOverhead, loadPasses]);

  function changeSpot() {
    spotRef.current = null;
    setPasses(null);
    setOverhead(null);
    setPassesError(null);
    clear();
  }

  const visibleNow = overhead?.visible ?? [];

  return (
    <section aria-label="What's in the sky" className="flex flex-col gap-5">
      <SkyHeading />

      {observer === null ? (
        <div className="flex flex-col gap-3">
          <button className="btn btn-primary self-start" onClick={locate} disabled={locating} data-testid="tonight-locate">
            {locating ? "Finding your spot…" : "Show me tonight's passes"}
          </button>
          <div className="flex max-w-md flex-col gap-1.5">
            <span className="text-[13px] text-[var(--color-text-muted)]">or pick a place, no location sharing needed</span>
            <PlaceSearch onChoose={choose} />
          </div>
          {locationError ? <p className="text-[13px] text-[var(--color-status-warn)]">{locationError.message}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="badge badge-good max-w-full truncate" title={formatSpot(observer.lat, observer.lon)}>
              Watching from {spotName(observer)}
            </span>
            <button className="text-[var(--color-accent)] hover:underline" onClick={changeSpot}>
              change spot
            </button>
            {busy && passes === null ? <span className="text-[var(--color-text-muted)]">Crunching orbits…</span> : null}
          </div>

          {/* The headline: passes a person can actually see. */}
          {passes !== null ? (
            <VisibleTonight data={passes} nowMs={nowMs} spot={spotName(observer)} />
          ) : passesError && !busy ? (
            <p className="text-[13px] text-[var(--color-status-warn)]">{passesError}</p>
          ) : null}

          {/* Right now — geometry, not visibility. */}
          <div>
            <h2 className="mb-1.5 text-[14px] font-semibold text-[var(--color-text-secondary)]">Above your horizon right now</h2>
            {visibleNow.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {visibleNow.map((entry) => (
                  <li key={entry.satelliteNumber} className="panel-inset px-3 py-2">
                    <span className="text-[14px] font-semibold">{entry.name}</span>
                    <span className="ml-2 text-[13px] text-[var(--color-text-secondary)]">
                      {entry.elevationDeg.toFixed(0)}° high, toward {entry.direction.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-[var(--color-text-secondary)]">
                Neither station is above 15° this minute. The ISS comes back around roughly every 90 minutes.
              </p>
            )}
          </div>

          {/* Every geometric pass, seen or not — for the curious, one click away. */}
          {passes !== null ? (
            <details className="group">
              <summary className="cursor-pointer select-none text-[14px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                Every pass in the next 24 hours, visible or not
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {passes.results.map((sat) => {
                  const label = shortLabel(sat.satelliteNumber, sat.name);
                  const first = sat.passes[0];
                  return sat.failure ? (
                    <p key={sat.satelliteNumber} className="text-[13px] text-[var(--color-status-bad)]">
                      {label}: {sat.failure.message}
                    </p>
                  ) : !first ? (
                    <p key={sat.satelliteNumber} className="text-[14px] text-[var(--color-text-secondary)]">
                      {label} doesn&apos;t clear your horizon in the next day.
                    </p>
                  ) : (
                    <div key={sat.satelliteNumber}>
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <Link href={`/satellites/${sat.satelliteNumber}`} className="text-[14px] font-semibold hover:underline">
                          {label}
                        </Link>
                        <span className="text-[12px] text-[var(--color-text-muted)]">
                          next pass peaks {timeUntil(first.maxTime, nowMs) ?? "now"}
                        </span>
                        {sat.passes.length > 3 ? (
                          <Link href="/passes" className="ml-auto text-[12px] text-[var(--color-accent)] hover:underline">
                            + {sat.passes.length - 3} more →
                          </Link>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1.5" data-testid="tonight-pass-cards">
                        {sat.passes.slice(0, 3).map((pass) => (
                          <PassCard key={pass.maxTime} pass={pass} timeZone={passes.observerTimeZone} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}

          {passes !== null ? (
            <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Predicted from published orbits ({new Date(passes.windowStart).toLocaleDateString()}), next 24 h.
              Visible means the station is sunlit while your sky is past civil twilight (sun below −6°) and it is at
              least 10° up. Clouds, light pollution, and your horizon aren&apos;t modeled; brightness estimates are
              rough (attitude, solar arrays). Sky charts: the centre is straight up and the rim your horizon, with
              east on the left — hold one overhead with N to the north. The bright line is the part you can see; a
              ring marks where it slips into Earth&apos;s shadow.{" "}
              <Link href="/methodology" className="hover:underline">
                How this works
              </Link>
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
