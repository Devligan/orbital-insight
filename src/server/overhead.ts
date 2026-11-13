/**
 * "What's above me right now" (application service).
 *
 * Selects a bounded set of bright, interesting candidates from the catalog
 * snapshot (crewed stations first, then HST), propagates them to the instant
 * of the request and computes observer look angles with the same domain
 * operations the pass engine uses (SGP4 → TEME→ECF → topocentric angles).
 *
 * Failure honesty: a candidate whose record cannot be obtained or propagated
 * is skipped, never fabricated. Visibility follows the requested elevation
 * threshold; objects below it are not returned at all.
 */

import { ecfToLookAngle, temeToEcf, type ObserverLocation } from "@/domain/orbit/coordinates";
import { compileElementSet, propagateTo } from "@/domain/orbit/propagation";
import type { TwoLineElementSet } from "@/domain/orbit/types";
import type { DataLineage } from "./satellites";
import { satelliteService } from "./satellites";
import { loadStaticCatalog } from "./search-index";

export const DEFAULT_MIN_ELEVATION_DEG = 15;

export interface OverheadCandidate {
  satelliteNumber: string;
  name: string;
  elementSet: TwoLineElementSet;
  lineage: DataLineage;
}

export interface OverheadEntry {
  satelliteNumber: string;
  name: string;
  elevationDeg: number;
  azimuthDeg: number;
  /** 8-point compass word for azimuth. */
  direction: string;
  /** Geocentric radius − equatorial radius, km (≈ altitude above equator). */
  altitudeKm: number;
  lineage: DataLineage;
}

export interface OverheadResult {
  observer: ObserverLocation;
  /** UTC instant the positions were propagated to (ISO). */
  asOf: string;
  visible: OverheadEntry[];
  /** How many candidates were skipped (record/propagation failures). */
  skipped: number;
}

const PRIORITY_GROUPS = ["stations"];
const MAX_CANDIDATES = 16;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function compassWord(azimuthDeg: number): string {
  const index = Math.round(((azimuthDeg % 360) + 360) % 360 / 45) % 8;
  return COMPASS[index] ?? "N";
}

/** Candidates are chosen once per snapshot refresh, deterministic order. */
export function selectCandidates(
  entries: { satelliteNumber: string; name: string; group: string; elementSet: TwoLineElementSet }[],
  max = MAX_CANDIDATES,
): { satelliteNumber: string; name: string; group: string; elementSet: TwoLineElementSet }[] {
  const stations = entries.filter((e) => PRIORITY_GROUPS.includes(e.group));
  const hubble = entries.filter((e) => e.group === "science" && /^(HST|HUBBLE)/i.test(e.name));
  const chosen = [...stations, ...hubble];
  return chosen.slice(0, max);
}

/**
 * Pure overhead computation for a fixed set of candidates — synchronous,
 * injectable, fully unit-testable without any provider or catalog state.
 */
export function computeOverheadFor(
  observer: ObserverLocation,
  candidates: OverheadCandidate[],
  asOf: Date,
  minElevationDeg: number = DEFAULT_MIN_ELEVATION_DEG,
): { visible: OverheadEntry[]; skipped: number } {
  const visible: OverheadEntry[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const compiled = compileElementSet(candidate.elementSet);
      const state = propagateTo(compiled, asOf);
      const ecf = temeToEcf(state.teme, asOf);
      const look = ecfToLookAngle(observer, ecf);
      if (look.elevationDeg < minElevationDeg) continue;
      const altitudeKm = state.geodetic.altitudeKm;
      visible.push({
        satelliteNumber: candidate.satelliteNumber,
        name: candidate.name,
        elevationDeg: look.elevationDeg,
        azimuthDeg: look.azimuthDeg,
        direction: compassWord(look.azimuthDeg),
        altitudeKm,
        lineage: candidate.lineage,
      });
    } catch {
      skipped += 1;
    }
  }

  visible.sort((a, b) => b.elevationDeg - a.elevationDeg);
  return { visible, skipped };
}

/**
 * Request-level wrapper: resolves candidates from the catalog snapshot,
 * fetches their records with "cache-first" policy (an outage or a missing
 * record simply skips that candidate — never fabrication), and computes the
 * result for the current instant.
 */
export async function computeOverhead(
  observer: ObserverLocation,
  minElevationDeg: number = DEFAULT_MIN_ELEVATION_DEG,
  service = satelliteService,
): Promise<OverheadResult> {
  const asOf = new Date();
  const candidates: OverheadCandidate[] = [];
  let skipped = 0;
  for (const candidate of selectCandidates(loadStaticCatalog().entries)) {
    try {
      const served = await service.get(candidate.satelliteNumber, "cache-first");
      candidates.push({
        satelliteNumber: candidate.satelliteNumber,
        name: candidate.name,
        elementSet: served.record.elementSet,
        lineage: served.lineage,
      });
    } catch {
      skipped += 1;
    }
  }
  // `skipped` covers both failure kinds: records that wouldn't load (here)
  // and element sets that wouldn't propagate (inside computeOverheadFor).
  const computed = computeOverheadFor(observer, candidates, asOf, minElevationDeg);
  return {
    observer,
    asOf: asOf.toISOString(),
    visible: computed.visible,
    skipped: skipped + computed.skipped,
  };
}
