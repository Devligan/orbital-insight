/**
 * Unit-explicit primitives.
 *
 * Different distance/time units must never be silently mixed. These tiny
 * wrapper types are documentation-first: they cost nothing at runtime and are
 * used at module boundaries where a unit mistake would corrupt physics.
 */

export type Degrees = number;
export type Radians = number;
export type Kilometers = number;
export type KilometersPerSecond = number;
export type Minutes = number;

export const RAD2DEG = 180 / Math.PI;
export const DEG2RAD = Math.PI / 180;
export const TWO_PI = 2 * Math.PI;

/** Normalize any angle (radians) into [0, 2π). */
export function normalizeAngle2Pi(angle: Radians): Radians {
  const twoPi = TWO_PI;
  return ((angle % twoPi) + twoPi) % twoPi;
}

/** Normalize any longitude (radians) into (-π, π] - same convention as the
 * degrees variant so both call sites agree at the antimeridian. */
export function normalizeLongitudeRad(lon: Radians): Radians {
  const twoPi = TWO_PI;
  const normalized = ((lon + Math.PI) % twoPi) + twoPi;
  const wrapped = (normalized % twoPi) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Normalize any longitude (degrees) into (-180, 180]. */
export function normalizeLongitudeDeg(lon: Degrees): Degrees {
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Format a UTC timestamp for display: `2025-11-05 14:02:07 UTC`. */
export function formatUtc(date: Date): string {
  return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}
