/**
 * SGP4 adapter - the only module that imports `satellite.js`.
 *
 * Conventions owned here so the rest of the domain never touches library
 * internals:
 *  - input: a validated element set (TLE lines) and a target UTC Date
 *  - output: TEME position/velocity (km, km/s) and WGS-72 geodetic coords
 *  - time: minutes from element-set epoch, the TLE/SGP4 convention
 */

import {
  eciToGeodetic,
  gstime,
  sgp4,
  twoline2satrec,
  type SatRec,
  type SatRecError,
} from "satellite.js";
import { AppError } from "@/lib/errors";
import type { Kilometers, Radians } from "@/lib/units";
import type {
  GeodeticPosition,
  PropagationFailureReason,
  TemEState,
  TwoLineElementSet,
} from "@/domain/orbit/types";

const MS_PER_MINUTE = 60_000;

/** satellite.js SatRecError enum values → domain failure reasons. */
const FAILURE_REASON_BY_CODE: Record<number, PropagationFailureReason> = {
  [1]: "mean-eccentricity-out-of-range",
  [2]: "mean-motion-below-zero",
  [3]: "perturbed-eccentricity-out-of-range",
  [4]: "semi-latus-rectum-below-zero",
  [6]: "decayed",
};

function toState(satrec: SatRec, date: Date): { teme: TemEState; geodetic: GeodeticPosition } {
  const minutesFromEpoch = (date.getTime() - satrecEpochMs(satrec)) / MS_PER_MINUTE;
  const result = sgp4(satrec, minutesFromEpoch) as
    | { position: false; velocity: false }
    | { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
    | null;

  // satellite.js returns a falsy result or `{ position: false }` (or NaNs)
  // on SGP4 error codes.
  if (
    result === null ||
    result.position === false ||
    !Number.isFinite(result.position.x)
  ) {
    const code: number = typeof satrec.error === "number" ? satrec.error : 0;
    const reason = FAILURE_REASON_BY_CODE[code] ?? "mean-motion-below-zero";
    throw new AppError("propagation", `SGP4 propagation failed for ${satrec.satnum} at ${date.toISOString()}`, {
      details: { reason, code },
    });
  }

  const position = result.position;
  const velocity = result.velocity;

  const teme: TemEState = {
    frame: "teme",
    positionKm: [position.x, position.y, position.z],
    velocityKmS: [velocity.x, velocity.y, velocity.z],
  };

  const gmst: Radians = gstime(date);
  const geodetic = eciToGeodetic(result.position, gmst);

  return {
    teme,
    geodetic: {
      latitudeDeg: (geodetic.latitude * 180) / Math.PI,
      longitudeDeg: (geodetic.longitude * 180) / Math.PI,
      altitudeKm: geodetic.height as Kilometers,
    },
  };
}

/** satrec epochs derive from the parse step; satellite.js stores the full Julian date. */
function satrecEpochMs(satrec: SatRec): number {
  // jdsatepoch holds the complete Julian date (integer + fraction) in v7.
  return julianToMs(satrec.jdsatepoch);
}

function julianToMs(jd: number): number {
  return (jd - 2_440_587.5) * 86_400_000;
}

/**
 * Compile a validated element set into a reusable SGP4 record.
 * Throws AppError("propagation") if the element set is numerically unusable.
 */
export function createSatrec(elementSet: TwoLineElementSet): SatRec {
  let satrec: SatRec;
  try {
    satrec = twoline2satrec(elementSet.line1, elementSet.line2);
  } catch (error) {
    throw new AppError("propagation", "Could not initialize SGP4 from the element set", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  // Probe-propagate at epoch: catches malformed coefficients immediately
  // instead of at first display time.
  const probe = sgp4(satrec, 0) as { position: false; velocity: false } | { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } } | null;
  if (probe === null || probe.position === false || !Number.isFinite(probe.position.x)) {
    throw new AppError("propagation", "The element set is not propagatable (SGP4 error at epoch)", {
      details: { reason: FAILURE_REASON_BY_CODE[typeof satrec.error === "number" ? satrec.error : 0] ?? "mean-motion-below-zero" },
    });
  }
  return satrec;
}

/** Propagate a compiled satrec to a UTC instant. */
export function propagateState(satrec: SatRec, date: Date): { teme: TemEState; geodetic: GeodeticPosition } {
  return toState(satrec, date);
}

/** The element-set epoch as a UTC Date (derived from the compiled satrec). */
export function satrecEpochDate(satrec: SatRec): Date {
  return new Date(satrecEpochMs(satrec));
}

export type { SatRec, SatRecError };
