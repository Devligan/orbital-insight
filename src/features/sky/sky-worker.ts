/**
 * Whole-sky propagation worker.
 *
 * Owns all SGP4 work for the 10k-object point cloud so the UI thread never
 * blocks:
 *  - parses the catalog (~10.6k TLEs) once, skipping unparsable rows
 *  - classifies every object once (LEO / MEO / GEO / HEO from mean motion +
 *    eccentricity — derived from the elements, never guessed)
 *  - propagates continuously in round-robin batches against a shared
 *    simulation clock; every post is a flat Float32Array (zero-copy transfer)
 *
 * Time contract: simulation time follows the explorer's shared clock
 * (`sim = baseSim + elapsedWall × rate`, see view-clock.ts), set at init and
 * on every `clock` message. rate 0 = paused at a chosen instant: the worker
 * finishes one full sweep at that instant (so every dot moves there), then
 * idles instead of recomputing identical positions. GEO objects stay put over
 * their longitude because eciToGeodetic folds in Earth's rotation via GMST.
 */

import { eciToGeodetic, gstime, sgp4, twoline2satrec } from "satellite.js";
import { categoryOf, type SkyCategory } from "./category";

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
  /** Batch size per tick and tick interval (ms) — tuned by the main thread. */
  batchSize: number;
  tickMs: number;
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

export interface PositionsMessage {
  type: "positions";
  /** Simulation time the batch was computed at (epoch ms). */
  tMs: number;
  /** Object indices covered by this batch (Int32Array, same order as values). */
  idx: Int32Array;
  /** Flat per-object [lonDeg, latDeg, altKm] values (see values below the last channel). */
  values: Float32Array;
  /** true when the final slice of the catalog — the full cloud is visible. */
  sweepDone: boolean;
}

export type SkyWorkerOutbound = ReadyMessage | PositionsMessage | { type: "error"; message: string };

interface Compiled {
  satrec: ReturnType<typeof twoline2satrec>;
}

const MINUTE_MS = 60_000;

let compiled: Compiled[] = [];
let ids: string[] = [];
let cursor = 0;
let clockBaseMs = 0; // wall time when the clock was last re-based
let clockBaseSimMs = 0; // simulated time at that wall instant
let rate = 1;
/** Objects still to propagate before a paused clock's sweep is complete. */
let remainingInSweep = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let batchSize = 600;
let tickMs = 140;

function simTimeMs(): number {
  return clockBaseSimMs + (Date.now() - clockBaseMs) * rate;
}

function setClock(simMs: number, nextRate: number): void {
  clockBaseSimMs = simMs;
  clockBaseMs = Date.now();
  rate = nextRate;
  remainingInSweep = compiled.length;
}

self.onmessage = (event: MessageEvent<SkyWorkerInbound>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      compiled = [];
      ids = [];
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
          compiled.push({ satrec });
          categories[ids.length - 1] = categoryOf(satrec);
        } catch {
          failed++;
        }
      }
      setClock(message.startMs, message.rate);
      batchSize = message.batchSize;
      tickMs = message.tickMs;
      cursor = 0;
      const ready: ReadyMessage = {
        type: "ready",
        parsed: compiled.length,
        failed,
        categories: categories.slice(0, compiled.length),
        ids,
      };
      self.postMessage(ready, { transfer: [ready.categories.buffer] });
      startLoop();
    } catch (error) {
      self.postMessage({ type: "error", message: error instanceof Error ? error.message : "Worker init failed" } satisfies SkyWorkerOutbound);
    }
    return;
  }
  if (message.type === "clock") {
    setClock(message.simMs, message.rate);
  }
};

function computeBatch(): { msg: PositionsMessage } | null {
  const n = compiled.length;
  if (n === 0) return null;
  const size = Math.min(batchSize, n);
  const idx = new Int32Array(size);
  const values = new Float32Array(size * 3);
  const tMs = simTimeMs();
  const gd = new Date(tMs);
  const gmst = gstime(gd);
  const begin = cursor;
  let written = 0;
  for (let s = 0; s < size; s++) {
    const objectIndex = cursor;
    const object = compiled[objectIndex]; // noUncheckedIndexedAccess
    cursor = (cursor + 1) % n;
    if (!object) continue;
    const minutesFromEpoch = (tMs - julianEpochMs(object.satrec)) / MINUTE_MS;
    const result = sgp4(object.satrec, minutesFromEpoch) as
      | { position: false }
      | { position: { x: number; y: number; z: number } }
      | null;
    if (result === null || result.position === false || !Number.isFinite(result.position.x)) continue;
    const geo = eciToGeodetic(result.position, gmst);
    idx[written] = objectIndex;
    // eciToGeodetic longitude comes from atan2 — already within [-180, 180].
    values[written * 3] = (geo.longitude * 180) / Math.PI;
    values[written * 3 + 1] = (geo.latitude * 180) / Math.PI;
    values[written * 3 + 2] = geo.height;
    written++;
  }
  return {
    msg: {
      type: "positions",
      tMs,
      idx: idx.slice(0, written),
      values: values.slice(0, written * 3),
      // A sweep completes when the cursor wrapped past its starting index.
      sweepDone: cursor <= begin,
    },
  };
}

function julianEpochMs(satrec: ReturnType<typeof twoline2satrec>): number {
  return (satrec.jdsatepoch - 2_440_587.5) * 86_400_000;
}

function startLoop(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    // Paused and every object already drawn at the paused instant: idle.
    if (rate === 0 && remainingInSweep <= 0) return;
    const batch = computeBatch();
    if (!batch) return;
    remainingInSweep -= batchSize;
    const { idx, values } = batch.msg;
    self.postMessage(batch.msg, { transfer: [idx.buffer, values.buffer] });
  }, tickMs);
  // Prime the cloud with the first batch immediately.
  const first = computeBatch();
  if (first) {
    remainingInSweep -= batchSize;
    self.postMessage(first.msg, { transfer: [first.msg.idx.buffer, first.msg.values.buffer] });
  }
}
