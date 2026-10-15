import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NamedElementSet } from "@/integrations/celestrak/client";
import type { SkyCatalogEntry, SkyCatalogResult } from "@/server/sky-catalog";

/**
 * Contract tests for the whole-sky catalog service against a stubbed
 * provider client. The service module is loaded via vi.resetModules per test
 * so each test gets an isolated module-level cache.
 */

function makeNamed(count: number, seed = 0): NamedElementSet[] {
  const rows: NamedElementSet[] = [];
  for (let k = 0; k < count; k++) {
    const satnum = String(10_000 + seed + k).padStart(5, "0");
    rows.push({
      name: `OBJ ${seed + k}`,
      elementSet: {
        format: "tle",
        satelliteNumber: satnum,
        classification: "U",
        internationalDesignator: null,
        epoch: new Date("2026-10-15T00:00:00Z"),
        // checksum digits need not be valid: satellite.js ignores them
        line1: `1 ${satnum}U 26001A   26288.00000000  .00000000  00000-0  00000-0 0  9990`,
        line2: `2 ${satnum} 051.2500 180.0000 0005000 180.0000 180.0000 15.50000000    10`,
      },
    });
  }
  return rows;
}

let fetchGpTle: ReturnType<typeof vi.fn> | undefined;

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("@/integrations/celestrak/client", () => {
    const mock = vi.fn();
    fetchGpTle = mock;
    return { celestrakClient: { fetchGpTle: mock }, ProviderError: class extends Error {} };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sky catalog service", () => {
  it("serves a compact payload (i/n/l1/l2) from one provider call", async () => {
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockResolvedValue(makeNamed(5_100));
    const result = await getSkyCatalog();
    expect(result.stale).toBe(false);
    expect(result.count).toBe(5_100);
    expect(result.entries).toHaveLength(5_100);
    const first: SkyCatalogEntry | undefined = result.entries[0]; // noUncheckedIndexedAccess
    expect(first).toBeDefined();
    expect(Object.keys(first as object).sort()).toEqual(["i", "l1", "l2", "n"]);
    // One provider call; a second call inside the TTL window must not refetch.
    await getSkyCatalog();
    expect(fetchGpTle).toHaveBeenCalledTimes(1);
  });

  it("refuses a suspiciously small active feed instead of showing a fake sky", async () => {
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockResolvedValue(makeNamed(120));
    await expect(getSkyCatalog()).rejects.toThrow(/only 120 objects/);
  });

  it("on provider failure with no prior copy, the typed error propagates (no fabricated sky)", async () => {
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockRejectedValue(new Error("CelesTrak returned HTTP 503"));
    await expect(getSkyCatalog()).rejects.toThrow("HTTP 503");
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(makeNamed(5_200)), 20)));
    const [a, b] = await Promise.all([getSkyCatalog(), getSkyCatalog()] as const);
    expect(fetchGpTle).toHaveBeenCalledTimes(1);
    expect((a as SkyCatalogResult).count).toBe(5_200);
    expect((b as SkyCatalogResult).count).toBe(5_200);
  });
});
