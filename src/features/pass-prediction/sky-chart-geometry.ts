/**
 * Sky-chart geometry - a pass drawn on the dome of the observer's sky.
 *
 * Projection: azimuthal-equidistant in elevation, the convention of printed
 * pass charts. The zenith is the centre, the horizon the rim, and radius
 * grows linearly as elevation falls (r = R·(90° − el)/90°). Orientation is a
 * star chart's: north up, **east left**, because the chart is the sky seen
 * from below - hold it overhead with N toward north and every point lies
 * where it appears.
 *
 * Pure (no React, no DOM) so the projection and the visible-segment rules
 * are unit-tested.
 */

import type { PassCardData } from "./sky-words";

type Visibility = NonNullable<PassCardData["visibility"]>;
type SkyPoint = Visibility["skyTrack"][number];

export interface ChartPoint {
  x: number;
  y: number;
}

/** (azimuth, elevation) → chart coordinates, centred on the zenith, y down. */
export function projectSky(azimuthDeg: number, elevationDeg: number, radius: number): ChartPoint {
  const r = (radius * (90 - Math.min(90, Math.max(0, elevationDeg)))) / 90;
  const az = (azimuthDeg * Math.PI) / 180;
  return { x: -r * Math.sin(az), y: -r * Math.cos(az) };
}

export interface SkyChartModel {
  /** SVG path for the whole pass above the threshold, rise → set. */
  track: string;
  /** SVG path for the stretch a person can actually see; null when none. */
  visible: string | null;
  /** Where the visible stretch begins / ends (null when nothing is visible). */
  visibleStart: ChartPoint | null;
  visibleEnd: ChartPoint | null;
  /** Visibility ends with the satellite entering Earth's shadow mid-sky. */
  endsInShadow: boolean;
  /** Visibility begins with the satellite leaving Earth's shadow mid-sky. */
  startsFromShadow: boolean;
  /** Arrowhead at the end of the drawn motion: tip position and heading. */
  heading: { tip: ChartPoint; angleDeg: number };
}

/**
 * Direction of travel arriving at `tip`, from the nearest earlier point that
 * is visibly apart from it (a one-sample visible window starts and ends at
 * the same spot, and has no direction of its own). Null when none is.
 */
function headingInto(tip: ChartPoint, path: ChartPoint[]): number | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i] as ChartPoint;
    if (Math.hypot(tip.x - p.x, tip.y - p.y) > 0.5) return (Math.atan2(tip.y - p.y, tip.x - p.x) * 180) / Math.PI;
  }
  return null;
}

function toPath(points: ChartPoint[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/**
 * The drawable pass, or null when the server sent no sky track (a pass
 * truncated on both sides is never enriched - nothing honest to draw).
 *
 * The visible stretch is not read off the coarse samples: it runs from the
 * refined window start, through the samples strictly inside the window, to
 * the refined window end - so the bright line starts and stops where the
 * text says it does.
 */
export function skyChartModel(pass: PassCardData, radius: number): SkyChartModel | null {
  const visibility = pass.visibility;
  const samples = visibility?.skyTrack ?? [];
  if (!visibility || samples.length < 2) return null;

  const project = (p: SkyPoint) => projectSky(p.azimuthDeg, p.elevationDeg, radius);
  const trackPoints = samples.map(project);

  const window = visibility.visibleWindow;
  let visiblePoints: ChartPoint[] | null = null;
  // Everything drawn up to the arrow's tip, oldest first.
  let motion = trackPoints;
  if (window) {
    const startMs = Date.parse(window.start.timeIso);
    const endMs = Date.parse(window.end.timeIso);
    const inside = samples.filter((s) => {
      const t = Date.parse(s.timeIso);
      return t > startMs && t < endMs;
    });
    visiblePoints = [window.start, ...inside, window.end].map(project);
    motion = [...samples.filter((s) => Date.parse(s.timeIso) <= startMs).map(project), ...visiblePoints];
  }

  // The arrow follows the motion the eye follows: the visible stretch when
  // there is one, otherwise the whole geometric pass.
  const tip = motion[motion.length - 1] as ChartPoint;
  const angleDeg = headingInto(tip, motion) ?? 0;

  return {
    track: toPath(trackPoints),
    visible: visiblePoints ? toPath(visiblePoints) : null,
    visibleStart: visiblePoints ? (visiblePoints[0] as ChartPoint) : null,
    visibleEnd: visiblePoints ? tip : null,
    endsInShadow: window?.endsInShadow ?? false,
    startsFromShadow: window?.startsFromShadow ?? false,
    heading: { tip, angleDeg },
  };
}
