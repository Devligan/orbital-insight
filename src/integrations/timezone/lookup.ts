/**
 * Observer coordinates → IANA time zone, offline.
 *
 * Pass times are for planning, so they must read in the *observer's* wall
 * clock — not the viewer's device. (Type Tokyo's coordinates from New York
 * and every time used to come out in New York time.) Library: tz-lookup
 * (CC0, ~90 KB bundled boundary data, no network). Its documented
 * trade-off: simplified boundaries — about 5% of random points on Earth,
 * mostly remote areas and open ocean, get a zone with a different UTC
 * offset; populated places resolve reliably. Open ocean resolves to nautical
 * Etc/GMT±N zones. Upgrade path if that's ever not enough: `geo-tz` (exact
 * boundaries, server-only, much larger data). This is the only module that
 * imports the library.
 */

import tzLookup from "@photostructure/tz-lookup";

/** The IANA zone at a point, or null when the lookup rejects the input. */
export function timeZoneAt(latitudeDeg: number, longitudeDeg: number): string | null {
  try {
    return tzLookup(latitudeDeg, longitudeDeg);
  } catch {
    return null;
  }
}
