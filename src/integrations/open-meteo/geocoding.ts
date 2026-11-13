/**
 * Place search: Open-Meteo's geocoding API (GeoNames places, CC BY 4.0).
 *
 * The only module that talks to the geocoder. Unlike CelesTrak, it is called
 * from the browser, not through our server. Open-Meteo applies its free-tier
 * limits per IP address and warns that shared hosting IPs (Vercel's included)
 * hit them early, so calls from each visitor's own connection spread the load
 * the way the provider asks. There is no key to protect.
 *
 * Responses are validated before anything else sees them, and failures are
 * typed so the UI can say what went wrong instead of showing an empty list.
 */

import { z } from "zod";

const SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_MS = 8_000;
export const MAX_PLACE_RESULTS = 6;

export interface Place {
  id: number;
  name: string;
  /** State, province, or region; absent for some places. */
  region: string | null;
  country: string | null;
  latDeg: number;
  lonDeg: number;
  /** IANA zone the geocoder reports for the place. */
  timeZone: string | null;
  population: number | null;
}

export type PlaceSearchFailure = "network" | "timeout" | "server-error" | "schema";

export class PlaceSearchError extends Error {
  constructor(
    readonly reason: PlaceSearchFailure,
    message: string,
  ) {
    super(message);
    this.name = "PlaceSearchError";
  }
}

const resultSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  country: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
});

// The API omits `results` entirely when nothing matches.
const responseSchema = z.object({ results: z.array(resultSchema).optional() });

/** Validate a geocoder response body into places. Throws PlaceSearchError("schema"). */
export function parsePlaceResponse(body: unknown): Place[] {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new PlaceSearchError("schema", "The place search returned an unexpected answer.");
  }
  return (parsed.data.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    region: r.admin1 && r.admin1 !== r.name ? r.admin1 : null,
    country: r.country ?? null,
    latDeg: r.latitude,
    lonDeg: r.longitude,
    timeZone: r.timezone ?? null,
    population: r.population ?? null,
  }));
}

/** "Brooklyn, New York, United States" */
export function placeLabel(place: Pick<Place, "name" | "region" | "country">): string {
  return [place.name, place.region, place.country].filter(Boolean).join(", ");
}

/**
 * Search places by name or postcode. `signal` cancels a superseded keystroke's
 * request. An abort by the caller rejects with the original AbortError so it can be
 * told apart from a provider failure.
 */
export async function searchPlaces(
  query: string,
  { signal, fetchImpl = fetch }: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Place[]> {
  const name = query.trim();
  if (name.length < 2) return [];

  const url = new URL(SEARCH_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("count", String(MAX_PLACE_RESULTS));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  // One controller for both the caller's cancel and our timeout (AbortSignal.any
  // is too new for some phones still in use).
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new PlaceSearchError("timeout", "The place search took too long to answer.");
    if (signal?.aborted) throw error;
    throw new PlaceSearchError("network", "Couldn't reach the place search.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  if (!response.ok) {
    throw new PlaceSearchError("server-error", `The place search answered HTTP ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlaceSearchError("schema", "The place search returned an unexpected answer.");
  }
  return parsePlaceResponse(body);
}

/**
 * Coordinates typed into the place box: "40.7, -74", "40.7 -74",
 * "40.7N 74W", "40.7°N, 74.0°W". Returns null for anything else (it's a name).
 */
export function parseCoordinates(text: string): { latDeg: number; lonDeg: number } | null {
  const match = text
    .trim()
    .match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!match) return null;
  const [, latText, latHemi, lonText, lonHemi] = match;
  let lat = Number(latText);
  let lon = Number(lonText);
  if (latHemi) {
    if (lat < 0) return null; // "-40 N" is contradictory
    if (latHemi.toUpperCase() === "S") lat = -lat;
  }
  if (lonHemi) {
    if (lon < 0) return null;
    if (lonHemi.toUpperCase() === "W") lon = -lon;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latDeg: lat, lonDeg: lon };
}
