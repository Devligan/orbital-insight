/**
 * Orbit-band classification for the whole-sky cloud.
 *
 * Derived from the element set itself (mean motion + eccentricity) — no
 * provider side-channel decides what an object "is". Bands follow the standard
 * regime boundaries: LEO below a ~129-minute period, the GEO belt within a
 * window around the 23.93-hour geostationary period, strongly eccentric
 * objects are HEO regardless of period, everything else is MEO.
 */

export type SkyCategory = 0 | 1 | 2 | 3; // LEO | MEO | GEO | HEO

export const CATEGORY_LABELS = [
  "Low orbit",
  "Medium orbit",
  "Geostationary belt",
  "High orbit / elliptical",
] as const;

export const CATEGORY_COLORS = ["#38bdf8", "#a78bfa", "#fbbf24", "#34d399"] as const;

export interface ClassificationInput {
  /** satellite.js v7: mean motion in rad/min (the `no` field). */
  no?: number;
  /** Eccentricity. */
  ecco?: number;
}

const TWO_PI = 2 * Math.PI;
const MINUTES_PER_DAY = 1440;

export function categoryOf(rec: ClassificationInput): SkyCategory {
  // Missing mean motion: it cannot be classified honestly — default to the
  // LEO band, where almost all of the active catalog falls anyway.
  const radPerMin = rec.no ?? 0;
  if (radPerMin <= 0) return 0;
  const revsPerDay = (radPerMin * MINUTES_PER_DAY) / TWO_PI;
  const periodMinutes = MINUTES_PER_DAY / revsPerDay;
  if ((rec.ecco ?? 0) > 0.25) return 3; // HEO: strongly elliptical transfer/legacy orbits
  if (periodMinutes < 129) return 0; // LEO
  if (periodMinutes > 1_320 && periodMinutes < 1_560) return 2; // GEO belt (23.93 h ± drift)
  return 1; // MEO (GNSS etc.)
}
