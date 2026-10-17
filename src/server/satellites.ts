/**
 * Satellite service (application layer).
 *
 * Responsibilities: fetch bounded curated groups from CelesTrak, maintain
 * catalog + element-set caches, execute searches, and expose single records
 * with provenance (source, epoch, retrieval time, staleness).
 *
 * Staleness policy:
 *  - "live": fetched or cache-fresh within TTL (2 h).
 *  - "cached": past TTL — answered at once while a background refresh runs
 *    (< 1 day old), or served when the provider is rate-limiting
 *    (< 7 days age) — user-facing responses say so.
 *  - "provider-unavailable-stale": served from cache after a provider
 *    failure; responses flag it, and UI offers a retry.
 *
 * The provider outage path never fabricates data: without cached data we
 * throw ProviderError so routes translate to a clear HTTP failure.
 */

import { AppError, isProviderFailure } from "@/lib/errors";
import type { SatelliteRecord } from "@/domain/orbit/types";
import {
  celestrakClient,
  ProviderError,
  type GpQuery,
  type HttpCelestrakClient,
  type NamedElementSet,
} from "@/integrations/celestrak/client";
import {
  BoundedCache,
  CatalogEntryCache,
  ELEMENT_SET_TTL_MS,
  type CachedElementSet,
} from "./catalog-cache";
import { loadStaticCatalog } from "./search-index";

/** Curated, bounded groups (total < ~400 entries). Deliberately excludes
 * `active` (~11k) and Starlink-scale catalogs to respect the free provider. */
export const CATALOG_GROUPS = ["stations", "gps-ops", "galileo", "science"] as const;

const MAX_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Past its TTL but younger than this, a cached record is answered at once
 * (labelled "cached") while the provider refresh runs in the background.
 * Waiting for the provider instead put its full timeout on the page's
 * critical path whenever it was unreachable — measured 10.7 s for a cached
 * ISS lookup once the client's outage breaker re-probed. Element sets a day
 * old still predict a low-orbit pass to within seconds; older ones wait for
 * the provider as before.
 */
const SERVE_WHILE_REFRESHING_MS = 24 * 60 * 60 * 1000;

export type DataLineage = "live" | "cached" | "provider-unavailable-stale";

export interface SatelliteRecordResult {
  record: SatelliteRecord;
  lineage: DataLineage;
}

export class SatelliteService {
  private cache = new BoundedCache(ELEMENT_SET_TTL_MS);
  private names = new CatalogEntryCache();
  private groupsFetched = new Set<string>();
  /** Background refreshes in flight, one per satellite. */
  private refreshing = new Map<string, Promise<void>>();

  /**
   * @param hydrateStaticCatalog seed caches from the build-time catalog
   *   snapshot (default false so injected/pure instances stay provider-free;
   *   the app singleton opts in for instant curated answers).
   */
  constructor(
    private readonly client: HttpCelestrakClient = celestrakClient,
    hydrateStaticCatalog = false,
  ) {
    if (hydrateStaticCatalog) this.hydrateFromStaticCatalog();
  }

  /** Seed caches with the build-time snapshot (see search-index.ts). */
  private hydrateFromStaticCatalog(): void {
    const { generatedAt, entries } = loadStaticCatalog();
    for (const entry of entries) {
      this.cache.set({
        name: entry.name,
        group: entry.group,
        elementSet: entry.elementSet,
        retrievedAt: generatedAt ?? new Date(),
        fromSnapshot: true,
      });
      this.names.set({
        satelliteNumber: entry.satelliteNumber,
        name: entry.name,
        group: entry.group,
      });
    }
  }

  /** Fetch and cache a bounded curated group (once per server instance TTL). */
  async ensureGroup(group: string): Promise<void> {
    if (this.groupsFetched.has(group)) return;
    const entries = await this.client.fetchGpTle({ kind: "group", value: group });
    for (const entry of entries) {
      this.cache.set({
        name: entry.name,
        group,
        elementSet: entry.elementSet,
        retrievedAt: new Date(),
      });
      this.names.set({
        satelliteNumber: entry.elementSet.satelliteNumber,
        name: entry.name,
        group,
      });
    }
    this.groupsFetched.add(group);
  }

  /**
   * Search across the catalog. Instant on cold instances: the build-time
   * snapshot seeds the catalog (see search-index.ts), so no provider fetch
   * is on the latency-critical path. The live provider refreshes the same
   * groups in the background — later searches on the same instance see the
   * refreshed data; an outage simply leaves the snapshot in place.
   */
  async search(query: string, limit = 25): Promise<SatelliteCatalogEntrySearchResult[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];

    for (const group of CATALOG_GROUPS) {
      // Non-blocking refresh: the response never waits on the provider.
      void this.ensureGroup(group).catch(() => undefined);
    }

