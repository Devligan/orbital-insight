"use client";

/**
 * Sky — the whole-sky 3D globe (Cesium, lazy-loaded, no Ion token: dimmed
 * Natural Earth II imagery served from our own /cesium assets, with real
 * day/night lighting).
 *
 * Two visual layers on one viewer:
 *  1. **The cloud** (opt-in via `cloud`): every active satellite, propagated
 *     client-side in a web worker (`sky-worker`), rendered as a
 *     PointPrimitiveCollection and animated in real time. Clicks pick an
 *     object and hand it to the parent (`onSelectSatellite`).
 *  2. **The tracked object** (same contract the single-orbit globe had):
 *     sampled positions → interpolated orbit polyline + satellite dot; ground
 *     track → antimeridian-split polylines at ellipsoid level 0.
 *
 * Honesty contracts preserved from the single-orbit globe:
 *  - WebGL-unavailable environments ⇒ 2D ground-track fallback rendered by
 *    the parent (data-mode="webgl-unavailable"); the globe never fakes it.
 *  - Catalog/worker failures ⇒ an honest inline message over the globe; the
 *    tracked-object view keeps working (it is provider-backed and cached).
 *
 * Bounded GPU load: the viewer renders on request only (`requestRenderMode`);
 * cloud batches and entity updates each trigger one render, camera input
 * renders by itself. Cloud cadence ≈ 7 batches/s — a gentle, bounded render
 * loop, not a 60 fps churn.
 */

import { useEffect, useRef, useState } from "react";
import type { EciSample } from "./sample-types";
import { SkyCloud, CATEGORY_COLORS, CATEGORY_LABELS } from "@/features/sky/sky-cloud";

export interface SkyFieldProps {
  samples: EciSample[];
  /** consecutive [lat, lon] pairs split at the antimeridian, degrees */
  trackSegments: [number, number][][];
  name: string;
  /** Seconds between samples — drives interpolated-orbit line timing. */
  sampleIntervalSeconds: number;
  /** Called once when WebGL unavailable — the parent shows the 2D fallback. */
  onUnavailable?: () => void;
  /** Render the whole-sky cloud (fetches /api/sky/catalog, spawns the worker). */
  cloud?: boolean;
  onSelectSatellite?: (satelliteNumber: string) => void;
  onCloudStatus?: (status: CloudStatus) => void;
}

export interface CloudStatus {
  state: "idle" | "loading" | "ready" | "stale" | "error";
  parsed?: number;
  failed?: number;
  message?: string;
}

interface CesiumViewer {
  entities: {
    add: (entity: unknown) => unknown;
    removeAll: () => void;
    removeById?: (id: string) => boolean;
    getById?: (id: string) => unknown;
  };
  scene: {
    primitives: {
      add: (primitive: unknown) => unknown;
      remove: (primitive: unknown) => void;
    };
    requestRender: () => void;
    pick: (position: unknown) => { id?: unknown; primitive?: unknown } | undefined;
    canvas: HTMLCanvasElement;
  };
  camera: {
    flyTo: (options: unknown) => void;
    setView: (options: unknown) => void;
  };
  clock: { currentTime: unknown; shouldAnimate: boolean };
  destroy: () => void;
  isDestroyed?: () => boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type CesiumModule = any;

const WIDGET_STYLESHEET_ID = "cesium-widgets-css";

/** Inject Cesium's widget CSS (copied to /cesium by the build) once, and wait for it. */
function ensureWidgetStylesheet(): Promise<void> {
  const existing = document.getElementById(WIDGET_STYLESHEET_ID) as HTMLLinkElement | null;
  if (existing?.sheet) return Promise.resolve();
  const link = existing ?? document.createElement("link");
  const loaded = new Promise<void>((resolve, reject) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => reject(new Error("Cesium widget stylesheet failed to load")), { once: true });
  });
  if (!existing) {
    link.id = WIDGET_STYLESHEET_ID;
    link.rel = "stylesheet";
    link.href = "/cesium/Widgets/widgets.css";
    document.head.appendChild(link);
  }
  return loaded;
}

