/**
 * Whole-sky propagation worker.
 *
 * Owns all SGP4 work for the 10k-object point cloud so the UI thread never
 * blocks:
 *  - parses the catalog (~10.6k TLEs) once, skipping unparsable rows
 *  - classifies every object once (LEO / MEO / GEO / HEO from mean motion +
 *    eccentricity — derived from the elements, never guessed)
 *  - sweeps: SGP4 for *every* object at one simulated instant, posting
 *    Earth-fixed positions and velocities as flat Float32Arrays (zero-copy
 *    transfer). The globe moves each dot along its velocity between sweeps
 *    (see sky-motion.ts), so a sweep is needed only every ~15 s of simulated
 *    time — every 5 s live, every ¼ s at 60×.
 *
 * Time contract: simulation time follows the explorer's shared clock
 * (`sim = baseSim + elapsedWall × rate`, see view-clock.ts), set at init and
 * on every `clock` message. A `clock` message sweeps immediately at the new
 * instant (the slider jumped; the old sweep belongs to another moment).
 * rate 0 = paused: that one sweep is exact, and the worker then idles.
 */

import { gstime, sgp4, twoline2satrec } from "satellite.js";
import { categoryOf, type SkyCategory } from "./category";
import { sweepIntervalMs, temeToEarthFixed } from "./sky-motion";

export interface SkyWorkerEntry {
  i: string;
  l1: string;
  l2: string;
}

export interface InitMessage {
  type: "init";
  entries: SkyWorkerEntry[];
  /** Simulated instant at init, epoch ms (UTC). */
  startMs: number;
  /** Simulated ms per wall ms at init (0 paused, 1 real time, 60 fast-forward). */
  rate: number;
}

/** Re-base the simulation clock: show `simMs` now, advancing at `rate`. */
export interface ClockMessage {
  type: "clock";
  simMs: number;
  rate: number;
}

export type SkyWorkerInbound = InitMessage | ClockMessage;

export type { SkyCategory };

export interface ReadyMessage {
  type: "ready";
  parsed: number;
  failed: number;
  categories: Int8Array;
  ids: string[];
}

export interface SweepMessage {
  type: "sweep";
  /** Simulation instant the sweep was computed at (epoch ms). */
  tMs: number;
  /**
   * Per object (same order as `ids`), flat [x, y, z] Earth-fixed position in
   * metres. NaN where SGP4 has no solution at `tMs` (e.g. decayed elements).
   */
  positions: Float32Array;
  /** Per object, flat [vx, vy, vz] Earth-fixed velocity in m/s. */
  velocities: Float32Array;
}

export type SkyWorkerOutbound = ReadyMessage | SweepMessage | { type: "error"; message: string };

type Satrec = ReturnType<typeof twoline2satrec>;

const MINUTE_MS = 60_000;

let satrecs: Satrec[] = [];
let epochMs: Float64Array = new Float64Array(0);
let clockBaseMs = 0; // wall time when the clock was last re-based
let clockBaseSimMs = 0; // simulated time at that wall instant
let rate = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

function simTimeMs(): number {
  return clockBaseSimMs + (Date.now() - clockBaseMs) * rate;
}

self.onmessage = (event: MessageEvent<SkyWorkerInbound>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      satrecs = [];
      const ids: string[] = [];
      const epochs: number[] = [];
      let failed = 0;
      const categories = new Int8Array(message.entries.length);
      for (let k = 0; k < message.entries.length; k++) {
        const entry = message.entries[k]; // noUncheckedIndexedAccess: guard below
        if (!entry) continue;
        try {
          const satrec = twoline2satrec(entry.l1, entry.l2);
          // Probe at epoch: reject records SGP4 cannot even start.
          const probe = sgp4(satrec, 0) as { position: false } | { position: { x: number } };
          if (probe === null || probe.position === false || !Number.isFinite(probe.position.x)) {
            failed++;
            continue;
          }
          ids.push(entry.i);
          satrecs.push(satrec);
          epochs.push((satrec.jdsatepoch - 2_440_587.5) * 86_400_000);
          categories[ids.length - 1] = categoryOf(satrec);
        } catch {
          failed++;
        }
      }
      epochMs = Float64Array.from(epochs);
      const ready: ReadyMessage = {
        type: "ready",
        parsed: satrecs.length,
        failed,
        categories: categories.slice(0, satrecs.length),
        ids,
      };
      self.postMessage(ready, { transfer: [ready.categories.buffer] });
      setClock(message.startMs, message.rate);
    } catch (error) {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Worker init failed" } satisfies SkyWorkerOutbound);
    }
    return;
  }
  if (message.type === "clock") {
    setClock(message.simMs, message.rate);
  }
};

/** Re-base the clock, sweep at the new instant now, and schedule the next sweeps. */
function setClock(simMs: number, nextRate: number): void {
  clockBaseSimMs = simMs;
  clockBaseMs = Date.now();
  rate = nextRate;
  if (timer) clearTimeout(timer);
  timer = null;
  sweepAndSchedule();
}

function sweepAndSchedule(): void {
  postSweep();
  const interval = sweepIntervalMs(rate);
  timer = interval === null ? null : setTimeout(sweepAndSchedule, interval);
}

/**
 * Every component finite — a non-finite coordinate reaching Cesium poisons
 * the cloud's bounding volume and stops the globe's rendering.
 */
function finiteState(r: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.z) &&
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z)
  );
}

function postSweep(): void {
  const n = satrecs.length;
  if (n === 0) return;
  const tMs = simTimeMs();
  const gmst = gstime(new Date(tMs));
  const positions = new Float32Array(n * 3);
  const velocities = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const satrec = satrecs[k]; // noUncheckedIndexedAccess
    const result = satrec
      ? (sgp4(satrec, (tMs - (epochMs[k] ?? 0)) / MINUTE_MS) as
          | { position: false; velocity: false }
          | { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }
          | null)
      : null;
    if (!result || result.position === false || !finiteState(result.position, result.velocity)) {
      positions[k * 3] = positions[k * 3 + 1] = positions[k * 3 + 2] = Number.NaN;
      continue;
    }
    temeToEarthFixed(result.position, result.velocity, gmst, positions, velocities, k);
  }
  const sweep: SweepMessage = { type: "sweep", tMs, positions, velocities };
  self.postMessage(sweep, { transfer: [positions.buffer, velocities.buffer] });
}
