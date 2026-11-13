/**
 * Visible-window tests (src/domain/passes/visibility.ts).
 *
 * Real input, physical checks — not implementation mirrors:
 *  - Vanguard 1 from the official SGP4-VER.TLE fixture, propagated over 24 h
 *    from its epoch for observers spread in longitude, so passes land at
 *    dusk, dawn, night, and day.
 *  - Every window edge is checked against the light primitives directly: the
 *    satellite must be sunlit and the sky dark just inside each refined edge,
 *    and the visibility conditions must fail just outside it (unless the edge
 *    is the pass's own rise/set). A shadow-labelled edge must have the
 *    satellite in shadow just outside it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findPasses } from "@/domain/passes/finder";
import { enrichPassVisibility, SKY_DARKNESS_SUN_ELEVATION_DEG } from "@/domain/passes/visibility";
import { compileElementSet } from "@/domain/orbit/propagation";
import { parseTle } from "@/domain/orbit/tle";
import { propagateState } from "@/integrations/sgp4/adapter";
import { satelliteInSunlight, sunElevationDegAt } from "@/domain/light/solar";
import type { ObserverLocation } from "@/domain/orbit/coordinates";
import type { PassResult } from "@/domain/passes/types";

const lines = readFileSync("tests/fixtures/SGP4-VER.TLE", "utf8").replace(/\r/g, "").split("\n");
const vanguard = compileElementSet(
  parseTle(lines.find((l) => l.startsWith("1 00005")) ?? "", (lines.find((l) => l.startsWith("2 00005")) ?? "").slice(0, 69)),
);

const windowStart = new Date("2000-06-27T18:50:19.733Z"); // element-set epoch
const windowEnd = new Date(windowStart.getTime() + 24 * 3_600_000);

const OBSERVERS: ObserverLocation[] = [
  { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 },
  { latitudeDeg: 40, longitudeDeg: 30, heightKm: 0 },
  { latitudeDeg: -30, longitudeDeg: 150, heightKm: 0 },
  { latitudeDeg: 0, longitudeDeg: 0, heightKm: 0 },
  { latitudeDeg: 35, longitudeDeg: 100, heightKm: 0 },
  { latitudeDeg: -20, longitudeDeg: -60, heightKm: 0 },
];

function lit(time: Date): boolean {
  const s = propagateState(vanguard.satrec, time);
  return satelliteInSunlight({ x: s.teme.positionKm[0], y: s.teme.positionKm[1], z: s.teme.positionKm[2] }, time);
}

function visibleAt(observer: ObserverLocation, time: Date): boolean {
  return lit(time) && sunElevationDegAt(time, observer) < SKY_DARKNESS_SUN_ELEVATION_DEG;
}

const cases = OBSERVERS.flatMap((observer) =>
  (findPasses({ compiled: [vanguard], observer, windowStart, windowEnd, minElevationDeg: 10 })[0]?.passes ?? [])
    .filter((pass: PassResult) => pass.truncated !== "both")
    .map((pass) => ({
      observer,
      pass,
      visibility: enrichPassVisibility({ satrec: vanguard.satrec, pass, observer, windowStart, windowEnd, standardMagnitude: null }),
    })),
);
const visible = cases.filter((c) => c.visibility.fromGround);

describe("brightness honesty", () => {
  it("never estimates a magnitude for an object without a published standard magnitude", () => {
    for (const { visibility } of visible) expect(visibility.bestEstimatedMagnitude).toBeNull();
  });

  it("estimates one when a standard magnitude is supplied, without changing the verdict or window", () => {
    // Vanguard 1 is listed by Heavens-Above at 10.3 (1000 km, 50% illuminated)
    // — a value used here only as an input, not asserted as truth.
    for (const { observer, pass, visibility } of visible) {
      const withStd = enrichPassVisibility({ satrec: vanguard.satrec, pass, observer, windowStart, windowEnd, standardMagnitude: 10.3 });
      expect(withStd.bestEstimatedMagnitude).not.toBeNull();
      expect(withStd.bestEstimatedMagnitude as number).toBeGreaterThan(5); // a 16 cm sphere is never naked-eye
      expect(withStd.visibleWindow).toEqual(visibility.visibleWindow);
      expect(withStd.bestTimeMs).toBe(visibility.bestTimeMs);
    }
  });
});

describe("visible window", () => {
  it("the fixture spans both visible and invisible passes (tests below are not vacuous)", () => {
    expect(visible.length).toBeGreaterThan(0);
    expect(cases.length - visible.length).toBeGreaterThan(0);
    expect(visible.some((c) => c.visibility.visibleWindow?.endsInShadow || c.visibility.visibleWindow?.startsFromShadow)).toBe(true);
  });

  it("exists exactly when the pass is visible from the ground", () => {
    for (const { visibility } of cases) {
      expect(visibility.visibleWindow !== null).toBe(visibility.fromGround);
    }
  });

  it("sits inside the pass and contains the brightest moment", () => {
    for (const { pass, visibility } of visible) {
      const w = visibility.visibleWindow;
      if (!w) throw new Error("visible pass without a window");
      const lo = (pass.rise ?? windowStart).getTime();
      const hi = (pass.set ?? windowEnd).getTime();
      expect(w.start.timeMs).toBeGreaterThanOrEqual(lo - 1);
      expect(w.end.timeMs).toBeLessThanOrEqual(hi + 1);
      expect(w.start.timeMs).toBeLessThanOrEqual(w.end.timeMs);
      expect(visibility.bestTimeMs).not.toBeNull();
      expect(visibility.bestTimeMs as number).toBeGreaterThanOrEqual(w.start.timeMs - 1);
      expect(visibility.bestTimeMs as number).toBeLessThanOrEqual(w.end.timeMs + 1);
      // Edge look angles are real sky positions above the pass threshold.
      expect(w.start.elevationDeg).toBeGreaterThanOrEqual(9.5);
      expect(w.end.elevationDeg).toBeGreaterThanOrEqual(9.5);
      expect(w.start.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(w.start.azimuthDeg).toBeLessThan(360);
    }
  });

  it("refines mid-pass edges to within ~2 s of the real light transition", () => {
    for (const { observer, pass, visibility } of visible) {
      const w = visibility.visibleWindow;
      if (!w) continue;
      const lo = (pass.rise ?? windowStart).getTime();
      const hi = (pass.set ?? windowEnd).getTime();

      expect(visibleAt(observer, new Date(w.start.timeMs + 500))).toBe(true);
      expect(visibleAt(observer, new Date(w.end.timeMs - 500))).toBe(true);
      if (w.start.timeMs - lo > 5_000) {
        expect(visibleAt(observer, new Date(w.start.timeMs - 2_000))).toBe(false);
      }
      if (hi - w.end.timeMs > 5_000) {
        expect(visibleAt(observer, new Date(w.end.timeMs + 2_000))).toBe(false);
      }
      if (w.startsFromShadow) expect(lit(new Date(w.start.timeMs - 2_000))).toBe(false);
      if (w.endsInShadow) expect(lit(new Date(w.end.timeMs + 2_000))).toBe(false);
    }
  });
});

describe("sky track (the sky chart's path)", () => {
  const angleGap = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

  it("runs rise → set along the pass, uniform in time, never above the apex or below the threshold", () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const { pass, visibility } of cases) {
      const track = visibility.skyTrack;
      expect(track.length).toBe(24);
      const step = (track[1] as (typeof track)[number]).timeMs - (track[0] as (typeof track)[number]).timeMs;
      for (let i = 1; i < track.length; i++) {
        expect(Math.abs((track[i] as (typeof track)[number]).timeMs - (track[i - 1] as (typeof track)[number]).timeMs - step)).toBeLessThanOrEqual(1);
      }
      for (const point of track) {
        // 0.1° slack: the wire rounds look angles to a tenth of a degree.
        expect(point.elevationDeg).toBeGreaterThanOrEqual(10 - 0.1);
        expect(point.elevationDeg).toBeLessThanOrEqual(pass.maxElevationDeg + 0.1);
      }
      const first = track[0] as (typeof track)[number];
      const last = track[track.length - 1] as (typeof track)[number];
      if (pass.rise) {
        expect(Math.abs(first.timeMs - pass.rise.getTime())).toBeLessThanOrEqual(1);
        expect(first.elevationDeg).toBeCloseTo(10, 0);
        expect(angleGap(first.azimuthDeg, pass.azimuthAtRiseDeg as number)).toBeLessThan(0.2);
      }
      if (pass.set) {
        expect(Math.abs(last.timeMs - pass.set.getTime())).toBeLessThanOrEqual(1);
        expect(angleGap(last.azimuthDeg, pass.azimuthAtSetDeg as number)).toBeLessThan(0.2);
      }
    }
  });

  it("passes through the visible window: every track point inside it is a visible instant", () => {
    for (const { observer, visibility } of visible) {
      const w = visibility.visibleWindow;
      if (!w) continue;
      for (const point of visibility.skyTrack) {
        if (point.timeMs > w.start.timeMs && point.timeMs < w.end.timeMs) {
          expect(visibleAt(observer, new Date(point.timeMs))).toBe(true);
        }
      }
    }
  });
});
