"use client";

/**
 * Cesium globe (lazy-loaded, no Ion token — OpenStreetMap raster imagery).
 *
 * Data flows in as props; this component renders only what callers supply:
 *  - `position`: sampled TEME states at times (already computed server-side)
 *  - `groundTrack`: dt-polylines for the track
 *  - `timeIndex`: which sample to show (bounded time-slider control)
 *
 * WebGL-unavailable environments receive the 2D ground-track fallback
 * (data-mode="webgl-unavailable") rendered by the parent instead.
 */

import { useEffect, useRef, useState } from "react";
import type { EciSample } from "./sample-types";

export interface OrbitGlobeProps {
  samples: EciSample[];
  /** consecutive [lat, lon] pairs split at the antimeridian, degrees */
  trackSegments: [number, number][][];
  name: string;
  /** Seconds between samples — drives interpolated-orbit line timing. */
  sampleIntervalSeconds: number;
  /** Called once when WebGL unavailable — the parent shows the 2D fallback. */
  onUnavailable?: () => void;
}

interface CesiumViewer {
  entities: {
    add: (entity: unknown) => unknown;
    removeAll: () => void;
    getEntityById?: (id: string) => unknown;
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

export function OrbitGlobe({ samples, trackSegments, name, sampleIntervalSeconds, onUnavailable }: OrbitGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

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
    const viewer = new Cesium.Viewer(host, {
          imageryProvider: new Cesium.OpenStreetMapImageryProvider({
            url: "https://tile.openstreetmap.org/",
          }),
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
          maximumScreenSpaceError: 6,
        });
        if (disposed) {
          viewer.destroy();
          return;
        }
        viewerRef.current = viewer;
        setReady(true);
      } catch (error) {
        if (!disposed) {
          setFailed(error instanceof Error ? error.message : String(error));
          onUnavailable?.();
        }
      }
    })();

    return () => {
      disposed = true;
      const viewer = viewerRef.current;
      if (viewer && (!viewer.isDestroyed || !viewer.isDestroyed())) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

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
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString("#38bdf8"),
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
  }, [ready, samples, name, sampleIntervalSeconds]);

  // Ground track segments (antimeridian-split polylines at ellipsoid level 0).
  useEffect(() => {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || !ready) return;
    const flat: unknown[] = [];
    for (const segment of trackSegments) {
      for (const [lat, lon] of segment) {
        flat.push(Cesium.Cartesian3.fromDegrees(lon, lat, 0));
      }
    }
    viewer.entities.add({
      id: "ground-track",
      polyline: {
        positions: flat,
        width: 1.2,
        clampToGround: true,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString("#fbbf24aa"),
          dashLength: 10,
        }),
      },
    });
  }, [ready, trackSegments]);

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
      <div className="panel flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-[var(--color-status-warn)] text-[13px]">3D globe unavailable: WebGL could not start.</p>
        <p className="text-[12px] text-[var(--color-text-muted)] max-w-sm">{failed}</p>
        <p className="text-[12px] text-[var(--color-text-muted)]">Use the 2D ground track below — it shows the same computed data.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-label={`3D globe showing ${name}`} />
      <button
        className="btn btn-secondary absolute right-3 top-3 z-10"
        onClick={resetCamera}
      >
        Reset camera
      </button>
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-root)]/80">
          <p className="text-[12px] text-[var(--color-text-muted)]">Loading 3D globe…</p>
        </div>
      ) : null}
    </div>
  );
}
