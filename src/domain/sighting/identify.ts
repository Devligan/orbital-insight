/**
 * "What did I just see?": match a reported moving light against every
 * catalogued satellite.
 *
 * The question people actually ask after seeing a steady light glide across
 * the sky. They know roughly when, roughly which way they were looking, and
 * maybe how high. This module answers it from orbital mechanics alone: which
 * objects were, during the reported minutes,
 *   1. above 10° from the observer,
 *   2. in direct sunlight (cylindrical shadow test, as for passes),
 *   3. against a sky past civil twilight (sun below −6° at the observer),
 *   4. crossing the sky at a pace you'd notice (≥ 1° a minute), and
 *   5. near the reported direction and height,
 * ranked by how close they came to where the person looked.
 *
 * Pure: bodies are propagated through a callback (TEME km), and the per-instant
 * frame quantities (sidereal angle, sun direction, sun elevation) come in
 * precomputed, so the hot loop allocates nothing and tests can use synthetic
 * geometry. Topocentric angles follow satellite.js's ecfToLookAngles exactly
 * (WGS-72 ellipsoid, SEZ frame); a unit test cross-checks them.
 */

import { estimateMagnitude } from "@/domain/light/magnitude";

/** One instant the search samples, with everything that's the same for every body. */
export interface SightingFrame {
  tMs: number;
  /** TEME → ECF rotation angle (GMST), radians. */
  gmstRad: number;
  /** Unit vector from Earth's centre toward the sun, TEME/ECI axes. */
  sunUnit: readonly [number, number, number];
  /** Sun elevation at the observer, degrees. */
  sunElevationDeg: number;
}

export interface SightingObserver {
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
}

export interface SightingBody {
  id: string;
  name: string;
  /** International designator launch, "2026-123", or null. */
  launch: string | null;
  /** Published standard magnitude, when one exists (see standard-magnitudes.ts). */
  standardMagnitude: number | null;
  /** TEME position/velocity (km, km/s) into out[offset..offset+5]; false where SGP4 has no solution. */
  state: (tMs: number, out: Float64Array, offset: number) => boolean;
}

export type HeightBand = "low" | "mid" | "high";

/** Elevation bands, degrees: "just above the trees", "halfway up", "nearly overhead". */
export const HEIGHT_BANDS: Readonly<Record<HeightBand, readonly [number, number]>> = {
  low: [10, 30],
  mid: [30, 60],
  high: [60, 90],
};

export interface SightingQuery {
  /** Compass direction the person looked, degrees from north; null = "not sure". */
  azimuthDeg: number | null;
  height: HeightBand | null;
  /** How far from the reported direction a match may be (people's directions are rough). */
  maxSeparationDeg: number;
  /** Compass direction it was moving toward, degrees; null/absent = "not sure". */
  travelDeg?: number | null;
}

/** "Moving NE" is taken as NE ± this: one compass point either side, plus slack. */
export const TRAVEL_TOLERANCE_DEG = 45;

export const MIN_ELEVATION_DEG = 10;
/** Civil twilight: brighter skies drown out all but the brightest satellites. */
export const DARK_SKY_SUN_ELEVATION_DEG = -6;
/** "It was moving": slower objects (GEO, navigation satellites) don't read as a moving light. */
export const MIN_ANGULAR_RATE_DEG_PER_MIN = 1;
/** A train: at least this many launch-mates together on the sky... */
export const GROUP_MIN_MEMBERS = 4;
/** ...within this angle of each other at the same instant. */
export const TRAIN_RADIUS_DEG = 10;

export interface TrackPoint {
  tMs: number;
  azimuthDeg: number;
  elevationDeg: number;
  /** Sunlit and against a dark sky at this instant (the part that could be seen). */
  seeable: boolean;
}

