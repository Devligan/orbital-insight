/**
 * Bounded in-process cache for satellite catalog + element-set data.
 *
 * One satellite record per request must NOT refetch the provider: this cache
 * holds fetched groups keyed by satellite number with a TTL, and serves
 * stale data (clearly labelled by callers) when the provider is down.
 *
 * Concurrency/limits: bounded by MAX_ENTRIES (oldest evicted first), so the
 * curated catalog can never unbound memory. On Vercel serverless the cache
 * lives per-instance (typical friend-warm instance lifetime), which is the
 * documented trade-off for the free tier (see /methodology + README).
 */

import type { SatelliteCatalogEntry, TwoLineElementSet } from "@/domain/orbit/types";

export interface CachedElementSet {
  name: string;
  group?: string;
  elementSet: TwoLineElementSet;
  /** When this application obtained the record. */
  retrievedAt: Date;
}

const MAX_ENTRIES = 2_000;

export class BoundedCache {
  private store = new Map<string, CachedElementSet>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number = MAX_ENTRIES,
  ) {}

  get(satelliteNumber: string): CachedElementSet | undefined {
    return this.store.get(satelliteNumber);
  }

  set(entry: CachedElementSet): void {
    this.store.set(entry.elementSet.satelliteNumber, entry);
    if (this.store.size > this.maxEntries) {
      // Evict earliest-inserted (Map preserves insertion order).
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
  }

  /** Entries whose age is below the TTL. */
  fresh(): CachedElementSet[] {
    const cutoff = Date.now() - this.ttlMs;
    return [...this.store.values()].filter((e) => e.retrievedAt.getTime() >= cutoff);
  }

  /** Entries at any age (used for stale-serve fallback). */
  all(): CachedElementSet[] {
    return [...this.store.values()];
  }

  age(satelliteNumber: string): number | undefined {
    const entry = this.store.get(satelliteNumber);
    if (!entry) return undefined;
    return Date.now() - entry.retrievedAt.getTime();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Catalog entries (names grouped-side of the pairing). Names may change less
 * frequently than element sets and come with the same fetch; keeping a
 * parallel simple map keyed by number is enough.
 */
export class CatalogEntryCache {
  private entries = new Map<string, SatelliteCatalogEntry>();

  set(entry: SatelliteCatalogEntry): void {
    this.entries.set(entry.satelliteNumber, entry);
  }

  get(satelliteNumber: string): SatelliteCatalogEntry | undefined {
    return this.entries.get(satelliteNumber);
  }

  all(): SatelliteCatalogEntry[] {
    return [...this.entries.values()];
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Element-set TTL: 2 hours balances freshness vs. provider politeness. */
export const ELEMENT_SET_TTL_MS = 2 * 60 * 60 * 1000;
