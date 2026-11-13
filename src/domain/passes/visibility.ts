/**
 * Pass visibility — "can a human actually see this pass?"
 *
 * A geometric pass (satellite above the horizon) says nothing about whether
 * anyone can observe it: a satellite crossing a sunlit sky is invisible, and
 * one inside Earth's shadow glints nothing back. This module evaluates each
 * pass against the physics that actually decides visibility:
 *
 *   1. The satellite must be in sunlight (cylindrical shadow test).
 *   2. The observer's sky must be dark (sun below `−6°` elevation — civil
 *      twilight; stars are still fading but bright objects read clearly).
 *   3. The satellite must be above the pass elevation threshold at that
 *      moment (it is, by construction, between rise and set of the pass).
 *
 * Brightness follows the standard-magnitude convention (Mallama 2020,
 * arXiv:2012.05100 §2): m_std is the magnitude at 1 000 km and 90° phase,
 * and the phase term is the illuminated fraction of a sphere, normalized so
 * it vanishes at 90°:
 *
 *      m ≈ m_std − 15 + 5·log₁₀(rangeKm) − 2.5·log₁₀((1 + cos φ)/2) − 0.753
 *
 * (−0.753 = 2.5·log₁₀ 0.5; equivalently Quicksat's "− 15.75".) m_std comes
 * only from published per-object values (domain/light/standard-magnitudes);
 * for any other object the brightness is reported as unknown, never guessed.
 *
 * The visible window (when the pass is actually observable) is bracketed by
 * the per-pass light samples, then each edge is refined by bisection to
 * about a second.
 */

import { temeToEcf, ecfToLookAngle, type ObserverLocation, type SatRec } from "@/domain/orbit/coordinates";
import { propagateState } from "@/integrations/sgp4/adapter";
import {
  satelliteInSunlight,
  sunElevationDegAt,
  phaseAngleDeg,
  observerEciKm,
  type EciVectorKm,
} from "@/domain/light/solar";
import type { PassResult } from "./types";

/** Sky-darkness threshold: civil twilight — the satellite reads if it is bright. */
const SKY_DARKNESS_SUN_ELEVATION_DEG = -6;

/** 2.5·log₁₀(0.5): moves the phase term's zero from full phase to 90°. */
const HALF_PHASE_NORMALIZATION = 2.5 * Math.log10(0.5);

/** Samples per pass for the light sweep. Passes are 5–15 min for LEO. */
const SAMPLES_PER_PASS = 24;

/**
 * Bisection steps used to refine each edge of the visible window between two
 * bracketing samples: the sample gap (≤ ~40 s for LEO passes) shrinks by 2⁶,
 * to about a second — the same order as the cylindrical-shadow model's own
 * timing error, so further refinement would only add false precision.
 */
const EDGE_REFINEMENT_STEPS = 6;

