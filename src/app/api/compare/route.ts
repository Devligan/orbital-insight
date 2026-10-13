/**
 * GET /api/compare?left=<id>&right=<id>&hours=&samples=
 *
 * Element-set + propagated-position comparison between two catalog objects.
 * Response includes interpretation notes so the UI cannot misrepresent the
 * deltas.
 */

import { z } from "zod";
import { jsonFail, jsonOk } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { compareElementSets } from "@/server/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const input = z
      .object({
        left: z.string().regex(/^[0-9]{1,5}$/),
        right: z.string().regex(/^[0-9]{1,5}$/),
        hours: z.coerce.number().min(1).max(48).default(24).optional(),
        samples: z.coerce.number().int().min(2).max(200).default(24).optional(),
      })
      .parse(Object.fromEntries(url.searchParams.entries()));

    const comparison = await compareElementSets(input);
    return jsonOk(comparison, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonFail(new AppError("validation", "Invalid comparison request", {
        details: error.issues.slice(0, 3).map((i) => ({ path: i.path.join("."), message: i.message })),
      }));
    }
    return jsonFail(error);
  }
}
