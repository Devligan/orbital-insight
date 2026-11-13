"use client";

/**
 * Pass-prediction workflow UI.
 *
 * Inputs validate format client-side; the server re-validates everything.
 * Results distinguish predicted passes from visibility guarantees and label
 * truncated passes honestly. CSV export encodes exactly the returned data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PlaceSearch, type ChosenSpot } from "@/features/observer/place-search";
import { rememberSpot, useRememberedSpot } from "@/features/observer/spot-store";
import { useWatchlist } from "@/features/watchlist/local-store";
import { PassCard, type PassCardData as PassEntry } from "@/features/pass-prediction/pass-cards";
import { observerClock, observerZoneNote } from "@/features/pass-prediction/sky-words";
import { SkyChart } from "@/features/pass-prediction/sky-chart";
import { Badge, EmptyState, ErrorState, Loading, Panel, PanelHeader } from "@/components/ui/primitives";
import { downloadFile } from "@/lib/download";
import { formatUtc } from "@/lib/units";

interface PassSatelliteResult {
  satelliteNumber: string;
  name: string;
  passes: PassEntry[];
  failure?: { reason: string; message: string };
  lineage?: string;
}

interface PassResponse {
  ok: boolean;
  data?: {
    results: PassSatelliteResult[];
    windowStart: string;
    windowEnd: string;
    minElevationDeg: number;
    /** IANA zone at the observer's coordinates (server-resolved). */
    observerTimeZone: string | null;
  };
  error?: { kind: string; message: string };
}

/** Bright, well-known objects people ask about, one tap each. */
const QUICK_PICKS = [
  { satelliteNumber: "25544", name: "ISS" },
  { satelliteNumber: "48274", name: "Tiangong" },
  { satelliteNumber: "20580", name: "Hubble" },
] as const;

interface FormValues {
  satellites: string;
  latitude: string;
  longitude: string;
  altitudeMeters: string;
  windowHours: string;
  minElevationDeg: string;
}

const DEFAULT_SPOT = { lat: "51.5072", lon: "-0.1276", altitudeMeters: "11", label: "London, England, United Kingdom" };

