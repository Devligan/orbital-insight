/**
 * OPTIONAL live provider check.
 *
 * Explicitly categorized per the testing standards: skipped unless
 * RUN_LIVE_TESTS=1 is set, so the default suite never depends on network
 * availability or current catalog contents. When enabled, it verifies the
 * real CelesTrak contract end-to-end (URL, TLE-triplet parsing, checksum).
 */

import { describe, expect, it } from "vitest";
import { HttpCelestrakClient } from "@/integrations/celestrak/client";

const mayBeSkipped = process.env.RUN_LIVE_TESTS !== "1";

(mayBeSkipped ? describe.skip : describe)("live CelesTrak integration", () => {
  it("fetches the ISS element set over the real network", async () => {
    const client = new HttpCelestrakClient();
    const results = await client.fetchGpTle({ kind: "catnr", value: "25544" });
    expect(results).toHaveLength(1);
    const first = results[0];
    expect(first?.name).toContain("ISS");
    expect(first?.elementSet.satelliteNumber).toBe("25544");
    // Epoch must be recent (hours to days old at most, since the demo checks
    // within a day of fetching).
    const ageDays = (Date.now() - (first?.elementSet.epoch.getTime() ?? 0)) / 86_400_000;
    expect(ageDays).toBeGreaterThan(-1);
    expect(ageDays).toBeLessThan(30);
  }, 30_000);
});
