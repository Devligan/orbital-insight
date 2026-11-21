/**
 * POST /api/passes, called directly: the real route schema, so the limits
 * tested here are the ones production enforces. The analysis service is
 * stubbed; only the request boundary is under test.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const computePasses = vi.fn();
vi.mock("@/server/analysis", () => ({ computePasses }));

const { POST } = await import("@/app/api/passes/route");

interface Body {
  ok: boolean;
  error?: { kind: string; message: string; details?: { path: string; message: string }[] };
}

function valid() {
  return {
    satelliteNumbers: ["25544"],
    observer: { latitudeDeg: 51.5, longitudeDeg: -0.12, altitudeMeters: 11 },
    windowStartIso: new Date().toISOString(),
    windowHours: 24,
    minElevationDeg: 10,
  };
}

async function post(body: unknown): Promise<{ status: number; body: Body }> {
  const response = await POST(
    new Request("http://local/api/passes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Body };
}

beforeEach(() => {
  computePasses.mockReset();
  computePasses.mockResolvedValue({ results: [] });
});

describe("POST /api/passes", () => {
  it("passes a normal request through to the analysis service", async () => {
    const { status, body } = await post(valid());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(computePasses).toHaveBeenCalledWith(
      expect.objectContaining({ satelliteNumbers: ["25544"], hours: 24, minElevationDeg: 10, observer: { latitudeDeg: 51.5, longitudeDeg: -0.12, heightKm: 0.011 } }),
    );
  });

  it("names the field that's out of range", async () => {
    const { status, body } = await post({ ...valid(), minElevationDeg: 200 });
    expect(status).toBe(400);
    expect(body.error?.message).toBe("Invalid pass-prediction request. Minimum elevation must be between 0° and 85°.");
    expect(body.error?.details).toEqual([{ path: "minElevationDeg", message: "Minimum elevation must be between 0° and 85°." }]);
    expect(computePasses).not.toHaveBeenCalled();
  });

  it("names every bad field in a hostile request, and computes nothing", async () => {
    const { status, body } = await post({
      satelliteNumbers: ["<script>alert(1)</script>"],
      observer: { latitudeDeg: 9999, longitudeDeg: -999999, altitudeMeters: -1e8 },
      windowStartIso: new Date().toISOString(),
      windowHours: 9_999_999,
      minElevationDeg: -50,
    });
    expect(status).toBe(400);
    const message = body.error?.message ?? "";
    for (const said of ["Catalog IDs are 1 to 5 digits.", "Latitude must be", "Longitude must be", "Altitude must be", "Prediction window must be"]) {
      expect(message).toContain(said);
    }
    expect(computePasses).not.toHaveBeenCalled();
  });

  // JSON has no NaN or Infinity: JSON.stringify turns them into null.
  it.each([null, "51.5", Number.NaN, Number.POSITIVE_INFINITY])("refuses a latitude of %s", async (latitudeDeg) => {
    const { status, body } = await post({ ...valid(), observer: { ...valid().observer, latitudeDeg } });
    expect(status).toBe(400);
    expect(body.error?.message).toContain("Latitude must be between -90° and 90°.");
  });

  it("enforces the satellite-count limit", async () => {
    const satelliteNumbers = Array.from({ length: 26 }, (_, i) => String(10000 + i));
    const { status, body } = await post({ ...valid(), satelliteNumbers });
    expect(status).toBe(400);
    expect(body.error?.message).toContain("Enter at most 25 catalog IDs.");
  });

  it("refuses a body that isn't JSON", async () => {
    const { status, body } = await post("{not json");
    expect(status).toBe(400);
    expect(body.error?.message).toBe("Request body must be valid JSON");
  });
});
