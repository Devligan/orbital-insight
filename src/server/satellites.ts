/**
 * Satellite service (application layer).
 *
 * Responsibilities: fetch bounded curated groups from CelesTrak, maintain
 * catalog + element-set caches, execute searches, and expose single records
 * with provenance (source, epoch, retrieval time, staleness).
 *
 * Staleness policy:
 *  - "live": fetched or cache-fresh within TTL (2 h).
 *  - "cached": past TTL but served while the provider fetch was attempted
 *    recently (< 7 days age) — user-facing responses say so.
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
} from "@/integrations/celestrak/client";
import {
  BoundedCache,
  CatalogEntryCache,
  ELEMENT_SET_TTL_MS,
  type CachedElementSet,
} from "./catalog-cache";

/** Curated, bounded groups (total < ~400 entries). Deliberately excludes
 * `active` (~11k) and Starlink-scale catalogs to respect the free provider. */
export const CATALOG_GROUPS = ["stations", "gps-ops", "galileo", "science"] as const;

const MAX_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DataLineage = "live" | "cached" | "provider-unavailable-stale";

export interface SatelliteRecordResult {
  record: SatelliteRecord;
  lineage: DataLineage;
}

export class SatelliteService {
  private cache = new BoundedCache(ELEMENT_SET_TTL_MS);
  private names = new CatalogEntryCache();
  private groupsFetched = new Set<string>();

  constructor(private readonly client: HttpCelestrakClient = celestrakClient) {}

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

  /** Search across cached catalog entries (fetched on demand). */
  async search(query: string, limit = 25): Promise<SatelliteCatalogEntrySearchResult[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    for (const group of CATALOG_GROUPS) await this.ensureGroup(group);

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
   * Order: cache (within TTL) → provider (single-number query) → stale fallback.
   * A fresh cache entry is served without a provider call regardless of
   * strategy; "fresh-first" refetches only when the entry passed its TTL.
   */
  async get(satelliteNumber: string, strategy: "fresh-first" | "cache-first" = "fresh-first"): Promise<SatelliteRecordResult> {
    const cached = this.cache.get(satelliteNumber);
    if (cached) {
      const age = Date.now() - cached.retrievedAt.getTime();
      if (age <= ELEMENT_SET_TTL_MS || strategy === "cache-first") {
        return { record: toRecord(cached), lineage: lineageFor(cached.retrievedAt) };
      }
    }

    try {
      const entries = await this.client.fetchGpTle({ kind: "catnr", value: satelliteNumber });
      const entry = entries.find((e) => e.elementSet.satelliteNumber === satelliteNumber);
      if (!entry) {
        throw new AppError("not-found", `No orbital data available for catalog identifier ${satelliteNumber}`);
      }
      this.cache.set({ name: entry.name, elementSet: entry.elementSet, retrievedAt: new Date() });
      this.names.set({ satelliteNumber, name: entry.name });
      return { record: toRecord({ name: entry.name, elementSet: entry.elementSet, retrievedAt: new Date() }), lineage: "live" };
    } catch (error) {
      if (cached) {
        // Provider failed but we hold real previously-fetched data: serve it
        // clearly labelled. Only if within the stale horizon.
        if (Date.now() - cached.retrievedAt.getTime() <= MAX_STALE_AGE_MS) {
          const lineage: DataLineage = error instanceof ProviderError && error.reason === "rate-limited" ? "cached" : "provider-unavailable-stale";
          return { record: toRecord(cached), lineage };
        }
      }
      if (isProviderFailure(error)) throw error;
      throw new AppError("not-found", `No orbital data available for catalog identifier ${satelliteNumber}`);
    }
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
export const satelliteService: SatelliteService = new SatelliteService();

export type { GpQuery };
