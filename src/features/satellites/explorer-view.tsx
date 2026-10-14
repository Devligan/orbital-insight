"use client";

/**
 * Explorer — the main user-facing experience.
 *
 * User-first order of operations: "what can I see tonight from where I am" is
 * the first panel, the globe is the visual anchor, and the technical panel is
 * reference material underneath. Every jargon-bearing label gets a plain-word
 * companion. The satellite and prediction instant are shareable through the
 * URL (?cat=<id>&t=<step>) so a moment you're looking at can be sent to a
 * friend, not just described.
 *
 * Selection lives in state (`selectedId`), seeded from a deep-link param when
 * present: clicking an example both reloads data and rewrites the URL, so the
 * address bar always names what's on screen.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EciSample } from "@/features/orbit-visualization/sample-types";
import type { PositionsResponse, GroundTrackResponse } from "@/features/orbit-visualization/position-group";
import { toEciSamples, toTrackSegments } from "@/features/orbit-visualization/position-group";
import { GroundTrackPlot } from "@/features/orbit-visualization/ground-track-plot";
import { useWatchlist } from "@/features/watchlist/local-store";
import { useObserverLocation } from "@/features/observer/use-observer-location";
import { OverheadNow } from "@/features/overhead/overhead-now";
import { TonightPasses } from "@/features/pass-prediction/tonight-passes";
import { copyToClipboard } from "@/lib/clipboard";
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
  // HST replaced NOAA 19 (36511): the provider no longer serves elements for
  // the retired weather satellite, so its example tile opened on an honest
  // not-found error. Everything here must actually load.
  { satelliteNumber: "20580", name: "HST (Hubble)" },
  { satelliteNumber: "43873", name: "STARLINK-30423" },
];

export function ExplorerView({ initialSatellite }: { initialSatellite?: { satelliteNumber: string; name: string } | null }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const observerLocation = useObserverLocation();
  const watchlist = useWatchlist();

  // A link that names a catalog object (?cat=…) opens straight on it — shared
  // moments land where they point, instead of resetting to the default ISS.
  const rawCat = searchParams.get("cat");
  const urlTime = useMemo(() => {
    const value = Number(searchParams.get("t"));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }, [searchParams]);
  const initial = useMemo(() => {
    if (rawCat && /^[0-9]{1,5}$/.test(rawCat)) {
      return { satelliteNumber: rawCat, name: CURATED.find((c) => c.satelliteNumber === rawCat)?.name ?? `NORAD ${rawCat}` };
    }
    return initialSatellite ?? DEFAULT_SATELLITE;
    // Read once on mount; afterwards the URL is written by this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedId, setSelectedId] = useState(initial.satelliteNumber);
  const [detail, setDetail] = useState<SatelliteDetail["data"] | null>(null);
  const [positions, setPositions] = useState<EciSample[]>([]);
  const [trackSegmentsPt, setTrackSegmentsPt] = useState<[number, number][][]>();
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [timeIndex, setTimeIndex] = useState(0);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [globeUnavailable, setGlobeUnavailable] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayName = detail?.name ?? initial.name;

  const load = useCallback(async (satelliteNumber: string, initialIndex: number) => {
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
      const sampleCount = positionsBody.data?.positions.length ?? 0;
      // Only adopt a new detail when it matches the selection at completion
      // time — a slow response for an earlier click must never overwrite the
      // data of a later one.
      if (detailBody.data && detailBody.data.satelliteNumber === satelliteNumber) {
        setDetail(detailBody.data);
      }
      setPositions(positionsBody.data ? toEciSamples(positionsBody.data.positions) : []);
      setTrackSegmentsPt(toTrackSegments(trackBody.data));
      setIntervalSeconds(trackBody.data?.sampleIntervalSeconds ?? 60);
      setTimeIndex(initialIndex > 0 ? Math.min(initialIndex, Math.max(sampleCount - 1, 0)) : 0);
    } catch {
      setError({ kind: "network", message: "Could not reach the analysis service" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Defer via a timer: setState happens in a callback, not synchronously
    // within the effect body.
    const t = setTimeout(() => void load(selectedId, urlTime), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Shareable state through the router itself. NOTE: raw window.history
  // mutations are barred here — replaceState(null, …) wipes Next Router's
  // internal history state and silently breaks every later client-side
  // navigation (reproduced + receipt in the e2e journey). router.replace
  // keeps the router authoritative. Sync runs only on satellite *changes*
  // (not slider ticks, which would spam the server); the copy-link action
  // builds the full ?cat=&t= moment on demand.
  const firstSelectedRef = useRef(selectedId);
  useEffect(() => {
    if (selectedId === firstSelectedRef.current) return;
    router.replace(`/?cat=${selectedId}`, { scroll: false });
  }, [selectedId, router]);

  function copyLink() {
    const url = `${window.location.origin}/?cat=${selectedId}&t=${timeIndex}`;
    router.replace(`/?cat=${selectedId}&t=${timeIndex}`, { scroll: false });
    void copyToClipboard(url).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_500);
      }
    });
  }

  const selected = positions[timeIndex] ?? null;

  return (
    <div className="flex flex-col gap-3 p-3 lg:h-[calc(100dvh-6rem)] xl:h-[calc(100dvh-3.5rem)]">
      {/* Curated examples strip */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Examples</span>
        {CURATED.map((example) => (
          <button
            key={example.satelliteNumber}
            className={
              "badge " +
              (example.satelliteNumber === selectedId
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]")
            }
            onClick={() => setSelectedId(example.satelliteNumber)}
          >
            {example.name}
          </button>
        ))}
        <Link href={`/satellites/${selectedId}`} className="badge text-[var(--color-accent)] hover:underline">
          Full details →
        </Link>
        <button className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]" onClick={copyLink}>
          {copied ? "Link copied ✓" : "Copy share link"}
        </button>
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
            retry={() => void load(selectedId, 0)}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
          {/* Globe: the visual anchor */}
          <div className="panel relative min-h-[320px] overflow-hidden lg:min-h-0">
            <OrbitGlobe
              samples={positions}
              trackSegments={trackSegmentsPt ?? []}
              name={displayName}
              sampleIntervalSeconds={intervalSeconds}
              onUnavailable={() => setGlobeUnavailable(true)}
            />
            {globeUnavailable ? (
              <div className="absolute inset-0 overflow-auto bg-[var(--color-bg-panel)] p-3">
                <p className="mb-2 text-[12px] text-[var(--color-status-warn)]">
                  3D globe unavailable — showing the computed 2D ground track instead. The accent marker follows the
                  prediction-time slider below. Want the full globe? Turn on &quot;Use graphics acceleration&quot; in
                  your browser settings, then refresh.
                </p>
                <GroundTrackPlot
                  name={displayName}
                  segments={((trackSegmentsPt ?? []) as [number, number][][]).map((segment) =>
                    segment.map(([lat, lon]) => ({ latitudeDeg: lat, longitudeDeg: lon, altitudeKm: 0, time: "" })),
                  )}
                  markerPosition={selected
                    ? { latitudeDeg: selected.latitudeDeg, longitudeDeg: selected.longitudeDeg, time: selected.time }
                    : null}
                  height={420}
                />
              </div>
            ) : null}
          </div>

          {/* Panel stack: user-first (tonight's passes) before the technical detail */}
          <aside className="panel-inset flex max-h-full flex-col gap-3 overflow-auto p-3">
            <TonightPasses location={observerLocation} />
            <div className="border-t border-[var(--color-border-hairline)] pt-3">
              <OverheadNow location={observerLocation} />
            </div>
            <div className="border-t border-[var(--color-border-hairline)] pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <h1 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                  {displayName}
                </h1>
                <WatchlistStar
                  satelliteNumber={selectedId}
                  name={displayName}
                  watchlist={watchlist}
                />
              </div>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                NORAD {detail?.satelliteNumber ?? selectedId} · {detail?.internationalDesignator ?? "ID unavailable"}
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                The dot on the globe is where it is right now — slide the time below to see where it goes next.
              </p>
            </div>

            {detail?.characteristics ? (
              <dl className="flex flex-col">
                <Row label="Orbit tilt" value={`${detail.characteristics.inclinationDeg.toFixed(1)}°`} hint="how steeply it crosses the equator" />
                <Row label="Lowest altitude" value={`${detail.characteristics.perigeeAltitudeKm.toFixed(0)} km`} />
                <Row label="Highest altitude" value={`${detail.characteristics.apogeeAltitudeKm.toFixed(0)} km`} />
                <Row label="One lap around Earth" value={`${detail.characteristics.periodMinutes.toFixed(0)} min`} />
                <Row label="Orbits per day" value={detail.characteristics.meanMotionRevPerDay.toFixed(2)} />
                <Row label="Eccentricity" value={detail.characteristics.eccentricity.toFixed(7)} hint="how non-circular the orbit is" />
              </dl>
            ) : (
              <Loading label={busy ? "Loading orbital elements…" : ""} />
            )}

            {detail ? (
              <div className="mt-auto flex flex-col gap-1 border-t border-[var(--color-border-hairline)] pt-2 text-[11px] text-[var(--color-text-muted)]">
                <p>Element epoch: <span className="data-value">{formatUtc(new Date(detail.epoch))}</span></p>
                <p>Retrieved: <span className="data-value">{formatUtc(new Date(detail.retrievedAt))}</span></p>
                <p className="italic">Position shown is calculated from the orbital elements — a good prediction, not a live reading.</p>
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

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[var(--color-bg-inset)] py-1">
      <dt className="label">
        {label}
        {hint ? <span className="block text-[10px] font-normal text-[var(--color-text-muted)]">{hint}</span> : null}
      </dt>
      <dd className="data-value text-right">{value}</dd>
    </div>
  );
}

/** Compact star toggle next to the object name — the watchlist is one glance away. */
function WatchlistStar({
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
      className={
        "shrink-0 text-[18px] leading-none " +
        (saved ? "text-[var(--color-accent)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]")
      }
      aria-pressed={saved}
      aria-label={saved ? "In watchlist — click to remove" : "Save to watchlist"}
      title={saved ? "In watchlist — click to remove" : "Save to watchlist"}
      onClick={() => (saved ? watchlist.remove(satelliteNumber) : watchlist.add(satelliteNumber, name))}
    >
      {saved ? "★" : "☆"}
    </button>
  );
}
