/**
 * The sampled instants for a sighting search, with everything that is the
 * same for every satellite at that instant computed once: the sidereal
 * angle, the sun's direction, and how high the sun is for the observer.
 */

import { sunDirection, sunElevationDegAt } from "@/domain/light/solar";
import { gmstRadians } from "@/domain/orbit/coordinates";
import type { Degrees, Kilometers } from "@/lib/units";
import type { SightingFrame, SightingObserver } from "./identify";

/** Seconds between samples. LEO objects cross ~1°/s overhead, so 10 s keeps a pass from skipping a ~25° match cone. */
export const SIGHTING_STEP_SECONDS = 10;

export function sightingFrames(
  observer: SightingObserver,
  centerMs: number,
  halfWindowMinutes: number,
  stepSeconds = SIGHTING_STEP_SECONDS,
): SightingFrame[] {
  const frames: SightingFrame[] = [];
  const stepMs = stepSeconds * 1000;
  const n = Math.round((halfWindowMinutes * 60_000) / stepMs);
  const location = {
    latitudeDeg: observer.latitudeDeg as Degrees,
    longitudeDeg: observer.longitudeDeg as Degrees,
    heightKm: observer.heightKm as Kilometers,
  };
  for (let i = -n; i <= n; i++) {
    const tMs = centerMs + i * stepMs;
    const date = new Date(tMs);
    const sun = sunDirection(date);
    frames.push({
      tMs,
      gmstRad: gmstRadians(date),
      sunUnit: [sun.x, sun.y, sun.z],
      sunElevationDeg: sunElevationDegAt(date, location),
    });
  }
  return frames;
}
