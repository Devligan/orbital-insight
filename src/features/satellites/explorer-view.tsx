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
import { useDeferredMount } from "@/lib/use-deferred-mount";
import {
  FAST_FORWARD_RATE,
  isLive,
  liveClock,
  offsetLabel,
  pausedAt,
  simTimeAt,
  sliderIndexFor,
  withRate,
  type ViewClock,
} from "@/features/orbit-visualization/view-clock";
import { ErrorState, Loading } from "@/components/ui/primitives";
import { formatUtc } from "@/lib/units";

// The globe ships ~2 MB of WebGL runtime; keep it out of the initial bundle.
const SkyField = dynamic(
  () => import("@/features/orbit-visualization/sky-field").then((m) => m.SkyField),
  { ssr: false, loading: () => <Loading label="Loading 3D globe…" /> },
);

const DEFAULT_SATELLITE = { satelliteNumber: "25544", name: "ISS (ZARYA)" };
const NO_TRACK: [number, number][][] = [];

/** Position window: 10 min before now → 6 h after, one sample every 5 min. */
const WINDOW_LEAD_MS = 10 * 60_000;
const WINDOW_HOURS = 6 + WINDOW_LEAD_MS / 3_600_000;
const WINDOW_SAMPLES = Math.round((WINDOW_HOURS * 60) / 5) + 1; // 75

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
  // One clock for the whole view (see view-clock.ts): live by default; the
  // slider pauses it at a chosen instant; fast-forward runs it at 60×.
  const [clock, setClock] = useState<ViewClock>(() => liveClock(Date.now()));
  const [wallNow, setWallNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState<{ satelliteNumber: string; name: string } | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [globeUnavailable, setGlobeUnavailable] = useState(false);
  const [wholeSky, setWholeSky] = useState(true); // the hero visual
  const [copied, setCopied] = useState(false);
  const globeHostRef = useRef<HTMLDivElement>(null);
  const globeReady = useDeferredMount(globeHostRef);

  const displayName = detail?.name ?? initial.name;
  // The current selection, readable from async loads (stale-response guard).
  const selectedIdRef = useRef(selectedId);

  const load = useCallback(async (satelliteNumber: string, initialIndex: number) => {
    // Yield to the microtask queue first: setState after an await is an
    // async continuation, not a synchronous cascading render in the effect.
    await Promise.resolve();
    setBusy(true);
    setError(null);
    // NOTE: globeUnavailable is deliberately NOT reset here. WebGL
    // availability is a property of the machine/session, not of the selected
    // satellite — resetting it would unstick the fallback and leave the 3D
    // globe's loading state forever on GPUs that cannot start WebGL.
    try {
      const [detailRes, positionsRes, trackRes] = await Promise.all([
        fetch(`/api/satellites/${satelliteNumber}`),
        // Window opens 10 min before this device's "now" (5-min steps to +6 h)
        // so the current instant is always inside the samples, whatever the
        // latency or clock skew — otherwise the globe has nothing to draw.
        fetch(
          `/api/satellites/${satelliteNumber}/positions?start=${new Date(Date.now() - WINDOW_LEAD_MS).toISOString()}&hours=${WINDOW_HOURS}&samples=${WINDOW_SAMPLES}`,
        ),
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
      // A slow response for an earlier click must never overwrite the data of
      // a later one — for the detail card, the positions, and the track alike.
      if (satelliteNumber !== selectedIdRef.current) return;
      if (detailBody.data && detailBody.data.satelliteNumber === satelliteNumber) {
        setDetail(detailBody.data);
      }
      const samples = positionsBody.data ? toEciSamples(positionsBody.data.positions) : [];
      setPositions(samples);
      setTrackSegmentsPt(toTrackSegments(trackBody.data));
      // The globe draws what these samples are: its id/name come from the
      // loaded data, not the (possibly newer) selection.
      setLoaded({ satelliteNumber, name: detailBody.data?.name ?? satelliteNumber });
      // A shared link's step (?t=) opens paused at that instant.
      const linked = initialIndex > 0 ? samples[Math.min(initialIndex, samples.length - 1)] : undefined;
      if (linked) setClock(pausedAt(Date.parse(linked.time), Date.now()));
    } catch {
      setError({ kind: "network", message: "Could not reach the analysis service" });
    } finally {
      setBusy(false);
    }
  }, []);

  // The shared link's instant applies to the first load only — switching
  // satellites afterwards keeps whatever time the user is looking at.
  const pendingLinkStepRef = useRef(urlTime);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    // Defer via a timer: setState happens in a callback, not synchronously
    // within the effect body.
    const step = pendingLinkStepRef.current;
    pendingLinkStepRef.current = 0;
    const t = setTimeout(() => void load(selectedId, step), 0);
    return () => clearTimeout(t);
  }, [selectedId, load]);

  // One-second tick: advances the slider/readout, stops fast-forward at the
  // end of the predicted window, and fetches a fresh 6 h window before live
  // time runs past the current one.
  const clockRef = useRef(clock);
  const positionsRef = useRef(positions);
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    clockRef.current = clock;
    positionsRef.current = positions;
  });
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setWallNow(now);
      const samples = positionsRef.current;
      const last = samples[samples.length - 1];
      if (!last) return;
      const current = clockRef.current;
      const endMs = Date.parse(last.time);
      const sim = simTimeAt(current, now);
      if (current.rate > 1 && sim >= endMs) {
        setClock(pausedAt(endMs, now));
      } else if (current.rate === 1 && sim > endMs - 60 * 60_000 && now - lastRefreshRef.current > 5 * 60_000) {
        lastRefreshRef.current = now;
        void load(selectedIdRef.current, 0);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [load]);

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

  // Stable props for the (memoized) globe: this component re-renders every
  // second for its readout, and fresh callbacks would re-register the
  // globe's click handler each time.
  const onGlobeUnavailable = useCallback(() => setGlobeUnavailable(true), []);
  const onGlobeSelect = useCallback((satnum: string) => {
    if (satnum) {
      setWholeSky(true);
      setSelectedId(satnum);
    }
  }, []);

  const simNow = simTimeAt(clock, wallNow);
  const live = isLive(clock, wallNow);
  const windowStartMs = positions[0] ? Date.parse(positions[0].time) : 0;
  const stepMs = positions[1] && positions[0] ? Date.parse(positions[1].time) - windowStartMs : 0;
  const timeIndex = sliderIndexFor(simNow, windowStartMs, stepMs, positions.length);
  const selected = positions[timeIndex] ?? null;

  return (
    // One first screen, two answers side by side on desktop: "what can I see
    // tonight" (left) and the live sky itself (right, sticky while the left
    // column scrolls). Phones stack them in reading order: tonight → globe →
    // the followed object's card.
    <div className="hero-band px-3 pb-8 pt-6 sm:px-6 lg:pt-8">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <SkyTonight location={observerLocation} />
        </div>

        {/* ─── The live sky: "here's what it looks like" ─── */}
        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="flex flex-col gap-3 lg:sticky lg:top-[72px]">
            <div className="flex flex-wrap items-center gap-2">
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
              <div className="panel">
                <ErrorState
                  title="Couldn't load this satellite right now"
                  message={`${error.message} The public data provider may be briefly down; try again shortly.`}
                  retry={() => void load(selectedId, 0)}
                />
              </div>
            ) : (
              /* Globe: the visual anchor. On desktop it fills the viewport
                 height beside the tonight column; on phones a tall band. */
              <div
                ref={globeHostRef}
                className="panel relative h-[60vh] min-h-[420px] overflow-hidden lg:h-[calc(100vh-13rem)] lg:max-h-[920px] lg:min-h-[520px]"
              >
                {/* Mounted when near the viewport and the browser is idle — on
                    phones the globe is below the fold, and starting Cesium at
                    load froze taps on the tonight button for ~2.4 s. */}
                {globeReady ? (
                  <SkyField
                    samples={positions}
                    trackSegments={trackSegmentsPt ?? NO_TRACK}
                    name={loaded?.name ?? displayName}
                    satelliteNumber={loaded?.satelliteNumber ?? selectedId}
                    clock={clock}
                    onUnavailable={onGlobeUnavailable}
                    cloud={wholeSky}
                    onSelectSatellite={onGlobeSelect}
                  />
                ) : (
                  <Loading label="Loading 3D globe…" />
                )}
                {globeUnavailable ? (
                  <div className="absolute inset-0 overflow-auto bg-[var(--color-bg-panel)] p-4">
                    <p className="mb-2 text-[13px] text-[var(--color-status-warn)]">
                      This browser has 3D graphics turned off, so here&apos;s the same orbit drawn in 2D. The marker
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
            )}

            {/* Time controls: the slider drives the whole globe (satellite,
                model, every whole-sky dot) through the shared clock. */}
            <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              <label htmlFor="time-slider" className="label shrink-0">
                Time
              </label>
              {live ? (
                <span className="badge badge-good shrink-0" title="Positions update in real time">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-status-good)]" />
                  Live
                </span>
              ) : (
                <button
                  className="badge shrink-0 text-[var(--color-accent)] hover:border-[var(--color-accent)]"
                  onClick={() => setClock(liveClock(Date.now()))}
                >
                  ↺ Back to live
                </button>
              )}
              <input
                id="time-slider"
                type="range"
                className="min-w-0 flex-1"
                min={0}
                max={Math.max(positions.length - 1, 0)}
                value={timeIndex}
                onChange={(e) => {
                  const sample = positions[Number(e.target.value)];
                  if (sample) setClock(pausedAt(Date.parse(sample.time), Date.now()));
                }}
                disabled={positions.length === 0}
                aria-valuemin={0}
                aria-valuemax={positions.length - 1}
                aria-valuenow={timeIndex}
                aria-valuetext={positions.length ? `${offsetLabel(simNow, wallNow)}, ${formatUtc(new Date(simNow))}` : "no data"}
              />
              <span className="text-[11px] text-[var(--color-text-muted)]">+6 h</span>
              <button
                className="badge shrink-0 text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]"
                disabled={positions.length === 0}
                aria-pressed={clock.rate === FAST_FORWARD_RATE}
                onClick={() =>
                  setClock(
                    clock.rate === FAST_FORWARD_RATE
                      ? pausedAt(simNow, Date.now())
                      : withRate(clock, FAST_FORWARD_RATE, Date.now()),
                  )
                }
                title="Fast-forward: one hour of orbits per minute"
              >
                {clock.rate === FAST_FORWARD_RATE ? "❚❚ Pause" : "▶ 60×"}
              </button>
              {/* Own line on phones: the fixed-width UTC stamp overflowed a 390px screen. */}
              <span className="data-value w-full text-right text-[13px] sm:w-auto sm:min-w-[19ch]">
                {positions.length ? (
                  <>
                    {!live ? (
                      <span className="mr-2 text-[var(--color-accent)]">{offsetLabel(simNow, wallNow)}</span>
                    ) : null}
                    {formatUtc(new Date(simNow))}
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Object panel: friendly headline + collapsed engineering */}
        {error ? null : (
          <aside className="panel flex min-w-0 flex-col gap-3 self-start p-4 lg:col-start-1 lg:row-start-2">
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
                Shown where it is right now. Drag the time slider, or fast-forward, to see where it goes next.
                {selectedId === "25544"
                  ? " The 3D station model (NASA) is drawn enlarged; the real ISS is about 109 m across."
                  : ""}
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
                <p className="italic">Position shown is calculated from the orbital elements: a good prediction, not a live reading.</p>
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
        )}
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
      aria-label={saved ? "In watchlist. Click to remove" : "Save to watchlist"}
      title={saved ? "In watchlist. Click to remove" : "Save to watchlist"}
      onClick={() => (saved ? watchlist.remove(satelliteNumber) : watchlist.add(satelliteNumber, name))}
    >
      {saved ? "★" : "☆"}
    </button>
  );
}
