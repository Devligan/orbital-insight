/**
 * Conjunction screening: when does one object pass close to any other?
 *
 * The classic filter chain (after Hoots, Crawford & Roehrich 1984), sized for a
 * browser worker over the ~16k-object active catalog:
 *
 *  1. Radius filter. Two orbits whose radial ranges [perigee, apogee] don't
 *     overlap (within the screening distance plus a pad) can never come
 *     close. This drops ~95–98% of candidates for a typical LEO target.
 *  2. Sampled sweep. Survivors are propagated on a fixed time grid together
 *     with the target; a local minimum of the sampled separation brackets each
 *     true approach. Between samples the separation can shrink by at most
 *     (relative speed × step), so minima whose sampled distance exceeds
 *     threshold + MAX_RELATIVE_SPEED × step are provably outside the threshold
 *     and are dropped without refinement. The same bound lets the sweep jump
 *     over spans where no approach is possible (time skipping): from distance
 *     d, nothing gets within the threshold for (d − threshold) / MAX_RELATIVE_SPEED.
 *  3. Refinement. Golden-section search on the bracketing interval finds the
 *     time of closest approach (TCA) to well under a millisecond, and the
 *     miss vector is resolved into the target's radial / in-track /
 *     cross-track frame - the components an operator reads first.
 *
 * Pure: bodies come with their own propagator, so tests drive this with exact
 * analytic orbits and the app drives it with SGP4. Frame-agnostic as long as
 * every body reports the same inertial frame (TEME for SGP4).
 *
 * Honesty: TLE-based positions are uncertain at the kilometre level and carry
 * no covariance, so this is screening (which approaches deserve a look), never
 * a collision probability.
 */

/** A head-on meeting of two circular LEO orbits is ~15.5 km/s; bound it above. */
export const MAX_RELATIVE_SPEED_KMS = 16;
/**
 * Slack on the radius filter: mean-element (Keplerian) radii differ from the
 * SGP4 osculating radius by short-period J2 terms of order 10 km in LEO.
 */
export const RADIUS_PAD_KM = 30;
/**
 * Approaches slower than this aren't encounters but co-orbiting objects:
 * docked modules, formation flyers, a satellite and the stage it just left.
 * They're reported separately instead of flooding the list every orbit.
 */
export const CO_ORBITING_SPEED_KMS = 0.05;

const GOLDEN = (Math.sqrt(5) - 1) / 2;
const MS_PER_SECOND = 1_000;

export interface ScreeningBody {
  id: string;
  name: string;
  /** Mean-element perigee and apogee radii from Earth's centre (km). */
  perigeeRadiusKm: number;
  apogeeRadiusKm: number;
  /**
   * Inertial state at epoch-ms `tMs`: writes [x, y, z, vx, vy, vz] (km, km/s)
   * into `out` at `offset`; false where the propagator has no solution.
   */
  state(tMs: number, out: Float64Array, offset: number): boolean;
}

export interface ScreeningOptions {
  startMs: number;
  durationMinutes: number;
  /** Sample spacing for the sweep; 60 s keeps every LEO approach bracketed. */
  stepSeconds?: number;
  /** Report approaches closer than this (km). */
  thresholdKm: number;
  /**
   * Jump over spans where no approach under the threshold is possible
   * (default true; false gives the brute-force sweep, used by tests to prove
   * both find the same approaches).
   */
  timeSkipping?: boolean;
  /** Called as candidates finish: (done, total). */
  onProgress?: (done: number, total: number) => void;
}

export interface CloseApproach {
  id: string;
  name: string;
  tcaMs: number;
  missKm: number;
  relativeSpeedKmS: number;
  /** Miss vector (object − target) in the target's RIC frame (km). */
  radialKm: number;
  inTrackKm: number;
  crossTrackKm: number;
}

export interface CoOrbitingObject {
  id: string;
  name: string;
  closestKm: number;
}

export interface ScreeningStats {
  catalogSize: number;
  afterRadiusFilter: number;
  minimaRefined: number;
  propagations: number;
  /** Candidates whose propagator failed somewhere in the window (decayed elements). */
  propagationFailures: number;
  windowStartMs: number;
  windowEndMs: number;
  stepSeconds: number;
}

export interface ScreeningResult {
  approaches: CloseApproach[];
  coOrbiting: CoOrbitingObject[];
  stats: ScreeningStats;
}

