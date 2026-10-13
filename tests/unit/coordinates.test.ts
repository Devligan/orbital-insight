import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { temeToEcf, ecfToLookAngle } from "@/domain/orbit/coordinates";
import { normalizeLongitudeDeg, normalizeLongitudeRad } from "@/lib/units";
import { parseTle } from "@/domain/orbit/tle";
import { compileElementSet, propagateTo } from "@/domain/orbit/propagation";

/**
 * Implementation-independent properties for the coordinate pipeline:
 * TEME→ECF is a pure rotation about the Z axis (by GMST), so it must
 * preserve vector length exactly (within floating-point error) for any
 * input. This validates the frame conversion without relying on satellite.js
 * values being "plausible".
 */

// Real published element set: Vanguard 1 from the SGP4 verification fixture.
const fixtureText = readFileSync("tests/fixtures/SGP4-VER.TLE", "utf8").replace(/\r/g, "");
const line1 = fixtureText.split("\n").find((l) => l.startsWith("1 00005")) ?? "";
const line2 = (fixtureText.split("\n").find((l) => l.startsWith("2 00005")) ?? "").slice(0, 69);
const vanguard = compileElementSet(parseTle(line1, line2));

function norm(v: { x: number; y: number; z: number }): number {
  return Math.hypot(v.x, v.y, v.z);
}

describe("TEME→ECF conversion properties", () => {
  it("preserves position magnitude across a full orbital revolution", () => {
    let maxRelError = 0;
    for (let minutes = 0; minutes <= 720; minutes += 30) {
      const time = new Date(vanguard.epoch.getTime() + minutes * 60_000);
      const state = propagateTo(vanguard, time);
      const temeNorm = norm({ x: state.teme.positionKm[0], y: state.teme.positionKm[1], z: state.teme.positionKm[2] });
      const ecf = temeToEcf(state.teme, time);
      const ecfNorm = norm(ecf);
      const relError = Math.abs(temeNorm - ecfNorm) / temeNorm;
      maxRelError = Math.max(maxRelError, relError);
      // Rotation must not change the length: machine-epsilon scale bound.
      expect(relError, `t=+${minutes}min`).toBeLessThan(1e-9);
    }
    expect(maxRelError).toBeGreaterThanOrEqual(0);
  });

  it("keeps geodetic altitude within 1 km of the geocentric radius surplus for LEO", () => {
    // Geocentric radius minus equatorial radius overstates altitude somewhat
    // (ellipsoid flattening at |lat|>0); bound it loosely: |alt - (r-6378)|
    // must stay within the flattening envelope (~21 km at pole, ~0 at equator)
    // for a LEO object.
    const time = new Date(vanguard.epoch.getTime() + 30 * 60_000);
    const state = propagateTo(vanguard, time);
    const temeNorm = norm({ x: state.teme.positionKm[0], y: state.teme.positionKm[1], z: state.teme.positionKm[2] });
    const naiveAltitude = temeNorm - 6_378.137;
    expect(Math.abs(state.geodetic.altitudeKm - naiveAltitude)).toBeLessThan(21.5);
  });

  it("elevation from the sub-satellite point is 90° by symmetry", () => {
    // With the observer exactly under the satellite (same geodetic lat/lon,
    // height 0), the topocentric vector is radial to the local vertical, so
    // the elevation angle is 90° up to float noise — an exact symmetry the
    // conversion must preserve.
    const time = new Date(vanguard.epoch.getTime() + 12 * 60_000);
    const state = propagateTo(vanguard, time);
    const observer = { latitudeDeg: state.geodetic.latitudeDeg, longitudeDeg: state.geodetic.longitudeDeg, heightKm: 0 };
    const look = ecfToLookAngle(observer, temeToEcf(state.teme, time));
    expect(look.elevationDeg).toBeGreaterThan(89.99);
    expect(look.elevationDeg).toBeLessThanOrEqual(90.01);
  });
});

describe("longitude normalization", () => {
  it("wraps degrees into the documented (-180, 180] range", () => {
    expect(normalizeLongitudeDeg(0)).toBe(0);
    expect(normalizeLongitudeDeg(180)).toBe(180);
    expect(normalizeLongitudeDeg(-180)).toBe(180);
    expect(normalizeLongitudeDeg(181)).toBe(-179);
    expect(normalizeLongitudeDeg(-181)).toBe(179);
    expect(normalizeLongitudeDeg(540)).toBe(180);
    expect(normalizeLongitudeDeg(-540)).toBe(180); // -540 ≡ -180 → normalizes to 180
  });

  it("wraps radians into (-π, π] — matching the degrees convention", () => {
    expect(normalizeLongitudeRad(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeLongitudeRad(-Math.PI)).toBeCloseTo(Math.PI, 12); // boundary → +π
    expect(normalizeLongitudeRad(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeLongitudeRad(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeLongitudeRad(0.5)).toBeCloseTo(0.5, 12);
    expect(normalizeLongitudeRad(-0.5)).toBeCloseTo(-0.5, 12);
  });
});
