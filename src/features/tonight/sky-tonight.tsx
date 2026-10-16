"use client";

/**
 * SkyTonight — the product's answer to the only question most people arrive
 * with: "what can I see from my spot, tonight?"
 *
 * One location ask (device or manual fallback) feeds both computations:
 *  - "Right now": curated bright stations above 15° elevation at this instant
 *    (the /api/overhead computation, refreshed every 60 s)
 *  - "Tonight": the next 24 h of passes for those objects, as plain cards
 *    with local times and compass words (the /api/passes computation)
 *
 * Replaces the old two overlapping widgets (OverheadNow + TonightPasses)
 * that each asked for location separately — one CTA now fills both.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ObserverLocationState } from "@/features/observer/use-observer-location";
import { PassCard, compassPoint, localWhen, type PassCardData } from "@/features/pass-prediction/pass-cards";

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

interface PassSatResult {
  satelliteNumber: string;
  name: string;
  passes: PassCardData[];
  lineage?: string;
  failure?: { reason: string; message: string };
}

const TONIGHT_TARGETS = [
  { satelliteNumber: "25544", label: "ISS (ZARYA)" },
  { satelliteNumber: "48274", label: "CSS (TIANHE)" },
];

/** "in 2 h 05 m" / "now ish" — the countdown humans plan around. */
function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${h} h ${String(m).padStart(2, "0")} m`;
}

function SkyHeading() {
  return (
    <div>
      <h1 className="heading-display text-[26px] sm:text-[34px]">What&apos;s flying over you tonight?</h1>
      <p className="lede mt-1 max-w-xl">
        One tap fills in your spot and shows what the sky is actually doing: what&apos;s up right now, and when the
        bright stations come back around. Real orbits, no account, no drama.
      </p>
    </div>
  );
}

export function SkyTonight({ location }: { location: ObserverLocationState }) {
  const { observer, locating, error: locationError, manualLat, manualLon, setManualLat, setManualLon, locate, submitManual } = location;
  const [overhead, setOverhead] = useState<OverheadData | null>(null);
  const [passes, setPasses] = useState<PassSatResult[] | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
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
      const passesBody = (await passesRes.json()) as { ok: boolean; data?: { results: PassSatResult[]; windowStart: string }; error?: { message: string } };

      if (overheadBody.ok && overheadBody.data) setOverhead(overheadBody.data);
      if (passesBody.ok && passesBody.data) {
        setPasses(passesBody.data.results);
        setWindowStart(passesBody.data.windowStart);
      }
      if (!overheadBody.ok && !passesBody.ok) {
        setError(passesBody.error?.message ?? "The sky computations are briefly unavailable — try again shortly.");
      }
    } catch {
      setError("Could not reach the analysis service");
    } finally {
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

          {/* Right now */}
          <div>
            <h2 className="label mb-2">Right now above you</h2>
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
                Nothing bright is above 15° this minute — the ISS comes back around roughly every 90 minutes, and
                tonight&apos;s chances are below.
              </p>
            )}
          </div>

          {/* Tonight */}
          <div>
            <h2 className="label mb-2">The next 24 hours</h2>
            {passes === null && busy ? null : (
              <div className="flex flex-col gap-3">
                {passes?.map((sat) => {
                  const label = TONIGHT_TARGETS.find((t) => t.satelliteNumber === sat.satelliteNumber)?.label ?? sat.name;
                  return sat.failure ? (
                    <p key={sat.satelliteNumber} className="text-[13px] text-[var(--color-status-bad)]">
                      {label}: {sat.failure.message}
                    </p>  ) : sat.passes.length === 0 || !sat.passes[0] ? (
    <p key={sat.satelliteNumber} className="text-[14px] text-[var(--color-text-secondary)]">
      {label.replace(/\s*\(.*\)$/, "")} doesn&apos;t clear your horizon in the next day.
    </p>
  ) : (
    <div key={sat.satelliteNumber} className="panel-inset p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Link href={`/satellites/${sat.satelliteNumber}`} className="text-[15px] font-semibold hover:underline">
          {label.replace(/\s*\(.*\)$/, "")}
        </Link>
        <span className="badge">next pass {countdown(sat.passes[0].maxTime)}</span>
                        {sat.passes.length > 3 ? (
                          <Link href="/passes" className="ml-auto text-[12px] text-[var(--color-accent)] hover:underline">
                            + {sat.passes.length - 3} more →
                          </Link>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-1" data-testid="tonight-pass-cards">
                        {sat.passes.slice(0, 3).map((pass, i) => (
                          <PassCard key={i} pass={pass} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {windowStart ? (
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    Predicted orbits from {new Date(windowStart).toLocaleDateString()}, over the next 24 h. Sunlight
                    geometry is modeled — Earth&apos;s shadow and your sky&apos;s darkness decide the visual-visibility
                    verdicts; clouds aren&apos;t. Magnitude estimates carry about ±1.5 mag of uncertainty.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Small helper kept here so the hero owns its own compass vocabulary. */
export const skyCompass = compassPoint;
export const skyLocal = localWhen;
