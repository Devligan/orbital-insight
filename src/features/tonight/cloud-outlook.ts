/**
 * "Will clouds be in the way?" for one visible pass, from an hourly forecast.
 *
 * Cloud cover is forecast at whole hours. A pass lasts minutes, so the value
 * at its midpoint is interpolated linearly between the two bracketing hours.
 * Outside the forecast's span the answer is "no forecast", never a guess.
 *
 * The words follow the meteorological okta bands loosely (clear ≈ 0–2 oktas,
 * overcast ≈ 7–8): 20 / 50 / 80 % are the cut-offs. Satellites are point
 * sources, so even "mostly cloudy" can leave a gap; only overcast is called
 * "likely hidden".
 */

import type { CloudForecast } from "@/integrations/open-meteo/forecast";

export type CloudSky = "clear" | "partly-cloudy" | "mostly-cloudy" | "overcast";

export interface CloudOutlook {
  /** Total cloud cover at the pass midpoint, whole percent. */
  pct: number;
  sky: CloudSky;
}

const HOUR_MS = 3_600_000;

export function skyFor(pct: number): CloudSky {
  if (pct <= 20) return "clear";
  if (pct <= 50) return "partly-cloudy";
  if (pct <= 80) return "mostly-cloudy";
  return "overcast";
}

/** Cloud cover for a visible window [startMs, endMs], or null when the forecast doesn't cover it. */
export function cloudOutlookFor(forecast: CloudForecast, startMs: number, endMs: number): CloudOutlook | null {
  const mid = (startMs + endMs) / 2;
  const hours = forecast.hours;
  for (let i = 0; i < hours.length; i++) {
    const at = hours[i]!;
    if (at.atMs === mid) return outlook(at.totalPct);
    const next = hours[i + 1];
    // Interpolate only across one real hourly step: a gap in the series (a
    // dropped null hour) is not bridged.
    if (next && at.atMs < mid && mid < next.atMs && next.atMs - at.atMs <= HOUR_MS) {
      const f = (mid - at.atMs) / (next.atMs - at.atMs);
      return outlook(at.totalPct + f * (next.totalPct - at.totalPct));
    }
  }
  return null;
}

function outlook(rawPct: number): CloudOutlook {
  const pct = Math.round(Math.min(100, Math.max(0, rawPct)));
  return { pct, sky: skyFor(pct) };
}

/** The line shown on a pass: "Clear sky forecast · 8% cloud". */
export function cloudPhrase(outlook: CloudOutlook): string {
  switch (outlook.sky) {
    case "clear":
      return `Clear sky forecast · ${outlook.pct}% cloud`;
    case "partly-cloudy":
      return `Partly cloudy forecast · ${outlook.pct}% cloud`;
    case "mostly-cloudy":
      return `Mostly cloudy forecast · ${outlook.pct}% cloud, look for gaps`;
    case "overcast":
      return `Overcast forecast · ${outlook.pct}% cloud, likely hidden`;
  }
}
