import type { Degrees, Kilometers } from "@/lib/units";
import type { ObserverLocation } from "@/domain/orbit/coordinates";

export interface PassTiming {
  /** First instant above the elevation threshold (UTC). */
  rise: Date | null;
  /** Instant of maximum elevation within the pass (UTC). */
  max: Date;
  /** Elevation at the apex. */
  maxElevationDeg: Degrees;
  /** Last instant above the elevation threshold (UTC). */
  set: Date | null;
}

export interface PassResult extends PassTiming {
  /** Epochs when the true crossing points were just outside the window. */
  truncated: "rise" | "set" | "both" | null;
  azimuthAtRiseDeg: Degrees | null;
  azimuthAtMaxDeg: Degrees;
  azimuthAtSetDeg: Degrees | null;
}

export interface SatellitePasses {
  satelliteNumber: string;
  name: string;
  passes: PassResult[];
  /** Present if the element set could not be propagated across the window. */
  failure?: { reason: string; message: string };
}

export interface PassSearchRequest {
  observer: ObserverLocation;
  satelliteNumbers: string[];
  windowStart: Date;
  windowEnd: Date;
  minElevationDeg: Degrees;
  /** Height above mean sea level; kept on observer for documentation. */
  observerHeightKm?: Kilometers;
}
