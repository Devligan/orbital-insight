import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { degreesToRadians, ecfToLookAngles, eciToEcf } from "satellite.js";
import {
  compareCandidates,
  foldLaunchGroups,
  identifySighting,
  launchOf,
  lookAngleInto,
  observerGeometryFor,
  separationFromReport,
  skyHeadingDeg,
  type SightingBody,
  type SightingCandidate,
  type SightingFrame,
  type SightingObserver,
} from "@/domain/sighting/identify";
import { sightingFrames } from "@/domain/sighting/frames";
import { findPasses } from "@/domain/passes/finder";
import { enrichPassVisibility } from "@/domain/passes/visibility";
import { compileElementSet } from "@/domain/orbit/propagation";
import { parseTle } from "@/domain/orbit/tle";
import { compileTleLines, epochMillis, temeStateInto } from "@/integrations/sgp4/bulk";
import type { ObserverLocation } from "@/domain/orbit/coordinates";

const DEG = Math.PI / 180;
const OBSERVER: SightingObserver = { latitudeDeg: 40, longitudeDeg: -74, heightKm: 0 };

describe("lookAngleInto", () => {
  it("agrees with satellite.js's eciToEcf + ecfToLookAngles", () => {
    const obs = observerGeometryFor({ latitudeDeg: 51.5, longitudeDeg: -0.13, heightKm: 0.02 });
    const look = new Float64Array(3);
    const positions = [
      [4000, 3000, 4500],
      [-6000, 2000, 1500],
      [1200, -6800, 400],
      [20000, 30000, 1000],
    ] as const;
    for (const gmst of [0, 1.3, 4.9]) {
      for (const [x, y, z] of positions) {
        lookAngleInto(obs, gmst, x, y, z, look);
        const reference = ecfToLookAngles(
          { latitude: degreesToRadians(51.5), longitude: degreesToRadians(-0.13), height: 0.02 },
          eciToEcf({ x, y, z }, gmst),
        );
        expect(look[0]).toBeCloseTo(reference.azimuth / DEG, 9);
        expect(look[1]).toBeCloseTo(reference.elevation / DEG, 9);
        expect(look[2]).toBeCloseTo(reference.rangeSat, 6);
      }
    }
  });
});

describe("separationFromReport", () => {
  it("is zero anywhere on the reported line of sight when height is unsure", () => {
    // acos near 1 loses digits: ~1e-6° is float noise, not a separation.
    for (const el of [10, 45, 89]) expect(separationFromReport(300, el, { azimuthDeg: 300, height: null })).toBeCloseTo(0, 5);
  });

  it("measures to the reported height band", () => {
    // Reported "low" (10–30°) in the W; the object is due W at 50°: 20° above the band.
    expect(separationFromReport(270, 50, { azimuthDeg: 270, height: "low" })).toBeCloseTo(20, 9);
    expect(separationFromReport(270, 20, { azimuthDeg: 270, height: "low" })).toBeCloseTo(0, 9);
  });

  it("treats the zenith as on every line of sight, and behind you as far", () => {
    expect(separationFromReport(90, 90, { azimuthDeg: 270, height: null })).toBeCloseTo(0, 6);
    // Due E at 30° while looking W: nearest point of the W arc is the zenith, 60° away.
    expect(separationFromReport(90, 30, { azimuthDeg: 270, height: null })).toBeCloseTo(60, 9);
    // 30° to the side at the horizon is 30° away.
    expect(separationFromReport(300, 0, { azimuthDeg: 270, height: "low" })).toBeCloseTo(
      Math.acos(Math.cos(30 * DEG) * Math.cos(10 * DEG)) / DEG,
      9,
    );
  });

  it("only constrains height when no direction is given", () => {
    expect(separationFromReport(123, 70, { azimuthDeg: null, height: "high" })).toBe(0);
    expect(separationFromReport(123, 40, { azimuthDeg: null, height: "high" })).toBe(20);
    expect(separationFromReport(123, 40, { azimuthDeg: null, height: null })).toBe(0);
  });
});

