"use client";

/**
 * Tonight's passes — the location-first answer to "what can I see tonight?".
 *
 * One click for device location (manual fallback), then immediate server-side
 * pass predictions for the curated bright objects over the next 24 h, from
 * that spot. Renders pass cards (phone-legible) with plain-language wording.
 * Honesty: geometry predictions, not an optics forecast — stated in-panel.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ObserverLocationState } from "@/features/observer/use-observer-location";
import { PassCard, type PassCardData } from "./pass-cards";
import { Loading } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/units";

/** Curated bright objects worth looking for tonight (stations + imaging sats). */
const TONIGHT_TARGETS = [
  { satelliteNumber: "25544", label: "ISS (ZARYA)" },
  { satelliteNumber: "48274", label: "CSS (TIANHE)" },
];

interface PassSatResult {
  satelliteNumber: string;
  name: string;
  passes: PassCardData[];
  failure?: { reason: string; message: string };
}

interface TonightData {
  results: PassSatResult[];
  windowStart: string;
  windowEnd: string;
}

export function TonightPasses({ location }: { location: ObserverLocationState }) {
  const { observer, locating, error, manualLat, manualLon, setManualLat, setManualLon, locate, submitManual } = location;
  const [data, setData] = useState<TonightData | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const observerLat = observer?.lat;
  const observerLon = observer?.lon;

  async function fetchPasses(lat: number, lon: number) {
    setBusy(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          satelliteNumbers: TONIGHT_TARGETS.map((t) => t.satelliteNumber),
          observer: { latitudeDeg: lat, longitudeDeg: lon, altitudeMeters: 0 },
          windowStartIso: new Date().toISOString(),
          windowHours: 24,
          minElevationDeg: 10,
        }),
      });
      const body = (await res.json()) as { ok: boolean; data?: TonightData; error?: { message: string } };
      if (!res.ok || !body.ok || !body.data) {
        setFetchError(body.error?.message ?? "Pass prediction is temporarily unavailable");
        return;
      }
      setData(body.data);
    } catch {
      setFetchError("Could not reach the pass-prediction service");
    } finally {
      setBusy(false);
    }
  }

  // Once an observer exists (device or manual), fetch immediately — no extra
  // "submit" step in the location-first path.
  useEffect(() => {
    if (observerLat === undefined || observerLon === undefined) return;
    // Timer-deferred: setState happens in the fetch callback, not
    // synchronously within the effect body (cascading-render guard).
    const t = setTimeout(() => void fetchPasses(observerLat, observerLon), 0);
    return () => clearTimeout(t);
  }, [observerLat, observerLon]);

  return (
    <section aria-label="Tonight's passes from your location" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Tonight from your spot</h2>
        {data ? (
          <span className="badge badge-good">{data.results.reduce((n, r) => n + r.passes.length, 0)} passes in 24 h</span>
        ) : null}
      </div>

      {observer === null ? (
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary text-[12px]" onClick={locate} disabled={locating} data-testid="tonight-locate">
            {locating ? "Finding you…" : "☆ Show me tonight's passes"}
          </button>
          <div className="flex gap-1">
            <input
              aria-label="Tonight latitude"
              placeholder="lat, e.g. 28.5"
              className="input w-full text-[12px]"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
            />
            <input
              aria-label="Tonight longitude"
              placeholder="lon, e.g. -80.6"
              className="input w-full text-[12px]"
              value={manualLon}
              onChange={(e) => setManualLon(e.target.value)}
            />
            <button className="btn btn-secondary text-[12px]" onClick={() => submitManual()}>
              Go
            </button>
          </div>
          {error ? <p className="text-[11px] text-[var(--color-status-warn)]">{error.message}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {busy && !data ? <Loading label="Calculating the next 24 h…" /> : null}
          {fetchError ? <p className="text-[11px] text-[var(--color-status-warn)]">{fetchError}</p> : null}

          {data && !busy ? (
            data.results.map((sat) => {
              const label = sat.failure
                ? `NORAD ${sat.satelliteNumber}`
                : TONIGHT_TARGETS.find((t) => t.satelliteNumber === sat.satelliteNumber)?.label ?? sat.name;
              return (
                <div key={sat.satelliteNumber} className="rounded border border-[var(--color-bg-inset)] p-2">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <Link href={`/satellites/${sat.satelliteNumber}`} className="text-[13px] font-medium hover:underline">
                      {label}
                    </Link>
                    {sat.failure ? <span className="text-[10px] text-[var(--color-status-bad)]">{sat.failure.reason}</span> : null}
                  </div>
                  {sat.failure ? null : sat.passes.length === 0 ? (
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                      Doesn&apos;t clear your horizon in the next day — check again tomorrow.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1" data-testid="tonight-pass-cards">
                      {sat.passes.slice(0, 3).map((pass, i) => (
                        <PassCard key={i} pass={pass} />
                      ))}
                      {sat.passes.length > 3 ? (
                        <p className="text-[10px] text-[var(--color-text-muted)]">
                          + {sat.passes.length - 3} more in 24 h — full list on{" "}
                          <Link href="/passes" className="text-[var(--color-accent)] hover:underline">
                            pass predictions
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })
          ) : null}

          {data ? (
            <p className="text-[10px] text-[var(--color-text-muted)]">
              Predicted geometry for {formatUtc(new Date(data.windowStart)).slice(0, 17)} → 24 h window. Not a visibility
              forecast — clouds and sunlight aren&apos;t modeled.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
