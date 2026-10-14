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
}

/** 0–360° azimuth → the 8 compass points a human actually uses. */
export function compassPoint(azimuthDeg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(((azimuthDeg % 360) / 45)) % 8] ?? "N";
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
