/**
 * GET /api/compare?left=<id>&right=<id>&hours=&samples=
 *
 * Element-set + propagated-position comparison between two catalog objects.
 * Response includes interpretation notes so the UI cannot misrepresent the
 * deltas.
 */

import { z } from "zod";
import { catalogNumber, jsonFail, jsonOk } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { COMPARE_MESSAGES } from "@/contracts/catalog-number";
import { compareElementSets } from "@/server/analysis";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const input = z
      .object({
        left: catalogNumber(COMPARE_MESSAGES.left),
        right: catalogNumber(COMPARE_MESSAGES.right),
        hours: z.coerce.number().min(1).max(48).default(24).optional(),
        samples: z.coerce.number().int().min(2).max(200).default(24).optional(),
      })
      .parse(Object.fromEntries(url.searchParams.entries()));

    const comparison = await compareElementSets(input);
    return jsonOk(comparison, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.slice(0, 3);
      // Name the side that's wrong; the form shows this message as-is.
      const said = [...new Set(issues.map((i) => i.message))].join(" ");
      return jsonFail(new AppError("validation", `Invalid comparison request. ${said}`, {
        details: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }));
    }
    return jsonFail(error);
  }
}
