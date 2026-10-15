/**
 * GET /api/sky/catalog
 *
 * The whole-sky feed for the animated 3D globe: element sets for every
 * active object (provider: CelesTrak GROUP=active), cached server-side with a
 * shared in-flight fetch. Failures serve the previous copy labelled `"stale"`
 * — the client renders the honest message, never fabricated orbits.
 *
 * Payload shape is compact (`{i, n, l1, l2}` per entry): the browser
 * propagates positions itself in a web worker, so no per-object server work
 * happens here.
 */

import { getSkyCatalog } from "@/server/sky-catalog";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const catalog = await getSkyCatalog();
    return Response.json(
      { ok: true, data: catalog },
      {
        headers: {
          // Large payload; gzip/br handles it (~10k TLEs compress ~4:1).
          "Content-Type": "application/json",
          "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200",
        },
      },
    );
  } catch (error) {
    const status = 502;
    const message = error instanceof Error ? error.message : "Provider unavailable";
    return Response.json(
      { ok: false, error: { kind: "provider", message } },
      { status },
    );
  }
}