describe("skyHeadingDeg", () => {
  it("names the compass direction of motion", () => {
    expect(skyHeadingDeg(0, 80, 90, 80)).toBeCloseTo(135, 0); // across the zenith from N to E: heading SE
    expect(skyHeadingDeg(270, 20, 270, 40)).toBeCloseTo(90, 6); // climbing out of the W: toward the E
    expect(skyHeadingDeg(180, 50, 180, 30)).toBeCloseTo(180, 6); // sinking into the S: toward the S
  });
});

describe("launchOf", () => {
  it.each([
    ["1 25544U 98067A   26317.5 ", "1998-067"],
    ["1 48274U 21035A   26317.5 ", "2021-035"],
    ["1 99999U 57001B   26317.5 ", "1957-001"],
    ["1 80001U          26317.5 ", null],
  ])("%s → %s", (line1, launch) => {
    expect(launchOf(line1)).toBe(launch);
  });
});

/**
 * Synthetic sky: a body placed at a chosen az/el/range from the observer at
 * each instant (gmst 0, so TEME = ECF), with the sun on whichever side the
 * test wants.
 */
function placed(
  id: string,
  path: (tMs: number) => { az: number; el: number; rangeKm?: number },
  extra: Partial<SightingBody> = {},
): SightingBody {
  const lat = OBSERVER.latitudeDeg * DEG;
  const lon = OBSERVER.longitudeDeg * DEG;
  const o = observerGeometryFor(OBSERVER);
  return {
    id,
    name: extra.name ?? id,
    launch: extra.launch ?? null,
    standardMagnitude: extra.standardMagnitude ?? null,
    state: (tMs, out, offset) => {
      const { az, el, rangeKm = 800 } = path(tMs);
      // SEZ → ECF (inverse of the look-angle rotation).
      const s = -Math.cos(el * DEG) * Math.cos(az * DEG) * rangeKm;
      const e = Math.cos(el * DEG) * Math.sin(az * DEG) * rangeKm;
      const z = Math.sin(el * DEG) * rangeKm;
      const rx = Math.sin(lat) * Math.cos(lon) * s - Math.sin(lon) * e + Math.cos(lat) * Math.cos(lon) * z;
      const ry = Math.sin(lat) * Math.sin(lon) * s + Math.cos(lon) * e + Math.cos(lat) * Math.sin(lon) * z;
      const rz = -Math.cos(lat) * s + Math.sin(lat) * z;
      out[offset] = o.x + rx;
      out[offset + 1] = o.y + ry;
      out[offset + 2] = o.z + rz;
      out[offset + 3] = out[offset + 4] = out[offset + 5] = 0;
      return true;
    },
  };
}

const T0 = Date.UTC(2026, 10, 13, 2, 0, 0);
function frames(sunElevationDeg = -20, sunUnit: [number, number, number] = [0, 0, 1]): SightingFrame[] {
  // Sun straight "up" the z axis lights everything (nothing is behind Earth from it here).
  return Array.from({ length: 13 }, (_, i) => ({ tMs: T0 + (i - 6) * 10_000, gmstRad: 0, sunUnit, sunElevationDeg }));
}

/** Moving 0.5°/s in azimuth through `az0` at T0. */
const sweeping = (az0: number, el: number) => (tMs: number) => ({ az: az0 + ((tMs - T0) / 1000) * 0.5, el });