export interface SightingCandidate {
  id: string;
  name: string;
  launch: string | null;
  /** The sampled instant closest to where the person looked. */
  best: { tMs: number; azimuthDeg: number; elevationDeg: number; rangeKm: number };
  /** Angular distance from the reported direction/height, degrees (0 = right there). */
  separationDeg: number;
  /** Where its seeable stretch in the window began and ended (compass azimuths). */
  fromAzimuthDeg: number;
  toAzimuthDeg: number;
  /** Apparent speed across the sky at the best instant, degrees per second. */
  angularRateDegPerSec: number;
  /** Compass direction of its motion across the sky at the best instant. */
  headingDeg: number;
  estimatedMagnitude: number | null;
  /** Above-horizon samples in the window, for drawing. */
  track: TrackPoint[];
}

export interface LaunchGroup {
  launch: string;
  count: number;
  /** The best-matching member, which stands in for the group. */
  representative: SightingCandidate;
}

export interface SightingResult {
  /** Sun elevation at the observer at the reported moment. */
  sunElevationDeg: number;
  /** Bodies that propagated (the caller counts element sets SGP4 refused). */
  bodiesConsidered: number;
  /** Bodies seeable somewhere in the sky (any direction) during the window. */
  seeableAnywhere: number;
  /** Matches, best first, with launch batches folded into `groups`. */
  candidates: SightingCandidate[];
  groups: LaunchGroup[];
}

// WGS-72, as in satellite.js's geodeticToEcf.
const A_KM = 6378.137;
const B_KM = 6356.7523142;
const F = (A_KM - B_KM) / A_KM;
const E2 = 2 * F - F * F;
const DEG = Math.PI / 180;

/** Observer position in ECF km and the SEZ rotation terms, computed once. */
function observerGeometry(o: SightingObserver) {
  const lat = o.latitudeDeg * DEG;
  const lon = o.longitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = A_KM / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + o.heightKm) * cosLat * cosLon,
    y: (n + o.heightKm) * cosLat * sinLon,
    z: (n * (1 - E2) + o.heightKm) * sinLat,
    sinLat,
    cosLat,
    sinLon,
    cosLon,
  };
}

type ObserverGeometry = ReturnType<typeof observerGeometry>;

/**
 * Look angles from a TEME position, written into `look` as [azimuthDeg,
 * elevationDeg, rangeKm]. Same algebra as satellite.js (eciToEcf, then
 * ecfToLookAngles), unrolled so nothing is allocated per call.
 */
export function lookAngleInto(
  obs: ObserverGeometry,
  gmstRad: number,
  x: number,
  y: number,
  z: number,
  look: Float64Array,
): void {
  const cosG = Math.cos(gmstRad);
  const sinG = Math.sin(gmstRad);
  const ex = x * cosG + y * sinG;
  const ey = -x * sinG + y * cosG;
  const rx = ex - obs.x;
  const ry = ey - obs.y;
  const rz = z - obs.z;
  const south = obs.sinLat * obs.cosLon * rx + obs.sinLat * obs.sinLon * ry - obs.cosLat * rz;
  const east = -obs.sinLon * rx + obs.cosLon * ry;
  const up = obs.cosLat * obs.cosLon * rx + obs.cosLat * obs.sinLon * ry + obs.sinLat * rz;
  const range = Math.sqrt(rx * rx + ry * ry + rz * rz);
  look[0] = (Math.atan2(-east, south) + Math.PI) / DEG;
  look[1] = Math.asin(up / range) / DEG;
  look[2] = range;
}

/** Shared with tests: the observer geometry the search uses. */
export function observerGeometryFor(o: SightingObserver): ObserverGeometry {
  return observerGeometry(o);
}

function sunlit(x: number, y: number, z: number, sun: readonly [number, number, number]): boolean {
  const axial = x * sun[0] + y * sun[1] + z * sun[2];
  if (axial >= 0) return true;
  const px = x - axial * sun[0];
  const py = y - axial * sun[1];
  const pz = z - axial * sun[2];
  return Math.sqrt(px * px + py * py + pz * pz) >= A_KM;
}

/**
 * Angular distance (degrees) from a sky position to what was reported: the
 * arc of the vertical circle through the reported azimuth, limited to the
 * reported height band (or horizon-to-zenith when unsure). In closed form:
 * on that circle the cosine of the separation is a·cos t + b·sin t with
 * a = cos el·cos Δaz, b = sin el, maximised at t = atan2(b, a), clamped
 * into the band.
 */