export function SkyField({
  samples,
  trackSegments,
  name,
  sampleIntervalSeconds,
  onUnavailable,
  cloud = false,
  onSelectSatellite,
  onCloudStatus,
}: SkyFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const collectionRef = useRef<any | null>(null);
  const cloudRef = useRef<SkyCloud | null>(null);
  const metaRef = useRef<{ ids: string[]; categories: Int8Array } | null>(null);
  const trackEntityIdsRef = useRef<string[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Viewer construction is retryable: a failed init (module load, imagery
  // provider) is NOT evidence the machine lacks WebGL — that's the probe's
  // job. Bumping `attempt` tears down and rebuilds the viewer.
  const [attempt, setAttempt] = useState(0);
  const [cloudStatus, setCloudStatusState] = useState<CloudStatus>({ state: "idle" });
  const [speed, setSpeed] = useState(1);
  const [categoryCounts, setCategoryCounts] = useState<number[] | null>(null);
  // The cloud's legend/speed controls add up; collapsed by default, one
  // click away when someone actually wants them.
  const [cloudDetailsOpen, setCloudDetailsOpen] = useState(false);
  const statusRef = useRef(onCloudStatus);

  // Parent status callback is kept in a ref (never called during render).
  useEffect(() => {
    statusRef.current = onCloudStatus;
  });

  useEffect(() => {
    statusRef.current?.(cloudStatus);
  }, [cloudStatus]);

  useEffect(() => {
    let disposed = false;
    (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = "/cesium";

    // WebGL preflight: create (and discard) a throwaway context BEFORE paying
    // for the ~2 MB Cesium module and imagery-provider setup. Machines without
    // a working GPU stack engage the honest fallback in a fraction of a second
    // instead of after a slow, timing-dependent module load — the fallback
    // message stays exactly the same.
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ??
      probe.getContext("webgl") ??
      probe.getContext("experimental-webgl");
    if (!gl) {
      if (!disposed) onUnavailable?.();
      return () => {
        disposed = true;
      };
    }

    (async () => {
      try {
        setFailed(null);
        setReady(false);
        const Cesium = (await import("cesium")) as CesiumModule;
        cesiumRef.current = Cesium;

        // Guard against WebGL being unavailable (headless, blocked GPU):
        // Cesium throws at viewer construction; report an honest failure
        // rather than a blank widget.
        const host = containerRef.current;
        if (!host) {
          if (!disposed) setFailed("Globe container is not mounted");
          return;
        }
        // Cesium's widget stylesheet sizes the canvas to its container and
        // lays out the credit line; without it the canvas stays at the
        // browser default 300×150. Loaded before construction so the first
        // frame is measured against the real container size.
        await ensureWidgetStylesheet();
        if (disposed) return;
        // Basemap: Natural Earth II (public domain), shipped with Cesium and
        // served from our own /cesium assets — no API key, no third-party
        // tile requests, nothing to rate-limit. (The previous CARTO dark
        // raster now requires a key and rendered "API KEY REQUIRED" tiles.)
        // Dimmed and desaturated so the night-side palette and the cloud
        // dots carry the visual weight. `baseLayer` is the current option;
        // the old `imageryProvider` is silently ignored by Cesium ≥1.104,
        // which then falls back to token-gated Cesium ion imagery.
        const baseLayer = Cesium.ImageryLayer.fromProviderAsync(
          Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")),
        );
        baseLayer.brightness = 0.55;
        baseLayer.saturation = 0.55;
        baseLayer.contrast = 1.15;
        const viewer = new Cesium.Viewer(host, {
          baseLayer,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          requestRenderMode: true, // bounded GPU load: render on events only
          // 3D only: the app never switches to 2D/Columbus view, so Cesium
          // can skip building 2D projections of every geometry (its
          // longitude-splitting step, where date-line edge cases crash).
          scene3DOnly: true,
          maximumScreenSpaceError: 6,
        });
        if (disposed) {
          viewer.destroy();
          return;
        }
        // Real day/night shading from Cesium's sun model: the same "is it
        // dark where you are?" question the visibility verdicts answer.
        viewer.scene.globe.enableLighting = true;
        viewerRef.current = viewer;
        setReady(true);
      } catch (error) {
        if (!disposed) {
          // Deliberately NOT onUnavailable: WebGL availability was already
          // confirmed by the probe above, so a construction failure here is a
          // runtime error (imagery, module load, ordering) — retryable, not a
          // reason to demote the user to the 2D fallback.
          setFailed(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
      cloudRef.current?.dispose();
      cloudRef.current = null;
      const viewer = viewerRef.current;
      if (viewer && (!viewer.isDestroyed || !viewer.isDestroyed())) viewer.destroy();
      viewerRef.current = null;
      collectionRef.current = null;
      metaRef.current = null;
    };
  }, [attempt]);

  // The cloud: fetch the active catalog once, then stream real-time positions.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready || !cloud) return;

    let disposed = false;
    let abort: AbortController | null = new AbortController();
    const setStatus = (status: CloudStatus) => {
      if (!disposed) setCloudStatusState(status);
    };
    setStatus({ state: "loading" });

    (async () => {
      try {
        const res = await fetch("/api/sky/catalog", { signal: abort?.signal });
        const body = (await res.json()) as {
          ok: boolean;
          data?: { generatedAt: string; stale: boolean; count: number; entries: { i: string; l1: string; l2: string }[] };
          error?: { message: string };
        };
        if (!res.ok || !body.ok || !body.data) {
          setStatus({
            state: "error",
            message: body.error?.message ?? "The whole-sky catalog couldn't load right now.",
          });
          return;
        }
        if (disposed) return;
        setStatus(body.data.stale ? { state: "stale", parsed: body.data.count } : { state: "loading", parsed: body.data.count });

        const sky = new SkyCloud({
          onReady: ({ parsed, failed: parseFailed, categories, ids }) => {
            metaRef.current = { ids, categories };
            const counts = [0, 0, 0, 0];
            for (const c of categories) {
              if (c >= 0 && c < 4) {
                const bucket = counts[c]; // noUncheckedIndexedAccess guard below
                if (bucket !== undefined) counts[c] = bucket + 1;
              }
            }
            setCategoryCounts(counts);
            // One primitive per object; points stay hidden until their first
            // position batch arrives (progressive "lit up" formation).
            const collection = new Cesium.PointPrimitiveCollection();
            for (let index = 0; index < ids.length; index++) {
              const category = (categories[index] ?? 0) as number;
              collection.add({
                id: index,
                position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
                show: false,
                pixelSize: category === 2 ? 3 : 2.5,
                // Slightly translucent: ten thousand saturated dots compete
                // for attention; muted colors let the map and cloud coexist.
                color: Cesium.Color.fromCssColorString((CATEGORY_COLORS[category] ?? "#38bdf8") + "cc"),
                scaleByDistance: new Cesium.NearFarScalar(8_000_000, 1.35, 60_000_000, 0.7),
              });
            }
            viewer.scene.primitives.add(collection);
            collectionRef.current = collection;
            setStatus({ state: body?.data?.stale ? "stale" : "ready", parsed, failed: parseFailed });
            viewer.scene.requestRender();
          },
          onPositions: ({ idx, values }) => {
            const collection = collectionRef.current;
            if (!collection) return;
            for (let row = 0; row < idx.length; row++) {
              const objectIndex = idx[row]; // noUncheckedIndexedAccess
              if (objectIndex === undefined) continue;
              const point = collection.get(objectIndex);
              if (!point) continue;
              const lon = values[row * 3]; // noUncheckedIndexedAccess
              const lat = values[row * 3 + 1];
              const alt = values[row * 3 + 2];
              if (lon === undefined || lat === undefined || alt === undefined) continue;
              point.show = true;
              point.position = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(alt, 0) * 1000);
            }
            viewer.scene.requestRender();
          },
          onError: (message) => {
            setStatus({ state: "error", message: `The whole-sky computer stopped: ${message}` });
          },
        });
        cloudRef.current = sky;
        sky.start(body.data.entries);
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        setStatus({
          state: "error",
          message: error instanceof Error ? error.message : "The whole-sky catalog couldn't load right now.",
        });
      }
    })();

    return () => {
      disposed = true;
      abort?.abort();
      abort = null;
      if (collectionRef.current) {
        try {
          viewer.scene.primitives.remove(collectionRef.current);
        } catch {
          // viewer teardown order — the destroy path handles the rest.
        }
      }
      collectionRef.current = null;
      metaRef.current = null;
      cloudRef.current?.dispose();
      cloudRef.current = null;
      // requestRenderMode: without an explicit redraw the last frame — dots
      // included — stayed on screen after "Whole sky: off".
      if (!viewer.isDestroyed?.()) viewer.scene.requestRender();
    };
  }, [ready, cloud, cesiumRef]);

  // Click-to-open: pick a cloud dot → hand the catalog number to the parent.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready || !onSelectSatellite) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: unknown }) => {
      const picked = viewer.scene.pick(movement.position);
      const id = picked?.id;
      const meta = metaRef.current;
      if (typeof id === "number" && meta) {
        const satnum = meta.ids[id];
        if (satnum) onSelectSatellite(satnum);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      handler.destroy();
    };
  }, [ready, onSelectSatellite]);

  useEffect(() => {
    cloudRef.current?.setSpeed(speed);
  }, [speed]);

  // Satellite position + trail updates when samples change.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready || samples.length === 0) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return;
    viewer.entities.removeAll();

    const startDate = Cesium.JulianDate.fromDate(new Date(first.time));
    const endDate = Cesium.JulianDate.fromDate(new Date(last.time));
    viewer.clock.currentTime = startDate;
    viewer.clock.shouldAnimate = false;
    Cesium.JulianDate.addSeconds(startDate, samples.length * sampleIntervalSeconds, endDate);

    // Bounded orbit polyline from TEME→fixed conversions sampled server-side.
    const orbitPositions: unknown[] = [];
    for (const s of samples) {
      orbitPositions.push(new Cesium.Cartesian3(s.ecf.x, s.ecf.y, s.ecf.z));
    }

    const sampleCbs = new Cesium.SampledPositionProperty();
    for (const s of samples) {
      sampleCbs.addSample(Cesium.JulianDate.fromDate(new Date(s.time)), new Cesium.Cartesian3(s.ecf.x, s.ecf.y, s.ecf.z));
    }
    sampleCbs.setInterpolationOptions({
      interpolationDegree: 2,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });

    viewer.entities.add({
      id: "satellite",
      name,
      position: sampleCbs,
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString("#ffffff"),
        outlineColor: Cesium.Color.fromCssColorString("#0b1017"),
        outlineWidth: 1,
      },
      label: {
        text: name,
        font: "12px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, -14),
        fillColor: Cesium.Color.fromCssColorString("#dbe4f0"),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0b1017ee"),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
      },
    });

    viewer.entities.add({
      id: "orbit",
      polyline: {
        positions: orbitPositions,
        width: 1.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#38bdf866"),
        }),
      },
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startDate, stop: endDate }),
      ]),
    });
    viewer.scene.requestRender();
  }, [ready, samples, name, sampleIntervalSeconds]);

  // Ground track segments (antimeridian-split polylines at ellipsoid level 0).
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready) return;
    // One entity per antimeridian-split segment. (These were once flattened
    // into a single polyline, which reconnected every +180° end to the next
    // −180° start — a line across the globe — and fed Cesium degenerate
    // date-line segments that crashed its geometry worker.)
    //
    // The entities use fixed ids and survive the satellite effect's removeAll
    // (which fires only on its own dependencies) — adding over a stale id is a
    // hard Cesium DeveloperError, so remove-then-add keeps updates idempotent.
    for (const id of trackEntityIdsRef.current) viewer.entities.removeById?.(id);
    trackEntityIdsRef.current = [];
    trackSegments.forEach((segment, index) => {
      if (segment.length < 2) return;
      const id = `ground-track-${index}`;
      viewer.entities.add({
        id,
        polyline: {
          positions: segment.map(([lat, lon]) => Cesium.Cartesian3.fromDegrees(lon, lat, 0)),
          width: 1.2,
          clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString("#fbbf24aa"),
            dashLength: 10,
          }),
        },
      });
      trackEntityIdsRef.current.push(id);
    });
    viewer.scene.requestRender();
    // sampleIntervalSeconds is included deliberately: the orbit effect above
    // needs it and calls removeAll on those changes, which would otherwise
    // silently drop the ground-track line until the next track update.
  }, [ready, trackSegments, sampleIntervalSeconds]);

  function resetCamera() {
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewerRef.current) return;
    viewerRef.current.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, 20, 22_000_000),
      duration: 0.6,
    });
  }

  if (failed) {
    return (
      <div className="panel flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="globe-failed">
        <p className="text-[var(--color-status-warn)] text-[13px]">The 3D globe couldn&apos;t start this time.</p>
        <p className="text-[12px] text-[var(--color-text-muted)] max-w-sm">{failed}</p>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary px-3 py-1.5 text-[13px]" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
          <button className="btn btn-secondary px-3 py-1.5 text-[13px]" onClick={() => onUnavailable?.()}>
            Use the 2D ground track
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label={`3D globe showing ${name}`} />      <button
        className="badge absolute bottom-3 right-3 z-10 cursor-pointer bg-[#0b1017cc] px-3 py-1.5 text-[var(--color-text-secondary)] backdrop-blur-sm hover:text-[var(--color-text-primary)]"
        onClick={resetCamera}
      >
        Reset camera
      </button>

      {/* Cloud commentary: load state or honest failure — one glanceable line. */}
      {cloud ? (
        // bottom-9: clears Cesium's credit line (imagery attribution) along the bottom edge.
        <div className="absolute bottom-9 left-3 z-10 flex max-w-[75%] flex-col gap-1 rounded-md bg-[#0b1017cc] px-3 py-2 backdrop-blur-sm">
          {cloudStatus.state === "loading" ? (
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Filling the sky — {cloudStatus.parsed ? "catalog in hand, propagating" : "fetching the live catalog"}…
            </p>
          ) : null}
          {cloudStatus.state === "ready" ? (
            cloudDetailsOpen ? (
              <>
                <button
                  className="self-start text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                  aria-expanded="true"
                  onClick={() => setCloudDetailsOpen(false)}
                >
                  ▾ Hide legend
                </button>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {CATEGORY_LABELS.map((label, index) => (
                    <span key={label} className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: CATEGORY_COLORS[index] }}
                      />
                      {label}
                      {categoryCounts ? ` · ${(categoryCounts[index] ?? 0).toLocaleString()}` : ""}
                    </span>
                  ))}
                  <span className="ml-auto flex items-center gap-1 text-[10px]">
                    <button
                      className={"badge px-1 " + (speed === 1 ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]")}
                      onClick={() => setSpeed(1)}
                    >
                      Real time
                    </button>
                    <button
                      className={"badge px-1 " + (speed === 60 ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]")}
                      onClick={() => setSpeed(60)}
                    >
                      60×
                    </button>
                  </span>
                </div>
              </>
            ) : (
              // At rest the cloud is one quiet line: a count and a promise.
              // The legend and speed controls stay one click away.
              <button
                className="flex items-center gap-2 self-start text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                aria-expanded="false"
                onClick={() => setCloudDetailsOpen(true)}
              >
                <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--color-status-good)]" />
                {cloudStatus.parsed?.toLocaleString()} objects · live — click any dot to open it
                <span aria-hidden className="text-[var(--color-text-muted)]">· legend ▴</span>
              </button>
            )
          ) : null}
          {cloudStatus.state === "stale" ? (
            <p className="text-[11px] text-[var(--color-status-warn)]">
              {" · "}
              The live catalog didn&apos;t answer just now — showing the last good copy ({cloudStatus.parsed?.toLocaleString()} objects).
            </p>
          ) : null}
          {cloudStatus.state === "error" ? (
            <p className="text-[11px] text-[var(--color-status-warn)]">
              Whole-sky catalog unavailable right now
              {cloudStatus.message ? ` (${cloudStatus.message.replace(/\.$/, "")})` : ""}. The selected satellite is
              still tracked live.
            </p>
          ) : null}
        </div>
      ) : null}

      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-root)]/80">
          <p className="text-[12px] text-[var(--color-text-muted)]">Loading 3D globe…</p>
        </div>
      ) : null}
    </div>
  );
}
