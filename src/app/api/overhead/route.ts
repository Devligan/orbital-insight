/**
 * GET /api/overhead?latDeg=<num>&lonDeg=<num>&minElevationDeg=<num>
 *
 * Which curated objects are above an observer right now. Cached-first: the
 * deployment carries the build-time catalog snapshot, so a cold instance
 * answers instantly; the response labels per-entry lineage honestly
 * ("cached" for snapshot-served data, "live" when the provider refreshed it).
 */

import { z } from "zod";
import { handleRoute, parseSearch, jsonFail } from "@/lib/http";
import { computeOverhead } from "@/server/overhead";

export const dynamic = "force-dynamic";

const schema = z.object({
  latDeg: z.coerce.number().min(-90).max(90),
  lonDeg: z.coerce.number().min(-180).max(180),
  minElevationDeg: z.coerce.number().min(0).max(85).default(15),
});

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleRoute(async () => {
      const input = parseSearch(
        new URL(request.url).searchParams,
        schema,
      );
      const observer = {
        latitudeDeg: input.latDeg,
        longitudeDeg: input.lonDeg,
        heightKm: 0,
      };
      return computeOverhead(observer, input.minElevationDeg);
    });
  } catch (error) {
    return jsonFail(error);
  }
}
