/**
 * Whole-sky catalog service.
 *
 * The full-sky globe needs element sets for **every active object**: one
 * CelesTrak request (`GROUP=active`, ~10,600 entries ≈ 2 MB text). That is a
 * real provider cost, so it is fetched at most once per TTL and held in a
 * module-level cache; concurrent callers share one in-flight fetch. When the
 * provider fails and a previous copy exists, the stale copy is served and
 * clearly labelled — the UI decides how honestly to present it (same contract
 * as every other provider-backed view).
 *
 * Payload discipline: the route serializes only what the browser needs to
 * propagate client-side (name, catalog number, both TLE lines). Group
 * classification (LEO/MEO/GEO/HEO) derives client-side from the mean motion —
 * no extra provider requests, no hidden data.
 */

import { celestrakClient } from "@/integrations/celestrak/client";

/** Refresh the whole-sky catalog at most this often from the provider. */
const SKY_CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 h — active.txt changes slowly
/** A fetch older than this is never served, even as stale. */
const MAX_STALE_MS = 48 * 60 * 60 * 1000;

export interface SkyCatalogEntry {
  /** NORAD catalog number (string for JSON interop with the rest of the app). */
  i: string;
  /** Display name from the provider's TLE name line. */
  n: string;
  /** TLE line 1 verbatim. */
  l1: string;
  /** TLE line 2 verbatim. */
  l2: string;
}

export interface SkyCatalogResult {
  generatedAt: string;
  /** true when served from cache after a failed provider fetch. */
  stale: boolean;
  count: number;
  entries: SkyCatalogEntry[];
}

interface CacheState {
  result: SkyCatalogResult | null;
  inFlight: Promise<SkyCatalogResult> | null;
}

// Module-level (per serverless instance) — the documented cache trade-off,
// same as the bounded catalog cache.
const state: CacheState = { result: null, inFlight: null };

function toEntries(
  named: { name: string; elementSet: { satelliteNumber: string; line1: string; line2: string } }[],
): SkyCatalogEntry[] {
  const entries: SkyCatalogEntry[] = [];
  for (const item of named) {
    const { satelliteNumber, line1, line2 } = item.elementSet;
    if (!satelliteNumber || !line1 || !line2) continue;
    entries.push({ i: satelliteNumber, n: item.name, l1: line1, l2: line2 });
  }
  return entries;
}

async function fetchFresh(): Promise<SkyCatalogResult> {
  const named = await celestrakClient.fetchGpTle({ kind: "group", value: "active" });
  // A whole-catalog answer far below the active population is a provider
  // anomaly (truncated feed): refuse it rather than presenting a fake "sky".
  if (named.length < 5_000) {
    throw new Error(`CelesTrak answered GROUP=active with only ${named.length} objects — expected the full active feed`);
  }
  return {
    generatedAt: new Date().toISOString(),
    stale: false,
    count: named.length,
    entries: toEntries(named),
  };
}

export async function getSkyCatalog(): Promise<SkyCatalogResult> {
  const cached = state.result;
  if (cached) {
    const age = Date.now() - new Date(cached.generatedAt).getTime();
    if (age < SKY_CATALOG_TTL_MS) return cached;
    if (age > MAX_STALE_MS) {
      state.result = null;
    }
  }
  if (!state.inFlight) {
    state.inFlight = fetchFresh()
      .then((fresh) => {
        state.result = fresh;
        return fresh;
      })
      .catch((error: unknown) => {
        // Provider outage: serve the previous copy (labelled stale), else the
        // typed error propagates to the route (honest failure, no fake sky).
        const stale = state.result && Date.now() - new Date(state.result.generatedAt).getTime() <= SKY_CATALOG_TTL_MS + MAX_STALE_MS;
        if (state.result && stale) {
          return { ...state.result, stale: true };
        }
        throw error;
      })
      .finally(() => {
        state.inFlight = null;
      });
  }
  return state.inFlight;
}