describe("identifySighting", () => {
  const query = { azimuthDeg: 300, height: null, maxSeparationDeg: 25 } as const;

  it("finds the object where the person looked, and only that one", () => {
    const result = identifySighting(
      [
        placed("there", sweeping(300, 40)),
        placed("opposite", sweeping(120, 40)),
        placed("parked", () => ({ az: 300, el: 40, rangeKm: 36_000 })), // geostationary: doesn't move
      ],
      OBSERVER,
      frames(),
      query,
      T0,
    );
    expect(result.candidates.map((c) => c.id)).toEqual(["there"]);
    const [there] = result.candidates;
    expect(there!.separationDeg).toBeLessThan(0.5);
    expect(there!.best.tMs).toBe(T0);
    expect(there!.angularRateDegPerSec).toBeCloseTo(0.5 * Math.cos(40 * DEG), 1);
    expect(there!.fromAzimuthDeg).toBeLessThan(there!.toAzimuthDeg);
    expect(result.seeableAnywhere).toBe(2); // "there" and "opposite"; the parked one never counts
    expect(result.bodiesConsidered).toBe(3);
  });

  it("reads the way it moved, and filters on it when the person remembers", () => {
    // Sweeping clockwise through WNW at constant height. Heading comes from the
    // 10 s chord 300° → 305°, whose direction is the tangent at its middle: 302.5 + 90 = 32.5° (NNE).
    const bodies = [placed("clockwise", sweeping(300, 40))];
    const [moving] = identifySighting(bodies, OBSERVER, frames(), query, T0).candidates;
    expect(moving!.headingDeg).toBeCloseTo(32.5, 1);
    expect(identifySighting(bodies, OBSERVER, frames(), { ...query, travelDeg: 45 }, T0).candidates).toHaveLength(1);
    expect(identifySighting(bodies, OBSERVER, frames(), { ...query, travelDeg: 180 }, T0).candidates).toHaveLength(0);
  });

  it("finds nothing when the sky was too bright to see satellites", () => {
    const result = identifySighting([placed("there", sweeping(300, 40))], OBSERVER, frames(-3), query, T0);
    expect(result.sunElevationDeg).toBe(-3);
    expect(result.candidates).toEqual([]);
    expect(result.seeableAnywhere).toBe(0);
  });

  it("skips objects in Earth's shadow", () => {
    // Sun along +x (ECF = TEME here): a body on the far side, within Earth's shadow cylinder, is dark.
    const observerOnNight = { ...OBSERVER, latitudeDeg: 0, longitudeDeg: 180 };
    const result = identifySighting(
      [placed("overhead", () => ({ az: 0, el: 89.9, rangeKm: 500 }))],
      observerOnNight,
      frames(-30, [1, 0, 0]),
      { azimuthDeg: null, height: null, maxSeparationDeg: 25 },
      T0,
    );
    expect(result.candidates).toEqual([]);
  });

  it("ranks by closeness, then by known brightness, then by range", () => {
    const result = identifySighting(
      [
        placed("near-unknown", (t) => ({ ...sweeping(301, 40)(t), rangeKm: 600 })),
        placed("near-bright", sweeping(302, 40), { standardMagnitude: -1.3 }),
        placed("off-by-15", sweeping(315, 40)),
      ],
      OBSERVER,
      frames(),
      query,
      T0,
    );
    expect(result.candidates.map((c) => c.id)).toEqual(["near-bright", "near-unknown", "off-by-15"]);
    expect(result.candidates[0]!.estimatedMagnitude).not.toBeNull();
    expect(result.candidates[1]!.estimatedMagnitude).toBeNull();
  });

  it("folds a launch batch into one group entry", () => {
    const train = Array.from({ length: 6 }, (_, i) =>
      placed(`STARLINK-${i}`, sweeping(298 + i, 40), { launch: "2026-201", name: `STARLINK-${i}` }),
    );
    const result = identifySighting([...train, placed("loner", sweeping(305, 35), { launch: "2019-001" })], OBSERVER, frames(), query, T0);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ launch: "2026-201", count: 6 });
    expect(result.candidates.map((c) => c.id)).toEqual(["loner"]);
  });
});

