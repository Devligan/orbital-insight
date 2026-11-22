/**
 * NORAD catalog numbers, one spelling. Element sets carry the TLE's
 * zero-padded five digits ("00005" for Vanguard 1, "25544" for the ISS),
 * and every cache, lookup and link keys on that. People type "5",
 * "00005" or "00025544", and all three must reach the same object.
 *
 * Plain TypeScript, so the browser and the server share it.
 */

export const MAX_CATALOG_NUMBER = 99_999;

/**
 * The canonical spelling of a catalog number, or null when the text isn't
 * one: digits only (leading zeros allowed), 1 to 99,999. Alpha-5 numbers
 * ("A0001") aren't in the public catalog this app reads.
 */
export function canonicalCatalogNumber(text: string): string | null {
  const trimmed = text.trim();
  // A length cap first, so absurd input never reaches Number().
  if (!/^[0-9]{1,12}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (value < 1 || value > MAX_CATALOG_NUMBER) return null;
  return String(value).padStart(5, "0");
}

/** Compare's two fields, worded the same by the form and the route. */
export const COMPARE_MESSAGES = {
  left: "Left catalog ID must be a number from 1 to 99999.",
  right: "Right catalog ID must be a number from 1 to 99999.",
} as const;

/** The number as CelesTrak's CATNR query takes it: no padding. */
export function catalogQueryValue(canonical: string): string {
  return String(Number(canonical));
}
