"use client";

/**
 * Pass predictions as readable cards.
 *
 * Desktop keeps the technical table (arbitrary column counts, azimuth
 * comparisons). On a phone a 7-column table scrolls off-screen — the same
 * numbers render as a card per pass so nothing needs horizontal scrolling.
 * Used by the /passes results table (small screens) and the explorer's
 * "tonight from my location" panel. Times read on the observer's wall clock
 * (zone from the server), not the viewing device's.
 */

import { brightnessWord, compassPoint, observerClock, type PassCardData } from "./sky-words";

export { brightnessWord, compassPoint, type PassCardData };

/**
 * The visibility verdict, in words a human plans around. A magnitude is
 * shown only for objects with a published standard magnitude; otherwise the
 * card says brightness is unknown rather than guessing.
 */
export function visibilityLine(pass: PassCardData): string | null {
  const v = pass.visibility;
  if (!v) return null;
  if (v.fromGround) {
    const look = compassPoint(pass.azimuthAtMaxDeg);
    const brightness =
      v.bestEstimatedMagnitude !== null
        ? `estimated magnitude ${v.bestEstimatedMagnitude.toFixed(1)} (${brightnessWord(v.bestEstimatedMagnitude)})`
        : "brightness unknown — no published standard magnitude for this object";
    return `predicted visible in sunlight against a dark sky — look ${look} at the apex, ${brightness}`;
  }
  switch (v.reasonIfNotVisible) {
    case "satellite-in-shadow":
      return "crossing while inside Earth's shadow — no sunlight to reflect, don't look for it";
    case "sky-too-bright":
      // Covers civil twilight too (sun 0° to −6°), so not "the sun is up".
      return "your sky is still too bright then — lost against daylight or twilight";
    case "both":
      return "overhead only while your sky is lit or the satellite is eclipsed";
    default:
      return null;
  }
}

/**
 * One pass, read at a glance: when it peaks (observer's wall clock), how
 * high and where, rise/set, and the visibility verdict — a green dot when it
 * can actually be seen, so the eye finds the passes that matter.
 */
export function PassCard({ pass, timeZone }: { pass: PassCardData; timeZone: string | null }) {
  const visible = pass.visibility?.fromGround === true;
  const line = visibilityLine(pass);
  return (
    <div className="rounded-lg border border-[var(--color-border-hairline)] bg-[var(--color-bg-inset)] px-3 py-2.5" data-testid="pass-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[15px] font-semibold tabular-nums text-[var(--color-text-primary)]">
          {observerClock(pass.maxTime, timeZone)}
        </span>
        <span className="text-[12px] text-[var(--color-text-secondary)]">
          peaks {pass.maxElevationDeg.toFixed(0)}° up in the {compassPoint(pass.azimuthAtMaxDeg)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-[12px] tabular-nums text-[var(--color-text-muted)]">
        <span>
          rises {pass.riseTime ? observerClock(pass.riseTime, timeZone, false) : "already up"}
          {pass.azimuthAtRiseDeg !== null ? ` · ${compassPoint(pass.azimuthAtRiseDeg)}` : ""}
        </span>
        <span>
          sets {pass.setTime ? observerClock(pass.setTime, timeZone, false) : "after the window"}
          {pass.azimuthAtSetDeg !== null ? ` · ${compassPoint(pass.azimuthAtSetDeg)}` : ""}
        </span>
      </div>
      {pass.truncated !== "none" ? (
        <p className="mt-1 text-[11px] text-[var(--color-status-warn)]">partially outside the prediction window</p>
      ) : null}
      {line ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-[var(--color-text-secondary)]">
          <span
            aria-hidden
            className={
              "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full " +
              (visible ? "bg-[var(--color-status-good)]" : "bg-[var(--color-border-strong)]")
            }
          />
          <span>{line}</span>
        </p>
      ) : null}
    </div>
  );
}
