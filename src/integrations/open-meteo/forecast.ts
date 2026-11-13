/**
 * Cloud forecast: Open-Meteo's forecast API, hourly cloud cover.
 *
 * The only module that asks Open-Meteo for weather. Like the geocoder next
 * door, it is called from the visitor's browser: Open-Meteo rate-limits per
 * IP, so per-visitor calls are what its free tier is built for.
 *
 * What the numbers are (per Open-Meteo's docs): an instantaneous "total
 * cloud cover as an area fraction" (%) at each hour, from the "best match"
 * blend of the global (ECMWF IFS, NOAA GFS, DWD ICON) and higher-resolution
 * regional models available for the spot. Low/mid/high split at 3 km and
 * 8 km. A model grid cell, not your patch of sky.
 */

import { isNumberIn, isRecord } from "./shape";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8_000;

export interface CloudHour {
  /** The instant this value describes (UTC ms). */
  atMs: number;
  totalPct: number;
  lowPct: number | null;
  midPct: number | null;
  highPct: number | null;
}

export interface CloudForecast {
  hours: CloudHour[];
  /** When this browser received it (forecasts are re-asked, never trusted forever). */
  retrievedAtMs: number;
}

export type CloudForecastFailure = "network" | "timeout" | "server-error" | "schema";

export class CloudForecastError extends Error {
  constructor(
    readonly reason: CloudForecastFailure,
    message: string,
  ) {
    super(message);
    this.name = "CloudForecastError";
  }
}

type Series = Array<number | null>;

/** A list of percentages or nulls, or (for the optional layers) absent. */
function percentSeries(value: unknown, length: number): Series | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every((v) => v === null || isNumberIn(v, 0, 100)) ? (value as Series) : null;
}

/** Validate a forecast body. Hours with no total value are dropped, not guessed. */
export function parseCloudForecast(body: unknown, retrievedAtMs: number): CloudForecast {
  const schemaError = () => new CloudForecastError("schema", "The cloud forecast came back in an unexpected shape.");
  if (!isRecord(body) || !isRecord(body.hourly)) throw schemaError();
  const { time, cloud_cover, cloud_cover_low, cloud_cover_mid, cloud_cover_high } = body.hourly;
  if (!Array.isArray(time) || !time.every((t) => Number.isInteger(t))) throw schemaError();
  const total = percentSeries(cloud_cover, time.length);
  if (!total) throw schemaError();
  // Layers are optional; present but malformed still fails.
  const layer = (value: unknown): Series | null => {
    if (value === undefined) return null;
    const series = percentSeries(value, time.length);
    if (!series) throw schemaError();
    return series;
  };
  const low = layer(cloud_cover_low);
  const mid = layer(cloud_cover_mid);
  const high = layer(cloud_cover_high);

  const hours: CloudHour[] = [];
  (time as number[]).forEach((seconds, i) => {
    const pct = total[i];
    if (pct === null || pct === undefined) return;
    hours.push({
      atMs: seconds * 1000,
      totalPct: pct,
      lowPct: low?.[i] ?? null,
      midPct: mid?.[i] ?? null,
      highPct: high?.[i] ?? null,
    });
  });
  return { hours, retrievedAtMs };
}
/** Hourly cloud cover for the next two days at a spot. */
export async function fetchCloudForecast(
  latDeg: number,
  lonDeg: number,
  { signal, fetchImpl = fetch, now = Date.now }: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<CloudForecast> {
  const url = new URL(FORECAST_URL);
  // Two decimals (~1 km) is finer than any model grid cell, and sends less of
  // where the visitor is than their exact position would.
  url.searchParams.set("latitude", latDeg.toFixed(2));
  url.searchParams.set("longitude", lonDeg.toFixed(2));
  url.searchParams.set("hourly", "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", "GMT");

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
    if (timedOut) throw new CloudForecastError("timeout", "The cloud forecast took too long to answer.");
    if (signal?.aborted) throw error;
    throw new CloudForecastError("network", "Couldn't reach the cloud forecast.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  if (!response.ok) {
    throw new CloudForecastError("server-error", `The cloud forecast answered HTTP ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CloudForecastError("schema", "The cloud forecast came back in an unexpected shape.");
  }
  return parseCloudForecast(body, now());
}
