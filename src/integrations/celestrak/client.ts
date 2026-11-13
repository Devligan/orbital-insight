/**
 * CelesTrak provider client.
 *
 * The only module that talks to CelesTrak. Owns:
 *  - endpoint selection (current GP API, not deprecated endpoints)
 *  - TLE-triplet response parsing + validation (corrupt provider data never
 *    enters the domain)
 *  - timeouts and typed failures (network / timeout / rate-limit / schema)
 *
 * We use the documented TLE output format of the current GP data interface
 * (https://celestrak.org/NORAD/elements/gp.php - the /ed/ path was retired
 * with the 2023 GP interface upgrade), which also
 * prefixes each element set with the object's name - giving us both catalog
 * names and propagation-ready element sets from one bounded request.
 *
 * Rate-limit behavior (documented on /methodology): CelesTrak is a free
 * public service that throttles abusive clients; this client enforces a
 * minimum request interval and surfaces a typed failure instead of
 * hammering the endpoint. Caching lives one layer up (src/server).
 */

import { AppError } from "@/lib/errors";
import { parseTle } from "@/domain/orbit/tle";
import type { TwoLineElementSet } from "@/domain/orbit/types";

const GP_URL = "https://celestrak.org/NORAD/elements/gp.php";

const DEFAULT_TIMEOUT_MS = 15_000;
/** Minimum interval between outbound requests from a client instance. */
const MIN_REQUEST_INTERVAL_MS = 2_000;
/**
 * Circuit breaker: after an outage-type failure (unreachable, timeout,
 * throttled, 5xx/403), further requests fail immediately for this long
 * instead of each waiting out a fresh timeout. Callers then fall back to
 * cached data at once. (Measured during a CelesTrak block: every object's
 * first lookup took ~11 s before falling back; and re-asking a provider that
 * is blocking you prolongs the block.)
 */
const OUTAGE_COOLDOWN_MS = 2 * 60_000;

export type CelestrakFailureReason =
  | "network"
  | "timeout"
  | "rate-limited"
  | "schema"
  | "not-found"
  | "server-error";

export class ProviderError extends AppError {
  readonly reason: CelestrakFailureReason;

  constructor(reason: CelestrakFailureReason, message: string, options?: { details?: unknown; cause?: unknown }) {
    super("provider", message, options);
    this.name = "ProviderError";
    this.reason = reason;
  }
}

export type GpQuery =
  | { kind: "group"; value: string }
  | { kind: "catnr"; value: string }
  | { kind: "name"; value: string };

/** CelesTrak's gp.php parameter names are case-sensitive (PHP $_GET). */
const QUERY_PARAM_NAME: Record<GpQuery["kind"], string> = {
  group: "GROUP",
  catnr: "CATNR",
  name: "NAME",
};

export interface NamedElementSet {
  name: string;
  elementSet: TwoLineElementSet;
}

export interface CelestrakClient {
  fetchGpTle(query: GpQuery, timeoutMs?: number): Promise<NamedElementSet[]>;
}

/** Split a GP TLE response into name + validated element sets. */
export function parseGpTleResponse(text: string): NamedElementSet[] {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const results: NamedElementSet[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const candidateLine1 = lines[i] ?? "";
    // Find the next "1 xxxxxU" line; the preceding non-empty line is the name.
    if (!/^1 \d{5}[UCSO]/i.test(candidateLine1)) continue;
    const line2 = lines[i + 1] ?? "";
    if (!/^2 \d{5}/i.test(line2)) continue;
    const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";
    const name = prevLine && !/^[12] \d/.test(prevLine) ? prevLine.trim() : "";
    if (/^No GP data|^No TLE data/i.test(name)) continue;
    try {
      const elementSet = parseTle(candidateLine1, line2);
      results.push({ name: name || elementSet.satelliteNumber, elementSet });
      i += 1; // consumed line2
    } catch (error) {
      if (error instanceof AppError && error.kind === "validation") {
        throw new ProviderError("schema", `CelesTrak returned an invalid TLE for catalog ID ${name || candidateLine1.slice(2, 7)}`, {
          details: { line: i + 1 },
          cause: error.message,
        });
      }
      throw error;
    }
  }
  return results;
}

