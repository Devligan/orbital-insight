import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpCelestrakClient, ProviderError, parseGpTleResponse } from "@/integrations/celestrak/client";
import { vanguardTle, withCatalogNumber } from "../helpers/tles";

// Fixture derivation: the published Vanguard verification TLE, re-numbered
// with a NORAD-style catalog id, expressed as a GP TLE-triplet response.
const RENUMBERED = withCatalogNumber(vanguardTle(), "25544");
const ISS_TRIPLET = `TEST OBJECT\n${RENUMBERED.line1}\n${RENUMBERED.line2}\n`;

describe("parseGpTleResponse", () => {
  it("extracts name + validated element set from a TLE triplet", () => {
    const results = parseGpTleResponse(ISS_TRIPLET);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("TEST OBJECT");
    expect(results[0]?.elementSet.satelliteNumber).toBe("25544");
  });

  it("rejects a provider response whose TLE fails validation", () => {
    const bad = `TEST OBJECT\n${RENUMBERED.line1.slice(0, 68)}9\n${RENUMBERED.line2}\n`;
    // checksum corrupt → parseTle throws → client turns it into ProviderError
    expect(() => parseGpTleResponse(bad)).toThrow();
  });
});

function stubFetch(body: string | Promise<string>, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body instanceof Promise ? await body : body, { status })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HttpCelestrakClient", () => {
  it("returns parsed element sets on a valid GP response", async () => {
    stubFetch(ISS_TRIPLET);
    const client = new HttpCelestrakClient();
    const result = await client.fetchGpTle({ kind: "catnr", value: "25544" });
    expect(result).toHaveLength(1);
    expect(result[0]?.elementSet.satelliteNumber).toBe("25544");
  });

  it("maps HTTP 429 to a rate-limited provider failure", async () => {
    stubFetch("too many requests", 429);
    const client = new HttpCelestrakClient();
    await expect(client.fetchGpTle({ kind: "catnr", value: "25544" })).rejects.toMatchObject({
      reason: "rate-limited",
    });
  });

  it("maps an empty body to no results without throwing schema errors", async () => {
    stubFetch("", 200);
    const client = new HttpCelestrakClient();
    // Empty body means "no object found" upsteam; client surfaces it as an
    // empty array so the service layer can decide not-found vs cached.
    const result = await client.fetchGpTle({ kind: "catnr", value: "99999" });
    expect(result).toHaveLength(0);
  });

  it("maps network failure to a network provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    const client = new HttpCelestrakClient();
    await expect(client.fetchGpTle({ kind: "catnr", value: "25544" })).rejects.toBeInstanceOf(ProviderError);
  });

  it("does not throw on validated content regardless of continuation lines", async () => {
    const twoObjects = `TEST OBJECT\n${RENUMBERED.line1}\n${RENUMBERED.line2}\n\nSECOND OBJECT\n${vanguardTle().line1}\n${vanguardTle().line2}\n`;
    stubFetch(twoObjects);
    const client = new HttpCelestrakClient();
    const results = await client.fetchGpTle({ kind: "group", value: "science" });
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
