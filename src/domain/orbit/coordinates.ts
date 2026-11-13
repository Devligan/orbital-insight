/**
 * Coordinate-frame and observer-geometry conversions.
 *
 * TEME→ECF and ECF→look-angle math delegate to satellite.js (via the adapter's
 * conventions — km, radians-in, degrees-out documented here). Time is UTC.
 */

import { eciToEcf, ecfToLookAngles, degreesToRadians, gstime, type SatRec } from "satellite.js";
import { RAD2DEG, type Degrees, type Kilometers, type Radians } from "@/lib/units";
import type { GeodeticPosition, TemEState } from "@/domain/orbit/types";

export interface LookAngle {
  azimuthDeg: Degrees;
  /** Elevation above the observer's local horizon, negative = below horizon. */
  elevationDeg: Degrees;
  /** Line-of-sight range (km). */
  rangeKm: Kilometers;
}

/** WGS-72 ellipoid is the same model satellite.js's geodetic conversion uses. */
export interface ObserverLocation {
  latitudeDeg: Degrees;
  longitudeDeg: Degrees;
  /**
   * Height above mean sea level (km). Treated as geodetic height; the
   * geoid/ellipsoid difference (max ~100 m) is documented in the methodology
   * page and is negligible for pass timing at their typical accuracy.
   */
  heightKm: Kilometers;
}

/** Convert TEME state to ECF (ECEF) km at the given UTC instant. */
export function temeToEcf(teme: TemEState, date: Date): { x: Kilometers; y: Kilometers; z: Kilometers } {
  const gmst = gstime(date);
  const ecf = eciToEcf(
    { x: teme.positionKm[0], y: teme.positionKm[1], z: teme.positionKm[2] },
    gmst,
  );
  return { x: ecf.x as Kilometers, y: ecf.y as Kilometers, z: ecf.z as Kilometers };
}

/** Greenwich mean sidereal time (radians) at a UTC instant: the TEME→ECF rotation angle. */
export function gmstRadians(date: Date): number {
  return gstime(date);
}

/** Compute a topocentric look angle from an ECF satellite position. */
export function ecfToLookAngle(observer: ObserverLocation, satEcf: { x: Kilometers; y: Kilometers; z: Kilometers }): LookAngle {
  const result = ecfToLookAngles(
    {
      longitude: degreesToRadians(observer.longitudeDeg),
      latitude: degreesToRadians(observer.latitudeDeg),
      height: observer.heightKm,
    },
    satEcf,
  );
  return {
    azimuthDeg: (result.azimuth * RAD2DEG) as Degrees,
    elevationDeg: (result.elevation * RAD2DEG) as Degrees,
    rangeKm: result.rangeSat as Kilometers,
  };
}


export type { SatRec };
