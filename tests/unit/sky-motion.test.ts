import { describe, expect, it } from "vitest";
import { eciToEcf, gstime, sgp4, twoline2satrec } from "satellite.js";
import {
  EARTH_ROTATION_RAD_PER_S,
  SWEEP_HORIZON_SIM_MS,
  sweepIntervalMs,
  temeToEarthFixed,
} from "@/features/sky/sky-motion";

/**
 * The whole-sky cloud is drawn from SGP4 sweeps plus straight-line motion
 * between them. These pin the frame conversion against satellite.js and the
 * straight-line error against SGP4 itself, for a real element set.
 */

// ISS (ZARYA), CelesTrak, epoch 2026-10-15 (the bundled search-index snapshot).
const ISS_L1 = "1 25544U 98067A   26288.82192346  .00005580  00000+0  10980-3 0  9999";
const ISS_L2 = "2 25544  51.6317  63.1136 0006755 265.8514  94.1703 15.48879905590452";
const satrec = twoline2satrec(ISS_L1, ISS_L2);
const EPOCH_MS = (satrec.jdsatepoch - 2_440_587.5) * 86_400_000;

function earthFixedAt(tMs: number) {
  const state = sgp4(satrec, (tMs - EPOCH_MS) / 60_000) as {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
  };
  const gmst = gstime(new Date(tMs));
  const positions = new Float32Array(3);
  const velocities = new Float32Array(3);
  temeToEarthFixed(state.position, state.velocity, gmst, positions, velocities, 0);
  return { state, gmst, positions, velocities };
}

const T0 = EPOCH_MS + 6 * 3_600_000;

describe("TEME → Earth-fixed state", () => {
  it("places the position exactly where satellite.js's eciToEcf does (km → m)", () => {
    const { state, gmst, positions } = earthFixedAt(T0);
    const reference = eciToEcf(state.position, gmst);
    expect(positions[0]).toBeCloseTo(reference.x * 1000, -1); // Float32: ~0.5 m at 7,000 km
    expect(positions[1]).toBeCloseTo(reference.y * 1000, -1);
    expect(positions[2]).toBeCloseTo(reference.z * 1000, -1);
  });

  it("gives a point turning with the Earth (a geostationary slot) zero Earth-fixed velocity", () => {
    const gmst = 1.234;
    const radiusKm = 42_164;
    // At rest over longitude 30°: inertial position rotated by GMST, inertial velocity ω × r.
    const angle = gmst + (30 * Math.PI) / 180;
    const r = { x: radiusKm * Math.cos(angle), y: radiusKm * Math.sin(angle), z: 0 };
    const v = { x: -EARTH_ROTATION_RAD_PER_S * r.y, y: EARTH_ROTATION_RAD_PER_S * r.x, z: 0 };
    const positions = new Float32Array(3);
    const velocities = new Float32Array(3);
    temeToEarthFixed(r, v, gmst, positions, velocities, 0);
    expect(Math.hypot(velocities[0]!, velocities[1]!, velocities[2]!)).toBeLessThan(0.01); // m/s
    const longitude = (Math.atan2(positions[1]!, positions[0]!) * 180) / Math.PI;
    expect(longitude).toBeCloseTo(30, 5); // Float32 storage: 1e-5° ≈ 7 m at 42,164 km
  });

  it("gives the ISS a plausible ground-relative speed (orbital ~7.66 km/s minus Earth's spin)", () => {
    const { velocities } = earthFixedAt(T0);
    const speed = Math.hypot(velocities[0]!, velocities[1]!, velocities[2]!);
    expect(speed).toBeGreaterThan(7_100);
    expect(speed).toBeLessThan(7_700);
  });
});

describe("straight-line motion between sweeps stays on the orbit", () => {
  it.each([
    [5_000, 200],
    [SWEEP_HORIZON_SIM_MS, 1_500],
  ])("after %i ms the extrapolated ISS is within %i m of SGP4", (dtMs, toleranceM) => {
    const sweep = earthFixedAt(T0);
    const truth = earthFixedAt(T0 + dtMs);
    const dt = dtMs / 1000;
    const error = Math.hypot(
      sweep.positions[0]! + sweep.velocities[0]! * dt - truth.positions[0]!,
      sweep.positions[1]! + sweep.velocities[1]! * dt - truth.positions[1]!,
      sweep.positions[2]! + sweep.velocities[2]! * dt - truth.positions[2]!,
    );
    expect(error).toBeLessThan(toleranceM);
  });
});

describe("sweep scheduling", () => {
  it("sweeps every 5 s live, every ¼ s at 60×, and not at all while paused", () => {
    expect(sweepIntervalMs(1)).toBe(5_000);
    expect(sweepIntervalMs(60)).toBe(250);
    expect(sweepIntervalMs(0)).toBeNull();
  });

  it("never lets a dot travel more than the horizon in a straight line", () => {
    for (const rate of [1, 2, 10, 30, 60]) {
      expect(sweepIntervalMs(rate)! * rate).toBeLessThanOrEqual(SWEEP_HORIZON_SIM_MS);
    }
  });
});
