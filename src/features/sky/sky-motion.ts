/**
 * Whole-sky motion between SGP4 sweeps — pure, JSX-free, unit-tested.
 *
 * The worker runs SGP4 for every object in one sweep and sends each object's
 * Earth-fixed position *and velocity*. Between sweeps the globe moves every
 * dot along that velocity to the instant it is drawing:
 *
 *   p(t) = p(sweep) + v(sweep) × (t − sweep)
 *
 * A straight line drifts from the curved orbit by about ½·a·Δt² (gravity in
 * low orbit is ~8.7 m/s²): ~110 m after 5 s, ~1 km after 15 s — well under a
 * pixel at globe scale. So SGP4 recomputes every object at least every
 * `SWEEP_HORIZON_SIM_MS` of simulated time, and the dots glide smoothly at
 * any clock rate instead of jumping when their batch comes round.
 *
 * (Before: 600-object batches every 140 ms, so each dot moved once per
 * ~2.5 s — at 60× a low-orbit dot jumped ~1,100 km at a time — and every
 * batch cost ~600 separate GPU buffer uploads.)
 */

/** Earth's rotation rate (IERS, rad/s) — the Earth-fixed frame turns at this rate. */
export const EARTH_ROTATION_RAD_PER_S = 7.292115e-5;

/** Longest simulated span a dot is moved in a straight line before SGP4 recomputes it. */
export const SWEEP_HORIZON_SIM_MS = 15_000;

/**
 * A sweep older (or newer) than this relative to the drawn instant belongs to
 * a different moment — the clock jumped (slider). Hold the dots where they
 * are until the fresh sweep for the new instant arrives (milliseconds later).
 */
export const MAX_EXTRAPOLATION_SIM_MS = 2 * SWEEP_HORIZON_SIM_MS;

const MIN_SWEEP_INTERVAL_MS = 250;
const MAX_SWEEP_INTERVAL_MS = 5_000;

/**
 * Wall-clock time between sweeps at a clock rate (simulated ms per wall ms):
 * every 5 s live, every ¼ s at 60×. Paused ⇒ null: one sweep at the chosen
 * instant is exact, and nothing moves until the clock does.
 */
export function sweepIntervalMs(rate: number): number | null {
  if (!(rate > 0)) return null;
  return Math.min(MAX_SWEEP_INTERVAL_MS, Math.max(MIN_SWEEP_INTERVAL_MS, SWEEP_HORIZON_SIM_MS / rate));
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * SGP4's TEME state (km, km/s) → Earth-fixed state (m, m/s), written at
 * `index` into flat [x, y, z] arrays.
 *
 * Position: rotation by GMST about the pole — the same rotation
 * satellite.js's `eciToEcf` applies (no polar motion; metres-level, far below
 * a pixel). Velocity is taken *in the rotating frame*:
 * v_ef = R·v_teme − ω × r_ef, so a dot at rest over the ground (GEO) has
 * ~zero velocity and stays put.
 */
export function temeToEarthFixed(
  r: Vec3,
  v: Vec3,
  gmst: number,
  positions: Float32Array,
  velocities: Float32Array,
  index: number,
): void {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const x = (r.x * c + r.y * s) * 1000;
  const y = (-r.x * s + r.y * c) * 1000;
  const z = r.z * 1000;
  const o = index * 3;
  positions[o] = x;
  positions[o + 1] = y;
  positions[o + 2] = z;
  velocities[o] = (v.x * c + v.y * s) * 1000 + EARTH_ROTATION_RAD_PER_S * y;
  velocities[o + 1] = (-v.x * s + v.y * c) * 1000 - EARTH_ROTATION_RAD_PER_S * x;
  velocities[o + 2] = v.z * 1000;
}
