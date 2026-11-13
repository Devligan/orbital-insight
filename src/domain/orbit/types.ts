/**
 * Orbital domain types.
 *
 * Concepts are modelled explicitly, with units in field names where ambiguity
 * would be realistic (`meanMotionRevPerDay` vs a hypothetical rad/min internal
 * value). Frames are named: TLE/OMM element sets are fit to the TEME frame;
 * TEME→ECF→geodetic conversions happen only in the coordinate module.
 */

import type { Degrees, Kilometers, KilometersPerSecond } from "@/lib/units";

/** NORAD satellite catalog number, as printed in TLE columns 3–7. */
export type SatelliteNumber = string;

/** How an element set reached the application. */
export type ElementSetSource = "celestrak";

/**
 * A parsed, checksum-validated two-line element set.
 * Epoch is the exact TLE epoch (UT instant derived per published TLE rules).
 */
export interface TwoLineElementSet {
  format: "tle";
  satelliteNumber: SatelliteNumber;
  classification: "U" | "C" | "S" | "O";
  internationalDesignator: string | null;
  epoch: Date;
  line1: string;
  line2: string;
}

/**
 * Source header metadata attached to an element set by the retrieval layer.
 * `retrievedAt` is when *this application* obtained it; `serverEpoch` etc.
 * come from provider response metadata when available.
 */
export interface ElementSetProvenance {
  source: ElementSetSource;
  retrievedAt: Date;
  /** CelesTrak sup groups the record came from, when applicable. */
  group?: string;
}

/** A satellite catalog entry (catalog-level data, no elements). */
export interface SatelliteCatalogEntry {
  satelliteNumber: SatelliteNumber;
  name: string;
  group?: string;
}

/** Satellite + its current element set + provenance. */
export interface SatelliteRecord {
  catalog: SatelliteCatalogEntry;
  elementSet: TwoLineElementSet;
  provenance: ElementSetProvenance;
}

/** TEME (ECI) position/velocity produced by SGP4, in km and km/s. */
export interface TemEState {
  frame: "teme";
  positionKm: [Kilometers, Kilometers, Kilometers];
  velocityKmS: [KilometersPerSecond, KilometersPerSecond, KilometersPerSecond];
}

/** WGS-72 ellipsoidal geodetic position. */
export interface GeodeticPosition {
  latitudeDeg: Degrees;
  longitudeDeg: Degrees;
  /** Ellipsoidal height above the WGS-72 reference ellipsoid (km). */
  altitudeKm: Kilometers;
}

/** Propagated state as SGP4 + one frame conversion. */
export interface PropagatedState {
  time: Date;
  teme: TemEState;
  geodetic: GeodeticPosition;
}

/** Reason a propagation call failed, mapped from satellite.js SatRec.error. */
export type PropagationFailureReason =
  | "mean-eccentricity-out-of-range"
  | "mean-motion-below-zero"
  | "perturbed-eccentricity-out-of-range"
  | "semi-latus-rectum-below-zero"
  | "decayed";

/** A discrete point along a propagated path. */
export interface TrackPoint {
  time: Date;
  positionKm: [Kilometers, Kilometers, Kilometers];
  geodetic: GeodeticPosition;
}

/** Ground track segment; segments avoid dateline-crossing artifacts. */
export interface GroundTrackSegment {
  points: GeodeticPoint[];
}

export interface GeodeticPoint {
  latitudeDeg: Degrees;
  longitudeDeg: Degrees;
  time: Date;
  altitudeKm: Kilometers;
}
