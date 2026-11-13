/**
 * Plain-language sky vocabulary shared by the pass cards and the home page's
 * visible-pass list. JSX-free so pure selection logic (and its unit tests)
 * can depend on it without pulling in components.
 */

import type { PassResultDto } from "@/contracts/orbital";

/**
 * One pass as it arrives on the wire. Derived from the shared contract - a
 * hand-copied shape here is how the client once drifted from the server.
 */
export type PassCardData = PassResultDto["passes"][number];

/** 0–360° azimuth → the 8 compass points a human actually uses. */
export function compassPoint(azimuthDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((azimuthDeg % 360) / 45)) % 8] ?? "N";
}

/**
 * Wall-clock time at the observer's location ("Sat 4:06 AM"). `timeZone`
 * is the observer's IANA zone from the server; null falls back to the
 * device's zone (right whenever the location came from this device).
 */
export function observerClock(iso: string, timeZone: string | null, withDay = true): string {
  return new Intl.DateTimeFormat("en-US", {
    ...(withDay ? { weekday: "short" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}

function offsetName(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/**
 * "Times are Tokyo time (GMT+9)" - shown only when the observer's clock
 * differs from the device's at that instant, so a local user never sees
 * noise. Null when no label is needed.
 */
export function observerZoneNote(timeZone: string | null, deviceTimeZone: string, at: Date): string | null {
  if (!timeZone) return null;
  const observerOffset = offsetName(timeZone, at);
  if (observerOffset === offsetName(deviceTimeZone, at)) return null;
  if (timeZone.startsWith("Etc/")) return `Times are local to that spot (${observerOffset}).`;
  const place = (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  return `Times are ${place} time (${observerOffset}).`;
}

/** Plain-language bucket for an estimated magnitude (lower = brighter). */
export function brightnessWord(magnitude: number): "conspicuous" | "naked-eye" | "needs binoculars" {
  return magnitude <= 3.5 ? "conspicuous" : magnitude <= 6 ? "naked-eye" : "needs binoculars";
}
