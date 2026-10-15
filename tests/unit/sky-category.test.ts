import { describe, expect, it } from "vitest";
import { categoryOf } from "@/features/sky/category";

/**
 * Classification feeds the whole-sky legend's honesty contract: bands are
 * derived from the element set (mean motion + eccentricity), never guessed.
 * Boundaries: LEO < 129 min; GEO belt ≈ 23.93 h ± drift; ecc > 0.25 → HEO.
 */
describe("orbit-band classification", () => {
  it("classifies LEO by period below ~129 minutes (ISS regime)", () => {
    // 15.5 rev/day ≈ 92.9 min — mean motion in rad/min (satellite.js `no`)
    expect(categoryOf({ no: (15.5 * 2 * Math.PI) / 1440, ecco: 0.0005 })).toBe(0);
  });

  it("classifies MEO by 2–13 rev/day (GNSS regime)", () => {
    // GPS: 2.0056 rev/day ≈ 718 min
    expect(categoryOf({ no: (2.00565 * 2 * Math.PI) / 1440, ecco: 0.01 })).toBe(1);
  });

  it("classifies the GEO belt around the geostationary period", () => {
    // 1.0027 rev/day ≈ 1436 min
    expect(categoryOf({ no: (1.0027 * 2 * Math.PI) / 1440, ecco: 0.0002 })).toBe(2);
  });

  it("classifies strongly eccentric objects as HEO before any period rule", () => {
    // Molniya regime: ~2 rev/day but ecc ≈ 0.74
    expect(categoryOf({ no: (2.006 * 2 * Math.PI) / 1440, ecco: 0.74 })).toBe(3);
  });

  it("degrades gracefully when mean motion is missing (defaults to LEO band edge)", () => {
    expect(categoryOf({})).toBe(0);
  });
});
