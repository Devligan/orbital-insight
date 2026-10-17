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
 * Bounded load: the viewer renders on request only (`requestRenderMode`).
 * Camera input renders by itself; the clock redraws only as often as motion
 * is visible at the current zoom (render-cadence.ts); whole-sky dots are
 * moved along their velocities at each redraw between SGP4 sweeps
 * (sky-motion.ts). Measured on an integrated laptop GPU (Iris Xe, production
 * build, 10.6k-object cloud): idle redraws ~15/s → ~0.5/s (main-thread
 * script ~18% → ~5%); the 1–3.7 s shader-compile freezes that hit the first
 * drag now happen during load; wheel-zooming no longer waits on GPU depth
 * readbacks (main thread pegged at 100% → 60–70%).
 */

import { memo, useEffect, useRef, useState } from "react";
import type { EciSample } from "./sample-types";
import { SkyCloud, CATEGORY_COLORS, CATEGORY_LABELS, type SkySweep } from "@/features/sky/sky-cloud";
import { MAX_EXTRAPOLATION_SIM_MS } from "@/features/sky/sky-motion";
import { simTimeAt, type ViewClock } from "./view-clock";
import { ecfKmToMeters } from "./cesium-units";
import {
  dotMoveVisible,
  metersPerPixelAt,
  pixelAngle,
  simSecondsPerCloudUpdate,
  simSecondsPerRedraw,
} from "./render-cadence";

/**
 * 3D models for followed objects, served from /public/models. Only objects
 * with a sourced model get one; everything else stays an honest dot.
 * ISS: "International Space Station (ISS) (B)", NASA 3D Resources, credit
 * NASA/Michael D. Carbajal (NASA states its 3D resources are free and without
 * copyright; NASA brand guidelines apply). Drawn enlarged — at globe scale
 * the real 109 m station would be far below one pixel.
 */
const SATELLITE_MODELS: Record<string, { uri: string; credit: string }> = {
  "25544": { uri: "/models/iss.glb", credit: "ISS model: NASA/Michael D. Carbajal" },
};

export interface SkyFieldProps {
  samples: EciSample[];
  /** consecutive [lat, lon] pairs split at the antimeridian, degrees */
  trackSegments: [number, number][][];
  name: string;
  /** NORAD id of the followed object — selects its 3D model when one exists. */
  satelliteNumber: string;
  /** The explorer's shared clock: what instant the whole globe shows. */
  clock: ViewClock;
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
    maximumRenderTimeChange: number;
    pick: (position: unknown) => { id?: unknown; primitive?: unknown } | undefined;
    canvas: HTMLCanvasElement;
    preRender: CesiumEvent<(scene: unknown, time: unknown) => void>;
  };
  camera: {
    flyTo: (options: unknown) => void;
    setView: (options: unknown) => void;
    changed: CesiumEvent<() => void>;
    percentageChanged: number;
    positionCartographic?: { height: number };
    positionWC: { x: number; y: number; z: number };
    frustum?: { fovy?: number };
  };
  clock: { currentTime: unknown; shouldAnimate: boolean; multiplier: number; clockStep: unknown; clockRange: unknown };
  trackedEntity: unknown;
  destroy: () => void;
  isDestroyed?: () => boolean;
}

