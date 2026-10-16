/**
 * Solar-light unit tests.
 *
 * Known-value anchors (not implementation mirrors):
 *  - Solstice/equinox solar declination from the low-precision ephemeris
 *    must land within ±0.5° of published values (±23.44° / 0°) — the
 *    documented algorithm accuracy is ~0.01°, so this keeps the test honest
 *    about physics rather than about our own coefficients.
 *  - Shadow test on hand-built geometry vectors (sun side / night side /
 *    wide miss / grazing orbit altitudes over the pole).
 *  - Magnitude model: the working point the formula is normalized to
 *    (std magnitude at 1 000 km, half-phase reference ≈ 0 m per the
 *    documented contract) plus monotonicity in range and phase.
 */

import { describe, expect, it } from "vitest";
import {
  EARTH_RADIUS_KM,
  phaseAngleDeg,
  satelliteInSunlight,
  sunDirection,
  sunEciKm,
  sunElevationDegAt,
} from "@/domain/light/solar";
import { estimateMagnitude } from "@/domain/passes/visibility";
import type { ObserverLocation } from "@/domain/orbit/coordinates";


/** NASA JPL: June solstice dec = +23.44°, December −23.44°, equinoxes 0°. */
function solarDeclination(date: Date): number {
  const sun = sunEciKm(date);
  const r = Math.hypot(sun.x, sun.y, sun.z);
  return (Math.asin(sun.z / r) * 180) / Math.PI;
}

describe("sun position (low-precision ephemeris)", () => {
  it("June solstice → declination near +23.44°", () => {
    expect(solarDeclination(new Date("2026-06-21T08:00:00Z"))).toBeCloseTo(23.44, 0);
  });

  it("December solstice → declination near −23.44°", () => {
    expect(solarDeclination(new Date("2026-12-21T15:00:00Z"))).toBeCloseTo(-23.44, 0);
  });

  it("equinoxes → declination near 0°", () => {
    expect(Math.abs(solarDeclination(new Date("2026-03-20T14:00:00Z")))).toBeLessThan(0.5);
    expect(Math.abs(solarDeclination(new Date("2026-09-23T06:00:00Z")))).toBeLessThan(0.5);
  });

  it("ranges stay physical", () => {
    const date = new Date("2026-10-16T12:00:00Z");
    const sun = sunEciKm(date);
    const r = Math.hypot(sun.x, sun.y, sun.z);
    // 0.98–1.02 AU across the year; one instant must land in the band.
    expect(r).toBeGreaterThan(0.98 * 149_597_870.7);
    expect(r).toBeLessThan(1.02 * 149_597_870.7);
    const unit = sunDirection(date);
    expect(Math.hypot(unit.x, unit.y, unit.z)).toBeCloseTo(1, 12);
  });
});

const ATLANTA: ObserverLocation = { latitudeDeg: 33.749, longitudeDeg: -84.388, heightKm: 0.32 };

describe("sun elevation at an observer", () => {
  it("noon on the June solstice at 51°N is high (≈ 60–65°) near London", () => {
    const london: ObserverLocation = { latitudeDeg: 51.5, longitudeDeg: -0.13, heightKm: 0 };
    // ~12:00 BST = 11:00 UTC, longitude −0.13° shifts solar noon ~30 s.
    const elev = sunElevationDegAt(new Date("2026-06-21T11:58:00Z"), london);
    expect(elev).toBeGreaterThan(58);
    expect(elev).toBeLessThan(66);
  });

  it("local midnight is far below the horizon", () => {
    // Atlanta is UTC−4 in summer: true local midnight ≈ 04:00Z; at the
    // June solstice the antisolar point sits near −33° there.
    const elev = sunElevationDegAt(new Date("2026-06-21T04:15:00Z"), ATLANTA);
    expect(elev).toBeLessThan(-25);
  });
});

