/**
 * Sun + light geometry for pass visibility.
 *
 * Answers, from orbital mechanics alone, the two questions that decide
 * whether a pass is actually visible from the ground:
 *   1. Is the satellite above Earth's shadow (in sunlight)?
 *   2. Is the observer's sky dark enough to see it?
 * It also provides the sun position needed for a phase-corrected brightness
 * estimate (see ./visibility in the passes domain).
 *
 * Accuracy contract (documented and honest):
 *  - Sun position: low-precision Astronomical Almanac approximation,
 *    ~0.01° in direction — far better than the elevation thresholds we
 *    compare against. Never used for timing.
 *  - Shadow: cylindrical umbra (Earth radius, no penumbra/umbra-lobe
 *    geometry, no atmosphere). Penumbra timing is off by seconds; for the
 *    lit/unlit decision at 400+ km it is negligible.
 */

import { eciToEcf, ecfToLookAngles, degreesToRadians, gstime } from "satellite.js";
import { RAD2DEG, type Degrees } from "@/lib/units";
import type { ObserverLocation } from "@/domain/orbit/coordinates";

/** Days since J2000 (UT1≈UTC for this accuracy; difference ≤ minutes). */
function daysSinceJ2000(date: Date): number {
  // 2_440_587.5 JD = 1970-01-01 UTC; J2000.0 = 2_451_545.0 JD.
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  return jd - 2_451_545.0;
}

const DEG = Math.PI / 180;
const AU_KM = 149_597_870.7;
/** WGS-72 equatorial radius (matches satellite.js's geodetic model). */
export const EARTH_RADIUS_KM = 6_378.137;

/** Normalized hours-of-day offset is irrelevant: everything is UTC-driven. */

export interface EciVectorKm {
  x: number;
  y: number;
  z: number;
}

/**
 * Geocentric sun position in ECI, km. Equatorial frame (same TEME axes the
 * rest of this project uses — TEME and true-of-date equatorial differ by
 * arcseconds for this purpose).
 */
export function sunEciKm(date: Date): EciVectorKm {
  const n = daysSinceJ2000(date);
  const meanLongitudeDeg = (280.460 + 0.9856474 * n) % 360;
  const meanAnomalyDeg = (357.528 + 0.9856003 * n) % 360;
  const obliquityDeg = 23.439 - 0.0000004 * n;

  const g = meanAnomalyDeg * DEG;
  const lambdaDeg = meanLongitudeDeg + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
  const rAu = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);

  const lambda = lambdaDeg * DEG;
  const epsilon = obliquityDeg * DEG;
  const r = rAu * AU_KM;

  return {
    x: r * Math.cos(lambda),
    y: r * Math.cos(epsilon) * Math.sin(lambda),
    z: r * Math.sin(epsilon) * Math.sin(lambda),
  };
}

/** The sun's elevation above an observer's local horizon, degrees (−90..90). */
export function sunElevationDegAt(date: Date, observer: ObserverLocation): Degrees {
  const gmst = gstime(date);
  const sun = sunEciKm(date);
  const ecf = eciToEcf(sun, gmst);
  // A far-away point in the sun's direction behaves like any satellite for
  // az/el purposes; the range number is meaningless for the sun and unused.
  const look = ecfToLookAngles(
    {
      longitude: degreesToRadians(observer.longitudeDeg),
      latitude: degreesToRadians(observer.latitudeDeg),
      height: observer.heightKm,
    },
    ecf,
  );
  return (look.elevation * RAD2DEG) as Degrees;
}

/** Unit vector from Earth's center toward the sun. */
export function sunDirection(date: Date): EciVectorKm {
  const sun = sunEciKm(date);
  const norm = Math.hypot(sun.x, sun.y, sun.z);
  return { x: sun.x / norm, y: sun.y / norm, z: sun.z / norm };
}

/**
 * True when the satellite is in direct sunlight (cylindrical shadow test):
 * a satellite is eclipsed iff it lies behind Earth (anti-solar side) and
 * its perpendicular distance to the sun–Earth line is below Earth's radius.
 * `satEci` is a geocentric ECI position in km.
 */
export function satelliteInSunlight(satEci: EciVectorKm, date: Date): boolean {
  const s = sunDirection(date);
  const axial = satEci.x * s.x + satEci.y * s.y + satEci.z * s.z;
  if (axial >= 0) return true; // sun side of the terminator plane
  const perpX = satEci.x - axial * s.x;
  const perpY = satEci.y - axial * s.y;
  const perpZ = satEci.z - axial * s.z;
  return Math.hypot(perpX, perpY, perpZ) >= EARTH_RADIUS_KM;
}

/**
 * Phase angle φ: the angle at the satellite between the direction to the
 * sun and the direction to the observer, degrees (0..180). φ = 0 → the
 * observer sees the satellite's fully lit face; φ = 90° → half.
 * Both inputs are geocentric ECI positions in km.
 */
export function phaseAngleDeg(satEci: EciVectorKm, observerEci: EciVectorKm, date: Date): Degrees {
  const sun = sunEciKm(date);
  // Source vectors measured FROM the satellite (km scale, not unit vectors
  // — the earlier unit-vector mix-up made the angle degenerate to ~0).
  const toSun = { x: sun.x - satEci.x, y: sun.y - satEci.y, z: sun.z - satEci.z };
  const toObs = { x: observerEci.x - satEci.x, y: observerEci.y - satEci.y, z: observerEci.z - satEci.z };
  const n1 = Math.hypot(toSun.x, toSun.y, toSun.z);
  const n2 = Math.hypot(toObs.x, toObs.y, toObs.z);
  if (n1 === 0 || n2 === 0) return 0 as Degrees;
  const dot = (toSun.x * toObs.x + toSun.y * toObs.y + toSun.z * toObs.z) / (n1 * n2);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * RAD2DEG) as Degrees;
}

/**
 * Temporary helper — observer position as a geocentric ECI km vector at a
 * given instant (rotates the observer's ECF location into ECI). Used for
 * phase-angle geometry; simplicity over sub-km rigor.
 */
export function observerEciKm(observer: ObserverLocation, date: Date): EciVectorKm {
  const gmst = gstime(date);
  const lon = observer.longitudeDeg * DEG;
  const lat = observer.latitudeDeg * DEG;
  // maintains the WGS-72 convention used everywhere in this project
  const cos = Math.cos(lat);
  const radius = EARTH_RADIUS_KM + observer.heightKm;
  // ECF → ECI is a rotation by +GMST about Z.
  const cosG = Math.cos(gmst);
  const sinG = Math.sin(gmst);
  const ex = radius * cos * Math.cos(lon);
  const ey = radius * cos * Math.sin(lon);
  const ez = radius * Math.sin(lat);
  return { x: ex * cosG - ey * sinG, y: ex * sinG + ey * cosG, z: ez };
}