export function separationFromReport(azimuthDeg: number, elevationDeg: number, query: Omit<SightingQuery, "maxSeparationDeg">): number {
  const [lo, hi] = query.height ? HEIGHT_BANDS[query.height] : [0, 90];
  if (query.azimuthDeg === null) {
    return elevationDeg < lo ? lo - elevationDeg : elevationDeg > hi ? elevationDeg - hi : 0;
  }
  const el = elevationDeg * DEG;
  const delta = (azimuthDeg - query.azimuthDeg) * DEG;
  const a = Math.cos(el) * Math.cos(delta);
  const b = Math.sin(el);
  const t = Math.min(hi * DEG, Math.max(lo * DEG, Math.atan2(b, a)));
  const cosSep = a * Math.cos(t) + b * Math.sin(t);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) / DEG;
}

/** Great-circle angle between two sky positions, degrees. */
function skyAngleDeg(az1: number, el1: number, az2: number, el2: number): number {
  const e1 = el1 * DEG;
  const e2 = el2 * DEG;
  const cos = Math.sin(e1) * Math.sin(e2) + Math.cos(e1) * Math.cos(e2) * Math.cos((az1 - az2) * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

/**
 * Which way something moves across the sky, as a compass direction: the
 * horizontal (east, north) part of its displacement between two sky
 * positions. Near the zenith that is the ground direction it travels; low in
 * the west and climbing, it reads "toward the E", which is how people say it.
 */
export function skyHeadingDeg(az1: number, el1: number, az2: number, el2: number): number {
  const enu = (az: number, el: number) => [Math.cos(el * DEG) * Math.sin(az * DEG), Math.cos(el * DEG) * Math.cos(az * DEG)] as const;
  const [e1, n1] = enu(az1, el1);
  const [e2, n2] = enu(az2, el2);
  const heading = Math.atan2(e2 - e1, n2 - n1) / DEG;
  return (heading + 360) % 360;
}

/** Smallest angle between two compass directions, degrees (0–180). */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Phase angle at the satellite (degrees), with the sun treated as infinitely far. */
function phaseAngleDeg(
  obs: ObserverGeometry,
  gmstRad: number,
  x: number,
  y: number,
  z: number,
  sun: readonly [number, number, number],
): number {
  // Observer ECF → ECI is a rotation by +GMST.
  const cosG = Math.cos(gmstRad);
  const sinG = Math.sin(gmstRad);
  const ox = obs.x * cosG - obs.y * sinG;
  const oy = obs.x * sinG + obs.y * cosG;
  const tx = ox - x;
  const ty = oy - y;
  const tz = obs.z - z;
  const n = Math.sqrt(tx * tx + ty * ty + tz * tz);
  const cos = (tx * sun[0] + ty * sun[1] + tz * sun[2]) / n;
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

/**
 * Which catalogued objects could the reported light have been?
 * `frames` are the sampled instants (evenly spaced, ascending); the one
 * nearest `reportMs` supplies the sky-darkness answer.
 */
export function identifySighting(
  bodies: readonly SightingBody[],
  observer: SightingObserver,
  frames: readonly SightingFrame[],
  query: SightingQuery,
  reportMs: number,
  onProgress?: (done: number, total: number) => void,
): SightingResult {
  const obs = observerGeometry(observer);
  const state = new Float64Array(6);
  const look = new Float64Array(3);
  // Per-body scratch: az, el, range, seeable, and the TEME position for the phase angle.
  const az = new Float64Array(frames.length);
  const el = new Float64Array(frames.length);
  const range = new Float64Array(frames.length);
  const pos = new Float64Array(frames.length * 3);
  const ok = new Uint8Array(frames.length);
  const seeable = new Uint8Array(frames.length);

  const reportFrame = frames.reduce(
    (best, f) => (Math.abs(f.tMs - reportMs) < Math.abs(best.tMs - reportMs) ? f : best),
    frames[0]!,
  );

  let considered = 0;
  let seeableAnywhere = 0;
  const matches: SightingCandidate[] = [];

  for (let b = 0; b < bodies.length; b++) {
    const body = bodies[b]!;
    let propagated = false;
    let anySeeable = false;
    for (let f = 0; f < frames.length; f++) {
      const frame = frames[f]!;
      seeable[f] = 0;
      if (!body.state(frame.tMs, state, 0)) {
        ok[f] = 0;
        continue;
      }
      ok[f] = 1;
      propagated = true;
      lookAngleInto(obs, frame.gmstRad, state[0]!, state[1]!, state[2]!, look);
      az[f] = look[0]!;
      el[f] = look[1]!;
      range[f] = look[2]!;
      pos[f * 3] = state[0]!;
      pos[f * 3 + 1] = state[1]!;
      pos[f * 3 + 2] = state[2]!;
      if (
        el[f]! >= MIN_ELEVATION_DEG &&
        frame.sunElevationDeg <= DARK_SKY_SUN_ELEVATION_DEG &&
        sunlit(state[0]!, state[1]!, state[2]!, frame.sunUnit)
      ) {
        seeable[f] = 1;
        anySeeable = true;
      }
    }
    if (propagated) considered += 1;
    if (onProgress && (b % 1000 === 999 || b === bodies.length - 1)) onProgress(b + 1, bodies.length);
    if (!anySeeable) continue;

    // Its apparent pace, from the first pair of consecutive above-horizon samples.
    let rate = 0;
    for (let f = 1; f < frames.length; f++) {
      if (ok[f - 1] && ok[f] && el[f - 1]! > 0 && el[f]! > 0) {
        rate = skyAngleDeg(az[f - 1]!, el[f - 1]!, az[f]!, el[f]!) / ((frames[f]!.tMs - frames[f - 1]!.tMs) / 1000);
        break;
      }
    }
    if (rate * 60 < MIN_ANGULAR_RATE_DEG_PER_MIN) continue;
    seeableAnywhere += 1;

    let bestF = -1;
    let bestSep = Infinity;
    let firstF = -1;
    let lastF = -1;
    for (let f = 0; f < frames.length; f++) {
      if (!seeable[f]) continue;
      if (firstF < 0) firstF = f;
      lastF = f;
      const sep = separationFromReport(az[f]!, el[f]!, query);
      // Ties go to the instant nearest the reported moment.
      if (sep < bestSep - 1e-9 || (Math.abs(sep - bestSep) <= 1e-9 && bestF >= 0 && Math.abs(frames[f]!.tMs - reportMs) < Math.abs(frames[bestF]!.tMs - reportMs))) {
        bestSep = sep;
        bestF = f;
      }
    }
    if (bestF < 0 || bestSep > query.maxSeparationDeg) continue;

    const frame = frames[bestF]!;
    let rateAtBest = rate;
    // Motion is read forward in time: from the best sample to the next, or from the previous one to it.
    const forward = bestF + 1 < frames.length && ok[bestF + 1] === 1;
    const g = forward ? bestF + 1 : bestF - 1;
    let heading = 0;
    if (g >= 0 && ok[g]) {
      rateAtBest = skyAngleDeg(az[bestF]!, el[bestF]!, az[g]!, el[g]!) / (Math.abs(frames[g]!.tMs - frame.tMs) / 1000);
      heading = forward
        ? skyHeadingDeg(az[bestF]!, el[bestF]!, az[g]!, el[g]!)
        : skyHeadingDeg(az[g]!, el[g]!, az[bestF]!, el[bestF]!);
    }
    if (query.travelDeg !== undefined && query.travelDeg !== null && angleBetween(heading, query.travelDeg) > TRAVEL_TOLERANCE_DEG) {
      continue;
    }
    const magnitude =
      body.standardMagnitude === null
        ? null
        : estimateMagnitude(
            body.standardMagnitude,
            range[bestF]!,
            phaseAngleDeg(obs, frame.gmstRad, pos[bestF * 3]!, pos[bestF * 3 + 1]!, pos[bestF * 3 + 2]!, frame.sunUnit),
          );
    const track: TrackPoint[] = [];
    for (let f = 0; f < frames.length; f++) {
      if (ok[f] && el[f]! > 0) {
        track.push({ tMs: frames[f]!.tMs, azimuthDeg: az[f]!, elevationDeg: el[f]!, seeable: seeable[f] === 1 });
      }
    }
    matches.push({
      id: body.id,
      name: body.name,
      launch: body.launch,
      best: { tMs: frame.tMs, azimuthDeg: az[bestF]!, elevationDeg: el[bestF]!, rangeKm: range[bestF]! },
      separationDeg: bestSep,
      fromAzimuthDeg: az[firstF]!,
      toAzimuthDeg: az[lastF]!,
      angularRateDegPerSec: rateAtBest,
      headingDeg: heading,
      estimatedMagnitude: magnitude,
      track,
    });
  }

  matches.sort(compareCandidates);
  const { singles, groups } = foldLaunchGroups(matches);
  return {
    sunElevationDeg: reportFrame.sunElevationDeg,
    bodiesConsidered: considered,
    seeableAnywhere,
    candidates: singles,
    groups,
  };
}

/**
 * Best first: closeness to the report in 5° steps (finer would claim more
 * than anyone's "it was over there" contains), then known brightness
 * (brighter first; a published magnitude beats none), then range (nearer
 * objects of the same kind look brighter).
 */
export function compareCandidates(a: SightingCandidate, b: SightingCandidate): number {
  const bucket = (s: number) => Math.floor(s / 5);
  if (bucket(a.separationDeg) !== bucket(b.separationDeg)) return bucket(a.separationDeg) - bucket(b.separationDeg);
  const ma = a.estimatedMagnitude ?? Infinity;
  const mb = b.estimatedMagnitude ?? Infinity;
  if (ma !== mb) return ma - mb;
  return a.best.rangeKm - b.best.rangeKm;
}

/**
 * Fold a satellite train into one entry: launch-mates flying close together
 * on the sky at the same moment.
 *
 * Sharing a launch is not enough. Thousands of Starlinks from years-old
 * launches are spread around their orbital planes, so four from one 2021
 * launch crossing the same quarter of the sky within eight minutes is
 * ordinary and is not a train. A train is a cluster: at the representative's
 * best instant, at least GROUP_MIN_MEMBERS launch-mates (it included) within
 * TRAIN_RADIUS_DEG of it on the sky. Launch-mates outside the cluster stay
 * individual matches.
 */
export function foldLaunchGroups(sorted: readonly SightingCandidate[]): {
  singles: SightingCandidate[];
  groups: LaunchGroup[];
} {
  const byLaunch = new Map<string, SightingCandidate[]>();
  for (const c of sorted) {
    if (!c.launch) continue;
    const list = byLaunch.get(c.launch) ?? [];
    list.push(c);
    byLaunch.set(c.launch, list);
  }
  const folded = new Set<SightingCandidate>();
  const groups: LaunchGroup[] = [];
  for (const [launch, members] of byLaunch) {
    if (members.length < GROUP_MIN_MEMBERS) continue;
    const representative = members[0]!;
    const { tMs, azimuthDeg, elevationDeg } = representative.best;
    const cluster = members.filter((m) => {
      const at = m.track.find((p) => p.tMs === tMs);
      return at !== undefined && skyAngleDeg(at.azimuthDeg, at.elevationDeg, azimuthDeg, elevationDeg) <= TRAIN_RADIUS_DEG;
    });
    if (cluster.length < GROUP_MIN_MEMBERS) continue;
    for (const m of cluster) folded.add(m);
    groups.push({ launch, count: cluster.length, representative });
  }
  groups.sort((a, b) => compareCandidates(a.representative, b.representative));
  return { singles: sorted.filter((c) => !folded.has(c)), groups };
}

/** "98067A  " in TLE line 1 → "1998-067"; null when the field is blank (analyst objects). */
export function launchOf(line1: string): string | null {
  const field = line1.slice(9, 17).trim();
  const match = field.match(/^(\d{2})(\d{3})/);
  if (!match) return null;
  const yy = Number(match[1]);
  // NORAD convention: 57–99 → 1957–1999, 00–56 → 2000–2056.
  return `${yy >= 57 ? 1900 + yy : 2000 + yy}-${match[2]}`;
}
