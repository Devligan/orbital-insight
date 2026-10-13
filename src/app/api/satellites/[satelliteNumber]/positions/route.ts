/**
 * GET /api/satellites/:satelliteNumber/positions?hours=&samples=
 *
 * Bounded sampled positions (≤ 48 h, ≤ 600 samples) in TEME and ECEF km plus
 * geodetic values, for orbit rendering and the time slider. These are
 * SGP4 *predictions*, never live telemetry — labelled so in the UI.
 */

import { z } from "zod";
import { jsonFail, jsonOk } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { computePositions } from "@/server/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ satelliteNumber: string }> }): Promise<Response> {
  try {
    const { satelliteNumber } = await context.params;
    const id = z.string().regex(/^[0-9]{1,5}$/).parse(satelliteNumber);

    const url = new URL(request.url);
    const input = z
      .object({
        hours: z.coerce.number().min(1).max(48).default(6).optional(),
        samples: z.coerce.number().int().min(2).max(600).default(96).optional(),
      })
      .safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!input.success) {
      throw new AppError("validation", "Invalid positions query", {
        details: input.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }

    const { record, samples, lineage, characteristics } = await computePositions({
      satelliteNumber: id,
      hours: input.data.hours,
      samples: input.data.samples,
    });

    return jsonOk(
      {
        satelliteNumber: record.catalog.satelliteNumber,
        name: record.catalog.name,
        lineage,
        positions: samples.map((s) => ({
          time: s.time.toISOString(),
          teme: s.teme,
          ecf: s.ecf,
          latitudeDeg: s.latitudeDeg,
          longitudeDeg: s.longitudeDeg,
          altitudeKm: s.altitudeKm,
        })),
        characteristics,
      },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonFail(new AppError("validation", "Invalid satellite identifier"));
    }
    return jsonFail(error);
  }
}
