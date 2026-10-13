/**
 * Approximate orbital characteristics derived from an element set.
 *
 * Quantities reported here are derivable *from the element set itself* and
 * labelled approximations: they inherit all the limits of SGP4 input data and
 * are documented as such in the methodology page. Nothing invented: fields we
 * cannot compute report `undefined` rather than a guess.
 *
 * Physical constant: Earth's mean equatorial radius used by SGP4's own
 * WGS-72 constants (6378.135 km, from the SGP4 reference implementation).
 */

import type { CompiledElementSet } from "./propagation";

/** Earth equatorial radius retained by the SGP4 model (km), WGS-72 value. */
export const EARTH_EQUATORIAL_RADIUS_KM = 6_378.135;

export interface OrbitalCharacteristics {
  inclinationDeg: number;
  eccentricity: number;
  meanMotionRevPerDay: number;
  /** [0, 1] — sometimes reported in TLE as an all-digit-with-implied-decimal string. */
  /** Approximate period in minutes; 2π/mean-motion in the Keplerian sense. */
  periodMinutes: number;
  argPerigeeDeg: number;
  /** Semi-major axis from mean motion & μ: a = (μ / n²)^(1/3); km. */
  semiMajorAxisKm: number;
  /** a(1-e) - R_E mean perigee altitude above the equatorial ellipsoid (km). */
  perigeeAltitudeKm: number;
  /** a(1+e) - R_E mean apogee altitude above the equatorial ellipsoid (km). */
  apogeeAltitudeKm: number;
  /** Revolutions completed at the element-set epoch (per TLE line 2). */
  revolutionNumberAtEpoch: number | null;
}

/**
 * Standard gravitational parameter of the Earth used by the TLE's own
 * two-body close forms: μ = 398600.799640… km³/s².
 * Source: derived constants actually in SGP4's WGS-72 mu/xke pairs.
 */
const MU_EARTH_KM3_S2 = 398_600.7996;

export function computeCharacteristics(compiled: CompiledElementSet): OrbitalCharacteristics {
  const satrec = compiled.satrec;
  // satellite.js stores mean motion (rad/min), inclination/ecc/argp in radians.
  const nRadPerMin = satrec.no;
  const meanMotionRevPerDay = (nRadPerMin * 1440) / (2 * Math.PI);
  const e = satrec.ecco ?? 0;
  const incDeg = (satrec.inclo * 180) / Math.PI;
  const argPerigeeDeg = (satrec.argpo * 180) / Math.PI;

  // Keplerian two-body approximation from mean motion:
  // n = sqrt(μ / a³) ⇒ a = (μ/n²)^(1/3), n in rad/s here.
  const nRadPerSec = nRadPerMin / 60;
  const aKm = Math.cbrt(MU_EARTH_KM3_S2 / (nRadPerSec * nRadPerSec));
  const periodMinutes = (2 * Math.PI) / nRadPerMin;

  // Revolution number at epoch comes straight from TLE line 2
  // (columns 63–68) when present; not every record carries it.
  const revRaw = compiled.elementSet.line2.slice(63, 68).trim();
  const revAtEpoch = /^\d+$/.test(revRaw) ? Number(revRaw) : null;

  return {
    inclinationDeg: incDeg,
    eccentricity: e,
    meanMotionRevPerDay,
    periodMinutes,
    argPerigeeDeg,
    semiMajorAxisKm: aKm,
    perigeeAltitudeKm: aKm * (1 - e) - EARTH_EQUATORIAL_RADIUS_KM,
    apogeeAltitudeKm: aKm * (1 + e) - EARTH_EQUATORIAL_RADIUS_KM,
    revolutionNumberAtEpoch: revAtEpoch,
  };
}
