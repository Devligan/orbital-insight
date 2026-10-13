/**
 * Analysis service (application layer): combines the satellite service,
 * propagation domain, and pass domain into server-facing operations with
 * bounded windows. Route handlers stay thin by calling these.
 */

import { AppError } from "@/lib/errors";
import type { GroundTrackSegment, SatelliteRecord } from "@/domain/orbit/types";
import type { ObserverLocation } from "@/domain/orbit/coordinates";
import { compileElementSet, sampleTrack } from "@/domain/orbit/propagation";
import { propagateState } from "@/integrations/sgp4/adapter";
import { temeToEcf } from "@/domain/orbit/coordinates";
import { buildGroundTrackSegments } from "@/domain/orbit/ground-track";
import { computeCharacteristics, type OrbitalCharacteristics } from "@/domain/orbit/characteristics";
import { findPasses, type PassSearchParams } from "@/domain/passes/finder";
import type { PassResult } from "@/domain/passes/types";
import { SatelliteService, type DataLineage, satelliteService } from "./satellites";

/** Ground-track sampling bounds (free-tier + shared instance hostility). */
export const GROUND_TRACK_MAX_HOURS = 48;
export const GROUND_TRACK_DEFAULT_HOURS = 24;
export const GROUND_TRACK_DEFAULT_SAMPLES = 240;

/** Pass-prediction bounds. */
export const PASS_SEARCH_MAX_SATELLITES = 25;
export const PASS_SEARCH_MAX_HOURS = 24 * 30;
/**
 * Compute budget for one pass request: satellite-count × window-hours.
 * Measured worst case (25 sats × 720 h = 18,000 sat-hours) took ~11 s locally
 * (2026-10-13, dev-class CPU); Hobby serverless instances are slower and cap
 * request duration at 30 s, so requests are bounded well inside that.
 */
export const PASS_SEARCH_MAX_SATELLITE_HOURS = 720;

export interface GroundTrackResult {
  satelliteNumber: string;
  name: string;
  segments: GroundTrackSegment[];
  windowStart: Date;
  windowEnd: Date;
  sampleIntervalSeconds: number;
  lineage: DataLineage;
}

export async function computeGroundTrack(options: {
  satelliteNumber: string;
  start?: Date;
  hours?: number;
  samples?: number;
  satelliteService?: SatelliteService;
}): Promise<GroundTrackResult> {
  const service = options.satelliteService ?? satelliteService;
  const { record, lineage } = await service.get(options.satelliteNumber);

  const hours = Math.min(options.hours ?? GROUND_TRACK_DEFAULT_HOURS, GROUND_TRACK_MAX_HOURS);
  const samples = Math.min(
    Math.max(options.samples ?? GROUND_TRACK_DEFAULT_SAMPLES, 40),
    1_200,
  ) as number;

  // Window starts at request time so "next N hours" labels are literally
  // accurate about what the chart covers.
  const start = options.start ?? new Date();
  const end = new Date(start.getTime() + hours * 3_600_000);

  const compiled = compileElementSet(record.elementSet);
  const points = sampleTrack(compiled, start, end, samples);
  const segments = buildGroundTrackSegments(points);

  return {
    satelliteNumber: record.catalog.satelliteNumber,
    name: record.catalog.name,
    segments,
    windowStart: start,
    windowEnd: end,
    sampleIntervalSeconds: ((end.getTime() - start.getTime()) / (samples - 1)) / 1000,
    lineage,
  };
}

/** One bounded position sample with both inertial + fixed-frame values. */
export interface PositionSample {
  time: Date;
  /** TEME frame, km. */
  teme: { x: number; y: number; z: number };
  /** Earth-fixed frame, km (TEME→ECF at the sample's time). */
  ecf: { x: number; y: number; z: number };
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  velocityKmS: [number, number, number];
}

/** Compute bounded position samples for one satellite. */
export async function computePositions(options: {
  satelliteNumber: string;
  start?: Date;
  hours?: number;
  samples?: number;
  satelliteService?: SatelliteService;
}): Promise<{ record: SatelliteRecord; samples: PositionSample[]; lineage: DataLineage; characteristics: OrbitalCharacteristics }> {
  const service = options.satelliteService ?? satelliteService;
  const { record, lineage } = await service.get(options.satelliteNumber);

  const hours = Math.min(options.hours ?? 6, 48);
  const count = Math.min(Math.max(options.samples ?? 48, 2), 600);

  const start = options.start ?? new Date();
  const end = new Date(start.getTime() + hours * 3_600_000);
  const compiled = compileElementSet(record.elementSet);
  const samples = samplePositions(compiled, start, end, count);
  const characteristics = computeCharacteristics(compiled);

  return { record, samples, lineage, characteristics };
}

