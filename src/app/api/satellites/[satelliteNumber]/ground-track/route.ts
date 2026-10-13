/**
 * GET /api/satellites/:satelliteNumber/ground-track?hours=&samples=
 *
 * Bounded ground-track generation (≤ 48 h window, ≤ 1200 samples),
 * segment-split at the antimeridian. Query validation here; computation in
 * the server service layer.
 */

import { z } from "zod";
import { jsonFail, jsonOk } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { computeGroundTrack, GROUND_TRACK_MAX_HOURS } from "@/server/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ satelliteNumber: string }> }): Promise<Response> {
  try {
    const { satelliteNumber } = await context.params;
    const id = z.string().regex(/^[0-9]{1,5}$/).parse(satelliteNumber);

    const url = new URL(request.url);
    const input = z
      .object({
        hours: z.coerce.number().min(1).max(GROUND_TRACK_MAX_HOURS).default(24).optional(),
        samples: z.coerce.number().int().min(40).max(1200).default(240).optional(),
      })
      .safeParse(Object.fromEntries(url.searchParams.entries()));

    if (!input.success) {
      throw new AppError("validation", "Invalid ground-track query", {
        details: input.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    const track = await computeGroundTrack({
      satelliteNumber: id,
      hours: input.data.hours,
      samples: input.data.samples,
    });

    return jsonOk(track, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonFail(new AppError("validation", "Invalid satellite identifier"));
    }
    return jsonFail(error);
  }
}
