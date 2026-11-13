/**
 * Tiny response checks for the browser-side Open-Meteo clients.
 *
 * The server validates with zod (src/contracts). These modules ship to every
 * visitor on the home page, where zod measured +27 kB gzip of first-load JS
 * (122 → 150 kB against a 150 kB budget) for two small, flat responses. So
 * they check shape by hand: the same rules, a few hundred bytes.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A finite number within [min, max]. */
export function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Absent (undefined) or a string. Anything else fails the response. */
export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}