function samplePositions(
  compiled: ReturnType<typeof compileElementSet>,
  start: Date,
  end: Date,
  count: number,
): PositionSample[] {
  const t0 = start.getTime();
  const t1 = end.getTime();
  const step = (t1 - t0) / (count - 1);
  const out: PositionSample[] = [];
  for (let i = 0; i < count; i++) {
    const time = new Date(t0 + i * step);
    const state = propagateState(compiled.satrec, time);
    // TEME→ECF stays in the domain coordinates module — no library access
    // in the application layer.
    const ecf = temeToEcf(state.teme, time);
    out.push({
      time,
      teme: { x: state.teme.positionKm[0], y: state.teme.positionKm[1], z: state.teme.positionKm[2] },
      ecf: { x: ecf.x as number, y: ecf.y as number, z: ecf.z as number },
      latitudeDeg: state.geodetic.latitudeDeg,
      longitudeDeg: state.geodetic.longitudeDeg,
      altitudeKm: state.geodetic.altitudeKm,
      velocityKmS: state.teme.velocityKmS,
    });
  }
  return out;
}

export interface PassSearchEntry {
  satelliteNumber: string;
  name: string;
  passes: PassResult[];
  failure?: { reason: string; message: string };
  /** Undefined when the satellite could not be loaded at all. */
  lineage?: DataLineage;
}

export interface PassSearchServiceResult {
  results: PassSearchEntry[];
  windowStart: Date;
  windowEnd: Date;
  minElevationDeg: number;
}

/**
 * Element-set comparison for two identifiers.
 *
 * Only quantities with a defensible interpretation are reported:
 *  - element-set fields as published (per source record),
 *  - their difference as *data* deltas (not physical orbital change —
 *    different fits/epochs differ for reasons beyond physics),
 *  - propagated position deltas at common instants (SGP4 vs SGP4 against
 *    each element set).
 */
export interface ComparisonResult {
  left: ComparisonSide;
  right: ComparisonSide;
  /** TEME position delta at each common sample instant, km. */
  positionDeltas: Array<{ time: string; deltaKm: number; deltaAltitudeKm: number }>;
  notes: string[];
}

export interface ComparisonSide {
  satelliteNumber: string;
  name: string;
  lineage: DataLineage;
  epoch: string;
  retrievedAt: string;
  tleLine1: string;
  tleLine2: string;
  characteristics: {
    inclinationDeg: number;
    eccentricity: number;
    meanMotionRevPerDay: number;
    periodMinutes: number;
    semiMajorAxisKm: number;
    perigeeAltitudeKm: number;
    apogeeAltitudeKm: number;
  };
}

export async function compareElementSets(options: {
  left: string;
  right: string;
  samples?: number;
  hours?: number;
  satelliteService?: SatelliteService;
}): Promise<ComparisonResult> {
  const service = options.satelliteService ?? satelliteService;
  const hours = Math.min(options.hours ?? 24, GROUND_TRACK_MAX_HOURS);
  const count = Math.min(Math.max(options.samples ?? 24, 2), 200);

  const [left, right] = await Promise.all([
    service.get(options.left),
    service.get(options.right),
  ]);

  const leftCompiled = compileElementSet(left.record.elementSet);
  const rightCompiled = compileElementSet(right.record.elementSet);

  const start = new Date(Math.max(leftCompiled.epoch.getTime(), rightCompiled.epoch.getTime()));
  const end = new Date(start.getTime() + hours * 3_600_000);
  const step = (end.getTime() - start.getTime()) / (count - 1);

  const positionDeltas: ComparisonResult["positionDeltas"] = [];
  for (let i = 0; i < count; i++) {
    const time = new Date(start.getTime() + i * step);
    const l = propagateState(leftCompiled.satrec, time);
    const r = propagateState(rightCompiled.satrec, time);
    const dx = l.teme.positionKm[0] - r.teme.positionKm[0];
    const dy = l.teme.positionKm[1] - r.teme.positionKm[1];
    const dz = l.teme.positionKm[2] - r.teme.positionKm[2];
    positionDeltas.push({
      time: time.toISOString(),
      deltaKm: Math.hypot(dx, dy, dz),
      deltaAltitudeKm: l.geodetic.altitudeKm - r.geodetic.altitudeKm,
    });
  }

  return {
    left: toComparisonSide(left.record, left.lineage, leftCompiled),
    right: toComparisonSide(right.record, right.lineage, rightCompiled),
    positionDeltas,
    notes: [
      "Element-set differences reflect differing epochs, fitting procedures, and observation updates — not necessarily real orbital change.",
      "Position deltas compare two SGP4 predictions (one per element set) against each other; their accuracy is inherited from the underlying data.",
    ],
  };
}

