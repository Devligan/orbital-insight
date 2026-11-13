/**
 * Supabase persistence adapter.
 *
 * Runtime-optional: if env vars are missing, `persistenceAvailable()` is
 * false and the whole application runs in read-only demo mode. All
 * privileged access happens strictly server-side; the service-role key (if
 * configured) never reaches the browser.
 *
 * Watchlists are user-owned via Supabase Auth JWTs supplied by the request
 * and protected by RLS (see supabase/migrations/*). Snapshots are app-owned
 * (written with the service role when configured).
 */

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import type { SatelliteNumber } from "@/domain/orbit/types";
import type { OrbitalSnapshotRecord, WatchlistItem } from "./types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True only when the server has been configured with Supabase credentials. */
export function persistenceAvailable(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/** App-level client (service role, server-only). */
let appClient: SupabaseClient | null = null;

function getSnapshotsClient(): SupabaseClient | null {
  if (!persistenceAvailable()) return null;
  appClient ??= createClient(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return appClient;
}

/**
 * A per-request client bound to the caller's Supabase Auth JWT. Returns null
 * when credentials/token are absent - watchlist endpoints then report
 * unavailability instead of failing.
 */
export function getUserClient(request: Request): SupabaseClient | null {
  const url = SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) : null;
}

// ---------------------------------------------------------------------------
// Orbital snapshots (app-owned history)
// ---------------------------------------------------------------------------

export async function saveSnapshot(input: {
  satelliteNumber: SatelliteNumber;
  name: string;
  tleLine1: string;
  tleLine2: string;
  epoch: Date;
  retrievedAt: Date;
  source: string;
}): Promise<boolean> {
  const client = getSnapshotsClient();
  if (!client) return false;

  const { error } = await client.from("orbital_snapshots").upsert(
    {
      satellite_number: input.satelliteNumber,
      name: input.name,
      tle_line1: input.tleLine1,
      tle_line2: input.tleLine2,
      epoch: input.epoch.toISOString(),
      retrieved_at: input.retrievedAt.toISOString(),
      source: input.source,
    },
    // Database-side dedup: unique(satellite_number, epoch) keeps page views
    // from inflating history (see migrations).
    { onConflict: "satellite_number,epoch", ignoreDuplicates: false },
  );
  return error === null;
}

export async function listSnapshots(satelliteNumber: SatelliteNumber, limit = 20): Promise<OrbitalSnapshotRecord[]> {
  const client = getSnapshotsClient();
  if (!client) return [];

  const { data, error } = await client
    .from("orbital_snapshots")
    .select("id, satellite_number, name, tle_line1, tle_line2, epoch, retrieved_at, source")
    .eq("satellite_number", satelliteNumber)
    .order("epoch", { ascending: false })
    .limit(limit);

  if (error || data === null) return [];
  return data.map((row) => ({
    id: Number(row.id),
    satelliteNumber: String(row.satellite_number),
    name: String(row.name),
    tleLine1: String(row.tle_line1),
    tleLine2: String(row.tle_line2),
    epoch: String(row.epoch),
    retrievedAt: String(row.retrieved_at),
    source: String(row.source),
  }));
}

// ---------------------------------------------------------------------------
// Watchlists (user-owned, RLS-protected)
// ---------------------------------------------------------------------------

export class SupabaseWatchlistStore {
  async getWatchlist(client: SupabaseClient | null): Promise<WatchlistItem[]> {
    if (!client) throw new AppError("persistence", "Watchlist persistence is unavailable in read-only demo mode");
    const { data, error } = await client
      .from("watchlist_items")
      .select("satellite_number, name, added_at")
      .order("added_at", { ascending: false });
    if (error || data === null) {
      throw new AppError("persistence", error?.message ?? "Could not read the watchlist");
    }
    return data.map((row) => ({
      satelliteNumber: String(row.satellite_number),
      name: String(row.name),
      addedAt: String(row.added_at),
    }));
  }

  async addItem(client: SupabaseClient | null, item: WatchlistItem): Promise<WatchlistItem[]> {
    if (!client) throw new AppError("persistence", "Watchlist persistence is unavailable in read-only demo mode");
    const { error } = await client
      .from("watchlist_items")
      .upsert(
        { satellite_number: item.satelliteNumber, name: item.name, added_at: item.addedAt },
        // Unique(satellite_number) prevents duplicate watchlist rows.
        { onConflict: "satellite_number" },
      );
    if (error) throw new AppError("persistence", error.message);
    return this.getWatchlist(client);
  }

  async removeItem(client: SupabaseClient | null, satelliteNumber: SatelliteNumber): Promise<WatchlistItem[]> {
    if (!client) throw new AppError("persistence", "Watchlist persistence is unavailable in read-only demo mode");
    const { error } = await client.from("watchlist_items").delete().eq("satellite_number", satelliteNumber);
    if (error) throw new AppError("persistence", error.message ?? "Could not remove the watchlist item");
    return this.getWatchlist(client);
  }
}