/** Cesium's Event: addEventListener returns the remover. */
interface CesiumEvent<Listener> {
  addEventListener: (listener: Listener) => () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type CesiumModule = any;

/** Simulated seconds between clock-driven redraws for the current camera (render-cadence.ts). */
function redrawStepSeconds(viewer: CesiumViewer, rate: number): number {
  const height = viewer.camera.positionCartographic?.height;
  const fovy = viewer.camera.frustum?.fovy;
  const metersPerPixel = metersPerPixelAt(
    Number.isFinite(height) ? (height as number) : 20_000_000,
    Number.isFinite(fovy) ? (fovy as number) : Math.PI / 3,
    viewer.scene.canvas.clientHeight,
  );
  return simSecondsPerRedraw(metersPerPixel, rate);
}

/**
 * Mirror what the globe is actually showing onto its container as data
 * attributes, read back from Cesium itself (its clock; the satellite entity's
 * position at that instant). Tests assert against these — a readout-only
 * check once passed while the slider moved nothing and the satellite sat
 * inside the Earth.
 */
function publishGlobeState(Cesium: CesiumModule, viewer: CesiumViewer, element: HTMLElement | null): void {
  if (!element) return;
  element.setAttribute("data-clock-instant", Cesium.JulianDate.toIso8601(viewer.clock.currentTime, 0));
  const entity = viewer.entities.getById?.("satellite") as any;
  const position = entity?.position?.getValue(viewer.clock.currentTime);
  if (position) {
    const height = Cesium.Cartographic.fromCartesian(position)?.height;
    if (Number.isFinite(height)) element.setAttribute("data-satellite-altitude-km", String(Math.round(height / 1000)));
  }
}

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

// Memoized: the explorer re-renders every second (its time readout); the
// globe only needs to when its own props change.
export const SkyField = memo(function SkyField({
  samples,
  trackSegments,
  name,
  satelliteNumber,
  clock,
  onUnavailable,
  cloud = false,
  onSelectSatellite,
  onCloudStatus,
}: SkyFieldProps) {
  // Latest clock for effects that start asynchronous work (the cloud worker)
  // without re-running whenever the clock changes.
  const clockRef = useRef(clock);
  useEffect(() => {
    clockRef.current = clock;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const collectionRef = useRef<any | null>(null);
  const cloudRef = useRef<SkyCloud | null>(null);
  const metaRef = useRef<{ ids: string[]; categories: Int8Array } | null>(null);
  const trackEntityIdsRef = useRef<string[]>([]);
  /** Current clock rate and the redraw step it implies (read by camera/cloud listeners). */
  const rateRef = useRef(clock.rate);
  const redrawStepRef = useRef(2);
  // Camera locked to the followed satellite (Cesium trackedEntity).
  const [following, setFollowing] = useState(false);
  const followingRef = useRef(false);
  /** Satellite the camera last turned to face (null before the first). */
  const centeredOnRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Viewer construction is retryable: a failed init (module load, imagery
  // provider) is NOT evidence the machine lacks WebGL — that's the probe's
  // job. Bumping `attempt` tears down and rebuilds the viewer.
  const [attempt, setAttempt] = useState(0);
  const [cloudStatus, setCloudStatusState] = useState<CloudStatus>({ state: "idle" });
  const [categoryCounts, setCategoryCounts] = useState<number[] | null>(null);
  // The cloud's legend is collapsed by default, one click away when someone
  // actually wants it. (Time controls live with the explorer's slider.)
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
          // Plain sorted translucency: the only translucent things here are
          // thin lines and dots, and order-independent translucency costs
          // extra render passes every frame plus a set of shaders compiled
          // (main thread blocked) the first time anything translucent draws.
          orderIndependentTranslucency: false,
        });
        if (disposed) {
          viewer.destroy();
          return;
        }
        // Real day/night shading from Cesium's sun model: the same "is it
        // dark where you are?" question the visibility verdicts answer.
        viewer.scene.globe.enableLighting = true;
        // Fog only matters near the ground; this globe is seen from orbit.
        viewer.scene.fog.enabled = false;
        // Zoom without a GPU stall. Cesium's camera controls read the depth
        // buffer back from the GPU on every wheel step (to zoom toward
        // terrain or 3D tiles under the cursor), which blocks the main thread
        // until the GPU finishes the frame — measured ~0.7 s of every 1 s of
        // wheel-zooming on a laptop GPU. This globe is a smooth ellipsoid with
        // no terrain or tiles, so the exact ray–ellipsoid intersection Cesium
        // also computes is the right zoom target; without depth support
        // reported, that is the one it uses.
        Object.defineProperty(viewer.scene, "pickPositionSupported", { value: false });
        // Exact picks expose a Cesium edge case: wheel-zoom turns the camera
        // about cross(point under cursor, point at screen centre). With the
        // cursor on the centre pixel both are the same point, the axis is
        // zero, and Cesium throws — which stops the globe's rendering for
        // good (reproduced in 2 of 4 runs). A zero axis means "no rotation".
        const camera = viewer.camera as any;
        const rotate = camera.rotate.bind(camera);
        camera.rotate = (axis: any, angle?: number) => {
          const length = Cesium.Cartesian3.magnitudeSquared(axis);
          if (length === 0 || !Number.isFinite(length)) return;
          rotate(axis, angle);
        };
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
    let removePreRender: (() => void) | null = null;
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

        // Between SGP4 sweeps, every redraw moves each dot along its
        // velocity to the instant Cesium is drawing (sky-motion.ts) — so the
        // cloud and the followed satellite share one clock, frame by frame.
        const points: any[] = [];
        let sweep: SkySweep | null = null;
        let freshSweep = false;
        let appliedSimMs = Number.NaN;
        let holding = false;
        const scratch = new Cesium.Cartesian3();
        removePreRender = viewer.scene.preRender.addEventListener((_scene, time) => {
          if (!sweep || points.length === 0) return;
          const simMs = Cesium.JulianDate.toDate(time).getTime();
          const dtMs = simMs - sweep.tMs;
          // The clock jumped (slider): this sweep is for another moment.
          // Hold the dots until the worker's sweep at the new instant lands.
          holding = Math.abs(dtMs) > MAX_EXTRAPOLATION_SIM_MS;
          if (holding) return;
          // Redraws (camera moves included) move the dots only once simulated
          // time has advanced a cloud step: sub-pixel otherwise, and capped
          // at 10 moves per wall second (render-cadence.ts).
          const stepMs = simSecondsPerCloudUpdate(redrawStepRef.current, rateRef.current) * 1000;
          if (!freshSweep && Math.abs(simMs - appliedSimMs) < stepMs) return;
          freshSweep = false;
          appliedSimMs = simMs;
          const dt = dtMs / 1000;
          const p = sweep.positions;
          const v = sweep.velocities;
          const eye = viewer.camera.positionWC;
          const angle = pixelAngle(viewer.camera.frustum?.fovy ?? Math.PI / 3, viewer.scene.canvas.clientHeight);
          for (let k = 0; k < points.length; k++) {
            const point = points[k];
            const o = k * 3;
            scratch.x = (p[o] ?? Number.NaN) + (v[o] ?? 0) * dt;
            scratch.y = (p[o + 1] ?? Number.NaN) + (v[o + 1] ?? 0) * dt;
            scratch.z = (p[o + 2] ?? Number.NaN) + (v[o + 2] ?? 0) * dt;
            // No SGP4 solution at this instant (NaN from the worker). Never
            // hand Cesium a non-finite position: it poisons the collection's
            // bounding volume and rendering stops.
            if (!Number.isFinite(scratch.x + scratch.y + scratch.z)) {
              if (point.show) point.show = false;
              continue;
            }
            if (point.show) {
              // Leave dots whose move would be under half a pixel from here.
              const drawn = point.position;
              const mx = scratch.x - drawn.x;
              const my = scratch.y - drawn.y;
              const mz = scratch.z - drawn.z;
              const ex = scratch.x - eye.x;
              const ey = scratch.y - eye.y;
              const ez = scratch.z - eye.z;
              if (!dotMoveVisible(mx * mx + my * my + mz * mz, ex * ex + ey * ey + ez * ez, angle)) continue;
            } else {
              point.show = true;
            }
            point.position = scratch;
          }
        });

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
            // One primitive per object; points stay hidden until the first
            // sweep places them.
            const collection = new Cesium.PointPrimitiveCollection();
            for (let index = 0; index < ids.length; index++) {
              const category = (categories[index] ?? 0) as number;
              points[index] = collection.add({
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
          onSweep: (next) => {
            const first = sweep === null;
            sweep = next;
            freshSweep = true;
            // Draw now only if nothing else will soon: the first sweep, or
            // the sweep for an instant the slider just jumped to. Otherwise
            // the next clock-driven redraw picks it up.
            if (first || holding || Number.isNaN(appliedSimMs)) viewer.scene.requestRender();
          },
          onError: (message) => {
            setStatus({ state: "error", message: `The whole-sky computer stopped: ${message}` });
          },
        });
        cloudRef.current = sky;
        const current = clockRef.current;
        sky.start(body.data.entries, simTimeAt(current, Date.now()), current.rate);
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
      removePreRender?.();
      removePreRender = null;
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

  // The shared clock drives everything on the globe: Cesium's own clock (the
  // followed satellite and its model move along their sampled path) and the
  // whole-sky worker (every dot). Live = real time; slider scrub = paused at
  // the chosen instant; fast-forward = 60×.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready) return;
    const simNow = simTimeAt(clock, Date.now());
    viewer.clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(simNow));
    viewer.clock.multiplier = clock.rate > 0 ? clock.rate : 1;
    viewer.clock.shouldAnimate = clock.rate > 0;
    // requestRenderMode: redraw once simulated time has moved one redraw
    // step — sized to the zoom and rate (render-cadence.ts).
    rateRef.current = clock.rate;
    redrawStepRef.current = redrawStepSeconds(viewer, clock.rate);
    viewer.scene.maximumRenderTimeChange = redrawStepRef.current;
    cloudRef.current?.setClock(simNow, clock.rate);
    containerRef.current?.setAttribute("data-clock-rate", String(clock.rate));
    publishGlobeState(Cesium, viewer, containerRef.current);
    viewer.scene.requestRender();
  }, [ready, clock]);

  // Zooming changes how far a moving dot travels per pixel: re-size the
  // redraw step whenever the camera has moved appreciably.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.camera.percentageChanged = 0.1;
    const update = () => {
      redrawStepRef.current = redrawStepSeconds(viewer, rateRef.current);
      viewer.scene.maximumRenderTimeChange = redrawStepRef.current;
    };
    const remove = viewer.camera.changed.addEventListener(update);
    update();
    return remove;
  }, [ready]);

  // Satellite position + trail updates when samples change.
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready || samples.length === 0) return;
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) return;
    // Only this effect's own entities: the ground track is owned (and
    // replaced) by its own effect, so it no longer vanishes when samples change.
    viewer.entities.removeById?.("satellite");
    viewer.entities.removeById?.("orbit");

    // The sampled window. (The clock is no longer pinned to its start: the
    // shared clock effect above sets the shown instant — live by default.)
    const startDate = Cesium.JulianDate.fromDate(new Date(first.time));
    const endDate = Cesium.JulianDate.fromDate(new Date(last.time));

    // Bounded orbit polyline from TEME→fixed conversions sampled server-side.
    // Samples are km; Cesium is metres (see cesium-units.ts).
    const toCartesian = (s: EciSample) => {
      const m = ecfKmToMeters(s.ecf);
      return new Cesium.Cartesian3(m.x, m.y, m.z);
    };
    const orbitPositions: unknown[] = samples.map(toCartesian);

    const sampleCbs = new Cesium.SampledPositionProperty();
    for (const s of samples) {
      sampleCbs.addSample(Cesium.JulianDate.fromDate(new Date(s.time)), toCartesian(s));
    }
    sampleCbs.setInterpolationOptions({
      interpolationDegree: 2,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });

    // A sourced 3D model when we have one (enlarged: minimumPixelSize keeps
    // it visible from orbit-viewing distance; maximumScale stops it from
    // ballooning when zoomed in). Attitude follows the direction of travel —
    // close to the ISS's usual flight attitude, but an approximation: the
    // real attitude isn't in the element set. Everything else: a dot.
    const model = SATELLITE_MODELS[satelliteNumber];
    const satelliteEntity = viewer.entities.add({
      id: "satellite",
      name,
      position: sampleCbs,
      // "Follow" camera offset (east, north, up of the satellite, metres):
      // behind and above, so the craft rides over the curve of the Earth.
      viewFrom: new Cesium.Cartesian3(0, -1_800_000, 700_000),
      ...(model
        ? {
            orientation: new Cesium.VelocityOrientationProperty(sampleCbs),
            model: {
              uri: model.uri,
              minimumPixelSize: 72,
              maximumScale: 20_000,
              credits: model.credit,
              // No dynamic environment map (reflections of a sky Cesium
              // renders around the model). Building one compiled a batch of
              // shaders mid-interaction — the single biggest freeze measured
              // (~2 s on a laptop GPU) — and at 60× it was rebuilt every
              // simulated hour. The sun still lights the model.
              environmentMapOptions: { enabled: false },
            },
          }
        : {
            point: {
              pixelSize: 9,
              color: Cesium.Color.fromCssColorString("#ffffff"),
              outlineColor: Cesium.Color.fromCssColorString("#0b1017"),
              outlineWidth: 1,
            },
          }),
      label: {
        text: name,
        font: "12px sans-serif",
        pixelOffset: new Cesium.Cartesian2(0, model ? -40 : -14),
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
    // Re-created entities drop Cesium's tracking; keep following if asked.
    viewer.trackedEntity = followingRef.current ? satelliteEntity : undefined;

    // First time this satellite is shown: turn the globe to face it (the
    // fixed opening view often had it on the far side of the Earth). Later
    // sample refreshes for the same object leave the user's camera alone.
    if (!followingRef.current && centeredOnRef.current !== satelliteNumber) {
      const here = (satelliteEntity as any).position?.getValue(viewer.clock.currentTime);
      if (here) {
        const c = Cesium.Cartographic.fromCartesian(here);
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 20_000_000),
          duration: centeredOnRef.current === null ? 0 : 1.2,
        });
        centeredOnRef.current = satelliteNumber;
      }
    }
    publishGlobeState(Cesium, viewer, containerRef.current);
    viewer.scene.requestRender();

    // A model loads (and compiles its shaders) only on frames Cesium draws,
    // and the idle globe draws about once every 2 s — its one-time shader
    // compile (0.7–1 s, main thread blocked) was measured landing on the
    // user's first drag. Draw every frame until the model is ready and has
    // been drawn, so that cost is paid up front, during load.
    let pumpFrame = 0;
    if (model) {
      const startedAt = performance.now();
      const sphere = new Cesium.BoundingSphere();
      let framesSinceReady = 0;
      let seenLoading = false;
      const pump = () => {
        if (viewer.isDestroyed?.()) return;
        // FAILED also means "not registered yet" until Cesium's first update
        // after the entity was added — only a model seen loading can fail.
        const state = (viewer as any).dataSourceDisplay.getBoundingSphere(satelliteEntity, false, sphere);
        if (state === Cesium.BoundingSphereState.PENDING) seenLoading = true;
        if (state === Cesium.BoundingSphereState.DONE) framesSinceReady++;
        viewer.scene.requestRender();
        const settled = framesSinceReady > 3 || (seenLoading && state === Cesium.BoundingSphereState.FAILED);
        if (!settled && performance.now() - startedAt < 15_000) pumpFrame = requestAnimationFrame(pump);
      };
      pumpFrame = requestAnimationFrame(pump);
    }
    return () => cancelAnimationFrame(pumpFrame);
  }, [ready, samples, name, satelliteNumber]);

  useEffect(() => {
    followingRef.current = following;
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.trackedEntity = following ? viewer.entities.getById?.("satellite") : undefined;
    viewer.scene.requestRender();
  }, [following, ready]);

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
    // The entities use fixed ids — adding over a stale id is a hard Cesium
    // DeveloperError, so remove-then-add keeps updates idempotent.
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
  }, [ready, trackSegments]);

  function resetCamera() {
    const Cesium = cesiumRef.current;
    if (!Cesium || !viewerRef.current) return;
    const viewer = viewerRef.current;
    setFollowing(false);
    viewer.trackedEntity = undefined;
    // Back to the whole-Earth view, facing the followed satellite.
    const here = (viewer.entities.getById?.("satellite") as any)?.position?.getValue(viewer.clock.currentTime);
    const c = here ? Cesium.Cartographic.fromCartesian(here) : null;
    viewer.camera.flyTo({
      destination: c
        ? Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 20_000_000)
        : Cesium.Cartesian3.fromDegrees(0, 20, 22_000_000),
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
      <div ref={containerRef} className="h-full w-full" aria-label={`3D globe showing ${name}`} />
      <div className="absolute bottom-3 right-3 z-10 flex gap-2">
        <button
          className={
            "badge cursor-pointer bg-[#0b1017cc] px-3 py-1.5 backdrop-blur-sm " +
            (following
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]")
          }
          aria-pressed={following}
          disabled={!ready || samples.length === 0}
          onClick={() => setFollowing((on) => !on)}
        >
          {following ? "Following" : "Follow"} {name.replace(/\s*\(.*\)$/, "")}
        </button>
        <button
          className="badge cursor-pointer bg-[#0b1017cc] px-3 py-1.5 text-[var(--color-text-secondary)] backdrop-blur-sm hover:text-[var(--color-text-primary)]"
          onClick={resetCamera}
        >
          Reset camera
        </button>
      </div>

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
                </div>
              </>
            ) : (
              // At rest the cloud is one quiet line: a count and a promise.
              // The legend stays one click away.
              <button
                className="flex items-center gap-2 self-start text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                aria-expanded="false"
                onClick={() => setCloudDetailsOpen(true)}
              >
                <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--color-status-good)]" />
                {cloudStatus.parsed?.toLocaleString()} objects — click any dot to open it
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
});
