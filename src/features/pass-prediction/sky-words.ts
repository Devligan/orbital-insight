/**
 * Plain-language sky vocabulary shared by the pass cards and the home page's
 * visible-pass list. JSX-free so pure selection logic (and its unit tests)
 * can depend on it without pulling in components.
 */

import type { PassResultDto } from "@/contracts/orbital";

/**
 * One pass as it arrives on the wire. Derived from the shared contract — a
 * hand-copied shape here is how the client once drifted from the server.
 */
export type PassCardData = PassResultDto["passes"][number];

/** 0–360° azimuth → the 8 compass points a human actually uses. */
export function compassPoint(azimuthDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((azimuthDeg % 360) / 45)) % 8] ?? "N";
}

/** Plain-language bucket for an estimated magnitude (lower = brighter). */
export function brightnessWord(magnitude: number): "conspicuous" | "naked-eye" | "needs binoculars" {
  return magnitude <= 3.5 ? "conspicuous" : magnitude <= 6 ? "naked-eye" : "needs binoculars";
}
