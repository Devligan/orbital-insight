/**
 * Home-page "You can actually see" selection (src/features/tonight/visible-tonight.ts).
 *
 * The honesty rules under test: only server-judged visible passes with a
 * window still ahead are listed, soonest first across satellites; an empty
 * list explains itself from the returned verdicts; failed satellites are
 * named so "nothing visible" is never silently "data missing".
 */

import { describe, expect, it } from "vitest";
import type { PassResultDto } from "@/contracts/orbital";
import { countdownTo, heightWords, noneVisibleReason, skyPath, summarizeTonight, timeUntil } from "@/features/tonight/visible-tonight";

type Pass = PassResultDto["passes"][number];

const NOW = Date.parse("2026-10-16T18:00:00Z");
const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();
const label = (n: string, name: string) => (n === "25544" ? "ISS" : name || `NORAD ${n}`);

function pass(riseMin: number, opts: { visible?: [number, number]; reason?: "satellite-in-shadow" | "sky-too-bright" | "both"; endsInShadow?: boolean } = {}): Pass {
  return {
    riseTime: iso(riseMin),
    maxTime: iso(riseMin + 3),
    maxElevationDeg: 55,
    setTime: iso(riseMin + 6),
    truncated: "none",
    azimuthAtRiseDeg: 225,
    azimuthAtMaxDeg: 180,
    azimuthAtSetDeg: 90,
    visibility: {
      fromGround: opts.visible !== undefined,
      bestEstimatedMagnitude: opts.visible ? -1.4 : null,
      bestTimeIso: opts.visible ? iso(opts.visible[0]) : null,
      sunElevationDegAtApex: -12,
      satelliteInShadowAtApex: false,
      reasonIfNotVisible: opts.visible ? null : (opts.reason ?? "sky-too-bright"),
      visibleWindow: opts.visible
        ? {
            start: { timeIso: iso(opts.visible[0]), azimuthDeg: 225, elevationDeg: 10 },
            end: { timeIso: iso(opts.visible[1]), azimuthDeg: 90, elevationDeg: opts.endsInShadow ? 25 : 10 },
            startsFromShadow: false,
            endsInShadow: opts.endsInShadow ?? false,
          }
        : null,
      skyTrack: [],
    },
  };
}

function sat(satelliteNumber: string, passes: Pass[], extra: Partial<PassResultDto> = {}): PassResultDto {
  return { satelliteNumber, name: satelliteNumber === "25544" ? "ISS (ZARYA)" : "CSS (TIANHE)", lineage: "live", passes, ...extra };
}

describe("summarizeTonight", () => {
  it("lists only visible passes, merged across satellites and sorted by visible start", () => {
    const summary = summarizeTonight(
      [
        sat("25544", [pass(30), pass(120, { visible: [121, 125] })]),
        sat("48274", [pass(60, { visible: [61, 64] }), pass(300, { reason: "satellite-in-shadow" })]),
      ],
      NOW,
      label,
    );
    expect(summary.kind).toBe("visible");
    if (summary.kind !== "visible") return;
    expect(summary.passes.map((p) => p.satelliteNumber)).toEqual(["48274", "25544"]);
    expect(summary.passes[1]?.label).toBe("ISS");
    expect(summary.passes[0]?.magnitude).toBe(-1.4);
  });

  it("keeps a pass that is visible right now and drops one whose visible window has ended", () => {
    const summary = summarizeTonight([sat("25544", [pass(-8, { visible: [-7, -4] }), pass(-3, { visible: [-2, 2] })])], NOW, label);
    expect(summary.kind).toBe("visible");
    if (summary.kind !== "visible") return;
    expect(summary.passes).toHaveLength(1);
    expect(countdownTo(summary.passes[0]!.window.start.timeIso, summary.passes[0]!.window.end.timeIso, NOW)).toBe("visible now");
  });

  it("explains an empty list from the verdicts, counting only passes still ahead", () => {
    const summary = summarizeTonight(
      [
        sat("25544", [pass(-30), pass(30), pass(130), pass(400, { reason: "satellite-in-shadow" })]),
        sat("48274", [pass(200, { reason: "both" })]),
      ],
      NOW,
      label,
    );
    expect(summary).toMatchObject({ kind: "none-visible", upcoming: 4, skyTooBright: 2, inShadow: 1, both: 1 });
    if (summary.kind !== "none-visible") return;
    expect(noneVisibleReason(summary)).toBe(
      "Not the right night. 4 passes go over you in the next 24 hours, but none can be seen: 2 cross your sky while it's still light; 1 happens while the satellite is inside Earth's shadow; 1 happens in a light sky with the satellite eclipsed.",
    );
  });

  it("uses singular grammar for a single pass", () => {
    const summary = summarizeTonight([sat("25544", [pass(30)])], NOW, label);
    if (summary.kind !== "none-visible") throw new Error(`unexpected ${summary.kind}`);
    expect(noneVisibleReason(summary)).toBe(
      "Not the right night. 1 pass goes over you in the next 24 hours, but none can be seen: 1 crosses your sky while it's still light.",
    );
  });

  it("distinguishes 'no passes at all' from 'passes, none visible'", () => {
    expect(summarizeTonight([sat("25544", []), sat("48274", [])], NOW, label).kind).toBe("no-passes");
  });

  it("names failed satellites instead of silently shrinking the list", () => {
    const failed = sat("48274", [], { name: "", lineage: undefined, failure: { reason: "provider-unavailable", message: "CelesTrak 503" } });
    const partial = summarizeTonight([sat("25544", [pass(60, { visible: [61, 64] })]), failed], NOW, label);
    expect(partial.unavailable).toEqual(["NORAD 48274"]);
    expect(summarizeTonight([failed], NOW, label)).toEqual({ kind: "unavailable", unavailable: ["NORAD 48274"] });
  });
});

