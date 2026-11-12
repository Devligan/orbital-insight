import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
let snapshotDir: string;
let snapshotFile: string;

beforeEach(async () => {
  // Each test gets its own snapshot file: no state leaks between tests or
  // into the real server's restart cache.
  snapshotDir = mkdtempSync(path.join(tmpdir(), "sky-catalog-test-"));
  snapshotFile = path.join(snapshotDir, "sky-catalog.json");
  process.env.SKY_CATALOG_SNAPSHOT_PATH = snapshotFile;
  // The repo's real bundled snapshot is opted out unless a test provides one.
  process.env.SKY_CATALOG_BUNDLED_PATH = "off";
  vi.resetModules();
  vi.doMock("@/integrations/celestrak/client", () => {
    const mock = vi.fn();
    fetchGpTle = mock;
    return { celestrakClient: { fetchGpTle: mock }, ProviderError: class extends Error {} };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.SKY_CATALOG_SNAPSHOT_PATH;
  delete process.env.SKY_CATALOG_BUNDLED_PATH;
  rmSync(snapshotDir, { recursive: true, force: true });
});

/** Writes a deployment-bundled snapshot `hoursOld` hours old and points the service at it. */
function bundle(count: number, hoursOld: number): string {
  const file = path.join(snapshotDir, "bundled.json");
  const generatedAt = new Date(Date.now() - hoursOld * 3_600_000).toISOString();
  const entries = makeNamed(count).map((n) => ({ i: n.elementSet.satelliteNumber, n: n.name, l1: n.elementSet.line1, l2: n.elementSet.line2 }));
  writeFileSync(file, JSON.stringify({ generatedAt, source: "test", count, entries }));
  process.env.SKY_CATALOG_BUNDLED_PATH = file;
  return generatedAt;
}

describe("sky catalog service — the deployment's bundled snapshot", () => {
  it("serves a fresh bundled copy without asking the provider", async () => {
    const generatedAt = bundle(5_500, 2);
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    const result = await getSkyCatalog();
    expect(fetchGpTle).not.toHaveBeenCalled();
    expect(result.count).toBe(5_500);
    expect(result.generatedAt).toBe(generatedAt);
    expect(result.stale).toBe(false);
  });

  it("answers at once with a day-old copy past its TTL and refreshes in the background", async () => {
    bundle(5_500, 8);
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    let release: (rows: NamedElementSet[]) => void = () => undefined;
    fetchGpTle!.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const first = await getSkyCatalog(); // must not wait on the pending provider call
    expect(first.count).toBe(5_500);
    expect(fetchGpTle).toHaveBeenCalledTimes(1);
    release(makeNamed(5_600));
    await new Promise((r) => setTimeout(r, 0));
    const second = await getSkyCatalog();
    expect(second.count).toBe(5_600);
    expect(second.stale).toBe(false);
  });

  it("when the provider fails, serves an older bundled copy labelled stale with its true age", async () => {
    const generatedAt = bundle(5_500, 30);
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockRejectedValue(new Error("CelesTrak returned HTTP 500"));
    const result = await getSkyCatalog();
    expect(result.stale).toBe(true);
    expect(result.generatedAt).toBe(generatedAt);
  });

  it("refuses a bundled copy older than a week (typed failure, no ancient sky)", async () => {
    bundle(5_500, 8 * 24);
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockRejectedValue(new Error("CelesTrak returned HTTP 500"));
    await expect(getSkyCatalog()).rejects.toThrow("HTTP 500");
  });

  it("prefers the newer of the instance's disk copy and the bundled copy", async () => {
    bundle(5_500, 20);
    const diskEntries = makeNamed(5_700).map((n) => ({ i: n.elementSet.satelliteNumber, n: n.name, l1: n.elementSet.line1, l2: n.elementSet.line2 }));
    writeFileSync(snapshotFile, JSON.stringify({ generatedAt: new Date(Date.now() - 3_600_000).toISOString(), stale: false, count: 5_700, entries: diskEntries }));
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    const result = await getSkyCatalog();
    expect(result.count).toBe(5_700);
    expect(fetchGpTle).not.toHaveBeenCalled();
  });
});

/** Let the fire-and-forget snapshot write land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      if (readFileSync(snapshotFile, "utf8").length > 0) return;
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

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

  it("survives a restart: a fresh module restores the disk snapshot instead of re-downloading", async () => {
    const first = await import("@/server/sky-catalog");
    fetchGpTle!.mockResolvedValue(makeNamed(5_300));
    const original = await first.getSkyCatalog();
    await settle();

    vi.resetModules(); // simulate a server restart / dev hot-reload
    const second = await import("@/server/sky-catalog");
    fetchGpTle!.mockClear();
    const restored = await second.getSkyCatalog();
    expect(fetchGpTle).not.toHaveBeenCalled();
    expect(restored.count).toBe(5_300);
    // The snapshot keeps its true fetch time — never re-labelled as newer.
    expect(restored.generatedAt).toBe(original.generatedAt);
  });

  it("ignores a snapshot older than 48 h and asks the provider", async () => {
    const old = { generatedAt: new Date(Date.now() - 49 * 3_600_000).toISOString(), stale: false, count: 5_000, entries: [] as SkyCatalogEntry[] };
    old.entries = makeNamed(5_000).map((n) => ({ i: n.elementSet.satelliteNumber, n: n.name, l1: n.elementSet.line1, l2: n.elementSet.line2 }));
    writeFileSync(snapshotFile, JSON.stringify(old));
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockResolvedValue(makeNamed(5_400));
    const result = await getSkyCatalog();
    expect(fetchGpTle).toHaveBeenCalledTimes(1);
    expect(result.count).toBe(5_400);
  });

  it("backs off after a failure instead of re-asking the provider on every request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    const { getSkyCatalog } = await import("@/server/sky-catalog");
    fetchGpTle!.mockRejectedValue(new Error("CelesTrak returned HTTP 403"));
    await expect(getSkyCatalog()).rejects.toThrow("HTTP 403");
    await expect(getSkyCatalog()).rejects.toThrow("HTTP 403");
    await expect(getSkyCatalog()).rejects.toThrow("HTTP 403");
    expect(fetchGpTle).toHaveBeenCalledTimes(1);

    // After the backoff window, one new attempt.
    vi.setSystemTime(new Date("2026-10-16T12:11:00Z"));
    fetchGpTle!.mockResolvedValue(makeNamed(5_100));
    const recovered = await getSkyCatalog();
    expect(fetchGpTle).toHaveBeenCalledTimes(2);
    expect(recovered.stale).toBe(false);
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