describe("ordering helpers", () => {
  const candidate = (id: string, separationDeg: number, mag: number | null, rangeKm: number): SightingCandidate => ({
    id,
    name: id,
    launch: null,
    best: { tMs: 0, azimuthDeg: 0, elevationDeg: 45, rangeKm },
    separationDeg,
    fromAzimuthDeg: 0,
    toAzimuthDeg: 0,
    angularRateDegPerSec: 0.5,
    headingDeg: 0,
    estimatedMagnitude: mag,
    track: [],
  });

  it("doesn't let a 1° difference outrank brightness", () => {
    const sorted = [candidate("dim-closer", 1, null, 500), candidate("bright", 2, -2, 900)].sort(compareCandidates);
    expect(sorted.map((c) => c.id)).toEqual(["bright", "dim-closer"]);
  });

  it("leaves small batches as individual matches", () => {
    const three = ["a", "b", "c"].map((id) => ({ ...candidate(id, 1, null, 500), launch: "2026-001" }));
    expect(foldLaunchGroups(three)).toEqual({ singles: three, groups: [] });
  });

  it("doesn't call launch-mates spread across the sky a train", () => {
    // Five from one old launch, all near the reported direction but 15° apart in height: ordinary, not a train.
    const spread = [15, 30, 45, 60, 75].map((el, i) => ({
      ...candidate(`old-${i}`, 1, null, 500),
      launch: "2021-038",
      best: { tMs: 0, azimuthDeg: 300, elevationDeg: el, rangeKm: 500 },
      track: [{ tMs: 0, azimuthDeg: 300, elevationDeg: el, seeable: true }],
    }));
    const { singles, groups } = foldLaunchGroups(spread);
    expect(groups).toEqual([]);
    expect(singles).toHaveLength(5);
  });
});

/**
 * The independent check: the pass finder (finder.ts + visibility.ts, the
 * code behind every pass on the site) and the sighting search are separate
 * code paths. Wherever the pass finder says Vanguard 1 is visible, asking
 * "what was that, over there, then?" must name Vanguard 1.
 */
describe("agreement with the pass predictor", () => {
  const lines = readFileSync("tests/fixtures/SGP4-VER.TLE", "utf8").replace(/\r/g, "").split("\n");
  const line1 = (lines.find((l) => l.startsWith("1 00005")) ?? "").slice(0, 69);
  const line2 = (lines.find((l) => l.startsWith("2 00005")) ?? "").slice(0, 69);
  const compiled = compileElementSet(parseTle(line1, line2));
  const satrec = compileTleLines(line1, line2)!;
  const epochMs = epochMillis(satrec);
  const vanguard: SightingBody = {
    id: "00005",
    name: "VANGUARD 1",
    launch: launchOf(line1),
    standardMagnitude: null,
    state: (tMs, out, offset) => temeStateInto(satrec, (tMs - epochMs) / 60_000, out, offset),
  };
  const windowStart = new Date("2000-06-27T18:50:19.733Z");
  const windowEnd = new Date(windowStart.getTime() + 24 * 3_600_000);
  const observers: ObserverLocation[] = [
    { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 },
    { latitudeDeg: 40, longitudeDeg: 30, heightKm: 0 },
    { latitudeDeg: -30, longitudeDeg: 150, heightKm: 0 },
    { latitudeDeg: 35, longitudeDeg: 100, heightKm: 0 },
    { latitudeDeg: -20, longitudeDeg: -60, heightKm: 0 },
  ];
  const visibleMoments = observers.flatMap((observer) =>
    (findPasses({ compiled: [compiled], observer, windowStart, windowEnd, minElevationDeg: 10 })[0]?.passes ?? []).flatMap((pass) => {
      const v = enrichPassVisibility({ satrec, pass, observer, windowStart, windowEnd, standardMagnitude: null });
      const w = v.visibleWindow;
      if (!v.fromGround || !w) return [];
      // The middle of the visible stretch, and where it was then.
      const mid = v.skyTrack.find((m) => m.timeMs >= (w.start.timeMs + w.end.timeMs) / 2) ?? w.start;
      return [{ observer, moment: mid }];
    }),
  );

  it("has visible passes to check (the fixture isn't vacuous)", () => {
    expect(visibleMoments.length).toBeGreaterThanOrEqual(3);
  });

  it("names Vanguard 1 at every moment the pass predictor calls it visible", () => {
    for (const { observer, moment } of visibleMoments) {
      if (moment.elevationDeg < 12) continue; // the 10° floor is shared; stay clear of the edge
      const result = identifySighting(
        [vanguard],
        observer,
        sightingFrames(observer, moment.timeMs, 1),
        { azimuthDeg: moment.azimuthDeg, height: null, maxSeparationDeg: 25 },
        moment.timeMs,
      );
      expect(result.candidates.map((c) => c.id), `observer ${observer.latitudeDeg},${observer.longitudeDeg}`).toEqual(["00005"]);
      expect(result.candidates[0]!.separationDeg).toBeLessThan(1);
    }
  });
});