describe("countdown and sky path wording", () => {
  it("counts down in the units people plan with", () => {
    expect(timeUntil(iso(125), NOW)).toBe("in 2 h 05 m");
    expect(timeUntil(iso(14), NOW)).toBe("in 14 min");
    expect(timeUntil(new Date(NOW + 20_000).toISOString(), NOW)).toBe("in under a minute");
    expect(timeUntil(iso(-1), NOW)).toBeNull();
    expect(countdownTo(iso(-10), iso(-5), NOW)).toBe("over");
  });

  it("describes where to look, naming the apex only when it is inside the visible window", () => {
    const full = pass(10, { visible: [10, 16] });
    expect(skyPath(full, full.visibility!.visibleWindow!)).toEqual([
      "appears 10° up in the SW",
      "highest 55° in the S (about 5½ fists above the horizon)",
      "last seen 10° up in the E",
    ]);
    // Fades into shadow before culminating: no "highest" claim.
    const early = pass(10, { visible: [10, 12], endsInShadow: true });
    expect(skyPath(early, early.visibility!.visibleWindow!)).toEqual([
      "appears 10° up in the SW",
      "fades into Earth's shadow 25° up in the E",
    ]);
  });

  it("says 'already up' for a pass under way when the window opened, without naming its peak twice", () => {
    // The request was made mid-pass: no rise time, and the visible stretch starts
    // at its highest point (36°, as on a real ISS pass over New York).
    const p = pass(10, { visible: [13, 16] });
    const underWay = {
      ...p,
      riseTime: null,
      truncated: "rise" as const,
      maxTime: iso(13.2),
      maxElevationDeg: 36.3,
      visibility: {
        ...p.visibility!,
        visibleWindow: { ...p.visibility!.visibleWindow!, start: { timeIso: iso(13), azimuthDeg: 135, elevationDeg: 36 } },
      },
    };
    expect(skyPath(underWay, underWay.visibility.visibleWindow)).toEqual([
      "already up, 36° up in the SE",
      "last seen 10° up in the E",
    ]);
  });

  it("gives heights in fists at arm's length, and calls the zenith straight up", () => {
    expect(heightWords(10)).toBe("about 1 fist above the horizon");
    expect(heightWords(12)).toBe("about 1 fist above the horizon");
    expect(heightWords(4)).toBe("about 1 fist above the horizon");
    expect(heightWords(36)).toBe("about 3½ fists above the horizon");
    expect(heightWords(74)).toBe("about 7½ fists above the horizon");
    expect(heightWords(75)).toBe("nearly straight overhead");
    expect(heightWords(89)).toBe("nearly straight overhead");
  });

  it("attributes a mid-sky edge without a shadow flag to twilight", () => {
    // Visible from rise until 2 min before set, not shadow-flagged: dawn.
    const dawn = pass(10, { visible: [10, 14] });
    expect(skyPath(dawn, dawn.visibility!.visibleWindow!).at(-1)).toBe("lost in the brightening sky 10° up in the E");
    // Becomes visible 2 min after rise, not from shadow: dusk.
    const dusk = pass(10, { visible: [12, 16] });
    expect(skyPath(dusk, dusk.visibility!.visibleWindow!)[0]).toBe("shows up as the sky darkens, 10° up in the SW");
  });
});