export class HttpCelestrakClient implements CelestrakClient {
  private lastRequestAt = 0;
  /** Open circuit: no requests until `until`; fail fast with the cause. */
  private outage: { until: number; reason: CelestrakFailureReason; message: string } | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  async fetchGpTle(query: GpQuery, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<NamedElementSet[]> {
    if (this.outage && this.now() < this.outage.until) {
      throw new ProviderError(
        this.outage.reason,
        `${this.outage.message} (not retrying until ${new Date(this.outage.until).toISOString().slice(11, 19)} UTC)`,
      );
    }
    try {
      const result = await this.request(query, timeoutMs);
      this.outage = null;
      return result;
    } catch (error) {
      if (error instanceof ProviderError && isOutage(error)) {
        this.outage = { until: this.now() + OUTAGE_COOLDOWN_MS, reason: error.reason, message: error.message };
      }
      throw error;
    }
  }

  private async request(query: GpQuery, timeoutMs: number): Promise<NamedElementSet[]> {
    await this.throttle();

    const url = new URL(GP_URL);
    url.searchParams.set(QUERY_PARAM_NAME[query.kind], query.value);
    url.searchParams.set("FORMAT", "tle");

    let response: Response;
    try {
      response = await this.doFetch(url.toString(), timeoutMs);
    } catch (error) {
      // AbortSignal.timeout() rejects with "TimeoutError" (not "AbortError"),
      // which was being mislabelled as a network failure.
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError("timeout", `CelesTrak request timed out after ${timeoutMs}ms`);
      }
      throw new ProviderError("network", "Could not reach CelesTrak", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    if (response.status === 429) {
      throw new ProviderError("rate-limited", "CelesTrak is throttling requests (HTTP 429); retry shortly");
    }
    if (response.status === 400) {
      throw new ProviderError("not-found", "CelesTrak rejected this query", { details: { status: 400 } });
    }
    if (response.status === 404) {
      // CelesTrak answers unknown identifiers/groups with 404 + "No GP data
      // found" - a well-formed "no match" answer, not an outage: report an
      // empty result and let the service layer decide not-found vs cache.
      return [];
    }
    if (!response.ok) {
      throw new ProviderError("server-error", `CelesTrak returned HTTP ${response.status}`, { details: { status: response.status } });
    }

    const text = await response.text();
    if (!text.trim()) {
      // Empty body is how CelesTrak reports "no objects matched" - this is a
      // well-formed provider response, not a schema failure; callers map it
      // to not-found when nothing is cached.
      return [];
    }
    return parseGpTleResponse(text);
  }

  private throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = MIN_REQUEST_INTERVAL_MS - elapsed;
    this.lastRequestAt = Date.now() + Math.max(wait, 0);
    if (wait > 0) {
      return new Promise((resolve) => setTimeout(resolve, wait));
    }
    return Promise.resolve();
  }

  private doFetch(url: string, timeoutMs: number): Promise<Response> {
    return fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Politeness contract documented at /methodology. Content negotiation
        // is explicit: we request TLE-format text, not JSON, so CelesTrak's
        // Accept handling doesn't override FORMAT=tle.
        "User-Agent": "Orbital-Insight/0.1 (educational analysis tool; cached, bounded)",
        Accept: "text/plain",
      },
    });
  }
}

/** Failures that mean "the provider isn't serving us right now" (vs. a bad query). */
function isOutage(error: ProviderError): boolean {
  if (error.reason === "network" || error.reason === "timeout" || error.reason === "rate-limited") return true;
  if (error.reason !== "server-error") return false;
  const status = (error.details as { status?: number } | undefined)?.status;
  return status === undefined || status === 403 || status >= 500;
}

/** Singleton for route handlers; tests inject their own instances. */
export const celestrakClient = new HttpCelestrakClient();
