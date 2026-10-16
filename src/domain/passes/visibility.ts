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
 * Brightness is a standard low-precision apparent-magnitude model,
 * phase-corrected:
 *
 *      m ≈ m₀ − 15 + 5·log₁₀(rangeKm) − 2.5·log₁₀((1 + cos φ)/2)
 *
 * m₀ (standard magnitude at 1 000 km, fully lit, half-phase reference) is
 * size-dependent and per-object physical sizes are unknown to this catalog,
 * so the default m₀ = 0 and every estimate carries an honest ±1.5
 * magnitude-deeplen class uncertainty — the pass still spaces objects into
 * "conspicuous / faint / binocular or worse" buckets far better than a
 * binary visible flag would.
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

/** Standard magnitude at 1 000 km, half-phase. Default when size is unknown. */
const DEFAULT_STANDARD_MAGNITUDE = 0;

/** Samples per pass for the light sweep. Passes are 5–15 min for LEO. */
const SAMPLES_PER_PASS = 24;

export interface PassVisibility {
  /** True when at least one sampled instant satisfied all visibility conditions. */
  fromGround: boolean;
  /** Brightest estimated magnitude among the visible samples; null when never visible. */
  bestEstimatedMagnitude: number | null;
  /** Instant of that brightest sample (ISO), null when never visible. */
  bestTimeMs: number | null;
  /** Sun elevation at the observer at the pass apex — sky-darkness context. */
  sunElevationDegAtApex: number;
  /** Whether the satellite was inside Earth's shadow at the apex. */
  satelliteInShadowAtApex: boolean;
  /** Human-usable plain reason when `fromGround` is false. */
  reasonIfNotVisible: "satellite-in-shadow" | "sky-too-bright" | "both" | null;
}

interface LightSample {
  timeMs: number;
  rangeKm: number;
  phaseDeg: number;
  inSunlight: boolean;
  observerSunElevationDeg: number;
}

function estimateMagnitude(stdMag: number, rangeKm: number, phaseDeg: number): number {
  const rangeTerm = 5 * Math.log10(Math.max(rangeKm, 1));
  const cosPhase = Math.cos((phaseDeg * Math.PI) / 180);
  // Fully lit face (φ=0) → +0; half phase (φ=90°) → +0.75 (dimmer).
  const phaseTerm = -2.5 * Math.log10(Math.max((1 + cosPhase) / 2, 1e-6));
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
}): PassVisibility {
  const { satrec, pass, observer, windowStart, windowEnd } = params;

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
    const timeMs = lo + ((hi - lo) * i) / (SAMPLES_PER_PASS - 1);
    const time = new Date(timeMs);

    const state = propagateState(satrec, time);
    const ecf = temeToEcf(state.teme, time);
    const look = ecfToLookAngle(observer, ecf);

    samples.push({
      timeMs,
      rangeKm: look.rangeKm,
      phaseDeg: phaseAngleDeg(
        { x: state.teme.positionKm[0], y: state.teme.positionKm[1], z: state.teme.positionKm[2] },
        observerEciKm(observer, time),
        time,
      ) as number,
      inSunlight: satelliteInSunlight(
        { x: state.teme.positionKm[0], y: state.teme.positionKm[1], z: state.teme.positionKm[2] },
        time,
      ),
      observerSunElevationDeg: sunElevationDegAt(time, observer) as number,
    });
  }

  // Apex context: the sky-darkness label the card shows alongside the verdict.
  const apexTime = new Date(apexMs);
  const apexState = propagateState(satrec, apexTime);
  const apexTeme: EciVectorKm = {
    x: apexState.teme.positionKm[0],
    y: apexState.teme.positionKm[1],
    z: apexState.teme.positionKm[2],
  };

  const best = samples.reduce(
    (brightest, sample) => {
      if (!sample.inSunlight) return brightest;
      if (sample.observerSunElevationDeg >= SKY_DARKNESS_SUN_ELEVATION_DEG) return brightest;
      const magnitude = estimateMagnitude(DEFAULT_STANDARD_MAGNITUDE, sample.rangeKm, sample.phaseDeg);
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
    bestEstimatedMagnitude: fromGround ? Number(best.magnitude.toFixed(1)) : null,
    bestTimeMs: best.timeMs,
    sunElevationDegAtApex: Number(sunElevationDegAt(apexTime, observer).toFixed(1)),
    satelliteInShadowAtApex: apexInShadow,
    reasonIfNotVisible,
  };
}

export { DEFAULT_STANDARD_MAGNITUDE, estimateMagnitude, SAMPLES_PER_PASS as VISIBILITY_SAMPLES_PER_PASS };
