/**
 * The reported patch of sky and the best candidates' paths through it, on the
 * same star-chart projection as the pass charts (zenith at the centre, the
 * horizon on the rim, north up, east on the left).
 */

import { HEIGHT_BANDS, type HeightBand, type SightingCandidate } from "@/domain/sighting/identify";
import { projectSky } from "@/features/pass-prediction/sky-chart-geometry";

/** How wide "I was looking NW" is taken to be: one compass point either side. */
const SECTOR_HALF_WIDTH_DEG = 22.5;

function annularSector(azimuthDeg: number | null, height: HeightBand | null, radius: number): string {
  const [lo, hi] = height ? HEIGHT_BANDS[height] : [0, 90];
  if (azimuthDeg === null) {
    // A whole ring (or the whole dome): the band at every azimuth.
    const outer = (radius * (90 - lo)) / 90;
    const inner = (radius * (90 - hi)) / 90;
    const ring = (r: number) => `M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0Z`;
    return inner > 0 ? `${ring(outer)}${ring(inner)}` : ring(outer);
  }
  const points: string[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const az = azimuthDeg - SECTOR_HALF_WIDTH_DEG + (2 * SECTOR_HALF_WIDTH_DEG * i) / steps;
    const p = projectSky(az, lo, radius);
    points.push(`${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  for (let i = steps; i >= 0; i--) {
    const az = azimuthDeg - SECTOR_HALF_WIDTH_DEG + (2 * SECTOR_HALF_WIDTH_DEG * i) / steps;
    const p = projectSky(az, hi, radius);
    points.push(`L${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  }
  return points.join("") + "Z";
}

/** Path segments for one track: seeable stretches solid, the rest dashed. */
function trackPaths(candidate: SightingCandidate, radius: number): { d: string; seeable: boolean }[] {
  const segments: { d: string; seeable: boolean }[] = [];
  let current: { d: string; seeable: boolean } | null = null;
  let previous: string | null = null;
  for (const point of candidate.track) {
    const p = projectSky(point.azimuthDeg, point.elevationDeg, radius);
    const xy = `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    if (!current || current.seeable !== point.seeable) {
      if (current) segments.push(current);
      // Start where the last segment ended so the line stays continuous.
      current = { d: previous ? `M${previous}L${xy}` : `M${xy}`, seeable: point.seeable };
    } else {
      current.d += `L${xy}`;
    }
    previous = xy;
  }
  if (current) segments.push(current);
  return segments;
}

export function SightingChart({
  candidates,
  azimuthDeg,
  height,
  size = 280,
}: {
  candidates: readonly SightingCandidate[];
  azimuthDeg: number | null;
  height: HeightBand | null;
  size?: number;
}) {
  const fontSize = 12;
  const radius = size / 2 - fontSize - 4;
  const labels = [
    ["N", 0],
    ["E", 90],
    ["S", 180],
    ["W", 270],
  ] as const;
  return (
    <svg
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      width="100%"
      style={{ maxWidth: size }}
      role="img"
      aria-label={`Sky chart of where you looked and the paths of ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`}
      data-testid="sighting-chart"
    >
      <circle r={radius} style={{ fill: "var(--color-bg-inset)", stroke: "var(--color-border-strong)" }} />
      {[30, 60].map((el) => (
        <circle key={el} r={(radius * (90 - el)) / 90} fill="none" stroke="var(--color-border-hairline)" strokeDasharray="2 3" />
      ))}
      <path
        d={annularSector(azimuthDeg, height, radius)}
        fillRule="evenodd"
        style={{ fill: "color-mix(in oklab, var(--color-accent) 16%, transparent)" }}
        data-testid="sighting-chart-sector"
      />
      {labels.map(([label, az]) => {
        const p = projectSky(az, 0, radius + fontSize * 0.75);
        return (
          <text
            key={label}
            x={p.x}
            y={p.y}
            fontSize={fontSize}
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--color-text-muted)"
          >
            {label}
          </text>
        );
      })}
      {/* Drawn back to front so the best match sits on top. */}
      {[...candidates].reverse().map((candidate, reversedIndex) => {
        const rank = candidates.length - reversedIndex;
        const colour = rank === 1 ? "var(--color-accent)" : "var(--color-text-secondary)";
        const best = projectSky(candidate.best.azimuthDeg, candidate.best.elevationDeg, radius);
        return (
          <g key={candidate.id} data-testid="sighting-chart-track">
            {trackPaths(candidate, radius).map((segment, i) => (
              <path
                key={i}
                d={segment.d}
                fill="none"
                stroke={colour}
                strokeWidth={segment.seeable ? 2 : 1}
                strokeDasharray={segment.seeable ? undefined : "3 4"}
                strokeLinecap="round"
                opacity={segment.seeable ? 1 : 0.6}
              />
            ))}
            <circle cx={best.x} cy={best.y} r={8} fill="var(--color-bg-elevated, var(--color-bg-inset))" stroke={colour} />
            <text x={best.x} y={best.y} fontSize={10} textAnchor="middle" dominantBaseline="central" fill={colour}>
              {rank}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
