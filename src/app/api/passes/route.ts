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
import { PASS_SEARCH_MAX_HOURS } from "@/server/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const requestSchema = z.object({
  satelliteNumbers: z
    .array(z.string().regex(/^[0-9]{1,5}$/))
    .min(1)
    .max(25),
  observer: z.object({
    latitudeDeg: z.number().min(-90).max(90),
    longitudeDeg: z.number().min(-180).max(180),
    /** Meters above sea level (UI convention); converted to km in the service. */
    altitudeMeters: z.number().min(-1_000).max(10_000).default(0),
  }),
  windowStartIso: z.string().datetime(),
  windowHours: z.number().min(1).max(PASS_SEARCH_MAX_HOURS).default(24),
  minElevationDeg: z.number().min(0).max(85).default(10),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonFail(new AppError("validation", "Request body must be valid JSON"));
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonFail(
      new AppError("validation", "Invalid pass-prediction request", {
        details: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
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
