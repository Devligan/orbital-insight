/**
 * POST /api/passes
 *
 * Predict passes for up to 25 satellites over a bounded window (≤ 30 days)
 * for a validated observer location. Response is per-satellite results plus
 * explicit per-satellite failures; window honesty flags (truncated passes)
 * come from the domain.
 */

import { z } from "zod";
import { jsonFail, jsonOk } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { computePasses } from "@/server/analysis";
import {
  CATALOG_ID_PATTERN,
  MAX_PASS_SATELLITES,
  PASS_LIMITS,
  rangeMessage,
  SATELLITE_LIST_MESSAGES,
  type PassNumberField,
} from "@/contracts/pass-request";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A bounded number whose every failure (missing, NaN, out of range) reads as the form's own sentence. */
function bounded(field: PassNumberField) {
  const message = rangeMessage(field);
  return z.number({ error: message }).min(PASS_LIMITS[field].min, message).max(PASS_LIMITS[field].max, message);
}

const passRequestSchema = z.object({
  satelliteNumbers: z
    .array(z.string().regex(CATALOG_ID_PATTERN, "Catalog IDs are 1 to 5 digits."), { error: SATELLITE_LIST_MESSAGES.empty })
    .min(1, SATELLITE_LIST_MESSAGES.empty)
    .max(MAX_PASS_SATELLITES, SATELLITE_LIST_MESSAGES.tooMany),
  observer: z.object({
    latitudeDeg: bounded("latitudeDeg"),
    longitudeDeg: bounded("longitudeDeg"),
    /** Meters above sea level (UI convention); converted to km in the service. */
    altitudeMeters: bounded("altitudeMeters").default(0),
  }),
  windowStartIso: z.string().datetime(),
  windowHours: bounded("windowHours").default(24),
  minElevationDeg: bounded("minElevationDeg").default(10),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonFail(new AppError("validation", "Request body must be valid JSON"));
  }

  const parsed = passRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5);
    // Name what's wrong, not just that something is: the message is shown as-is.
    const said = [...new Set(issues.map((i) => i.message))].join(" ");
    return jsonFail(
      new AppError("validation", `Invalid pass-prediction request. ${said}`, {
        details: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
    );
  }

  try {
    const result = await computePasses({
      satelliteNumbers: parsed.data.satelliteNumbers,
      observer: {
        latitudeDeg: parsed.data.observer.latitudeDeg,
        longitudeDeg: parsed.data.observer.longitudeDeg,
        heightKm: parsed.data.observer.altitudeMeters / 1000,
      },
      windowStart: new Date(parsed.data.windowStartIso),
      hours: parsed.data.windowHours,
      minElevationDeg: parsed.data.minElevationDeg,
    });

    return jsonOk(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonFail(error);
  }
}
