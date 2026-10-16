/**
 * The km → m bridge into Cesium: an ISS-like sample must land ~400 km above
 * the surface, not inside the Earth (which is where raw km values put it).
 */

import { describe, expect, it } from "vitest";
import { ecfKmToMeters } from "@/features/orbit-visualization/cesium-units";

describe("ecfKmToMeters", () => {
  it("puts an ISS-altitude sample ~400 km above the surface in Cesium's metre frame", () => {
    // 6 798 km from the geocentre on the equator ≈ 420 km altitude.
    const m = ecfKmToMeters({ x: 6_798, y: 0, z: 0 });
    const radiusM = Math.hypot(m.x, m.y, m.z);
    const altitudeKm = (radiusM - 6_378_137) / 1_000;
    expect(altitudeKm).toBeGreaterThan(400);
    expect(altitudeKm).toBeLessThan(440);
  });

  it("scales every axis", () => {
    expect(ecfKmToMeters({ x: 1, y: -2, z: 3.5 })).toEqual({ x: 1_000, y: -2_000, z: 3_500 });
  });
});