function toComparisonSide(
  record: SatelliteRecord,
  lineage: DataLineage,
  compiled: ReturnType<typeof compileElementSet>,
): ComparisonSide {
  const c = computeCharacteristics(compiled);
  return {
    satelliteNumber: record.catalog.satelliteNumber,
    name: record.catalog.name,
    lineage,
    epoch: record.elementSet.epoch.toISOString(),
    retrievedAt: record.provenance.retrievedAt.toISOString(),
    tleLine1: record.elementSet.line1,
    tleLine2: record.elementSet.line2,
    characteristics: {
      inclinationDeg: c.inclinationDeg,
      eccentricity: c.eccentricity,
      meanMotionRevPerDay: c.meanMotionRevPerDay,
      periodMinutes: c.periodMinutes,
      semiMajorAxisKm: c.semiMajorAxisKm,
      perigeeAltitudeKm: c.perigeeAltitudeKm,
      apogeeAltitudeKm: c.apogeeAltitudeKm,
    },
  };
}

/** Compute passes for up to PASS_SEARCH_MAX_SATELLITES selected satellites. */
export async function computePasses(options: {
  satelliteNumbers: string[];
  observer: ObserverLocation;
  windowStart: Date;
  hours: number;
  minElevationDeg: number;
  satelliteService?: SatelliteService;
}): Promise<PassSearchServiceResult> {
  const service = options.satelliteService ?? satelliteService;

  if (options.satelliteNumbers.length === 0) {
    throw new AppError("validation", "At least one satellite is required");
  }
  if (options.satelliteNumbers.length > PASS_SEARCH_MAX_SATELLITES) {
    throw new AppError("validation", `Pass prediction is limited to ${PASS_SEARCH_MAX_SATELLITES} satellites per request`);
  }

  const windowStart = options.windowStart;
  const windowHours = Math.min(options.hours, PASS_SEARCH_MAX_HOURS);
  const budget = options.satelliteNumbers.length * windowHours;
  if (budget > PASS_SEARCH_MAX_SATELLITE_HOURS) {
    throw new AppError(
      "validation",
      `Pass prediction is compute-bounded: satellites × window-hours must be at most ${PASS_SEARCH_MAX_SATELLITE_HOURS} (requested ${budget}). Reduce the satellite count or the window.`,
      { details: { budget, max: PASS_SEARCH_MAX_SATELLITE_HOURS } },
    );
  }
  const windowEnd = new Date(windowStart.getTime() + windowHours * 3_600_000);

  const params: PassSearchParams = {
    compiled: [],
    observer: options.observer,
    windowStart,
    windowEnd,
    minElevationDeg: options.minElevationDeg,
  };

  const failures: PassSearchEntry[] = [];
  const successes: PassSearchEntry[] = [];

  await Promise.all(
    options.satelliteNumbers.map(async (satelliteNumber) => {
      try {
        const { record, lineage } = await service.get(satelliteNumber);
        // Pass accuracy degrades quickly beyond the element-set epoch + a day
        // for LEO objects; the domain-level warning is surfaced via lineage
        // (stale data still computes, but is labelled).
        const compiled = compileElementSet(record.elementSet);
        params.compiled.push(compiled);
        successes.push({
          satelliteNumber,
          name: record.catalog.name,
          passes: [],
          lineage,
        });
      } catch (error) {
        failures.push({
          satelliteNumber,
          name: "",
          passes: [],
          failure: {
            reason: error instanceof AppError ? error.kind : "internal",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }),
  );

  const finderResults = findPasses({
    compiled: params.compiled,
    observer: options.observer,
    windowStart,
    windowEnd,
    minElevationDeg: options.minElevationDeg,
  });

  const byNumber = new Map(finderResults.map((r) => [r.satelliteNumber, r]));
  const merged: PassSearchEntry[] = successes.map((entry) => {
    const found = byNumber.get(entry.satelliteNumber);
    return {
      satelliteNumber: entry.satelliteNumber,
      name: entry.name,
      passes: found?.passes ?? [],
      failure: found?.failure ?? entry.failure,
      lineage: entry.lineage,
    };
  });

  return {
    results: [...merged, ...failures],
    windowStart,
    windowEnd,
    minElevationDeg: options.minElevationDeg,
  };
}
