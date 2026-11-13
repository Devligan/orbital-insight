/**
 * Sky-chart geometry (src/features/pass-prediction/sky-chart-geometry.ts).
 *
 * The chart is only useful if a point lands where the eye should look, so the
 * projection is pinned at the zenith and the four cardinal horizons (star-
 * chart orientation: north up, east left), and the bright "visible" stretch
 * is pinned to the refined window edges, not to the coarse samples.
 */

import { describe, expect, it } from "vitest";
import type { PassResultDto } from "@/contracts/orbital";
import { projectSky, skyChartModel } from "@/features/pass-prediction/sky-chart-geometry";

type Pass = PassResultDto["passes"][number];
type Visibility = NonNullable<Pass["visibility"]>;

const R = 100;
const T0 = Date.parse("2026-11-13T01:00:00Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

/** A south-transiting pass, SW → S (60° up) → E, sampled every 30 s. */
function track(): Visibility["skyTrack"] {
  const points: Visibility["skyTrack"] = [];
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    points.push({ timeIso: at(i * 30), azimuthDeg: 225 - 135 * f, elevationDeg: 10 + 50 * Math.sin(Math.PI * f) });
  }
  return points;
}

function pass(window: Visibility["visibleWindow"], skyTrack = track()): Pass {
  return {
    riseTime: at(0),
    maxTime: at(180),
    maxElevationDeg: 60,
    setTime: at(360),
    truncated: "none",
    azimuthAtRiseDeg: 225,
    azimuthAtMaxDeg: 157.5,
    azimuthAtSetDeg: 90,
    visibility: {
      fromGround: window !== null,
      bestEstimatedMagnitude: null,
      bestTimeIso: window ? window.start.timeIso : null,
      sunElevationDegAtApex: -15,
      satelliteInShadowAtApex: false,
      reasonIfNotVisible: window ? null : "satellite-in-shadow",
      visibleWindow: window,
      skyTrack,
    },
  };
}

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

/** Parse "M1 2 L3 4 …" back to points. */
function points(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
}

describe("projectSky", () => {
  it("puts the zenith at the centre and the horizon on the rim, north up and east left", () => {
    close(projectSky(123, 90, R), 0, 0);
    close(projectSky(0, 0, R), 0, -R);
    close(projectSky(90, 0, R), -R, 0);
    close(projectSky(180, 0, R), 0, R);
    close(projectSky(270, 0, R), R, 0);
  });

  it("is linear in elevation and clamps below the horizon", () => {
    close(projectSky(180, 45, R), 0, R / 2);
    close(projectSky(180, 60, R), 0, R / 3);
    close(projectSky(180, -5, R), 0, R);
  });
});

describe("skyChartModel", () => {
  it("draws nothing without a sky track (a pass the server never enriched)", () => {
    const bare: Pass = { ...pass(null), visibility: undefined };
    expect(skyChartModel(bare, R)).toBeNull();
    expect(skyChartModel(pass(null, track().slice(0, 1)), R)).toBeNull();
  });

  it("draws the whole pass, rise to set, through every sample", () => {
    const model = skyChartModel(pass(null), R);
    expect(model).not.toBeNull();
    const drawn = points(model!.track);
    expect(drawn).toHaveLength(13);
    const rise = projectSky(225, 10, R);
    expect(drawn[0]!.x).toBeCloseTo(rise.x, 1);
    expect(drawn[0]!.y).toBeCloseTo(rise.y, 1);
    expect(model!.visible).toBeNull();
    expect(model!.visibleStart).toBeNull();
  });

  it("starts and stops the visible stretch at the refined window edges, keeping only samples inside", () => {
    const start = { timeIso: at(95), azimuthDeg: 186, elevationDeg: 52 };
    const end = { timeIso: at(250), azimuthDeg: 128, elevationDeg: 44 };
    const model = skyChartModel(pass({ start, end, startsFromShadow: true, endsInShadow: true }), R)!;
    const drawn = points(model.visible!);
    // Samples at 120, 150, 180, 210, 240 s lie strictly inside (95 s, 250 s).
    expect(drawn).toHaveLength(2 + 5);
    const s = projectSky(start.azimuthDeg, start.elevationDeg, R);
    const e = projectSky(end.azimuthDeg, end.elevationDeg, R);
    expect(drawn[0]!.x).toBeCloseTo(s.x, 1);
    expect(drawn[0]!.y).toBeCloseTo(s.y, 1);
    expect(drawn[drawn.length - 1]!.x).toBeCloseTo(e.x, 1);
    expect(model.visibleEnd).toEqual(e);
    expect(model.endsInShadow).toBe(true);
    expect(model.startsFromShadow).toBe(true);
  });

  it("points the arrow along the motion: this pass ends heading toward the east rim (left)", () => {
    const model = skyChartModel(pass(null), R)!;
    // Arriving at E from the SE: moving left and slightly up on the chart.
    expect(Math.abs(model.heading.angleDeg)).toBeGreaterThan(90);
    close(model.heading.tip, projectSky(90, 10, R).x, projectSky(90, 10, R).y);
  });

  it("still knows the direction when the visible window is a single instant", () => {
    // Exactly the 150 s sample: the window collapses onto a track point.
    const sample = track()[5]!;
    const moment = { timeIso: sample.timeIso, azimuthDeg: sample.azimuthDeg, elevationDeg: sample.elevationDeg };
    const model = skyChartModel(pass({ start: moment, end: moment, startsFromShadow: false, endsInShadow: false }), R)!;
    // The heading comes from the earlier track — the pass's own motion
    // (SW → S, leftward near the top of the arc) — not the zero-length stretch.
    expect(Math.abs(model.heading.angleDeg)).toBeGreaterThan(90);
    close(model.heading.tip, ...(Object.values(projectSky(sample.azimuthDeg, sample.elevationDeg, R)) as [number, number]));
  });
});
