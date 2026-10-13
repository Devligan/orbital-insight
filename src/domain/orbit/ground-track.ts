/**
 * Ground-track generation.
 *
 * A ground track in rectangular projection (and on some globe renderers)
 * must be cut at the ±180° longitude discontinuity: consecutive samples whose
 * longitudes jump by more than half the globe are a wrap, not a real motion
 * through the antimeridian. This module emits track segments split at those
 * jumps so plots draw at most one polyline per segment.
 */

import { normalizeLongitudeDeg } from "@/lib/units";
import type { GeodeticPoint, GroundTrackSegment } from "./types";

/** Longitude delta beyond which consecutive samples are treated as a wrap. */
const DATELINE_JUMP_THRESHOLD_DEG = 180;

/**
 * Split sampled geodetic points into drawable segments.
 * Assumption: consecutive sample longitudes move by < 90° between samples at
 * sane sampling rates (see SAMPLING guidance in callers); anything larger is
 * a wrap. A single wrap also corrects the crossing-point sign so lines meet
 * the map edges instead of doubling back.
 */
export function buildGroundTrackSegments(points: GeodeticPoint[]): GroundTrackSegment[] {
  if (points.length === 0) return [];
  const segments: GroundTrackSegment[] = [];
  let current: GeodeticPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (i === 0) {
      current.push(p);
      continue;
    }
    const prev = points[i - 1];
    if (!prev) continue;
    // Detect crossings on the RAW delta: with sane sampling, real motion
    // between samples is < 90°, while a wrap shows as a jump ≥ 180°.
    // (Normalizing first would erase exactly the signal we look for.)
    const rawDelta = p.longitudeDeg - prev.longitudeDeg;
    let dLon = rawDelta;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;

    if (Math.abs(rawDelta) >= DATELINE_JUMP_THRESHOLD_DEG) {
      // Push a synthetic edge point at the map border for the previous
      // segment so the preceding line reaches the frame before we cut it.
      const lastEdge = current[current.length - 1] ?? p;
      current.push(edgePointAtAntimeridian(prev, p, lastEdge));
      segments.push({ points: current });
      current = [];
      // Start the next segment at the antimeridian edge, then the sample.
      current.push(edgePointAtAntimeridian(p, prev, p));
    }
    current.push(p);
  }
  if (current.length > 0) segments.push({ points: current });
  return segments;
}

/**
 * Linear edge point on the antimeridian between two samples, projected onto
 * the side (±180) implied by the natural motion direction.
 */
function edgePointAtAntimeridian(
  from: GeodeticPoint,
  to: GeodeticPoint,
  hint: GeodeticPoint,
): GeodeticPoint {
  const fLon = normalizeLongitudeDeg(from.longitudeDeg);
  const tLon = normalizeLongitudeDeg(to.longitudeDeg);
  let dLon = tLon - fLon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const fraction = Math.abs(Math.abs(dLon) - 1e-9) < 0 ? 0 : antimeridianFraction(fLon, dLon);
  const latitude = from.latitudeDeg + (to.latitudeDeg - from.latitudeDeg) * fraction;
  const time = new Date(from.time.getTime() + (to.time.getTime() - from.time.getTime()) * fraction);
  const altitude = from.altitudeKm + (to.altitudeKm - from.altitudeKm) * fraction;
  const edgeLongitude = dLon > 0 ? 180 : -180;
  void hint;
  return { latitudeDeg: latitude, longitudeDeg: edgeLongitude, time, altitudeKm: altitude };
}

/** Fraction along the from→to path where the antimeridian is crossed. */
function antimeridianFraction(fromLon: number, dLon: number): number {
  if (dLon === 0) return 0;
  // distance from fromLon to the edge in the direction of travel
  const toEdge = dLon > 0 ? 180 - fromLon : fromLon + 180;
  const fraction = Math.abs(toEdge) / Math.abs(dLon);
  return Math.min(Math.max(fraction, 0), 1);
}
