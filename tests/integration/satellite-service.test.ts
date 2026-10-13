import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SatelliteService } from "@/server/satellites";
import { ProviderError, type HttpCelestrakClient, type NamedElementSet } from "@/integrations/celestrak/client";
import { parseTle } from "@/domain/orbit/tle";
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
