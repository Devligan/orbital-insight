/**
 * Pass prediction for a ground observer.
 *
 * Method (documented in /methodology page and README):
 *  1. Sweep the search window at a coarse step, computing the observer-side
 *     elevation each step via SGP4 + TEME→ECF→look-angles.
 *  2. Detect above-threshold crossings at the coarse resolution, tracking the
 *     last coarse instant below / above the threshold on each side.
 *  3. Refine each rise/set crossing with bisection to better than 1 second.
 *  4. Refine the pass apex with a ternary search to < 0.05°.
 *  5. Record rise/set azimuths at the refined instants.
 *
 * A pass that is already above threshold at window start (or that never sets
 * inside the window) is reported with `truncated` — we cannot know when it
 * rose/set; honesty over guesses.
 */

import { AppError } from "@/lib/errors";
import { normalizeAngle2Pi, type Degrees } from "@/lib/units";
import { ecfToLookAngle, temeToEcf, type ObserverLocation } from "@/domain/orbit/coordinates";
import { propagateState } from "@/integrations/sgp4/adapter";
import type { CompiledElementSet } from "@/domain/orbit/propagation";
import type { PassResult, SatellitePasses } from "./types";

/** Coarse sweep step (seconds). 30 s ≲ 0.14° of arc for a 12-rev/day LEO orbit. */
const COARSE_STEP_SECONDS = 30;
/** Bisection tolerance (ms). */
const CROSS_BISECTION_TOLERANCE_MS = 500;
/** Apex ternary-search iteration cap for < 0.05° at LEO speeds. */
const APEX_REFINE_ITERATIONS = 40;

const MS_PER_SECOND = 1000;
const MAX_WINDOW_MS = 30 * 86_400_000;

export interface PassSearchParams {
  compiled: CompiledElementSet[];
  observer: ObserverLocation;
  windowStart: Date;
  windowEnd: Date;
  minElevationDeg: Degrees;
  /** Coarse sweep step seconds (default 30). Callers may tune. */
  coarseStepSeconds?: number;
}

export function findPasses(params: PassSearchParams): SatellitePasses[] {
  validateWindow(params);
  return params.compiled.map((sat) => passesForSatellite(sat, params));
}

function validateWindow(params: PassSearchParams): void {
  if (params.windowEnd.getTime() <= params.windowStart.getTime()) {
    throw new AppError("validation", "Search window end must be after start");
  }
  if (params.windowEnd.getTime() - params.windowStart.getTime() > MAX_WINDOW_MS) {
    throw new AppError("validation", "Search window is limited to 30 days");
  }
  const step = params.coarseStepSeconds ?? COARSE_STEP_SECONDS;
  if (step <= 0) throw new AppError("validation", "Sampling step must be positive");
  if ((step * MS_PER_SECOND) * 2 > params.windowEnd.getTime() - params.windowStart.getTime()) {
    throw new AppError("validation", "Search window is shorter than two sampling steps");
  }
  if (params.minElevationDeg < 0 || params.minElevationDeg > 85) {
    throw new AppError("validation", "Minimum elevation must be within [0, 85] degrees");
  }
}

function lookAt(sat: CompiledElementSet, observer: ObserverLocation, time: Date): { elevationDeg: Degrees; azimuthDeg: Degrees } {
  const state = propagateState(sat.satrec, time);
  const look = ecfToLookAngle(observer, temeToEcf(state.teme, time));
  return { elevationDeg: look.elevationDeg, azimuthDeg: look.azimuthDeg };
}

interface PassBoundaryDates {
  /** First coarse instant above threshold (or windowStart if truncated). */
  firstAbove: Date;
  /** Last coarse instant above threshold before the pass ends. */
  lastAbove: Date;
  /** First coarse instant below threshold after the pass (or windowEnd when truncated). */
  firstBelow: Date;
}