/** Does `body` pass the radius filter against the target's radial range? */
export function radialRangesOverlap(target: ScreeningBody, body: ScreeningBody, thresholdKm: number): boolean {
  const pad = thresholdKm + RADIUS_PAD_KM;
  return body.perigeeRadiusKm - pad <= target.apogeeRadiusKm && body.apogeeRadiusKm + pad >= target.perigeeRadiusKm;
}

/** Miss vector resolved in the target's radial / in-track / cross-track frame. */
export function ricComponents(target: Float64Array, other: Float64Array): { radial: number; inTrack: number; crossTrack: number } {
  const [rx, ry, rz, vx, vy, vz] = target as unknown as [number, number, number, number, number, number];
  const dx = other[0]! - rx;
  const dy = other[1]! - ry;
  const dz = other[2]! - rz;
  const rNorm = Math.hypot(rx, ry, rz);
  const R = [rx / rNorm, ry / rNorm, rz / rNorm] as const;
  // C = (r × v) / |r × v|
  const cx = ry * vz - rz * vy;
  const cy = rz * vx - rx * vz;
  const cz = rx * vy - ry * vx;
  const cNorm = Math.hypot(cx, cy, cz);
  const C = [cx / cNorm, cy / cNorm, cz / cNorm] as const;
  // I = C × R completes the right-handed triad (≈ along-velocity for near-circular orbits).
  const I = [C[1] * R[2] - C[2] * R[1], C[2] * R[0] - C[0] * R[2], C[0] * R[1] - C[1] * R[0]] as const;
  return {
    radial: dx * R[0] + dy * R[1] + dz * R[2],
    inTrack: dx * I[0] + dy * I[1] + dz * I[2],
    crossTrack: dx * C[0] + dy * C[1] + dz * C[2],
  };
}

/**
 * Separation (km) around an approach, sampled every `stepMs` across
 * [tcaMs − halfWindowMs, tcaMs + halfWindowMs]; NaN where either propagator fails.
 */
export function separationProfile(
  target: ScreeningBody,
  other: ScreeningBody,
  tcaMs: number,
  halfWindowMs: number,
  stepMs: number,
): { tMs: number; km: number }[] {
  const a = new Float64Array(6);
  const b = new Float64Array(6);
  const points: { tMs: number; km: number }[] = [];
  for (let t = tcaMs - halfWindowMs; t <= tcaMs + halfWindowMs + 1e-6; t += stepMs) {
    const ok = target.state(t, a, 0) && other.state(t, b, 0);
    points.push({ tMs: t, km: ok ? Math.sqrt(distanceSq(a, 0, b, 0)) : Number.NaN });
  }
  return points;
}

function distanceSq(a: Float64Array, aOff: number, b: Float64Array, bOff: number): number {
  const dx = a[aOff]! - b[bOff]!;
  const dy = a[aOff + 1]! - b[bOff + 1]!;
  const dz = a[aOff + 2]! - b[bOff + 2]!;
  return dx * dx + dy * dy + dz * dz;
}

