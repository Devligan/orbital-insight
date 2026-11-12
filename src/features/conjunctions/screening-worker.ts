/**
 * Conjunction-screening worker: ~10⁶ SGP4 propagations off the UI thread.
 * One request in, progress messages, one result out.
 */

import { screen, type ScreeningBody, type ScreeningResult } from "@/domain/conjunction/screening";
import { sgp4Body } from "./sgp4-body";

export interface CatalogRow {
  i: string;
  n: string;
  l1: string;
  l2: string;
}

export interface ScreenRequest {
  type: "screen";
  target: CatalogRow;
  catalog: CatalogRow[];
  startMs: number;
  durationMinutes: number;
  thresholdKm: number;
}

export type ScreenWorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: ScreeningResult; elapsedMs: number; unusable: number }
  | { type: "error"; message: string };

const post = (message: ScreenWorkerMessage) => (self as unknown as Worker).postMessage(message);

self.onmessage = (event: MessageEvent<ScreenRequest>) => {
  const request = event.data;
  if (request.type !== "screen") return;
  try {
    const started = performance.now();
    const target = sgp4Body(request.target.i, request.target.n, request.target.l1, request.target.l2);
    if (!target) {
      post({ type: "error", message: `SGP4 can't propagate ${request.target.n}'s element set.` });
      return;
    }
    const bodies: ScreeningBody[] = [];
    let unusable = 0;
    for (const row of request.catalog) {
      const body = sgp4Body(row.i, row.n, row.l1, row.l2);
      if (body) bodies.push(body);
      else unusable += 1;
    }
    const result = screen(target, bodies, {
      startMs: request.startMs,
      durationMinutes: request.durationMinutes,
      thresholdKm: request.thresholdKm,
      onProgress: (done, total) => post({ type: "progress", done, total }),
    });
    post({ type: "result", result, elapsedMs: performance.now() - started, unusable });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "Screening failed" });
  }
};