/** Where and when the observer can actually see the satellite. */
export interface VisibleMoment {
  timeMs: number;
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * The visible portion of a pass. Assumed contiguous: within one LEO pass the
 * sky only darkens or brightens monotonically and the satellite crosses the
 * shadow boundary at most once, so "first visible" → "last visible" bounds it.
 */
export interface VisibleWindow {
  start: VisibleMoment;
  end: VisibleMoment;
  /** Visibility begins because the satellite leaves Earth's shadow mid-sky. */
  startsFromShadow: boolean;
  /** Visibility ends because the satellite enters Earth's shadow mid-sky. */
  endsInShadow: boolean;
}

export interface PassVisibility {
  /** True when at least one sampled instant satisfied all visibility conditions. */
  fromGround: boolean;
  /**
   * Brightest estimated magnitude among the visible samples. Null when never
   * visible, or when visible but the object has no published standard
   * magnitude (brightness unknown).
   */
  bestEstimatedMagnitude: number | null;
  /** Instant of the brightest visible sample (epoch ms), null when never visible. */
  bestTimeMs: number | null;
  /** Sun elevation at the observer at the pass apex — sky-darkness context. */
  sunElevationDegAtApex: number;
  /** Whether the satellite was inside Earth's shadow at the apex. */
  satelliteInShadowAtApex: boolean;
  /** Human-usable plain reason when `fromGround` is false. */
  reasonIfNotVisible: "satellite-in-shadow" | "sky-too-bright" | "both" | null;
  /** Visible portion of the pass (edges refined to ~1 s); null when never visible. */
  visibleWindow: VisibleWindow | null;
  /**
   * The pass's path across the observer's sky: the light-sweep samples
   * (uniform in time, rise → set, clamped to the serving window). Drawn as
   * the "where to look" sky chart; the visible stretch comes from
   * `visibleWindow`, whose refined edges are sharper than this sampling.
   */
  skyTrack: VisibleMoment[];
}

interface LightSample {
  timeMs: number;
  rangeKm: number;
  azimuthDeg: number;
  elevationDeg: number;
  phaseDeg: number;
  inSunlight: boolean;
  observerSunElevationDeg: number;
}

function isVisible(sample: LightSample): boolean {
  return sample.inSunlight && sample.observerSunElevationDeg < SKY_DARKNESS_SUN_ELEVATION_DEG;
}

function lightSampleAt(satrec: SatRec, observer: ObserverLocation, timeMs: number): LightSample {
  const time = new Date(timeMs);
  const state = propagateState(satrec, time);
  const satEci: EciVectorKm = { x: state.teme.positionKm[0], y: state.teme.positionKm[1], z: state.teme.positionKm[2] };
  const look = ecfToLookAngle(observer, temeToEcf(state.teme, time));
  return {
    timeMs,
    rangeKm: look.rangeKm,
    azimuthDeg: look.azimuthDeg,
    elevationDeg: look.elevationDeg,
    phaseDeg: phaseAngleDeg(satEci, observerEciKm(observer, time), time) as number,
    inSunlight: satelliteInSunlight(satEci, time),
    observerSunElevationDeg: sunElevationDegAt(time, observer) as number,
  };
}

/**
 * Bisect between an invisible (`outside`) and a visible (`inside`) sample,
 * returning the sample nearest the transition on the visible side.
 */
function refineEdge(
  satrec: SatRec,
  observer: ObserverLocation,
  outside: LightSample,
  inside: LightSample,
): LightSample {
  let out = outside;
  let inn = inside;
  for (let i = 0; i < EDGE_REFINEMENT_STEPS; i++) {
    const mid = lightSampleAt(satrec, observer, (out.timeMs + inn.timeMs) / 2);
    if (isVisible(mid)) inn = mid;
    else out = mid;
  }
  return inn;
}

function toMoment(sample: LightSample): VisibleMoment {
  return {
    timeMs: Math.round(sample.timeMs),
    azimuthDeg: Number(sample.azimuthDeg.toFixed(1)),
    elevationDeg: Number(sample.elevationDeg.toFixed(1)),
  };
}

/** Apparent magnitude from a standard magnitude (1 000 km, 90° phase). */
function estimateMagnitude(stdMag: number, rangeKm: number, phaseDeg: number): number {
  const rangeTerm = 5 * Math.log10(Math.max(rangeKm, 1));
  const cosPhase = Math.cos((phaseDeg * Math.PI) / 180);
  // Illuminated fraction, zeroed at 90°: full phase (φ=0) → −0.75 (brighter),
  // half phase → 0, crescent (φ>90°) → dimmer.
  const phaseTerm = -2.5 * Math.log10(Math.max((1 + cosPhase) / 2, 1e-6)) + HALF_PHASE_NORMALIZATION;
  return stdMag - 15 + rangeTerm + phaseTerm;
}

/**
 * Evaluate pass visibility for one geometric pass. `satrec` is the compiled
 * SGP4 record the pass was computed with; re-propagating the few samples is
 * cheap relative to the window sweep the finder already ran.
 */
export function enrichPassVisibility(params: {
  satrec: SatRec;
  pass: PassResult;
  observer: ObserverLocation;
  windowStart: Date;
  windowEnd: Date;
  /** Published standard magnitude; null = brightness unknown, none estimated. */
  standardMagnitude: number | null;
}): PassVisibility {
  const { satrec, pass, observer, windowStart, windowEnd, standardMagnitude } = params;

  const riseMs = (pass.rise ?? windowStart).getTime();
  const setMs = (pass.set ?? windowEnd).getTime();
  const apexMs = pass.max.getTime();

  // Uniform rise→set samples, clamped to the serving window (`truncated`
  // passes only expose their in-window half — we cannot compute light state
  // for times outside what we can honestly predict).
  const lo = Math.max(riseMs, windowStart.getTime());
  const hi = Math.min(setMs, windowEnd.getTime());
  const samples: LightSample[] = [];
  for (let i = 0; i < SAMPLES_PER_PASS; i++) {
    samples.push(lightSampleAt(satrec, observer, lo + ((hi - lo) * i) / (SAMPLES_PER_PASS - 1)));
  }

  // Apex context: the sky-darkness label the card shows alongside the verdict.
  const apexTime = new Date(apexMs);
  const apexState = propagateState(satrec, apexTime);
  const apexTeme: EciVectorKm = {
    x: apexState.teme.positionKm[0],
    y: apexState.teme.positionKm[1],
    z: apexState.teme.positionKm[2],
  };

  // The brightest instant depends only on range and phase, so it is located
  // with m_std = 0 even when the object's real m_std is unknown.
  const best = samples.reduce(
    (brightest, sample) => {
      if (!isVisible(sample)) return brightest;
      const magnitude = estimateMagnitude(standardMagnitude ?? 0, sample.rangeKm, sample.phaseDeg);
      if (magnitude < brightest.magnitude) {
        return { magnitude, timeMs: sample.timeMs };
      }
      return brightest;
    },
    { magnitude: Number.POSITIVE_INFINITY as number, timeMs: null as number | null },
  );

  const apexInShadow = !satelliteInSunlight(apexTeme, apexTime);
  const apexSkyBright = sunElevationDegAt(apexTime, observer) >= SKY_DARKNESS_SUN_ELEVATION_DEG;

  const fromGround = best.timeMs !== null;
  const reasonIfNotVisible: PassVisibility["reasonIfNotVisible"] = fromGround
    ? null
    : apexInShadow && apexSkyBright
      ? "both"
      : apexInShadow
        ? "satellite-in-shadow"
        : "sky-too-bright";

  return {
    fromGround,
    bestEstimatedMagnitude: fromGround && standardMagnitude !== null ? Number(best.magnitude.toFixed(1)) : null,
    bestTimeMs: best.timeMs,
    sunElevationDegAtApex: Number(sunElevationDegAt(apexTime, observer).toFixed(1)),
    satelliteInShadowAtApex: apexInShadow,
    reasonIfNotVisible,
    visibleWindow: fromGround ? visibleWindowOf(satrec, observer, samples) : null,
    skyTrack: samples.map(toMoment),
  };
}

/**
 * First → last visible sample, each edge refined by bisection against its
 * invisible neighbour. An edge at the first/last sample is the pass's own
 * rise/set (or the window bound) and needs no refinement.
 */
function visibleWindowOf(satrec: SatRec, observer: ObserverLocation, samples: LightSample[]): VisibleWindow | null {
  const first = samples.findIndex(isVisible);
  if (first === -1) return null;
  let last = first;
  for (let i = samples.length - 1; i > first; i--) {
    if (isVisible(samples[i] as LightSample)) {
      last = i;
      break;
    }
  }

  const before = samples[first - 1];
  const after = samples[last + 1];
  const startSample = before ? refineEdge(satrec, observer, before, samples[first] as LightSample) : (samples[first] as LightSample);
  const endSample = after ? refineEdge(satrec, observer, after, samples[last] as LightSample) : (samples[last] as LightSample);

  return {
    start: toMoment(startSample),
    end: toMoment(endSample),
    startsFromShadow: before !== undefined && !before.inSunlight,
    endsInShadow: after !== undefined && !after.inSunlight,
  };
}

export {
  SKY_DARKNESS_SUN_ELEVATION_DEG,
  estimateMagnitude,
  SAMPLES_PER_PASS as VISIBILITY_SAMPLES_PER_PASS,
};