function passesForSatellite(sat: CompiledElementSet, params: PassSearchParams): SatellitePasses {
  const stepMs = (params.coarseStepSeconds ?? COARSE_STEP_SECONDS) * MS_PER_SECOND;
  const minElev = params.minElevationDeg;

  try {
    const passes: PassResult[] = [];

    let current = params.windowStart;
    let currentElev = lookAt(sat, params.observer, current).elevationDeg;
    let above = currentElev >= minElev;
    // Boundary bookkeeping: last time below, first time above for the open pass.
    let lastBelowOrStart: Date = current;
    let firstAbove: Date = above ? current : current; // set when a pass opens or at window start

    while (current.getTime() < params.windowEnd.getTime()) {
      const next = new Date(Math.min(current.getTime() + stepMs, params.windowEnd.getTime()));
      const nextElev = lookAt(sat, params.observer, next).elevationDeg;

      if (!above && nextElev >= minElev) {
        // Crossing up: [lastBelowOrStart, next] brackets the rise.
        above = true;
        firstAbove = next;
        lastBelowOrStart = current;
      } else if (above && nextElev < minElev) {
        // Crossing down: [current (last above), next (first below)] brackets the set.
        const boundary: PassBoundaryDates = {
          firstAbove: firstAbove.getTime() === current.getTime() ? current : firstAbove,
          lastAbove: current,
          firstBelow: next,
        };
        passes.push(closePass(sat, params, boundary, minElev));
        above = false;
        lastBelowOrStart = current;
      }

      current = next;
      currentElev = nextElev;
    }
    void currentElev;

    if (above) {
      // Window ended while above threshold: pass apex is inside, rise/set may be truncated.
      const boundary: PassBoundaryDates = {
        firstAbove: above ? firstAbove : current,
        lastAbove: current,
        firstBelow: params.windowEnd,
      };
      const pass = closePass(sat, params, { ...boundary, firstAbove: above ? firstAbove : params.windowStart }, minElev);
      pass.truncated = firstAbove.getTime() === params.windowStart.getTime() ? "both" : "rise";
      passes.push(pass);
    }

    return { satelliteNumber: sat.elementSet.satelliteNumber, name: "", passes };
  } catch (error) {
    // Propagation failures mid-window are real: report per-satellite failure
    // rather than fabricating an empty result.
    const message = error instanceof AppError ? error.message : String(error);
    return {
      satelliteNumber: sat.elementSet.satelliteNumber,
      name: "",
      passes: [],
      failure: { reason: "propagation", message },
    };
  }
}

function closePass(sat: CompiledElementSet, params: PassSearchParams, boundary: PassBoundaryDates, minElev: Degrees): PassResult {
  const { firstAbove, lastAbove, firstBelow } = boundary;
  const windowStart = params.windowStart;
  const windowEnd = params.windowEnd;
  const stepSec = params.coarseStepSeconds ?? COARSE_STEP_SECONDS;

  const rise: Date | null =
    firstAbove.getTime() <= windowStart.getTime()
      ? null
      : bisectCrossing(sat, params.observer, new Date(firstAbove.getTime() - stepSec * MS_PER_SECOND), firstAbove, minElev, "rising");
  const set: Date | null =
    firstBelow.getTime() >= windowEnd.getTime()
      ? null
      : bisectCrossing(sat, params.observer, lastAbove, firstBelow, minElev, "setting");

  const searchStart = rise ?? firstAbove;
  const searchEnd = set ?? firstBelow;
  const { time: maxTime, elevation: maxElev } = refineApex(sat, params.observer, searchStart, searchEnd);

  const truncated =
    rise === null && set === null ? "both" : rise === null ? "rise" : set === null ? "set" : null;

  return {
    rise,
    max: maxTime,
    maxElevationDeg: maxElev,
    set,
    truncated: truncated,
    azimuthAtRiseDeg: rise ? lookAt(sat, params.observer, rise).azimuthDeg : null,
    azimuthAtMaxDeg: lookAt(sat, params.observer, maxTime).azimuthDeg,
    azimuthAtSetDeg: set ? lookAt(sat, params.observer, set).azimuthDeg : null,
  };
}

/**
 * Bisect an elevation-threshold crossing inside [t0, t1].
 * `rising`: elevation goes low→high across the window (rise crossing);
 * `setting`: high→low. Returns the refined boundary instant.
 */
function bisectCrossing(
  sat: CompiledElementSet,
  observer: ObserverLocation,
  t0: Date,
  t1: Date,
  minElev: Degrees,
  direction: "rising" | "setting",
): Date {
  const elevAt = (ms: number) => lookAt(sat, observer, new Date(ms)).elevationDeg;
  let lo = t0.getTime();
  let hi = t1.getTime();

  while (hi - lo > CROSS_BISECTION_TOLERANCE_MS) {
    const mid = Math.floor((lo + hi) / 2);
    if (direction === "rising") {
      // lo is below threshold, hi above; move the lo bound up inside.
      if (elevAt(mid) >= minElev) hi = mid;
      else lo = mid;
    } else {
      // lo is above threshold, hi below; move the hi bound down inside.
      if (elevAt(mid) >= minElev) lo = mid;
      else hi = mid;
    }
  }
  // Report the first ms where the state holds (sub-second by tolerance).
  return new Date(direction === "rising" ? hi : lo);
}

/**
 * Ternary refinement of the pass apex, treating elevation as unimodal over
 * the pass bracket (true for LEO topocentric elevation rise/set shapes).
 */
function refineApex(sat: CompiledElementSet, observer: ObserverLocation, t0: Date, t1: Date): { time: Date; elevation: Degrees } {
  let lo = t0.getTime();
  let hi = t1.getTime();

  for (let i = 0; i < APEX_REFINE_ITERATIONS && hi - lo > 250; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const e1 = lookAt(sat, observer, new Date(m1)).elevationDeg;
    const e2 = lookAt(sat, observer, new Date(m2)).elevationDeg;
    if (e1 < e2) lo = m1;
    else hi = m2;
  }
  const time = new Date(Math.floor((lo + hi) / 2));
  return { time, elevation: lookAt(sat, observer, time).elevationDeg };
}
