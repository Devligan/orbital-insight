/**
 * Satellite-detail data loader (server side).
 *
 * Assembles everything the detail page renders in one bounded operation so
 * the page stays a thin presentation component; staleness assessment happens
 * here, not during render.
 */

import { satelliteService, type DataLineage } from "./satellites";
import { computeGroundTrack } from "./analysis";
import { saveSnapshot } from "./persistence/supabase";
import { compileElementSet } from "@/domain/orbit/propagation";
import { computeCharacteristics, type OrbitalCharacteristics } from "@/domain/orbit/characteristics";
import type { GroundTrackResult } from "./analysis";
import type { SatelliteRecord } from "@/domain/orbit/types";

/** Element data older than this is flagged in the UI. Documented in the
 * methodology page: a conservative operational warning bound, not a
 * universal accuracy cutoff. */
export const STALE_WARNING_MS = 36 * 60 * 60 * 1000;

export interface SatelliteDetailData {
  record: SatelliteRecord;
  characteristics: OrbitalCharacteristics;
  track: GroundTrackResult;
  lineage: DataLineage;
  staleElements: boolean;
}

export async function loadSatelliteDetail(satelliteNumber: string): Promise<SatelliteDetailData> {
  const { record, lineage } = await satelliteService.get(satelliteNumber);
  const compiled = compileElementSet(record.elementSet);
  const track = await computeGroundTrack({ satelliteNumber });

  // Opportunistic snapshot persistence: when Supabase is configured, record
  // the element set actually served. The database-side unique constraint
  // (satellite_number, epoch) makes this idempotent - page views never
  // inflate history. Fire-and-forget: snapshot failure must never fail the
  // page load, but it is logged rather than swallowed.
  void saveSnapshot({
    satelliteNumber: record.catalog.satelliteNumber,
    name: record.catalog.name,
    tleLine1: record.elementSet.line1,
    tleLine2: record.elementSet.line2,
    epoch: record.elementSet.epoch,
    retrievedAt: record.provenance.retrievedAt,
    source: record.provenance.source,
  }).catch((error: unknown) => {
    console.warn("[snapshot] could not persist orbital snapshot", {
      satelliteNumber: record.catalog.satelliteNumber,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    record,
    characteristics: computeCharacteristics(compiled),
    track,
    lineage,
    staleElements: Date.now() - record.elementSet.epoch.getTime() > STALE_WARNING_MS,
  };
}
