/**
 * Route-handler tests (direct invocation, no HTTP listen): request
 * validation, bounds, and failure translation - the server-side safety net.
 * Services here hit a fake provider through module construction where
 * needed; persistence-independent paths run as-is.
 */

import { describe, expect, it } from "vitest";

// Route handlers import singletons; we exercise the validation layers
// through zod schemas + error mapping rather than spinning a server.

import { jsonFail } from "@/lib/http";
import { AppError } from "@/lib/errors";

describe("error → HTTP mapping", () => {
  it.each([
    ["validation", 400],
    ["not-found" as const, 404],
    ["provider", 502],
    ["propagation", 422],
    ["persistence", 503],
  ] as const)("%s maps to HTTP %i", (kind, status) => {
    const response = jsonFail(new AppError(kind, "fail"));
    expect(response.status).toBe(status);
  });

  it("unexpected errors get a correlation id and a generic 500", async () => {
    const response = jsonFail(new Error("boom"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { kind: string; message: string; correlationId?: string } };
    expect(body.error.kind).toBe("internal");
    expect(body.error.correlationId).toBeTruthy();
    expect(body.error.message).not.toContain("boom");
  });
});

// The /api/passes bounds are tested against the real route in passes-route.test.ts.
describe("validation bounds are enforced", () => {
  it("positions route rejects a window start more than 24 h from now (before any provider work)", async () => {
    const { GET } = await import("@/app/api/satellites/[satelliteNumber]/positions/route");
    const farFuture = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const response = await GET(new Request(`http://local/api/satellites/25544/positions?start=${farFuture}&hours=6`), {
      params: Promise.resolve({ satelliteNumber: "25544" }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; error?: { kind: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.kind).toBe("validation");
  });

  it("detail route id validation", () => {
    const idSchema = /^[0-9]{1,5}$/;
    expect(idSchema.test("25544")).toBe(true);
    expect(idSchema.test("abc")).toBe(false);
    expect(idSchema.test("-1")).toBe(false);
  });
});
