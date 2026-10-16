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
 *
 * Politeness beyond the TTL (both learned the hard way — CelesTrak blocked
 * this machine's IP after repeated full-catalog downloads):
 *  - The last good catalog is also written to a disk snapshot, so a server
 *    restart or dev hot-reload restores it instead of re-downloading ~2 MB.
 *    The snapshot keeps its original fetch time, so TTL and 48 h staleness
 *    rules apply exactly as if it had never left memory. (Serverless
 *    instances get a per-instance /tmp: helps warm instances, harmless
 *    otherwise.)
 *  - After a failed fetch, the provider is not asked again for
 *    FAILURE_BACKOFF_MS; callers get the stale copy or the same typed error.
 *    Without this, every page view during an outage fired another request.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { celestrakClient } from "@/integrations/celestrak/client";

/** Refresh the whole-sky catalog at most this often from the provider. */
const SKY_CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 h — active.txt changes slowly
/** A fetch older than this is never served, even as stale. */
const MAX_STALE_MS = 48 * 60 * 60 * 1000;
/** After a provider failure, don't ask again for this long. */
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;
/** Below this, a GROUP=active answer is a truncated feed, not the sky. */
const MIN_ACTIVE_OBJECTS = 5_000;

/** Snapshot location: SKY_CATALOG_SNAPSHOT_PATH, "off" to disable, else the OS temp dir. */
function snapshotPath(): string | null {
  const configured = process.env.SKY_CATALOG_SNAPSHOT_PATH;
  if (configured === "off") return null;
  return configured || path.join(tmpdir(), "orbital-insight", "sky-catalog.json");
}

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
  /** One-time disk restore, shared by concurrent first callers. */
  restore: Promise<void> | null;
  lastFailure: { at: number; error: unknown } | null;
}

// Module-level (per serverless instance) — the documented cache trade-off,
// same as the bounded catalog cache.
const state: CacheState = { result: null, inFlight: null, restore: null, lastFailure: null };

function ageMs(result: SkyCatalogResult): number {
  return Date.now() - new Date(result.generatedAt).getTime();
}

async function restoreSnapshot(): Promise<void> {
  const file = snapshotPath();
  if (!file || state.result) return;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<SkyCatalogResult>;
    const valid =
      typeof parsed.generatedAt === "string" &&
      Number.isFinite(new Date(parsed.generatedAt).getTime()) &&
      Array.isArray(parsed.entries) &&
      parsed.entries.length >= MIN_ACTIVE_OBJECTS &&
      parsed.count === parsed.entries.length;
    if (!valid) return;
    const restored: SkyCatalogResult = {
      generatedAt: parsed.generatedAt as string,
      stale: false,
      count: parsed.count as number,
      entries: parsed.entries as SkyCatalogEntry[],
    };
    if (ageMs(restored) <= MAX_STALE_MS && !state.result) state.result = restored;
  } catch {
    /* no snapshot yet, or unreadable: fall through to the provider */
  }
}

async function persistSnapshot(result: SkyCatalogResult): Promise<void> {
  const file = snapshotPath();
  if (!file) return;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(result), "utf8");
  } catch {
    /* best effort: a read-only filesystem just means no restart cache */
  }
}

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
  if (named.length < MIN_ACTIVE_OBJECTS) {
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
  state.restore ??= restoreSnapshot();
  await state.restore;

  const cached = state.result;
  if (cached) {
    const age = ageMs(cached);
    if (age < SKY_CATALOG_TTL_MS) return cached;
    if (age > MAX_STALE_MS) state.result = null;
  }

  // Recently failed: don't ask the provider again yet.
  if (state.lastFailure && Date.now() - state.lastFailure.at < FAILURE_BACKOFF_MS) {
    if (state.result) return { ...state.result, stale: true };
    throw state.lastFailure.error;
  }

  if (!state.inFlight) {
    state.inFlight = fetchFresh()
      .then((fresh) => {
        state.result = fresh;
        state.lastFailure = null;
        void persistSnapshot(fresh);
        return fresh;
      })
      .catch((error: unknown) => {
        state.lastFailure = { at: Date.now(), error };
        // Provider outage: serve the previous copy (labelled stale; expired
        // copies were dropped above), else the typed error propagates to the
        // route (honest failure, no fake sky).
        if (state.result) return { ...state.result, stale: true };
        throw error;
      })
      .finally(() => {
        state.inFlight = null;
      });
  }
  return state.inFlight;
}
