/**
 * Shape shared between server analysis output and the visualization layer.
 * Kept explicit so the globe component consumes exactly what the API
 * returns (thinking in ECF km at each sample, plus derived display values).
 */

export interface EciSample {
  time: string; // ISO 8601 UTC
  /** TEME frame position, km. */
  teme: { x: number; y: number; z: number };
  /** Earth-fixed frame position, km (TEME→ECF at the sample's time). */
  ecf: { x: number; y: number; z: number };
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}
