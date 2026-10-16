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
 * Both refresh every 60 s. Every pass, seen or not, stays one click away.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PassResultDto } from "@/contracts/orbital";
import type { ObserverLocationState } from "@/features/observer/use-observer-location";
import { PassCard, brightnessWord, compassPoint, localWhen } from "@/features/pass-prediction/pass-cards";
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

const TONIGHT_TARGETS = [
  { satelliteNumber: "25544", label: "ISS (ZARYA)" },
  { satelliteNumber: "48274", label: "CSS (TIANHE)" },
];

/** "ISS" from "ISS (ZARYA)" — the name people actually say. */
function shortLabel(satelliteNumber: string, fallbackName: string): string {
  const label = TONIGHT_TARGETS.find((t) => t.satelliteNumber === satelliteNumber)?.label ?? fallbackName;
  return label.replace(/\s*\(.*\)$/, "") || `NORAD ${satelliteNumber}`;
}

function localClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function SkyHeading() {
  return (
    <div>
      <h1 className="heading-display text-[26px] sm:text-[34px]">What&apos;s flying over you tonight?</h1>
      <p className="lede mt-1 max-w-xl">
        One tap fills in your spot and shows what you can actually see: which bright stations cross your dark sky
        while sunlit, when, and where to look. Real orbits, no account, no drama.
      </p>
    </div>
  );
}

