/**
 * SGP4 for bulk, browser-side work (conjunction screening runs ~10⁶ of these
 * in a Web Worker).
 *
 * Kept apart from adapter.ts on purpose: that module maps failures to the
 * server's AppError (which pulls in node:crypto), while this one must bundle
 * for the browser and stay allocation-free on the hot path. Same conventions:
 * TEME km and km/s, time as minutes from the element-set epoch, and
 * satellite.js is imported only inside src/integrations/sgp4.
 */

import { sgp4, twoline2satrec, type SatRec } from "satellite.js";

/** Compile raw TLE lines, or null when SGP4 can't initialize from them (callers skip the row). */
export function compileTleLines(line1: string, line2: string): SatRec | null {
  try {
    const satrec = twoline2satrec(line1, line2);
    return typeof satrec.error === "number" && satrec.error !== 0 ? null : satrec;
  } catch {
    return null;
  }
}

/** Element-set epoch in epoch milliseconds (UTC); satellite.js v7 keeps the full Julian date. */
export function epochMillis(satrec: SatRec): number {
  return (satrec.jdsatepoch - 2_440_587.5) * 86_400_000;
}

/**
 * TEME state with no Date, no geodetic conversion and no allocation. Writes
 * [x, y, z, vx, vy, vz] (km, km/s) into `out` at `offset` and returns true,
 * or returns false where SGP4 has no solution (decayed / diverged elements).
 */
export function temeStateInto(satrec: SatRec, minutesSinceEpoch: number, out: Float64Array, offset = 0): boolean {
  const result = sgp4(satrec, minutesSinceEpoch) as
    | { position: false; velocity: false }
    | { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
    | null;
  if (result === null || result.position === false || !Number.isFinite(result.position.x)) return false;
  out[offset] = result.position.x;
  out[offset + 1] = result.position.y;
  out[offset + 2] = result.position.z;
  out[offset + 3] = result.velocity.x;
  out[offset + 4] = result.velocity.y;
  out[offset + 5] = result.velocity.z;
  return true;
}
