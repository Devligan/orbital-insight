"use client";

/**
 * Explorer — the main recruiter-facing experience.
 *
 * Opens directly into a usable satellite explorer: default object (ISS),
 * 3D globe front-and-center, an information panel with real orbital data and
 * provenance, a bounded time slider that moves the displayed state through
 * the prediction window, and quick links to passes/compare.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { EciSample } from "@/features/orbit-visualization/sample-types";
import type { PositionsResponse, GroundTrackResponse } from "@/features/orbit-visualization/position-group";
import { toEciSamples, toTrackSegments } from "@/features/orbit-visualization/position-group";
import { GroundTrackPlot } from "@/features/orbit-visualization/ground-track-plot";
import { useWatchlist } from "@/features/watchlist/local-store";
import { OverheadNow } from "@/features/overhead/overhead-now";
import { Badge, ErrorState, Loading } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/units";

// The globe ships ~2 MB of WebGL runtime; keep it out of the initial bundle.
const OrbitGlobe = dynamic(
  () => import("@/features/orbit-visualization/orbit-globe").then((m) => m.OrbitGlobe),
  { ssr: false, loading: () => <Loading label="Loading 3D globe…" /> },
);

const DEFAULT_SATELLITE = { satelliteNumber: "25544", name: "ISS (ZARYA)" };

interface SatelliteDetail {
  ok: boolean;
  data?: {
    satelliteNumber: string;
    name: string;
    internationalDesignator: string | null;
    classification: string;
    epoch: string;
    retrievedAt: string;
    lineage: string;
    stale: boolean;
    tleLine1: string;
    tleLine2: string;
    characteristics?: {
      inclinationDeg: number;
      eccentricity: number;
      meanMotionRevPerDay: number;
      periodMinutes: number;
      perigeeAltitudeKm: number;
      apogeeAltitudeKm: number;
    };
  };
  error?: { kind: string; message: string };
}

const CURATED: { satelliteNumber: string; name: string; group?: string }[] = [
  { satelliteNumber: "25544", name: "ISS (ZARYA)" },
  { satelliteNumber: "48274", name: "CSS (TIANHE)" },
  { satelliteNumber: "36511", name: "NOAA 19" },
  { satelliteNumber: "43873", name: "STARLINK-30423" },
];

export function ExplorerView({ initialSatellite }: { initialSatellite?: { satelliteNumber: string; name: string } | null }) {
  const target = initialSatellite ?? DEFAULT_SATELLITE;
  const [detail, setDetail] = useState<SatelliteDetail["data"] | null>(null);
  const [positions, setPositions] = useState<EciSample[]>([]);
  const [trackSegmentsPt, setTrackSegmentsPt] = useState<[number, number][][]>();
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [timeIndex, setTimeIndex] = useState(0);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [globeUnavailable, setGlobeUnavailable] = useState(false);
  const watchlist = useWatchlist();

  const load = useCallback(async (satelliteNumber: string) => {
    // Yield to the microtask queue first: setState after an await is an
    // async continuation, not a synchronous cascading render in the effect.
    await Promise.resolve();
    setBusy(true);
    setError(null);
    setTimeIndex(0);
    // NOTE: globeUnavailable is deliberately NOT reset here. WebGL
    // availability is a property of the machine/session, not of the selected
    // satellite — resetting it would unstick the fallback and leave the 3D
    // globe's loading state forever on GPUs that cannot start WebGL.
    try {
      const [detailRes, positionsRes, trackRes] = await Promise.all([
        fetch(`/api/satellites/${satelliteNumber}`),
        fetch(`/api/satellites/${satelliteNumber}/positions?hours=6&samples=72`),
        fetch(`/api/satellites/${satelliteNumber}/ground-track?hours=24&samples=240`),
      ]);
      const detailBody = (await detailRes.json()) as SatelliteDetail;
      const positionsBody = (await positionsRes.json()) as PositionsResponse;
      const trackBody = (await trackRes.json()) as GroundTrackResponse;

      if (!detailRes.ok || !detailBody.ok) {
        setError(detailBody.error ?? { kind: "provider", message: "Satellite data is unavailable" });
        setBusy(false);
        return;
      }
      setDetail(detailBody.data ?? null);
      setPositions(positionsBody.data ? toEciSamples(positionsBody.data.positions) : []);
      setTrackSegmentsPt(toTrackSegments(trackBody.data));
      setIntervalSeconds(trackBody.data?.sampleIntervalSeconds ?? 60);
    } catch {
      setError({ kind: "network", message: "Could not reach the analysis service" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Defer via a timer: setState happens in a callback, not synchronously
    // within the effect body.
    const t = setTimeout(() => void load(target.satelliteNumber), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.satelliteNumber]);

  const selected = positions[timeIndex] ?? null;

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col gap-3 p-3 xl:h-[calc(100dvh-3.5rem)]">
      {/* Curated examples strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Examples</span>
        {CURATED.map((example) => (
          <button
            key={example.satelliteNumber}
            className={
              "badge " +
              (example.satelliteNumber === target.satelliteNumber
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]")
            }
            onClick={() => void load(example.satelliteNumber)}
          >
            {example.name}
          </button>
        ))}
        <Link href={`/satellites/${target.satelliteNumber}`} className="badge text-[var(--color-accent)] hover:underline">
          Full details →
        </Link>
        <span className="ml-auto flex items-center gap-2">
          {detail ? (
            <>
              <Badge tone="neutral">CelesTrak</Badge>
              <Badge tone={detail.lineage === "live" ? "good" : detail.lineage === "cached" ? "warn" : "bad"}>
                {lineageLabel(detail.lineage)}
              </Badge>
              <Badge tone={detail.stale ? "warn" : "good"}>{detail.stale ? "Elements > 36 h old" : "Elements recent"}</Badge>
            </>
          ) : null}
        </span>
      </div>

      {error ? (
        <div className="panel flex-1">
          <ErrorState
            title="Satellite data could not be loaded"
            message={`${error.kind}: ${error.message} — the public CelesTrak provider may be unavailable; retry shortly.`}
            retry={() => void load(target.satelliteNumber)}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
          {/* Globe: the visual anchor */}
          <div className="panel relative min-h-[320px] overflow-hidden lg:min-h-0">
            <OrbitGlobe
              samples={positions}
              trackSegments={trackSegmentsPt ?? []}
              name={detail?.name ?? target.name}
              sampleIntervalSeconds={intervalSeconds}
              onUnavailable={() => setGlobeUnavailable(true)}
            />
            {globeUnavailable ? (
              <div className="absolute inset-0 overflow-auto bg-[var(--color-bg-panel)] p-3">
                <p className="mb-2 text-[12px] text-[var(--color-status-warn)]">
                  3D globe unavailable — showing the computed 2D ground track instead.
                </p>
                <GroundTrackPlot
                  name={detail?.name ?? target.name}
                  segments={((trackSegmentsPt ?? []) as [number, number][][]).map((segment) =>
                    segment.map(([lat, lon]) => ({ latitudeDeg: lat, longitudeDeg: lon, altitudeKm: 0, time: "" })),
                  )}
                  height={420}
                />
              </div>
            ) : null}
          </div>

          {/* Information panel */}
          <aside className="panel-inset flex max-h-full flex-col gap-3 overflow-auto p-3">
            <OverheadNow />
            <div className="border-t border-[var(--color-border-hairline)] pt-3">
              <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                {detail?.name ?? target.name}
              </h1>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                NORAD {detail?.satelliteNumber ?? "—"} · {detail?.internationalDesignator ?? "ID unavailable"}
              </p>
            </div>

            <WatchlistButton
              satelliteNumber={target.satelliteNumber}
              name={detail?.name ?? target.name}
              watchlist={watchlist}
            />

            {detail?.characteristics ? (
              <dl className="flex flex-col">
                <Row label="Inclination" value={`${detail.characteristics.inclinationDeg.toFixed(4)}°`} />
                <Row label="Eccentricity" value={detail.characteristics.eccentricity.toFixed(7)} />
                <Row label="Period" value={`${detail.characteristics.periodMinutes.toFixed(2)} min`} />
                <Row label="Mean motion" value={`${detail.characteristics.meanMotionRevPerDay.toFixed(4)} rev/day`} />
                <Row label="Perigee (approx)" value={`${detail.characteristics.perigeeAltitudeKm.toFixed(0)} km`} />
                <Row label="Apogee (approx)" value={`${detail.characteristics.apogeeAltitudeKm.toFixed(0)} km`} />
              </dl>
            ) : (
              <Loading label={busy ? "Loading orbital elements…" : ""} />
            )}

            {detail ? (
              <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-border-hairline)] pt-2 text-[11px] text-[var(--color-text-muted)]">
                <p>Element epoch: <span className="data-value">{formatUtc(new Date(detail.epoch))}</span></p>
                <p>Retrieved: <span className="data-value">{formatUtc(new Date(detail.retrievedAt))}</span></p>
                <p className="italic">Position shown is an SGP4 prediction from the element set — not live telemetry.</p>
                <a
                  className="text-[var(--color-accent)] hover:underline"
                  href={`https://celestrak.org/NORAD/elements/gp.php?CATNR=${detail.satelliteNumber}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source: CelesTrak GP record ↗
                </a>
              </div>
            ) : null}
          </aside>
        </div>
      )}

      {/* Time slider row */}
      <div className="panel flex items-center gap-3 px-3 py-2">
        <label htmlFor="time-slider" className="label shrink-0">
          Prediction time
        </label>
        <input
          id="time-slider"
          type="range"
          className="flex-1"
          min={0}
          max={Math.max(positions.length - 1, 0)}
          value={Math.min(timeIndex, Math.max(positions.length - 1, 0))}
          onChange={(e) => setTimeIndex(Number(e.target.value))}
          disabled={positions.length === 0}
          aria-valuemin={0}
          aria-valuemax={positions.length - 1}
          aria-valuenow={timeIndex}
          aria-valuetext={selected ? formatUtc(new Date(selected.time)) : "no data"}
        />
        <span className="data-value min-w-[21ch] text-right text-[12px]">
          {selected ? formatUtc(new Date(selected.time)) : "—"}
        </span>
        <span className="data-value min-w-[17ch] text-right text-[12px] text-[var(--color-text-secondary)]">
          {selected
            ? `${selected.latitudeDeg.toFixed(2)}° ${selected.longitudeDeg.toFixed(2)}°`
            : ""}
        </span>
      </div>

    </div>
  );
}

function lineageLabel(lineage: string): string {
  if (lineage === "live") return "Live from provider";
  if (lineage === "cached") return "Cached";
  return "Stale (provider down)";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[var(--color-bg-inset)] py-1">
      <dt className="label">{label}</dt>
      <dd className="data-value text-right">{value}</dd>
    </div>
  );
}

function WatchlistButton({
  satelliteNumber,
  name,
  watchlist,
}: {
  satelliteNumber: string;
  name: string;
  watchlist: ReturnType<typeof useWatchlist>;
}) {
  const saved = watchlist.has(satelliteNumber);
  return (
    <button
      className={saved ? "btn btn-secondary" : "btn btn-primary"}
      aria-pressed={saved}
      onClick={() => (saved ? watchlist.remove(satelliteNumber) : watchlist.add(satelliteNumber, name))}
    >
      {saved ? "★ In watchlist" : "☆ Save to watchlist"}
    </button>
  );
}
