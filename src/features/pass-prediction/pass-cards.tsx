"use client";

/**
 * Pass predictions as readable cards.
 *
 * Desktop keeps the technical table (arbitrary column counts, azimuth
 * comparisons). On a phone a 7-column table scrolls off-screen — the same
 * numbers render as a card per pass so nothing needs horizontal scrolling.
 * Used by the /passes results table (small screens) and the explorer's
 * "tonight from my location" panel.
 */

import { formatUtc } from "@/lib/units";

export interface PassCardData {
  riseTime: string | null;
  maxTime: string;
  maxElevationDeg: number;
  setTime: string | null;
  azimuthAtRiseDeg: number | null;
  azimuthAtMaxDeg: number;
  azimuthAtSetDeg: number | null;
  truncated: "rise" | "set" | "both" | "none";
  /** Light-state evaluation — present when the server computed it. */
  visibility?: {
    fromGround: boolean;
    bestEstimatedMagnitude: number | null;
    bestTimeIso: string | null;
    sunElevationDegAtApex: number;
    satelliteInShadowAtApex: boolean;
    reasonIfNotVisible: "satellite-in-shadow" | "sky-too-bright" | "both" | "none" | null;
  };
}

/** 0–360° azimuth → the 8 compass points a human actually uses. */
export function compassPoint(azimuthDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((azimuthDeg % 360) / 45)) % 8] ?? "N";
}

/**
 * The visibility verdict, in words a human plans around. Magnitudes are
 * surveys' business; here ±1.5 mag of uncertainty is part of the display.
 */
export function visibilityLine(pass: PassCardData): string | null {
  const v = pass.visibility;
  if (!v) return null;
  if (v.fromGround && v.bestEstimatedMagnitude !== null) {
    const look = compassPoint(pass.azimuthAtMaxDeg);
    const brightness =
      v.bestEstimatedMagnitude <= 3.5
        ? "conspicuous"
        : v.bestEstimatedMagnitude <= 6
          ? "naked-eye"
          : "needs binoculars";
    return `visually confirmed in sunlight — look ${look} at the apex, estimated magnitude ${v.bestEstimatedMagnitude.toFixed(1)} (${brightness})`;
  }
  switch (v.reasonIfNotVisible) {
    case "satellite-in-shadow":
      return "crossing while inside Earth's shadow — no sunlight to reflect, don't look for it";
    case "sky-too-bright":
      return "the sun is still up at your spot then — invisible against the sky";
    case "both":
      return "overhead only while your sky is lit or the satellite is eclipsed";
    default:
      return null;
  }
}

/** Local wall-clock time — pass times are for planning, so local is the useful form. */
export function localWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function PassCard({ pass }: { pass: PassCardData }) {
  return (
    <div className="rounded border border-[var(--color-bg-inset)] p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="data-value text-[13px]">{localWhen(pass.maxTime)}</span>
        <span className="text-[11px] text-[var(--color-text-secondary)]">
          peaks {pass.maxElevationDeg.toFixed(0)}° above the horizon ({compassPoint(pass.azimuthAtMaxDeg)})
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-[var(--color-text-muted)]">
        <span>
          rises {pass.riseTime ? localWhen(pass.riseTime) : "already up"}
          {pass.azimuthAtRiseDeg !== null ? ` ${compassPoint(pass.azimuthAtRiseDeg)}` : ""}
        </span>
        <span>
          sets {pass.setTime ? localWhen(pass.setTime) : "still up"}
          {pass.azimuthAtSetDeg !== null ? ` ${compassPoint(pass.azimuthAtSetDeg)}` : ""}
        </span>
      </div>
      {pass.truncated !== "none" ? (
        <p className="mt-1 text-[10px] text-[var(--color-status-warn)]">partially outside the prediction window</p>
      ) : null}
      {(() => {
        const line = visibilityLine(pass);
        return line ? <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">{line}</p> : null;
      })()}
    </div>
  );
}

/** Compact UTC range line for provenance honesty alongside the local-time cards. */
export function PassUtcRange({ riseTime, maxTime, setTime }: { riseTime: string | null; maxTime: string; setTime: string | null }) {
  return (
    <span className="text-[10px] text-[var(--color-text-muted)]">
      UTC {riseTime ? formatUtc(new Date(riseTime)).slice(0, 17) : "…"}→{formatUtc(new Date(maxTime)).slice(11, 16)}
      {setTime ? `→${formatUtc(new Date(setTime)).slice(11, 16)}` : ""}
    </span>
  );
}
