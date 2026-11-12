import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SatelliteService } from "@/server/satellites";
import { ProviderError, type HttpCelestrakClient, type NamedElementSet } from "@/integrations/celestrak/client";
import { parseTle } from "@/domain/orbit/tle";
import { staticCatalogGeneratedAt } from "@/server/search-index";
import { vanguardTle } from "../helpers/tles";

const { line1: LINE1, line2: LINE2 } = vanguardTle();

type FakeClientInput = { client: HttpCelestrakClient; calls: () => number };

let clientRef: FakeClientInput;

function fakeClient(): FakeClientInput {
  let count = 0;
  const elementSets = async (): Promise<NamedElementSet[]> => {
    count++;
    return [{ name: "VANGUARD 1", elementSet: parseTle(LINE1, LINE2) }];
  };
  const client = {
    fetchGpTle: vi.fn(elementSets),
  } as unknown as HttpCelestrakClient;
  return { client, calls: () => count };
}

let service: SatelliteService;
let calls: () => number;
let client: HttpCelestrakClient;

beforeEach(() => {
  clientRef = fakeClient();
  client = clientRef.client;
  calls = clientRef.calls;
  service = new SatelliteService(client);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SatelliteService", () => {
  it("fetches once and serves repeat reads from cache", async () => {
    const first = await service.get("00005");
    const second = await service.get("00005");
    expect(calls()).toBe(1);
    expect(first.record.elementSet.satelliteNumber).toBe("00005");
    expect(second.record.elementSet.satelliteNumber).toBe("00005");
  });

  it("serves labelled stale data when the provider fails after a successful fetch", async () => {
    await service.get("00005");
    expect(calls()).toBe(1);
    // Simulate provider outage + rate-limit style failure.
    Object.assign(client, {
      fetchGpTle: async (): Promise<NamedElementSet[]> => {
        throw new ProviderError("rate-limited", "HTTP 429");
      },
    });
    // Age the cache entry beyond the TTL so it is past fresh but usable.
    const bounded = (service as unknown as { cache: { get: (n: string) => { retrievedAt: Date } | undefined } }).cache;
    const entry = bounded.get("00005") as { retrievedAt: Date } | undefined;
    if (entry) entry.retrievedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const served = await service.get("00005");
    expect(served.lineage).toBe("cached");
  });

  it("answers a day-young cached record at once, even while the provider hangs, and refreshes it behind the scenes", async () => {
    await service.get("00005");
    const bounded = (service as unknown as { cache: { get: (n: string) => { retrievedAt: Date } | undefined } }).cache;
    bounded.get("00005")!.retrievedAt = new Date(Date.now() - 5 * 60 * 60 * 1000);
    // A provider that never answers (an unreachable host waiting out its timeout).
    let release: () => void = () => undefined;
    const hung = vi.fn(
      () =>
        new Promise<NamedElementSet[]>((resolve) => {
          release = () => resolve([{ name: "VANGUARD 1", elementSet: parseTle(LINE1, LINE2) }]);
        }),
    );
    Object.assign(client, { fetchGpTle: hung });

    const served = await service.get("00005"); // resolves without the provider
    expect(served.lineage).toBe("cached");
    await service.get("00005"); // a second reader does not start a second refresh
    expect(hung).toHaveBeenCalledTimes(1);

    release();
    await service.settled();
    expect((await service.get("00005")).lineage).toBe("live");
  });

  it("still waits for the provider when the cached record is more than a day old", async () => {
    await service.get("00005");
    const bounded = (service as unknown as { cache: { get: (n: string) => { retrievedAt: Date } | undefined } }).cache;
    bounded.get("00005")!.retrievedAt = new Date(Date.now() - 30 * 60 * 60 * 1000);
    const served = await service.get("00005");
    expect(served.lineage).toBe("live");
    expect(calls()).toBe(2);
  });

  it("reports not-found for an unknown object when nothing is cached", async () => {
    Object.assign(client, { fetchGpTle: async (): Promise<NamedElementSet[]> => [] });
    await expect(service.get("42424")).rejects.toMatchObject({ kind: "not-found" });
  });

  it("propagates provider failures when no cached data can be served", async () => {
    Object.assign(client, {
      fetchGpTle: async (): Promise<NamedElementSet[]> => {
        throw new ProviderError("network", "Could not reach CelesTrak");
      },
    });
    await expect(service.get("00005")).rejects.toMatchObject({ kind: "provider" });
  });
});

describe("SatelliteService — build-time seeded catalog", () => {
  /** Search must answer from the snapshot (honest cached data) even while the
   *  provider is unreachable; the background refresh failure is swallowed. */
  it("answers search from the build-time snapshot without any provider dependency", async () => {
    const unreachable = {
      fetchGpTle: async (): Promise<NamedElementSet[]> => {
        throw new ProviderError("network", "Could not reach CelesTrak");
      },
    } as unknown as HttpCelestrakClient;
    const seeded = new SatelliteService(unreachable, true);

    // Note: the search contract is substring + catalog-number matching, so the
    // query must be a contiguous substring of the real catalog name.
    const hits = await seeded.search("iss (zarya)");
    expect(hits.some((h) => h.satelliteNumber === "25544" && h.name.includes("ISS"))).toBe(true);
    expect(await seeded.search("no-such-object-xyz")).toEqual([]);
    // Catalog-number search works too (leading-zero handling preserved).
    expect(await seeded.search("25544")).not.toEqual([]);
  });

  it("keeps provider failure semantics for detail lookups outside the snapshot", async () => {
    const unreachable = {
      fetchGpTle: async (): Promise<NamedElementSet[]> => {
        throw new ProviderError("network", "Could not reach CelesTrak");
      },
    } as unknown as HttpCelestrakClient;
    const seeded = new SatelliteService(unreachable, true);

    await expect(seeded.get("999999")).rejects.toMatchObject({ kind: "provider" });
  });

  it("serves seeded cached record when the provider is unreachable but data exists", async () => {
    // Pin "now" to a few days after the committed snapshot was generated. The
    // snapshot is a checked-in file, so reading the real clock made this test
    // a time bomb: it began failing once the file was > 7 days old.
    const generatedAt = staticCatalogGeneratedAt();
    expect(generatedAt).not.toBeNull();
    vi.useFakeTimers({ toFake: ["Date"], now: generatedAt!.getTime() + 3 * 24 * 60 * 60 * 1000 });
    try {
      const unreachable = {
        fetchGpTle: async (): Promise<NamedElementSet[]> => {
          throw new ProviderError("network", "Could not reach CelesTrak");
        },
      } as unknown as HttpCelestrakClient;
      const seeded = new SatelliteService(unreachable, true);

      const served = await seeded.get("25544");
      // Snapshot data is real previously-fetched provider data from the build:
      // honest label is "cached", never "live" (this instance did not fetch it).
      expect(served.lineage).toBe("cached");
      expect(served.record.catalog.name).toContain("ISS");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a snapshot past the stale horizon rather than serving week-old orbits", async () => {
    const generatedAt = staticCatalogGeneratedAt();
    vi.useFakeTimers({ toFake: ["Date"], now: generatedAt!.getTime() + 8 * 24 * 60 * 60 * 1000 });
    try {
      const unreachable = {
        fetchGpTle: async (): Promise<NamedElementSet[]> => {
          throw new ProviderError("network", "Could not reach CelesTrak");
        },
      } as unknown as HttpCelestrakClient;
      const seeded = new SatelliteService(unreachable, true);

      await expect(seeded.get("25544")).rejects.toMatchObject({ kind: "provider" });
    } finally {
      vi.useRealTimers();
    }
  });
});