function VisiblePassRow({ item, nowMs }: { item: VisiblePass; nowMs: number }) {
  const { window } = item;
  const minutes = Math.max(1, Math.round((Date.parse(window.end.timeIso) - Date.parse(window.start.timeIso)) / 60_000));
  return (
    <li className="panel-inset p-3" data-testid="tonight-visible-pass">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/satellites/${item.satelliteNumber}`} className="text-[15px] font-semibold hover:underline">
          {item.label}
        </Link>
        <span className="badge badge-good">{countdownTo(window.start.timeIso, window.end.timeIso, nowMs)}</span>
        {item.lineage === "provider-unavailable-stale" ? (
          <span className="badge badge-warn">older orbit data — times may drift</span>
        ) : null}
      </div>
      <p className="data-value mt-1.5 text-[14px]">
        {localWhen(window.start.timeIso)} – {localClock(window.end.timeIso)}
        <span className="ml-2 text-[12px] text-[var(--color-text-muted)]">about {minutes} min</span>
      </p>
      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">{skyPath(item.pass, window).join(" → ")}</p>
      <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
        {item.magnitude !== null ? (
          <>
            estimated magnitude {item.magnitude.toFixed(1)} ({brightnessWord(item.magnitude)}) · rough: real brightness
            shifts with the station&apos;s attitude and solar arrays
          </>
        ) : (
          "brightness unknown: no published standard magnitude for this object"
        )}
      </p>
    </li>
  );
}

function VisibleTonight({ results, nowMs }: { results: PassResultDto[]; nowMs: number }) {
  const summary = summarizeTonight(results, nowMs, shortLabel);
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
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            {summary.passes.length} {summary.passes.length === 1 ? "pass" : "passes"} in the next 24 hours, soonest
            first.
          </p>
          <ul className="flex flex-col gap-2" data-testid="tonight-visible-list">
            {summary.passes.map((item) => (
              <VisiblePassRow key={`${item.satelliteNumber}-${item.window.start.timeIso}`} item={item} nowMs={nowMs} />
            ))}
          </ul>
          {missing}
        </div>
      );
    case "none-visible":
      return (
        <div className="flex flex-col gap-2" data-testid="tonight-visible-empty">
          <p className="text-[14px] text-[var(--color-text-secondary)]">{noneVisibleReason(summary)}</p>
          {missing}
        </div>
      );
    case "no-passes":
      return (
        <div className="flex flex-col gap-2" data-testid="tonight-visible-empty">
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Neither station clears 10° above your horizon in the next 24 hours, so there is nothing to see from here
            today.
          </p>
          {missing}
        </div>
      );
    case "unavailable":
      return (
        <p className="text-[13px] text-[var(--color-status-warn)]" data-testid="tonight-visible-empty">
          Orbit data for {summary.unavailable.join(" and ")} is unavailable right now, so we can&apos;t say what&apos;s
          visible. Try again shortly.
        </p>
      );
  }
}

export function SkyTonight({ location }: { location: ObserverLocationState }) {
  const { observer, locating, error: locationError, manualLat, manualLon, setManualLat, setManualLon, locate, submitManual } = location;
  const [overhead, setOverhead] = useState<OverheadData | null>(null);
  const [passes, setPasses] = useState<PassResultDto[] | null>(null);
  const [passesError, setPassesError] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lat = observer?.lat;
  const lon = observer?.lon;

  const load = useCallback(async (obLat: number, obLon: number) => {
    setBusy(true);
    setError(null);
    try {
      const [overheadRes, passesRes] = await Promise.all([
        fetch(`/api/overhead?latDeg=${obLat}&lonDeg=${obLon}`),
        fetch("/api/passes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            satelliteNumbers: TONIGHT_TARGETS.map((t) => t.satelliteNumber),
            observer: { latitudeDeg: obLat, longitudeDeg: obLon, altitudeMeters: 0 },
            windowStartIso: new Date().toISOString(),
            windowHours: 24,
            minElevationDeg: 10,
          }),
        }),
      ]);
      const overheadBody = (await overheadRes.json()) as { ok: boolean; data?: OverheadData; error?: { message: string } };
      const passesBody = (await passesRes.json()) as { ok: boolean; data?: { results: PassResultDto[]; windowStart: string }; error?: { message: string } };

      if (overheadBody.ok && overheadBody.data) setOverhead(overheadBody.data);
      if (passesBody.ok && passesBody.data) {
        setPasses(passesBody.data.results);
        setWindowStart(passesBody.data.windowStart);
        setPassesError(null);
      } else {
        setPassesError(passesBody.error?.message ?? "Pass predictions are briefly unavailable — try again shortly.");
      }
      if (!overheadBody.ok && !passesBody.ok) {
        setError(passesBody.error?.message ?? "The sky computations are briefly unavailable — try again shortly.");
      }
    } catch {
      setError("Could not reach the analysis service");
    } finally {
      setNowMs(Date.now());
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    const t = setTimeout(() => void load(lat, lon), 0);
    const id = setInterval(() => void load(lat, lon), 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [lat, lon, load]);

  const visibleNow = overhead?.visible ?? [];

  return (
    <section aria-label="What's in the sky" className="flex flex-col gap-4">
      <SkyHeading />

      {observer === null ? (
        <div className="flex max-w-xl flex-col gap-3">
          <button className="btn btn-primary self-start" onClick={locate} disabled={locating} data-testid="tonight-locate">
            {locating ? "Finding your spot…" : "Show me tonight's passes"}
          </button>
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-[var(--color-text-muted)]">
            <span>or type coordinates</span>
            <input
              aria-label="Manual latitude"
              placeholder="lat, e.g. 40.7"
              className="input w-32"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
            />
            <input
              aria-label="Manual longitude"
              placeholder="lon, e.g. -74"
              className="input w-32"
              value={manualLon}
              onChange={(e) => setManualLon(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={() => submitManual()}>
              Go
            </button>
          </div>
          {locationError ? <p className="text-[13px] text-[var(--color-status-warn)]">{locationError.message}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="badge badge-good">watching from {observer.lat.toFixed(1)}°, {observer.lon.toFixed(1)}°</span>
            {busy && passes === null ? <span className="text-[13px] text-[var(--color-text-muted)]">Crunching orbits…</span> : null}
            {error ? <span className="text-[13px] text-[var(--color-status-warn)]">{error}</span> : null}
          </div>

          {/* The headline: passes a person can actually see. */}
          <div>
            <h2 className="label mb-2">You can actually see</h2>
            {passes !== null ? (
              <VisibleTonight results={passes} nowMs={nowMs} />
            ) : passesError && !busy ? (
              <p className="text-[13px] text-[var(--color-status-warn)]">{passesError}</p>
            ) : null}
          </div>

          {/* Right now — geometry, not visibility. */}
          <div>
            <h2 className="label mb-2">Above your horizon right now</h2>
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
              <summary className="label cursor-pointer select-none">Every pass in the next 24 hours, visible or not</summary>
              <div className="mt-3 flex flex-col gap-3">
                {passes.map((sat) => {
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
                    <div key={sat.satelliteNumber} className="panel-inset p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Link href={`/satellites/${sat.satelliteNumber}`} className="text-[15px] font-semibold hover:underline">
                          {label}
                        </Link>
                        <span className="badge">next pass peaks {timeUntil(first.maxTime, nowMs) ?? "now"}</span>
                        {sat.passes.length > 3 ? (
                          <Link href="/passes" className="ml-auto text-[12px] text-[var(--color-accent)] hover:underline">
                            + {sat.passes.length - 3} more →
                          </Link>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1" data-testid="tonight-pass-cards">
                        {sat.passes.slice(0, 3).map((pass) => (
                          <PassCard key={pass.maxTime} pass={pass} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}

          {windowStart ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Predicted orbits from {new Date(windowStart).toLocaleDateString()}, over the next 24 h. Visible means the
              satellite is sunlit while your sky is past civil twilight (sun below −6°) and it is at least 10° up;
              clouds, light pollution, and your horizon aren&apos;t modeled. Brightness comes from published standard
              magnitudes; their sources and weaknesses are on the{" "}
              <Link href="/methodology" className="hover:underline">
                methodology page
              </Link>
              .
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Small helper kept here so the hero owns its own compass vocabulary. */
export const skyCompass = compassPoint;
export const skyLocal = localWhen;
