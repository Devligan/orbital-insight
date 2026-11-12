import { describe, expect, it } from "vitest";
import { screen, type ScreeningBody } from "@/domain/conjunction/screening";
import { sgp4Body } from "@/features/conjunctions/sgp4-body";

/**
 * Real element sets (CelesTrak, epoch 2026-11-12): the ISS's modules, a
 * Progress docked to it, and China's station complex. Pinned here so the
 * test is reproducible; the window starts at the ISS element epoch.
 */
const ROWS: [string, string, string, string][] = [
  ["25544", "ISS (ZARYA)", "1 25544U 98067A   26316.43260916  .00008191  00000+0  15481-3 0  9999", "2 25544  51.6324 286.4897 0007327  17.4271 342.6968 15.49332729594739"],
  ["25575", "ISS (UNITY)", "1 25575U 98069F   26316.43260916  .00008191  00000+0  15481-3 0  9995", "2 25575  51.6324 286.4897 0007327  17.4271 342.6968 15.49332729586565"],
  ["26400", "ISS (ZVEZDA)", "1 26400U 00037A   26316.43260916  .00008191  00000+0  15481-3 0  9991", "2 26400  51.6324 286.4897 0007327  17.4271 342.6968 15.49332729586686"],
  ["49044", "ISS (NAUKA)", "1 49044U 21066A   26316.43260916  .00008191  00000+0  15481-3 0  9995", "2 49044  51.6324 286.4897 0007327  17.4271 342.6968 15.49332729586809"],
  ["68837", "PROGRESS-MS 34", "1 68837U 26093A   26316.17460339  .00008107  00000+0  15334-3 0  9997", "2 68837  51.6324 287.7668 0007312  16.4277 343.6947 15.49327857587736"],
  ["48274", "CSS (TIANHE)", "1 48274U 21035A   26316.00641791  .00018637  00000+0  21303-3 0  9998", "2 48274  41.4672 143.7353 0004511 294.0218  66.0149 15.61714975316253"],
  ["54216", "CSS (MENGTIAN)", "1 54216U 22143A   26316.00641791  .00018637  00000+0  21303-3 0  9992", "2 54216  41.4672 143.7353 0004512 294.0217  66.0149 15.61714975308606"],
];

const bodies = ROWS.map(([id, name, l1, l2]) => sgp4Body(id, name, l1, l2)).filter((b): b is ScreeningBody => b !== null);
const iss = bodies.find((b) => b.id === "25544")!;
// Day 316.43260916 of 2026.
const EPOCH_MS = Date.UTC(2026, 0, 1) + (316.43260916 - 1) * 86_400_000;

describe("screening with SGP4 on real element sets", () => {
  it("compiles every row", () => {
    expect(bodies).toHaveLength(ROWS.length);
    // Keplerian radii from mean motion: the ISS sits ~6,790–6,800 km from Earth's centre.
    expect(iss.perigeeRadiusKm).toBeGreaterThan(6_780);
    expect(iss.apogeeRadiusKm).toBeLessThan(6_810);
  });

  it("treats docked modules and a docked Progress as co-orbiting, never as approaches", () => {
    const result = screen(iss, bodies, { startMs: EPOCH_MS, durationMinutes: 24 * 60, thresholdKm: 25 });
    const issFamily = new Set(["25575", "26400", "49044", "68837"]);
    expect(result.approaches.filter((a) => issFamily.has(a.id))).toEqual([]);
    expect(result.coOrbiting.map((c) => c.id).sort()).toEqual([...issFamily].sort());
    // Modules share the ISS element set: zero separation, exactly.
    expect(result.coOrbiting.find((c) => c.id === "26400")!.closestKm).toBe(0);
    // The target itself is never a candidate; China's station is ~40 km lower but within reach of the filter.
    expect(result.stats.afterRadiusFilter).toBe(ROWS.length - 1);
  });

  it("stays fast enough for a browser worker", () => {
    // 24 h at 60 s for 6 candidates: a few thousand propagations, well under a second.
    const started = performance.now();
    const result = screen(iss, bodies, { startMs: EPOCH_MS, durationMinutes: 24 * 60, thresholdKm: 25 });
    expect(result.stats.propagations).toBeLessThan(20_000);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
