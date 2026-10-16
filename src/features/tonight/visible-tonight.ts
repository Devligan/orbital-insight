/**
 * "What can I actually see?" — the selection and wording behind the home
 * page's headline list. Pure (no React, no clock reads) so the honesty rules
 * are unit-tested:
 *
 *  - Only passes the server judged visible (sunlit satellite, dark sky) with
 *    a visible window still ahead of `nowMs` are listed, soonest first.
 *  - When nothing is visible, the empty state says *why*, from the same
 *    verdicts: no passes at all, or passes that cross a light sky / happen
 *    while the object is in Earth's shadow.
 *  - Satellites whose data failed to load are named, so an empty list is
 *    never silently an incomplete one.
 */

import type { PassResultDto } from "@/contracts/orbital";
import { compassPoint, type PassCardData } from "@/features/pass-prediction/sky-words";

type VisibleWindowDto = NonNullable<NonNullable<PassCardData["visibility"]>["visibleWindow"]>;

export interface VisiblePass {
  satelliteNumber: string;
  label: string;
  lineage: PassResultDto["lineage"];
  pass: PassCardData;
  window: VisibleWindowDto;
  magnitude: number | null;
}

export type TonightSummary =
  | { kind: "visible"; passes: VisiblePass[]; unavailable: string[] }
  | {
      kind: "none-visible";
      /** Geometric passes still ahead in the window… */
      upcoming: number;
      /** …and why they can't be seen (a pass without a verdict counts in none). */
      skyTooBright: number;
      inShadow: number;
      both: number;
      unavailable: string[];
    }
  | { kind: "no-passes"; unavailable: string[] }
  /** Every satellite failed to load: nothing can be said about the sky. */
  | { kind: "unavailable"; unavailable: string[] };

export function summarizeTonight(
  results: PassResultDto[],
  nowMs: number,
  labelFor: (satelliteNumber: string, fallbackName: string) => string,
): TonightSummary {
  const unavailable = results.filter((r) => r.failure).map((r) => labelFor(r.satelliteNumber, r.name));
  const loaded = results.filter((r) => !r.failure);
  if (loaded.length === 0) return { kind: "unavailable", unavailable };

  const visible: VisiblePass[] = [];
  let skyTooBright = 0;
  let inShadow = 0;
  let both = 0;
  let upcoming = 0;

  for (const sat of loaded) {
    for (const pass of sat.passes) {
      const v = pass.visibility;
      const window = v?.visibleWindow;
      if (v?.fromGround && window) {
        if (Date.parse(window.end.timeIso) <= nowMs) continue;
        visible.push({
          satelliteNumber: sat.satelliteNumber,
          label: labelFor(sat.satelliteNumber, sat.name),
          lineage: sat.lineage,
          pass,
          window,
          magnitude: v.bestEstimatedMagnitude,
        });
        continue;
      }
      if (Date.parse(pass.setTime ?? pass.maxTime) <= nowMs) continue;
      upcoming++;
      if (v?.reasonIfNotVisible === "sky-too-bright") skyTooBright++;
      else if (v?.reasonIfNotVisible === "satellite-in-shadow") inShadow++;
      else if (v?.reasonIfNotVisible === "both") both++;
    }
  }

  if (visible.length > 0) {
    visible.sort((a, b) => Date.parse(a.window.start.timeIso) - Date.parse(b.window.start.timeIso));
    return { kind: "visible", passes: visible, unavailable };
  }
  if (upcoming === 0) return { kind: "no-passes", unavailable };
  return { kind: "none-visible", upcoming, skyTooBright, inShadow, both, unavailable };
}

/** "in 2 h 05 m" / "in 14 min" / "in under a minute"; null once the instant has passed. */
export function timeUntil(iso: string, nowMs: number): string | null {
  const ms = Date.parse(iso) - nowMs;
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `in ${h} h ${String(minutes % 60).padStart(2, "0")} m`;
}

/** Countdown to a visible window — the number humans plan around. */
export function countdownTo(startIso: string, endIso: string, nowMs: number): string {
  return timeUntil(startIso, nowMs) ?? (Date.parse(endIso) > nowMs ? "visible now" : "over");
}

/** An edge this far from rise/set happened mid-sky, not at the horizon cutoff. */
const MID_SKY_EDGE_MS = 5_000;

/**
 * Where to look, start to finish: "appears 10° up in the SW → highest 63°
 * in the S → fades into Earth's shadow 25° up in the E". The apex is only
 * named when it falls inside the visible window — a pass that vanishes into
 * shadow before culminating never shows its highest point.
 *
 * A mid-sky edge has exactly two possible causes under the visibility model
 * (sunlit satellite + dark sky): Earth's shadow, flagged by the server, or
 * otherwise twilight — the sky darkening past or brightening through −6°.
 */
export function skyPath(pass: PassCardData, window: VisibleWindowDto): string[] {
  const steps: string[] = [];
  const at = (m: VisibleWindowDto["start"]) => `${Math.round(m.elevationDeg)}° up in the ${compassPoint(m.azimuthDeg)}`;
  const startMs = Date.parse(window.start.timeIso);
  const endMs = Date.parse(window.end.timeIso);

  const startsMidSky = pass.riseTime !== null && startMs - Date.parse(pass.riseTime) > MID_SKY_EDGE_MS;
  steps.push(
    window.startsFromShadow
      ? `emerges from Earth's shadow ${at(window.start)}`
      : startsMidSky
        ? `shows up as the sky darkens, ${at(window.start)}`
        : `appears ${at(window.start)}`,
  );

  const apexMs = Date.parse(pass.maxTime);
  if (apexMs > startMs && apexMs < endMs) {
    steps.push(`highest ${Math.round(pass.maxElevationDeg)}° in the ${compassPoint(pass.azimuthAtMaxDeg)}`);
  }

  const endsMidSky = pass.setTime !== null && Date.parse(pass.setTime) - endMs > MID_SKY_EDGE_MS;
  steps.push(
    window.endsInShadow
      ? `fades into Earth's shadow ${at(window.end)}`
      : endsMidSky
        ? `lost in the brightening sky ${at(window.end)}`
        : `last seen ${at(window.end)}`,
  );
  return steps;
}

/** The empty-state sentence, built only from the verdicts the server returned. */
export function noneVisibleReason(summary: Extract<TonightSummary, { kind: "none-visible" }>): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (summary.skyTooBright > 0) parts.push(`${plural(summary.skyTooBright, "crosses", "cross")} your sky while it's still light`);
  if (summary.inShadow > 0) parts.push(`${plural(summary.inShadow, "happens", "happen")} while the satellite is inside Earth's shadow`);
  if (summary.both > 0) parts.push(`${plural(summary.both, "happens", "happen")} in a light sky with the satellite eclipsed`);
  const lead = `Not the right night. ${plural(summary.upcoming, "pass goes", "passes go")} over you in the next 24 hours, but none can be seen`;
  return parts.length > 0 ? `${lead}: ${parts.join("; ")}.` : `${lead}.`;
}
