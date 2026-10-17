"use client";

/**
 * Main-thread client for the whole-sky propagation worker.
 *
 * Wraps the Worker protocol in a tiny event interface so the Cesium layer
 * never touches message plumbing. Each sweep arrives as zero-copy typed
 * arrays (Earth-fixed positions + velocities for every object at one
 * instant); the caller moves the dots between sweeps (sky-motion.ts) and
 * requests renders itself.
 */

import type { SkyWorkerInbound, SkyWorkerOutbound } from "./sky-worker";
import { CATEGORY_COLORS, CATEGORY_LABELS, type SkyCategory } from "./category";

export interface SkySweep {
  /** Simulated instant of the sweep, epoch ms. */
  tMs: number;
  /** Flat [x, y, z] Earth-fixed metres per object; NaN = no solution. */
  positions: Float32Array;
  /** Flat [vx, vy, vz] Earth-fixed m/s per object. */
  velocities: Float32Array;
}

export interface SkyCloudEvents {
  onReady(info: { parsed: number; failed: number; categories: Int8Array; ids: string[] }): void;
  onSweep(sweep: SkySweep): void;
  onError(message: string): void;
}

export class SkyCloud {
  private worker: Worker | null = null;
  private events: SkyCloudEvents;

  constructor(events: SkyCloudEvents) {
    this.events = events;
  }

  /** Start propagating, showing `simMs` now and advancing at `rate` (see view-clock.ts). */
  start(entries: { i: string; l1: string; l2: string }[], simMs: number, rate: number): void {
    if (typeof window === "undefined") return;
    const worker = new Worker(new URL("./sky-worker.ts", import.meta.url));
    const errorHandler = (error: ErrorEvent) => {
      this.events.onError(error.message || "The whole-sky computer hit an error");
      this.disposeWorker(worker, errorHandler);
    };
    worker.addEventListener("error", errorHandler);
    worker.onmessage = (event: MessageEvent<SkyWorkerOutbound>) => {
      const message = event.data;
      if (message.type === "ready") {
        this.events.onReady({
          parsed: message.parsed,
          failed: message.failed,
          categories: message.categories,
          ids: message.ids,
        });
      } else if (message.type === "sweep") {
        this.events.onSweep({ tMs: message.tMs, positions: message.positions, velocities: message.velocities });
      } else if (message.type === "error") {
        this.events.onError(message.message);
        this.disposeWorker(worker, errorHandler);
      }
    };
    this.worker = worker;
    worker.postMessage({ type: "init", entries, startMs: simMs, rate } satisfies SkyWorkerInbound);
  }

  /** Follow the explorer's shared clock: show `simMs` now, advancing at `rate`. */
  setClock(simMs: number, rate: number): void {
    this.worker?.postMessage({ type: "clock", simMs, rate } satisfies SkyWorkerInbound);
  }

  dispose(): void {
    if (!this.worker) return;
    this.disposeWorker(this.worker);
    this.worker = null;
  }

  private disposeWorker(worker: Worker, errorHandler?: (e: ErrorEvent) => void): void {
    if (errorHandler) worker.removeEventListener("error", errorHandler);
    worker.terminate();
    if (this.worker === worker) this.worker = null;
  }
}

export type { SkyCategory };
export { CATEGORY_LABELS, CATEGORY_COLORS };
