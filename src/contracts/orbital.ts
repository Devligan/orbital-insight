/**
 * Zod schemas shared across trust boundaries:
 *  - CelesTrak GP (OMM) JSON responses (external provider → server)
 *  - API request bodies/query strings (client → server)
 *  - API response payloads (server → client)
 *
 * kept at `src/contracts` so providers, services, and routes share one
 * authoritative definition instead of restating field lists.
 */

import { z } from "zod";

/** CelesTrak GP JSON "satcat + OMM" record (FORMAT=json). */
export const gpRecordSchema = z.object({
  OBJECT_NAME: z.string().min(1),
  OBJECT_ID: z.string().regex(/^[0-9]{4}-[0-9]{3}[A-Z]$|^[0-9]{8}$/).optional(),
  EPOCH: z.string().min(1),
  MEAN_MOTION: z.number().positive(),
  ECCENTRICITY: z.number().min(0).max(1),
  INCLINATION: z.number().min(0).max(180),
  RA_OF_ASC_NODE: z.number(),
  ARG_OF_PERICENTER: z.number(),
  MEAN_ANOMALY: z.number(),
  BSTAR: z.number(),
  MEAN_MOTION_DOT: z.number(),
  MEAN_MOTION_DDOT: z.number(),
  NORAD_CAT_ID: z.string().regex(/^[0-9]{1,5}$/),
  ELEMENT_SET_NO: z.number().int(),
  REV_AT_EPOCH: z.number().int(),
  EPHEMERIS_TYPE: z.number().int().optional(),
  CLASSIFICATION_TYPE: z.enum(["U", "C", "S", "O"]),
  REF_FRAME: z.string().optional(),
  TIME_SYSTEM: z.string().optional(),
});
export type GpRecord = z.infer<typeof gpRecordSchema>;

/** Catalog-query response item (server → client). */
export const catalogEntrySchema = z.object({
  satelliteNumber: z.string(),
  name: z.string(),
  group: z.string().optional(),
});
export type CatalogEntryDto = z.infer<typeof catalogEntrySchema>;

/** Single position sample (server → client), also used for tracks. */
export const positionSampleSchema = z.object({
  time: z.string(), // ISO 8601 UTC
  latitudeDeg: z.number(),
  longitudeDeg: z.number(),
  altitudeKm: z.number(),
});
export type PositionSampleDto = z.infer<typeof positionSampleSchema>;

/** Satellite detail response. */
export const satelliteDetailSchema = z.object({
  satelliteNumber: z.string(),
  name: z.string(),
  objectType: z.string().optional(),
  internationalDesignator: z.string().nullable(),
  epoch: z.string(),
  retrievedAt: z.string(),
  stale: z.boolean(),
  lineage: z.enum(["live", "cached", "provider-unavailable-stale"]),
  tleLine1: z.string(),
  tleLine2: z.string(),
  characteristics: z
    .object({
      inclinationDeg: z.number(),
      eccentricity: z.number(),
      meanMotionRevPerDay: z.number(),
      periodMinutes: z.number(),
      argPerigeeDeg: z.number(),
      semiMajorAxisKm: z.number(),
      perigeeAltitudeKm: z.number(),
      apogeeAltitudeKm: z.number(),
      revolutionNumberAtEpoch: z.number().nullable(),
    })
    .optional(),
});

export type SatelliteDetailDto = z.infer<typeof satelliteDetailSchema>;

/** Ground-track response. */
export const groundTrackSchema = z.object({
  satelliteNumber: z.string(),
  segments: z.array(
    z.object({
      points: z.array(positionSampleSchema),
    }),
  ),
  sampleIntervalSeconds: z.number(),
  windowStart: z.string(),
  windowEnd: z.string(),
  stale: z.boolean(),
});
export type GroundTrackDto = z.infer<typeof groundTrackSchema>;

/** Pass-prediction request. */
export const passPredictionRequestSchema = z.object({
  satelliteNumbers: z.array(z.string().regex(/^[0-9]{1,5}$/)).min(1).max(25),
  observer: z.object({
    latitudeDeg: z.number().min(-90).max(90),
    longitudeDeg: z.number().min(-180).max(180),
    /** Height above mean sea level, meters (display convention). */
    altitudeMeters: z.number().min(-500).max(10000).default(0),
  }),
  /** ISO 8601 UTC instants bounding the search window. */
  windowStart: z.string().datetime(),
  /** Search duration in hours, bounded in the route. */
  windowHours: z.number().min(1).max(24 * 30).default(24),
  minElevationDeg: z.number().min(0).max(85).default(10),
});
export type PassPredictionRequest = z.infer<typeof passPredictionRequestSchema>;

/** A point on the sky at an instant: where to look, and when. */
const visibleMomentSchema = z.object({
  timeIso: z.string(),
  azimuthDeg: z.number(),
  elevationDeg: z.number(),
});

/** Pass-prediction response item. */
export const passResultSchema = z.object({
  satelliteNumber: z.string(),
  name: z.string(),
  lineage: z.enum(["live", "cached", "provider-unavailable-stale"]).optional(),
  passes: z.array(
    z.object({
      riseTime: z.string().nullable(),
      maxTime: z.string(),
      maxElevationDeg: z.number(),
      setTime: z.string().nullable(),
      truncated: z.enum(["rise", "set", "both", "none"]),
      azimuthAtRiseDeg: z.number().nullable(),
      azimuthAtMaxDeg: z.number(),
      azimuthAtSetDeg: z.number().nullable(),
      /** Light-state evaluation; omitted when the pass was never enriched. */
      visibility: z
        .object({
          fromGround: z.boolean(),
          /** Null when not visible, or visible with no published standard magnitude (brightness unknown). */
          bestEstimatedMagnitude: z.number().nullable(),
          bestTimeIso: z.string().nullable(),
          sunElevationDegAtApex: z.number(),
          satelliteInShadowAtApex: z.boolean(),
          reasonIfNotVisible: z.enum(["satellite-in-shadow", "sky-too-bright", "both", "none"]).nullable(),
          /** Observable portion of the pass (edges ~1 s); null when never visible. */
          visibleWindow: z
            .object({
              start: visibleMomentSchema,
              end: visibleMomentSchema,
              /** Appears mid-sky as it leaves Earth's shadow. */
              startsFromShadow: z.boolean(),
              /** Fades out mid-sky as it enters Earth's shadow. */
              endsInShadow: z.boolean(),
            })
            .nullable(),
        })
        .optional(),
    }),
  ),
  failure: z
    .object({
      reason: z.string(),
      message: z.string(),
    })
    .optional(),
});
export type PassResultDto = z.infer<typeof passResultSchema>;