export function screen(target: ScreeningBody, catalog: readonly ScreeningBody[], options: ScreeningOptions): ScreeningResult {
  const stepSeconds = options.stepSeconds ?? 60;
  const stepMs = stepSeconds * MS_PER_SECOND;
  const steps = Math.floor((options.durationMinutes * 60) / stepSeconds) + 1;
  if (!(options.thresholdKm > 0) || steps < 3) throw new RangeError("screen: need thresholdKm > 0 and a window of at least 3 steps");
  const startMs = options.startMs;
  const timeSkipping = options.timeSkipping ?? true;
  const gateKm = options.thresholdKm + MAX_RELATIVE_SPEED_KMS * stepSeconds;
  const gateSq = gateKm * gateKm;

  // Target states on the grid, computed once.
  const targetStates = new Float64Array(steps * 6);
  const targetOk = new Uint8Array(steps);
  for (let k = 0; k < steps; k++) targetOk[k] = target.state(startMs + k * stepMs, targetStates, k * 6) ? 1 : 0;
  let propagations = steps;

  const candidates = catalog.filter((body) => body.id !== target.id && radialRangesOverlap(target, body, options.thresholdKm));

  const approaches: CloseApproach[] = [];
  const coOrbiting = new Map<string, CoOrbitingObject>();
  let minimaRefined = 0;
  let propagationFailures = 0;

  const tState = new Float64Array(6);
  const oState = new Float64Array(6);
  const separationSqAt = (body: ScreeningBody, tMs: number): number => {
    propagations += 2;
    if (!target.state(tMs, tState, 0) || !body.state(tMs, oState, 0)) return Infinity;
    return distanceSq(tState, 0, oState, 0);
  };

  const otherState = new Float64Array(6);
  candidates.forEach((body, index) => {
    // Rolling window of the last three sampled separations.
    let prevPrev = Infinity;
    let prev = Infinity;
    let failed = false;
    let minSq = Infinity;
    let maxSq = 0;
    for (let k = 0; k < steps; k++) {
      let current = Infinity;
      if (targetOk[k]) {
        propagations += 1;
        if (body.state(startMs + k * stepMs, otherState, 0)) current = distanceSq(targetStates, k * 6, otherState, 0);
        else failed = true;
      }
      if (current < minSq) minSq = current;
      if (current > maxSq) maxSq = current;
      // Interior local minimum at k-1, within reach of the threshold → refine.
      if (k >= 2 && prev < prevPrev && prev <= current && prev <= gateSq) {
        minimaRefined += 1;
        let lo = startMs + (k - 2) * stepMs;
        let hi = startMs + k * stepMs;
        let x1 = hi - GOLDEN * (hi - lo);
        let x2 = lo + GOLDEN * (hi - lo);
        let f1 = separationSqAt(body, x1);
        let f2 = separationSqAt(body, x2);
        while (hi - lo > 0.5) {
          if (f1 <= f2) {
            hi = x2;
            x2 = x1;
            f2 = f1;
            x1 = hi - GOLDEN * (hi - lo);
            f1 = separationSqAt(body, x1);
          } else {
            lo = x1;
            x1 = x2;
            f1 = f2;
            x2 = lo + GOLDEN * (hi - lo);
            f2 = separationSqAt(body, x2);
          }
        }
        const tcaMs = (lo + hi) / 2;
        const missSq = separationSqAt(body, tcaMs);
        if (Number.isFinite(missSq) && missSq < options.thresholdKm * options.thresholdKm) {
          // tState / oState hold the TCA states from that last evaluation.
          const relativeSpeed = Math.hypot(oState[3]! - tState[3]!, oState[4]! - tState[4]!, oState[5]! - tState[5]!);
          const missKm = Math.sqrt(missSq);
          if (relativeSpeed < CO_ORBITING_SPEED_KMS) {
            const seen = coOrbiting.get(body.id);
            if (!seen || missKm < seen.closestKm) coOrbiting.set(body.id, { id: body.id, name: body.name, closestKm: missKm });
          } else {
            const ric = ricComponents(tState, oState);
            approaches.push({
              id: body.id,
              name: body.name,
              tcaMs,
              missKm,
              relativeSpeedKmS: relativeSpeed,
              radialKm: ric.radial,
              inTrackKm: ric.inTrack,
              crossTrackKm: ric.crossTrack,
            });
          }
        }
      }
      prevPrev = prev;
      prev = current;

      // Conservative time skipping: separation shrinks no faster than
      // MAX_RELATIVE_SPEED, so from distance d nothing can come within the
      // threshold for (d − threshold) / MAX_RELATIVE_SPEED seconds. Jump
      // there. The skipped samples are unknown, so the minimum bookkeeping
      // restarts; a minimum at the landing sample is still bracketed (its
      // left neighbour lies in the skipped span, where d ≥ threshold).
      if (timeSkipping && Number.isFinite(current) && current > gateSq) {
        const skip = Math.floor((Math.sqrt(current) - options.thresholdKm) / (MAX_RELATIVE_SPEED_KMS * stepSeconds));
        if (skip >= 2) {
          k += skip - 1;
          prevPrev = Infinity;
          prev = Infinity;
        }
      }
    }
    // Inside the threshold for the whole window (docked modules often share
    // one element set, so their separation is flat and has no minimum).
    if (maxSq < options.thresholdKm * options.thresholdKm && !coOrbiting.has(body.id)) {
      coOrbiting.set(body.id, { id: body.id, name: body.name, closestKm: Math.sqrt(minSq) });
    }
    if (failed) propagationFailures += 1;
    if (options.onProgress && ((index + 1) % 25 === 0 || index + 1 === candidates.length)) {
      options.onProgress(index + 1, candidates.length);
    }
  });

  approaches.sort((a, b) => a.missKm - b.missKm || a.tcaMs - b.tcaMs);
  return {
    approaches,
    coOrbiting: [...coOrbiting.values()].sort((a, b) => a.closestKm - b.closestKm),
    stats: {
      catalogSize: catalog.length,
      afterRadiusFilter: candidates.length,
      minimaRefined,
      propagations,
      propagationFailures,
      windowStartMs: startMs,
      windowEndMs: startMs + (steps - 1) * stepMs,
      stepSeconds,
    },
  };
}