    const results = this.names
      .all()
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(q) ||
          entry.satelliteNumber.startsWith(q.replace(/^0+(?=\d)/, "")),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
    return results;
  }

  /**
   * Get one satellite with its element set.
   * Order: cache (within TTL) → cache under a day old, refreshed in the
   * background → provider (single-number query) → stale fallback.
   * A fresh cache entry is served without a provider call regardless of
   * strategy; "fresh-first" refetches only when the entry passed its TTL.
   */
  async get(satelliteNumber: string, strategy: "fresh-first" | "cache-first" = "fresh-first"): Promise<SatelliteRecordResult> {
    const cached = this.cache.get(satelliteNumber);
    if (cached) {
      const age = Date.now() - cached.retrievedAt.getTime();
      if (age <= ELEMENT_SET_TTL_MS || strategy === "cache-first") {
        // Snapshot-held data is honest "cached", never "live": this instance
        // did not fetch it (its retrieval happened at application build time).
        const lineage: DataLineage = cached.fromSnapshot ? "cached" : lineageFor(cached.retrievedAt);
        return { record: toRecord(cached), lineage };
      }
      if (age <= SERVE_WHILE_REFRESHING_MS) {
        this.refreshInBackground(satelliteNumber);
        return { record: toRecord(cached), lineage: "cached" };
      }
    }

    try {
      const entry = await this.fetchOne(satelliteNumber);
      return { record: toRecord({ name: entry.name, elementSet: entry.elementSet, retrievedAt: new Date() }), lineage: "live" };
    } catch (error) {
      if (cached) {
        // Provider failed but we hold real previously-fetched data: serve it
        // clearly labelled. Only if within the stale horizon.
        if (Date.now() - cached.retrievedAt.getTime() <= MAX_STALE_AGE_MS) {
          const lineage: DataLineage = cached.fromSnapshot
            ? "cached" // build-time data: the provider state is irrelevant to its label
            : error instanceof ProviderError && error.reason === "rate-limited"
              ? "cached"
              : "provider-unavailable-stale";
          return { record: toRecord(cached), lineage };
        }
      }
      if (isProviderFailure(error)) throw error;
      throw new AppError("not-found", `No orbital data available for catalog identifier ${satelliteNumber}`);
    }
  }

  /** One provider lookup by catalog number; caches the answer. */
  private async fetchOne(satelliteNumber: string): Promise<NamedElementSet> {
    const entries = await this.client.fetchGpTle({ kind: "catnr", value: satelliteNumber });
    const entry = entries.find((e) => e.elementSet.satelliteNumber === satelliteNumber);
    if (!entry) {
      throw new AppError("not-found", `No orbital data available for catalog identifier ${satelliteNumber}`);
    }
    this.cache.set({ name: entry.name, elementSet: entry.elementSet, retrievedAt: new Date() });
    this.names.set({ satelliteNumber, name: entry.name });
    return entry;
  }

  /** Refresh a cached record without anyone waiting on it; failures keep the cached copy. */
  private refreshInBackground(satelliteNumber: string): void {
    if (this.refreshing.has(satelliteNumber)) return;
    const refresh = this.fetchOne(satelliteNumber)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => this.refreshing.delete(satelliteNumber));
    this.refreshing.set(satelliteNumber, refresh);
  }

  /** Settles when background refreshes in flight are done (tests). */
  async settled(): Promise<void> {
    await Promise.all([...this.refreshing.values()]);
  }

  /** All cached catalog entries (for comparator previews). */
  listCatalog(): { entries: SatelliteCatalogEntrySearchResult[]; groupsLoaded: string[] } {
    return {
      entries: this.names.all(),
      groupsLoaded: [...this.groupsFetched],
    };
  }
}

export interface SatelliteCatalogEntrySearchResult {
  satelliteNumber: string;
  name: string;
  group?: string;
}

function toRecord(cached: Omit<CachedElementSet, "group"> & { group?: string }): SatelliteRecord {
  return {
    catalog: {
      satelliteNumber: cached.elementSet.satelliteNumber,
      name: cached.name,
      ...(cached.group !== undefined ? { group: cached.group } : {}),
    },
    elementSet: cached.elementSet,
    provenance: {
      source: "celestrak",
      retrievedAt: cached.retrievedAt,
      ...(cached.group !== undefined ? { group: cached.group } : {}),
    },
  };
}

function lineageFor(retrievedAt: Date): DataLineage {
  return Date.now() - retrievedAt.getTime() <= ELEMENT_SET_TTL_MS ? "live" : "cached";
}

/** Singleton for route handlers; tests inject a fake client. */
export const satelliteService: SatelliteService = new SatelliteService(
  celestrakClient,
  true, // hydrate from the build-time catalog snapshot
);

export type { GpQuery };
