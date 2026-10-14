"use client";

/**
 * 2D ground track — an equirectangular projection rendered as SVG.
 * Used both as the WebGL fallback on the explorer and as the primary
 * ground-track chart on the satellite detail page.
 *
 * The segments come pre-split at the antimeridian from the domain layer, so
 * no polyline ever crosses the map edge. A ±180° seam highlight makes the
 * projection boundaries explicit rather than implying a flat-Earth illusion.
 */

import { useMemo } from "react";
import { formatUtc } from "@/lib/units";

export interface TrackSegmentPoint {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  time: string;
}

export interface GroundTrackPlotProps {
  segments: TrackSegmentPoint[][];
  name: string;
  /** Highlight this sample (time-slider selection), if any. */
  selectedTime?: string | null;
  /**
   * Draw an absolute marker at this sub-satellite point, independent of the
   * track samples (used by the explorer fallback, whose slider covers the
   * 6 h position window at finer granularity than the 24 h track points).
   */
  markerPosition?: { latitudeDeg: number; longitudeDeg: number; time: string } | null;
  height?: number;
}

const WIDTH = 720;
const LAT_MARGIN = 8;

export function GroundTrackPlot({ segments, name, selectedTime, markerPosition, height = 320 }: GroundTrackPlotProps) {
  const { latLines, lonLines, projected, markerProjected } = useMemo(() => {
    const project = makeProject(height);
    const latLines = [-60, -30, 0, 30, 60].map((lat) => ({ lat, y: project(lat, 0).y }));
    const lonLines = [-180, -120, -60, 0, 60, 120, 180].map((lon) => ({ lon, x: project(0, lon).x }));
    const projected = segments.map((segment) =>
      segment.map((p) => ({
        ...p,
        ...project(p.latitudeDeg, p.longitudeDeg),
      })),
    );
    const markerProjected = markerPosition
      ? { ...markerPosition, ...project(markerPosition.latitudeDeg, markerPosition.longitudeDeg), altitudeKm: 0 }
      : null;
    return { latLines, lonLines, projected, markerProjected };
  }, [segments, height, markerPosition]);

  const selected = useMemo(() => {
    if (!selectedTime) return null;
    for (const segment of projected) {
      for (const p of segment) {
        if (p.time === selectedTime) return p;
      }
    }
    return null;
  }, [projected, selectedTime]);

  return (
    <figure className="panel-inset relative overflow-hidden" style={{ minHeight: height }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Ground track of ${name} in an equirectangular projection`}
      >
        {/* Ocean background + graticule */}
        <rect width={WIDTH} height={height} fill="var(--color-bg-inset)" />
        {latLines.map(({ lat, y }) => (
          <g key={lat}>
            <line x1={0} x2={WIDTH} y1={y} y2={y} stroke="var(--color-border-hairline)" strokeWidth={1} />
            <text x={4} y={y - 2} fontSize={9} fill="var(--color-text-muted)">
              {lat}° lat
            </text>
          </g>
        ))}
        {lonLines.map(({ lon, x }) => (
          <g key={lon}>
            <line x1={x} x2={x} y1={0} y2={height} stroke="var(--color-border-hairline)" strokeWidth={lon === -180 || lon === 180 ? 1.5 : 1} />
            <text x={x + 3} y={height - 4} fontSize={9} fill="var(--color-text-muted)">
              {lon}° lon
            </text>
          </g>
        ))}

        {/* Ground-track polylines */}
        {projected.map((segment, si) => (
          <polyline
            key={si}
            points={segment.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--color-status-warn)"
            strokeWidth={1.3}
            strokeDasharray="4 3"
            opacity={0.85}
          />
        ))}

        {/* First sample marker */}
        {projected[0]?.[0] ? (
          <circle cx={projected[0][0].x} cy={projected[0][0].y} r={3} fill="var(--color-status-warn)" />
        ) : null}

        {/* Absolute marker for the current prediction instant (explorer fallback). */}
        {markerProjected ? (
          <g data-testid="ground-track-marker">
            <circle cx={markerProjected.x} cy={markerProjected.y} r={6} fill="none" stroke="var(--color-accent)" strokeWidth={1.2} />
            <circle cx={markerProjected.x} cy={markerProjected.y} r={2.4} fill="var(--color-accent)" />
            <title>{`${name} @ ${formatUtc(new Date(markerProjected.time))} · ${markerProjected.latitudeDeg.toFixed(1)}°, ${markerProjected.longitudeDeg.toFixed(1)}°`}</title>
          </g>
        ) : null}

        {/* Selected-position marker (time slider) */}
        {selected ? (
          <g>
            <circle cx={selected.x} cy={selected.y} r={6} fill="none" stroke="var(--color-accent)" strokeWidth={1.2} />
            <circle cx={selected.x} cy={selected.y} r={2.4} fill="var(--color-accent)" />
            <title>{`${name} @ ${formatUtc(new Date(selected.time))} · ${selected.latitudeDeg.toFixed(1)}°, ${selected.longitudeDeg.toFixed(1)}° · ${selected.altitudeKm.toFixed(0)} km`}</title>
          </g>
        ) : null}
      </svg>
      <figcaption className="absolute bottom-1 right-2 text-[10px] text-[var(--color-text-muted)]">
        Equirectangular projection · sub-satellite points
      </figcaption>
    </figure>
  );
}

function makeProject(height: number) {
  const usableTop = LAT_MARGIN;
  const usable = height - 2 * LAT_MARGIN;
  return (latitudeDeg: number, longitudeDeg: number): { x: number; y: number } => {
    const x = ((longitudeDeg + 180) / 360) * WIDTH;
    // Equirectangular: linear in latitude across the usable vertical span.
    const latRad = (latitudeDeg * Math.PI) / 180;
    const yInverse = (latRad + Math.PI / 2) / Math.PI; // 0 at north pole
    const y = usableTop + yInverse * usable;
    return { x, y };
  };
}
