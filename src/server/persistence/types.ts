/**
 * Persistence contracts.
 *
 * Supabase is optional at runtime: when credentials are absent (the public
 * demo default), snapshot/watchlist operations are statically unavailable
 * and callers fall back to self-contained behavior (localStorage watchlists,
 * live-only comparisons). Route responses always disclose whether
 * persistence was available for the request.
 */

import type { SatelliteNumber } from "@/domain/orbit/types";

export interface OrbitalSnapshotRecord {
  id: number;
  satelliteNumber: SatelliteNumber;
  name: string;
  /** Full TLE lines as received from the provider. */
  tleLine1: string;
  tleLine2: string;
  /** Element-set epoch (ISO UTC). */
  epoch: string;
  retrievedAt: string;
  source: string;
}

export interface WatchlistItem {
  satelliteNumber: SatelliteNumber;
  name: string;
  addedAt: string;
}

export type PersistenceStatus = "available" | "unavailable";
