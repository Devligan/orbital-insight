/**
 * Sighting worker: the whole active catalog × ~50 instants of SGP4, off the
 * UI thread. One request in, progress messages, one result out.
 */

import { identifySighting, launchOf, type SightingBody, type SightingQuery, type SightingResult } from "@/domain/sighting/identify";
import { sightingFrames } from "@/domain/sighting/frames";
import { standardMagnitudeFor } from "@/domain/light/standard-magnitudes";
import { compileTleLines, epochMillis, temeStateInto } from "@/integrations/sgp4/bulk";

export interface CatalogRow {
  i: string;
  n: string;
  l1: string;
  l2: string;
}

export interface IdentifyRequest {
  type: "identify";
  catalog: CatalogRow[];
  observer: { latitudeDeg: number; longitudeDeg: number };
  reportMs: number;
  halfWindowMinutes: number;
  query: SightingQuery;
}

export type IdentifyWorkerMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; result: SightingResult; elapsedMs: number; unusable: number; propagations: number }
  | { type: "error"; message: string };

const post = (message: IdentifyWorkerMessage) => (self as unknown as Worker).postMessage(message);

self.onmessage = (event: MessageEvent<IdentifyRequest>) => {
  const request = event.data;
  if (request.type !== "identify") return;
  try {
    const started = performance.now();
    const bodies: SightingBody[] = [];
    let unusable = 0;
    for (const row of request.catalog) {
      const satrec = compileTleLines(row.l1, row.l2);
      if (!satrec) {
        unusable += 1;
        continue;
      }
      const epochMs = epochMillis(satrec);
      bodies.push({
        id: row.i,
        name: row.n,
        launch: launchOf(row.l1),
        standardMagnitude: standardMagnitudeFor(row.i)?.value ?? null,
        state: (tMs, out, offset) => temeStateInto(satrec, (tMs - epochMs) / 60_000, out, offset),
      });
    }
    const observer = { ...request.observer, heightKm: 0 };
    const frames = sightingFrames(observer, request.reportMs, request.halfWindowMinutes);
    const result = identifySighting(bodies, observer, frames, request.query, request.reportMs, (done, total) =>
      post({ type: "progress", done, total }),
    );
    post({
      type: "result",
      result,
      elapsedMs: performance.now() - started,
      unusable,
      propagations: bodies.length * frames.length,
    });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : "The search failed" });
  }
};
