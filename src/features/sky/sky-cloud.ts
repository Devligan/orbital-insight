"use client";

/**
 * Main-thread client for the whole-sky propagation worker.
 *
 * Wraps the Worker protocol in a tiny event interface so the Cesium layer
 * never touches message plumbing. Positions arrive as zero-copy typed arrays;
 * the caller applies them and calls `scene.requestRender()` itself.
 *
 * Tuning: batch size + tick interval keep a full catalog sweep at ~2 s
 * (10_600 objects ÷ 600 per 140 ms tick ≈ 2.5 s at 1× speed), so close-LEO
 * motion reads continuously without saturating a single worker core.
 */

import type { SkyWorkerOutbound } from "./sky-worker";
import { CATEGORY_COLORS, CATEGORY_LABELS, type SkyCategory } from "./category";

export interface SkyStartPosition {
  index: number;
  lonDeg: number;
  latDeg: number;
  altKm: number;
}

export interface SkyCloudEvents {
  onReady(info: { parsed: number; failed: number; categories: Int8Array; revsPerDay: Float32Array; ids: string[] }): void;
  onPositions(batch: { tMs: number; idx: Int32Array; values: Float32Array; sweepDone: boolean }): void;
  onError(message: string): void;
}

export class SkyCloud {
  private worker: Worker | null = null;
  private events: SkyCloudEvents;

  constructor(events: SkyCloudEvents) {
    this.events = events;
  }

  start(entries: { i: string; l1: string; l2: string }[]): void {
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
          revsPerDay: message.revsPerDay,
          ids: message.ids,
        });
      } else if (message.type === "positions") {
        this.events.onPositions({
          tMs: message.tMs,
          idx: message.idx,
          values: message.values,
          sweepDone: message.sweepDone,
        });
      } else if (message.type === "error") {
        this.events.onError(message.message);
        this.disposeWorker(worker, errorHandler);
      }
    };
    this.worker = worker;
    worker.postMessage({
      type: "init",
      entries,
      startMs: Date.now(),
      batchSize: 600,
      tickMs: 140,
    });
  }

  setSpeed(speed: number): void {
    this.worker?.postMessage({ type: "speed", speed });
  }

  setPaused(paused: boolean): void {
    this.worker?.postMessage({ type: "pause", paused });
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
