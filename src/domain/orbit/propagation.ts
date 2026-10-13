/**
 * Propagation service (domain level).
 *
 * Compiles an element set once, then produces propagated states at requested
 * instants and bounded sample tracks. All timestamps are UTC.
 */

import { AppError } from "@/lib/errors";
import type { Kilometers, Minutes } from "@/lib/units";
import type {
  PropagatedState,
  TwoLineElementSet,
  GeodeticPoint,
} from "./types";
import { createSatrec, propagateState, satrecEpochDate, type SatRec } from "@/integrations/sgp4/adapter";

export interface CompiledElementSet {
  satrec: SatRec;
  elementSet: TwoLineElementSet;
  epoch: Date;
}

/** Compile once per element set (memoize per request, not per point). */
export function compileElementSet(elementSet: TwoLineElementSet): CompiledElementSet {
  const satrec = createSatrec(elementSet);
  return { satrec, elementSet, epoch: satrecEpochDate(satrec) };
}

/** Minutes from the element-set epoch. */
export function minutesFromEpoch(compiled: CompiledElementSet, time: Date): Minutes {
  return (time.getTime() - compiled.epoch.getTime()) / 60_000;
}

/** Propagate to a single UTC instant. */
export function propagateTo(compiled: CompiledElementSet, time: Date): PropagatedState {
  const { teme, geodetic } = propagateState(compiled.satrec, time);
  return { time, teme, geodetic };
}

/**
 * Sample the path at even intervals (inclusive of both ends).
 * Bounds must be checked by callers/API contracts; the domain caps count.
 */
export const MAX_TRACK_POINTS = 5_000;

export function sampleTrack(compiled: CompiledElementSet, start: Date, end: Date, count: number): GeodeticPoint[] {
  if (count < 2) throw new AppError("validation", "Track sampling requires at least 2 points");
  if (count > MAX_TRACK_POINTS) {
    throw new AppError("validation", `Track sampling limited to ${MAX_TRACK_POINTS} points`);
  }
  const t0 = start.getTime();
  const t1 = end.getTime();
  if (t1 < t0) throw new AppError("validation", "Track end precedes start");
  const step = (t1 - t0) / (count - 1);
  const points: GeodeticPoint[] = [];
  for (let i = 0; i < count; i++) {
    const time = new Date(t0 + i * step);
    const state = propagateState(compiled.satrec, time);
    points.push({
      time,
      latitudeDeg: state.geodetic.latitudeDeg,
      longitudeDeg: state.geodetic.longitudeDeg,
      altitudeKm: state.geodetic.altitudeKm as Kilometers,
    });
  }
  return points;
}
