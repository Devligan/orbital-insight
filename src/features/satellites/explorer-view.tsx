"use client";

/**
 * Explorer — redesigned for people, not engineers.
 *
 * Reading order = question order: "what's over me tonight" (the hero),
 * "here's what it looks like" (the live orbit view), "tell me more"
 * (technical details, collapsed by default). The URL still shares the view
 * (?cat=<id>&t=<step>) through router-native syncing only — raw history
 * writes are barred (they silently broke router.push; see git history).
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
import { SkyTonight } from "@/features/tonight/sky-tonight";
import { copyToClipboard } from "@/lib/clipboard";
import { ErrorState, Loading } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/units";

// The globe ships ~2 MB of WebGL runtime; keep it out of the initial bundle.
const SkyField = dynamic(
  () => import("@/features/orbit-visualization/sky-field").then((m) => m.SkyField),
  { ssr: false, loading: () => <Loading label="Loading 3D globe…" /> },
);

const DEFAULT_SATELLITE = { satelliteNumber: "25544", name: "ISS (ZARYA)" };

/** The tracked object's orbit view + the (default-on) whole-sky cloud. */

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
  const [wholeSky, setWholeSky] = useState(true); // the hero visual
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

  // URL sync through the router only (raw window.history writes broke later
  // client navigation). On satellite *changes* only — slider ticks would
  // spam the server; the copy action carries the instant on demand.
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
    <div className="flex flex-col">
      {/* ─── Hero: the answer-first screen ─── */}
      <div className="hero-band px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <SkyTonight location={observerLocation} />
        </div>
      </div>

      {/* ─── Orbit view: "here's what it looks like" ─── */}
      <div className="px-3 pt-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <span className="label">Follow along</span>
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
          <button className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]" onClick={copyLink}>
            {copied ? "Link copied ✓" : "Copy share link"}
          </button>
          <Link href={`/satellites/${selectedId}`} className="badge text-[var(--color-accent)] hover:underline">
            Full details →
          </Link>
          <button
            className="badge text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
            aria-pressed={wholeSky}
            onClick={() => setWholeSky((on) => !on)}
          >
            {wholeSky ? "Whole sky: on" : "Whole sky: off"}
          </button>
        </div>

        {error ? (
          <div className="mx-auto mt-3 max-w-5xl">
            <div className="panel">
              <ErrorState
                title="Couldn't load this satellite right now"
                message={`${error.message} — the public data provider may be briefly down; try again shortly.`}
                retry={() => void load(selectedId, 0)}
              />
            </div>
          </div>
        ) : (
          <div className="mx-auto mt-3 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* Globe: the visual anchor — big, near edge-to-edge, the whole sky
                with the tracked object highlighted. Height is viewport-driven
                (capped) instead of a fixed short panel, so the cloud has room. */}
            <div className="panel relative h-[68vh] max-h-[880px] min-h-[520px] overflow-hidden">
              <SkyField
                samples={positions}
                trackSegments={trackSegmentsPt ?? []}
                name={displayName}
                sampleIntervalSeconds={intervalSeconds}
                onUnavailable={() => setGlobeUnavailable(true)}
                cloud={wholeSky}
                onSelectSatellite={(satnum) => {
                  if (satnum) {
                    setWholeSky(true);
                    setSelectedId(satnum);
                  }
                }}
              />
              {globeUnavailable ? (
                <div className="absolute inset-0 overflow-auto bg-[var(--color-bg-panel)] p-4">
                  <p className="mb-2 text-[13px] text-[var(--color-status-warn)]">
                    This browser has 3D graphics turned off, so here&apos;s the same orbit drawn in 2D — the marker
                    follows the time slider below. Want the full spinning globe? Turn on &quot;Use graphics
                    acceleration&quot; in your browser settings and refresh.
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

            {/* Object panel: friendly headline + collapsed engineering */}
            <aside className="panel flex min-w-0 flex-col gap-3 p-4">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[17px] font-bold text-[var(--color-text-primary)]">{displayName}</h2>
                  <WatchlistStar satelliteNumber={selectedId} name={displayName} watchlist={watchlist} />
                </div>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  {detail?.characteristics
                    ? `About ${detail.characteristics.perigeeAltitudeKm.toFixed(0)}–${detail.characteristics.apogeeAltitudeKm.toFixed(0)} km up, one lap every ${Math.round(detail.characteristics.periodMinutes)} minutes.`
                    : "Measuring its orbit…"}
                </p>
                <p className="text-[13px] text-[var(--color-text-muted)]">
                  The dot on the view is where it is right now — slide the time to see where it goes next.
                </p>
                {detail ? (
                  <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
                    {lineageLabel(detail.lineage)} · {detail.stale ? "elements > 36 h old" : "fresh elements"} ·{" "}
                    <a
                      className="text-[var(--color-accent)] hover:underline"
                      href={`https://celestrak.org/NORAD/elements/gp.php?CATNR=${detail.satelliteNumber}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      source record ↗
                    </a>
                  </p>
                ) : null}
              </div>

              <details className="border-t border-[var(--color-border-hairline)] pt-2">
                <summary className="cursor-pointer text-[13px] font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                  Technical details &amp; provenance
                </summary>
                <div className="flex flex-col gap-2 pt-2 text-[12px] text-[var(--color-text-muted)]">
                  <p className="italic">Position shown is calculated from the orbital elements — a good prediction, not a live reading.</p>
                  {detail ? (
                    <>
                      <p>Element epoch: <span className="data-value">{formatUtc(new Date(detail.epoch))}</span></p>
                      <p>Retrieved: <span className="data-value">{formatUtc(new Date(detail.retrievedAt))}</span></p>
                      <p>The upstream provider is CelesTrak&apos;s public catalog; propagation by SGP4.</p>
                    </>
                  ) : null}
                  {detail?.characteristics ? (
                    <dl className="flex flex-col">
                      <Row label="Orbit tilt" value={`${detail.characteristics.inclinationDeg.toFixed(1)}°`} hint="how steeply it crosses the equator" />
                      <Row label="Eccentricity" value={detail.characteristics.eccentricity.toFixed(7)} hint="how non-circular the orbit is" />
                      <Row label="Orbits per day" value={detail.characteristics.meanMotionRevPerDay.toFixed(2)} />
                      <Row label="NORAD id" value={detail.satelliteNumber} />
                    </dl>
                  ) : (
                    <Loading label={busy ? "Loading orbital elements…" : ""} />
                  )}
                </div>
              </details>
            </aside>
          </div>
        )}

        {/* Time slider row */}
        <div className="panel mx-auto mt-4 mb-4 flex max-w-7xl items-center gap-3 px-4 py-3">
          <label htmlFor="time-slider" className="label shrink-0">
            Time
          </label>
          <span className="text-[11px] text-[var(--color-text-muted)]">now</span>
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
          <span className="text-[11px] text-[var(--color-text-muted)]">+6 h</span>
          <span className="data-value min-w-[19ch] text-right text-[13px]">
            {selected ? formatUtc(new Date(selected.time)) : "—"}
          </span>
        </div>
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
        {hint ? <span className="block text-[11px] font-normal text-[var(--color-text-muted)]">{hint}</span> : null}
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
        "shrink-0 text-[20px] leading-none " +
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
