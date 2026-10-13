/**
 * GET /api/satellites/search?q=<query>&limit=<int>
 *
 * Server-side search over the curated cached catalog. Results and page
 * limits are bounded; unknown queries return an empty results array rather
 * than a provider call blow-up.
 */

import { z } from "zod";
import { handleRoute, parseSearch, jsonFail } from "@/lib/http";
import { satelliteService } from "@/server/satellites";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleRoute(async () => {
      const url = new URL(request.url);
      const input = parseSearch(
        url.searchParams,
        z.object({
          q: z.string().min(1).max(80),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
      );
      const results = await satelliteService.search(input.q, input.limit);
      return {
        query: input.q,
        results,
      };
    });
  } catch (error) {
    // parseSearch/validation failures arrive as route errors too.
    return jsonFail(error);
  }
}