export function PassPredictionsForm() {
  const watchlist = useWatchlist();
  // Where you are comes from the spot remembered on the home page (or a place
  // picked here); typing coordinates by hand overrides it for this page.
  const remembered = useRememberedSpot();
  const [typed, setTyped] = useState<{ latitude: string; longitude: string; altitudeMeters: string } | null>(null);
  const [satelliteInput, setSatelliteInput] = useState("25544");
  const [windowHours, setWindowHours] = useState("24");
  const [minElevationDeg, setMinElevationDeg] = useState("10");
  const [results, setResults] = useState<PassResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Drops a slower, superseded answer (e.g. the opening run vs. a quick re-run).
  const requestRef = useRef(0);

  const latitude = typed?.latitude ?? (remembered ? remembered.lat.toFixed(4) : DEFAULT_SPOT.lat);
  const longitude = typed?.longitude ?? (remembered ? remembered.lon.toFixed(4) : DEFAULT_SPOT.lon);
  // A geocoded place has no useful height for this; sea level is within the model's slack.
  const altitudeMeters = typed?.altitudeMeters ?? (remembered ? "0" : DEFAULT_SPOT.altitudeMeters);
  const spotLabel = typed ? null : remembered ? remembered.label : DEFAULT_SPOT.label;
  const form: FormValues = { satellites: satelliteInput, latitude, longitude, altitudeMeters, windowHours, minElevationDeg };

  // Uses only setters and the ref, so it's stable and effects can depend on it.
  const run = useCallback(async (values: FormValues) => {
    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          satelliteNumbers: values.satellites.split(/[\s,]+/).map((id) => id.trim()).filter((id) => /^[0-9]{1,5}$/.test(id)),
          observer: {
            latitudeDeg: Number(values.latitude),
            longitudeDeg: Number(values.longitude),
            altitudeMeters: Number(values.altitudeMeters),
          },
          windowStartIso: new Date().toISOString(),
          windowHours: Number(values.windowHours),
          minElevationDeg: Number(values.minElevationDeg),
        }),
      });
      const body = (await response.json()) as PassResponse;
      if (request !== requestRef.current) return;
      if (!body.ok || !body.data) {
        setError(body.error?.message ?? "The pass-prediction service reported an error");
        return;
      }
      setResults(body.data);
    } catch {
      if (request === requestRef.current) setError("Could not reach the pass-prediction service (network error)");
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  }, []);

  // The latest form, for the effect below (refs are written in effects, not during render).
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  });

  // Open on an answer, not an empty panel, and answer again whenever the spot
  // changes (a place picked here, or on the home page in another tab).
  const spotKey = remembered ? `${remembered.lat},${remembered.lon}` : "default";
  useEffect(() => {
    void run(formRef.current);
  }, [run, spotKey]);

  function choosePlace(spot: ChosenSpot) {
    setTyped(null);
    rememberSpot({ lat: spot.lat, lon: spot.lon, label: spot.label, source: spot.source });
  }

  function editSpot(field: "latitude" | "longitude" | "altitudeMeters", value: string) {
    setTyped({ latitude, longitude, altitudeMeters, [field]: value });
  }

  function submit() {
    void run(form);
  }
  const watchlistQuick = watchlist.items.slice(0, 4);

  return (
    <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
      <Panel>
        <PanelHeader title="Observation setup" />
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1">
            <span className="label">Where you&apos;re watching from</span>
            <PlaceSearch onChoose={choosePlace} label="Find a place by name, postcode, or coordinates" />
            <span className="text-[12px] text-[var(--color-text-secondary)]" data-testid="passes-spot">
              {spotLabel ?? "Coordinates as typed below"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="label">Latitude (±90°)</span>
              <input
                className="input"
                value={latitude}
                onChange={(e) => editSpot("latitude", e.target.value)}
                name="latitude"
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Longitude (±180°)</span>
              <input
                className="input"
                value={longitude}
                onChange={(e) => editSpot("longitude", e.target.value)}
                name="longitude"
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">Altitude above sea level (m)</span>
            <input className="input" value={altitudeMeters} onChange={(e) => editSpot("altitudeMeters", e.target.value)} name="altitude" autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Catalog IDs (up to 25, space-separated)</span>
            <input className="input font-mono" value={satelliteInput} onChange={(e) => setSatelliteInput(e.target.value)} name="satellites" autoComplete="off" />
          </label>
          <div className="-mt-1 flex flex-wrap gap-1">
            {QUICK_PICKS.map((pick) => (
              <button
                type="button"
                key={pick.satelliteNumber}
                className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                onClick={() => setSatelliteInput((prev) => addId(prev, pick.satelliteNumber))}
              >
                + {pick.name}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">Prediction window (hours, ≤ 720)</span>
            <input className="input" value={windowHours} onChange={(e) => setWindowHours(e.target.value)} name="window" autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Minimum elevation (°, 0–85)</span>
            <input className="input" value={minElevationDeg} onChange={(e) => setMinElevationDeg(e.target.value)} name="minElevation" autoComplete="off" />
          </label>

          {watchlistQuick.length > 0 ? (
            <div>
              <span className="label">From your browser watchlist</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {watchlistQuick.map((item) => (
                  <button
                    type="button"
                    key={item.satelliteNumber}
                    className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                    onClick={() => setSatelliteInput((prev) => addId(prev, item.satelliteNumber))}
                  >
                    + {item.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Calculating…" : "Predict passes"}
          </button>
        </form>

        <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
          Every pass is a geometry calculation. Sunlight geometry — Earth&apos;s shadow and the observer&apos;s sky
          darkness — is modeled. Brightness is estimated only for objects with a published standard magnitude
          (others read &ldquo;brightness unknown&rdquo;), and is rough even then. Clouds and eyesight are not
          modeled. See the{" "}
          <Link href="/methodology" className="text-[var(--color-accent)] hover:underline">methodology</Link>.
        </p>
      </Panel>

      <Panel className="min-w-0">
        <PanelHeader
          title="Predicted passes"
          right={
            results ? (
              <button className="btn btn-secondary" onClick={() => exportCsv(results, { latitude, longitude, altitudeMeters, windowHours, minElevationDeg })}>
                Export CSV
              </button>
            ) : undefined
          }
        />

        {busy ? <Loading label="Propagating passes…" /> : null}
        {error ? <ErrorState title="Pass prediction failed" message={error} retry={submit} /> : null}
        {!busy && !error && !results ? (
          <EmptyState title="No predictions yet" hint="Configure the observation parameters and run a prediction." />
        ) : null}

        {results ? (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Window {formatUtc(new Date(results.windowStart))} → {formatUtc(new Date(results.windowEnd))} ·
              minimum elevation {results.minElevationDeg}°
              {(() => {
                const note = observerZoneNote(
                  results.observerTimeZone,
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                  new Date(results.windowStart),
                );
                return note ? ` · ${note.replace(/^Times are/, "Local times are")}` : "";
              })()}
            </p>
            {results.results.map((sat) => (
              <div key={sat.satelliteNumber} className="panel-inset p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link href={`/satellites/${sat.satelliteNumber}`} className="text-[13px] font-medium text-[var(--color-text-primary)] hover:underline">
                    {sat.name || `NORAD ${sat.satelliteNumber}`}
                  </Link>
                  <span className="data-value text-[11px] text-[var(--color-text-muted)]">{sat.satelliteNumber}</span>
                  {(sat.lineage === "provider-unavailable-stale" || sat.lineage === "cached") ? (
                    <Badge tone="warn">{sat.lineage === "cached" ? "Cached elements" : "Stale elements"}</Badge>
                  ) : null}
                  {sat.failure ? <Badge tone="bad">{sat.failure.reason}</Badge> : null}
                </div>

                {sat.failure ? (
                  <p className="text-[12px] text-[var(--color-status-bad)]">{sat.failure.message}</p>
                ) : sat.passes.length === 0 ? (
                  <p className="text-[12px] text-[var(--color-text-muted)]">
                    No passes above {results.minElevationDeg}° in this window.
                  </p>
                ) : (
                  <>
                    {/* Phones read cards; desktop keeps the technical table. */}
                    <div className="flex flex-col gap-2 md:hidden">
                    {sat.passes.map((pass, i) => (
                      <PassCard key={`${sat.satelliteNumber}-${i}`} pass={pass} timeZone={results.observerTimeZone} />
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="table-technical">
                      <thead>
                        <tr>
                          <th>Sky</th>
                          <th>Peak (local)</th>
                          <th>Rise (UTC)</th>
                          <th>Rise az</th>
                          <th>Max elevation</th>
                          <th>Apex az</th>
                          <th>Set (UTC)</th>
                          <th>Set az</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sat.passes.map((pass, i) => (
                          <tr key={`${sat.satelliteNumber}-${i}`}>
                            <td className="!py-1">
                              <SkyChart pass={pass} size={44} />
                            </td>
                            <td>{observerClock(pass.maxTime, results.observerTimeZone)}</td>
                            <td>{pass.riseTime ? formatUtc(new Date(pass.riseTime)) : "before window"}</td>
                            <td>{pass.azimuthAtRiseDeg !== null ? `${pass.azimuthAtRiseDeg.toFixed(1)}°` : "—"}</td>
                            <td>{pass.maxElevationDeg.toFixed(1)}°</td>
                            <td>{pass.azimuthAtMaxDeg.toFixed(1)}°</td>
                            <td>{pass.setTime ? formatUtc(new Date(pass.setTime)) : "after window"}</td>
                            <td>{pass.azimuthAtSetDeg !== null ? `${pass.azimuthAtSetDeg.toFixed(1)}°` : "—"}</td>
                            <td>
                              {pass.truncated === "none" ? "" : `pass ${pass.truncated} outside window`}
                              {pass.visibility
                                ? pass.visibility.fromGround
                                  ? pass.visibility.bestEstimatedMagnitude !== null
                                    ? ` visible (≈ mag ${pass.visibility.bestEstimatedMagnitude.toFixed(1)})`
                                    : " visible (brightness unknown)"
                                  : " not visible " + (pass.visibility.reasonIfNotVisible ?? "")
                                : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function exportCsv(
  results: NonNullable<PassResponse["data"]>,
  inputs: { latitude: string; longitude: string; altitudeMeters: string; windowHours: string; minElevationDeg: string },
): void {
  const rows: string[][] = [
    ["satellite_number", "name", "rise_utc", "rise_azimuth_deg", "max_utc", "max_elevation_deg", "max_azimuth_deg", "set_utc", "set_azimuth_deg", "truncated", "visible", "estimated_magnitude"],
  ];
  for (const sat of results.results) {
    if (sat.failure) {
      rows.push([sat.satelliteNumber, sat.name || `NORAD ${sat.satelliteNumber}`, "", "", "", "", "", "", "", `error: ${sat.failure.reason}`, "", ""]);
      continue;
    }
    for (const pass of sat.passes) {
      rows.push([
        sat.satelliteNumber,
        sat.name || `NORAD ${sat.satelliteNumber}`,
        pass.riseTime ?? "",
        pass.azimuthAtRiseDeg !== null ? pass.azimuthAtRiseDeg.toFixed(2) : "",
        pass.maxTime,
        pass.maxElevationDeg.toFixed(2),
        pass.azimuthAtMaxDeg.toFixed(2),
        pass.setTime ?? "",
        pass.azimuthAtSetDeg !== null ? pass.azimuthAtSetDeg.toFixed(2) : "",
        pass.truncated,
        pass.visibility ? (pass.visibility.fromGround ? "yes" : "no" + (pass.visibility.reasonIfNotVisible ? `: ${pass.visibility.reasonIfNotVisible}` : "")) : "",
        pass.visibility?.bestEstimatedMagnitude !== null && pass.visibility?.bestEstimatedMagnitude !== undefined ? pass.visibility.bestEstimatedMagnitude.toFixed(2) : "",
      ]);
    }
  }
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  downloadFile(csv, `passes_${results.windowStart.slice(0, 10)}_${inputs.latitude}N${inputs.longitude}E.csv`, "text/csv;charset=utf-8");
}

/** Append a catalog id unless it's already listed. */
function addId(list: string, id: string): string {
  return list.split(/[\s,]+/).includes(id) ? list : `${list} ${id}`.trim();
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