describe("satellite illumination (cylindrical shadow)", () => {
  it("a satellite aligned toward the sun is lit", () => {
    // Sun direction (roughly +x/−y mix, no z) at 2026-10-16.
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    const sat = { x: s.x * 7000, y: s.y * 7000, z: s.z * 7000 };
    expect(satelliteInSunlight(sat, date)).toBe(true);
  });

  it("a satellite diametrically behind Earth is eclipsed", () => {
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    const sat = { x: -s.x * 7000, y: -s.y * 7000, z: -s.z * 7000 };
    expect(satelliteInSunlight(sat, date)).toBe(false);
  });

  it("a satellite on the night side but far off the shadow axis is lit", () => {
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    // Behind Earth, displaced sideways by 2 Earth radii perpendicular to the shadow.
    const off = { x: s.z, y: 0, z: -s.x }; // one unit vector ⊥ to s in the xy-plane… verify
    // Build strictly orthogonal helper numerically:
    const proj = off.x * s.x + off.y * s.y + off.z * s.z;
    const perp = { x: off.x - proj * s.x, y: off.y - proj * s.y, z: off.z - proj * s.z };
    const n = Math.hypot(perp.x, perp.y, perp.z);
    const perpUnit = { x: perp.x / n, y: perp.y / n, z: perp.z / n };
    const sat = {
      x: -s.x * 7000 + perpUnit.x * 2 * EARTH_RADIUS_KM,
      y: -s.y * 7000 + perpUnit.y * 2 * EARTH_RADIUS_KM,
      z: -s.z * 7000 + perpUnit.z * 2 * EARTH_RADIUS_KM,
    };
    expect(satelliteInSunlight(sat, date)).toBe(true);
  });

  it("a night-side satellite at grazing distance inside the shadow cylinder is eclipsed", () => {
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    const sat = {
      x: -s.x * 7000 + s.z * EARTH_RADIUS_KM * 0.5,
      y: -s.y * 7000,
      z: -s.z * 7000 - s.x * EARTH_RADIUS_KM * 0.5,
    };
    expect(satelliteInSunlight(sat, date)).toBe(false);
  });
});

describe("phase angle", () => {
  // Synthetic collinear geocentric vectors (the function is pure math — the
  // "observer" vectors here need not be on Earth's surface).
  it("is ~0° when the observer lies beyond the satellite, same side as the sun", () => {
    // Satellite sees the sun and the observer in the same direction — the
    // fully lit face faces the observer (like a full moon).
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    const sat = { x: s.x * 7000, y: s.y * 7000, z: s.z * 7000 };
    const observer = { x: s.x * 12000, y: s.y * 12000, z: s.z * 12000 };
    expect(phaseAngleDeg(sat, observer, date)).toBeLessThan(1);
  });

  it("is ~180° when the observer sits between the satellite and the sun", () => {
    // The observer then looks at the satellite's dark face — new-moon
    // geometry — which is also why overhead passes near local noon are
    // invisible even with the satellite fully sunlit above the atmosphere.
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    const sat = { x: s.x * 7000, y: s.y * 7000, z: s.z * 7000 };
    const observer = { x: s.x * 2000, y: s.y * 2000, z: s.z * 2000 };
    expect(phaseAngleDeg(sat, observer, date)).toBeGreaterThan(179);
  });

  it("matches the physical near-noon-overhead case for a ground observer", () => {
    // A satellite directly between a ground observer and the sun (local
    // noon, overhead): the observer sees the dark face → phase ≈ 180°.
    const date = new Date("2026-10-16T12:00:00Z");
    const s = sunDirection(date);
    const sat = { x: s.x * 6_778, y: s.y * 6_778, z: s.z * 6_778 }; // ~400 km alt
    const observer = { x: s.x * EARTH_RADIUS_KM, y: s.y * EARTH_RADIUS_KM, z: s.z * EARTH_RADIUS_KM };
    expect(phaseAngleDeg(sat, observer, date)).toBeGreaterThan(179);
  });
});

describe("apparent magnitude model", () => {
  it("adds the documented +0.75 half-phase correction at 1 000 km", () => {
    // m = m₀ − 15 + 5·log10(range) − 2.5·log10((1+cos φ)/2).
    // At range 1 000 km the range terms cancel (−15 + 5·log10(1000) = 0),
    // leaving only the phase term: −2.5·log10(0.5) ≈ +0.75.
    const halfPhase = estimateMagnitude(0, 1_000, 90);
    expect(halfPhase).toBeCloseTo(0.75, 2);
  });

  it("is brightest fully lit at close range and dims with range", () => {
    const zenith = estimateMagnitude(0, 450, 0);
    const horizon = estimateMagnitude(0, 1_800, 0);
    expect(zenith).toBeLessThan(horizon);
    // ISS-like zenith pass at ~450 km reads near −2 — inside the band the
    // real sky shows for ISS-class passes:
    expect(zenith).toBeGreaterThan(-3.5);
    expect(zenith).toBeLessThan(-1);
  });

  it("full phase (0°) is brighter than half phase (90°)", () => {
    expect(estimateMagnitude(0, 450, 0)).toBeLessThan(estimateMagnitude(0, 450, 90));
    expect(estimateMagnitude(0, 450, 150)).toBeGreaterThan(estimateMagnitude(0, 450, 90));
  });

  it("counts the ISS zenith pass as conspicuous, not marginal", () => {
    // The public promise: this pass is unmistakable, not "binoculars".
    const m = estimateMagnitude(0, 450, 20);
    expect(m).toBeLessThan(1);
  });
});
