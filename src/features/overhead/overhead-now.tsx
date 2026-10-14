"use client";

/**
 * What's above you right now.
 *
 * Asks the browser for the observer's location (with a manual coordinate
 * fallback — no permission friction) and computes, on the server, which
 * curated objects — crewed stations and HST — are above 15° elevation at this
 * instant. Auto-refreshes every 60 s while visible. Lineage is displayed
 * honestly: entries served from the build-time catalog snapshot are labelled
 * "cached", never "live".
 */

import { useCallback, useEffect, useState } from "react";
import { Badge, Loading } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/units";

interface OverheadEntry {
  satelliteNumber: string;
  name: string;
  elevationDeg: number;
  azimuthDeg: number;
  direction: string;
  altitudeKm: number;
  lineage: string;
}

interface OverheadData {
  asOf: string;
  visible: OverheadEntry[];
  skipped: number;
}

type OverheadError =
  | { kind: "permission"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "network"; message: string };

export function OverheadNow() {
  const [observer, setObserver] = useState<{ lat: number; lon: number } | null>(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [locating, setLocating] = useState(false);
  const [data, setData] = useState<OverheadData | null>(null);
  const [error, setError] = useState<OverheadError | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchOverhead = useCallback(async (lat: number, lon: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/overhead?latDeg=${lat}&lonDeg=${lon}`);
      const body = (await res.json()) as { ok: boolean; data?: OverheadData; error?: { message: string } };
      if (!res.ok || !body.ok) {
        setError({ kind: "network", message: body.error?.message ?? "Overhead computation is unavailable" });
        return;
      }
      setData(body.data ?? null);
      setError(null);
    } catch {
      setError({ kind: "network", message: "Could not reach the analysis service" });
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshNow = useCallback(() => {
    if (observer) void fetchOverhead(observer.lat, observer.lon);
  }, [observer, fetchOverhead]);

  function locate() {
    if (!("geolocation" in navigator)) {
      setError({ kind: "invalid", message: "This browser cannot share a location — enter coordinates manually." });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setObserver({ lat, lon });
        setManualLat(lat.toFixed(3));
        setManualLon(lon.toFixed(3));
        void fetchOverhead(lat, lon);
      },
      () => {
        setLocating(false);
        setError({
          kind: "permission",
          message: "Location permission denied — enter coordinates manually below.",
        });
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function useManual() {
    const lat = Number.parseFloat(manualLat);
    const lon = Number.parseFloat(manualLon);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) {
      setError({ kind: "invalid", message: "Latitude must be within ±90° and longitude within ±180°." });
      return;
    }
    setObserver({ lat, lon });
    void fetchOverhead(lat, lon);
  }

  useEffect(() => {
    if (!observer) return;
    const id = setInterval(() => refreshNow(), 60_000);
    return () => clearInterval(id);
  }, [observer, refreshNow]);

  return (
    <section aria-label="What&apos;s above you right now" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">What&apos;s above you now</h2>
        {data ? <Badge tone={data.visible.length > 0 ? "good" : "neutral"}>{data.visible.length} above 15°</Badge> : null}
      </div>

      {observer === null ? (
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary" onClick={locate} disabled={locating}>
            {locating ? "Locating…" : "Use my location"}
          </button>
          <div className="flex gap-1">
            <input
              aria-label="Manual latitude"
              placeholder="lat, e.g. 40.7"
              className="input w-full"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
            />
            <input
              aria-label="Manual longitude"
              placeholder="lon, e.g. -74"
              className="input w-full"
              value={manualLon}
              onChange={(e) => setManualLon(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={useManual}>
              Go
            </button>
          </div>
          {error ? <p className="text-[11px] text-[var(--color-status-warn)]">{humanize(error)}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Observer {observer.lat.toFixed(2)}°, {observer.lon.toFixed(2)}°
            {data ? <> · computed {formatUtc(new Date(data.asOf))}</> : null}
          </p>

          {error ? <p className="text-[11px] text-[var(--color-status-warn)]">{humanize(error)}</p> : null}
          {busy && data === null ? <Loading label="Computing overhead objects…" /> : null}

          {data ? (
            data.visible.length > 0 ? (
              <ul className="flex flex-col">
                {data.visible.map((entry) => (
                  <li
                    key={entry.satelliteNumber}
                    className="flex items-baseline justify-between gap-2 border-b border-[var(--color-bg-inset)] py-1"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{entry.name}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">{entry.lineage === "live" ? "live" : "cached"}</span>
                    </span>
                    <span className="data-value text-right text-[12px]">
                      {entry.elevationDeg.toFixed(0)}° {entry.direction}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Nothing from the bright over 15° right now — the catalog station group is tracked continuously; try again shortly.
              </p>
            )
          ) : null}

          <button
            className="btn btn-secondary self-start text-[12px]"
            onClick={() => refreshNow()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>
      )}
    </section>
  );
}

function humanize(error: OverheadError): string {
  return error.message;
}
