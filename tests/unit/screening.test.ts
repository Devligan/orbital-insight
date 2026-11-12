import { describe, expect, it } from "vitest";
import {
  CO_ORBITING_SPEED_KMS,
  radialRangesOverlap,
  ricComponents,
  screen,
  separationProfile,
  type ScreeningBody,
} from "@/domain/conjunction/screening";

const MU = 398_600.4418; // km³/s²
const T0 = Date.UTC(2026, 10, 12, 0, 0, 0);
/** The designed encounter instant: 3 h 17 min 23.456 s into the window. */
const T_CROSS = T0 + (3 * 3600 + 17 * 60 + 23.456) * 1000;

/**
 * Exact two-body circular orbit. The node line is the inertial x-axis, and
 * the argument of latitude is 0 (on the +x axis) at `nodeTimeMs`.
 */
function circular(id: string, radiusKm: number, inclinationDeg: number, nodeTimeMs: number, leadKm = 0): ScreeningBody {
  const n = Math.sqrt(MU / radiusKm ** 3); // rad/s
  const inc = (inclinationDeg * Math.PI) / 180;
  const lead = leadKm / radiusKm; // along-track lead, as an angle
  return {
    id,
    name: id.toUpperCase(),
    perigeeRadiusKm: radiusKm,
    apogeeRadiusKm: radiusKm,
    state(tMs, out, offset) {
      const u = n * ((tMs - nodeTimeMs) / 1000) + lead;
      const px = radiusKm * Math.cos(u);
      const py = radiusKm * Math.sin(u);
      const vx = -n * radiusKm * Math.sin(u);
      const vy = n * radiusKm * Math.cos(u);
      // Rotate the orbital plane about the node line (x) by the inclination.
      out[offset] = px;
      out[offset + 1] = py * Math.cos(inc);
      out[offset + 2] = py * Math.sin(inc);
      out[offset + 3] = vx;
      out[offset + 4] = vy * Math.cos(inc);
      out[offset + 5] = vy * Math.sin(inc);
      return true;
    },
  };
}

const target = circular("target", 6_778, 0, T_CROSS);
const window6h = { startMs: T0, durationMinutes: 6 * 60 };

describe("screen — analytic encounters with known answers", () => {
  it("finds a designed crossing: TCA to the millisecond, miss distance and its RIC split", () => {
    // Polar orbit 2 km higher, through the same node at the same instant.
    const crosser = circular("crosser", 6_780, 90, T_CROSS);
    const result = screen(target, [target, crosser], { ...window6h, thresholdKm: 5 });

    expect(result.approaches).toHaveLength(1);
    const [approach] = result.approaches;
    expect(Math.abs(approach!.tcaMs - T_CROSS)).toBeLessThan(5);
    expect(approach!.missKm).toBeCloseTo(2, 3);
    expect(approach!.radialKm).toBeCloseTo(2, 3);
    expect(Math.abs(approach!.inTrackKm)).toBeLessThan(0.01);
    expect(Math.abs(approach!.crossTrackKm)).toBeLessThan(0.01);
    // Perpendicular velocities of ~7.67 km/s each → √2 × 7.67.
    expect(approach!.relativeSpeedKmS).toBeCloseTo(Math.SQRT2 * Math.sqrt(MU / 6_778), 1);
    // The target is never screened against itself.
    expect(result.stats.afterRadiusFilter).toBe(1);
  });

  it("reports every pass under the threshold, closest first", () => {
    // Periods differ by ~2.5 s, so later node passes miss by growing amounts
    // (~6.6 km half an orbit later, ~13 km a full orbit later).
    const crosser = circular("crosser", 6_780, 90, T_CROSS);
    const result = screen(target, [crosser], { ...window6h, thresholdKm: 15 });
    expect(result.approaches.length).toBeGreaterThanOrEqual(3);
    expect(result.approaches[0]!.missKm).toBeCloseTo(2, 3);
    for (let i = 1; i < result.approaches.length; i++) {
      expect(result.approaches[i]!.missKm).toBeGreaterThanOrEqual(result.approaches[i - 1]!.missKm);
    }
  });

  it("refines but does not report an approach just outside the threshold", () => {
    const crosser = circular("crosser", 6_780, 90, T_CROSS);
    const result = screen(target, [crosser], { ...window6h, thresholdKm: 1.5 });
    expect(result.approaches).toEqual([]);
    expect(result.stats.minimaRefined).toBeGreaterThan(0);
  });

  it("is independent of where the samples fall: a 2 s offset to the grid finds the same TCA", () => {
    const crosser = circular("crosser", 6_780, 90, T_CROSS);
    const shifted = screen(target, [crosser], { startMs: T0 + 2_000, durationMinutes: 6 * 60, thresholdKm: 5 });
    expect(Math.abs(shifted.approaches[0]!.tcaMs - T_CROSS)).toBeLessThan(5);
  });

  it("separates co-orbiting objects (docked / formation) from encounters", () => {
    // Same plane, 50 m higher, 0.5 km ahead: the target slowly overtakes it.
    const neighbour = circular("neighbour", 6_778.05, 0, T_CROSS, 0.5);
    const result = screen(target, [neighbour], { ...window6h, thresholdKm: 5 });
    expect(result.approaches).toEqual([]);
    expect(result.coOrbiting).toHaveLength(1);
    expect(result.coOrbiting[0]!.closestKm).toBeLessThan(0.06);
    expect(CO_ORBITING_SPEED_KMS).toBeLessThan(0.1);
  });

  it("drops objects whose altitude range can never meet the target's", () => {
    const geo = circular("geo", 42_164, 0, T_CROSS);
    const result = screen(target, [geo], { ...window6h, thresholdKm: 50 });
    expect(result.stats.afterRadiusFilter).toBe(0);
    expect(result.stats.propagations).toBe(6 * 60 + 1); // only the target's own grid
  });

  it("skips objects whose propagator fails, and counts them", () => {
    const broken: ScreeningBody = { ...circular("broken", 6_780, 90, T_CROSS), state: () => false };
    const result = screen(target, [broken], { ...window6h, thresholdKm: 5 });
    expect(result.approaches).toEqual([]);
    expect(result.stats.propagationFailures).toBe(1);
  });

  it("reports progress through the candidate list", () => {
    const many = Array.from({ length: 60 }, (_, i) => circular(`c${i}`, 6_780 + i * 0.1, 45, T_CROSS + i * 60_000));
    const calls: [number, number][] = [];
    screen(target, many, { ...window6h, durationMinutes: 30, thresholdKm: 1, onProgress: (d, t) => calls.push([d, t]) });
    expect(calls).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ]);
  });

  it("time skipping finds exactly the approaches the brute-force sweep finds, with far less work", () => {
    // A seeded swarm of crossing orbits around the target's altitude.
    let seed = 42;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const swarm = Array.from({ length: 150 }, (_, i) =>
      circular(`s${i}`, 6_778 + (random() - 0.5) * 40, random() * 180, T0 + random() * 24 * 3_600_000),
    );
    const options = { startMs: T0, durationMinutes: 24 * 60, thresholdKm: 40 };
    const brute = screen(target, swarm, { ...options, timeSkipping: false });
    const skipping = screen(target, swarm, options);

    expect(brute.approaches.length).toBeGreaterThan(5); // the comparison means something
    expect(skipping.approaches.map((a) => `${a.id}@${Math.round(a.tcaMs)}`)).toEqual(
      brute.approaches.map((a) => `${a.id}@${Math.round(a.tcaMs)}`),
    );
    skipping.approaches.forEach((a, i) => expect(a.missKm).toBeCloseTo(brute.approaches[i]!.missKm, 6));
    expect(skipping.stats.propagations).toBeLessThan(brute.stats.propagations / 3);
  });

  it("rejects degenerate windows", () => {
    expect(() => screen(target, [], { startMs: T0, durationMinutes: 1, thresholdKm: 5 })).toThrow(RangeError);
    expect(() => screen(target, [], { startMs: T0, durationMinutes: 60, thresholdKm: 0 })).toThrow(RangeError);
  });
});

describe("separationProfile", () => {
  it("is smallest at the TCA and symmetric around a straight-through crossing", () => {
    const crosser = circular("crosser", 6_780, 90, T_CROSS);
    const profile = separationProfile(target, crosser, T_CROSS, 60_000, 10_000);
    expect(profile).toHaveLength(13);
    const middle = profile[6]!;
    expect(middle.tMs).toBe(T_CROSS);
    expect(middle.km).toBeCloseTo(2, 3);
    expect(Math.min(...profile.map((p) => p.km))).toBe(middle.km);
    expect(profile[0]!.km).toBeCloseTo(profile[12]!.km, 0);
  });
});

describe("radialRangesOverlap", () => {
  const leo = { perigeeRadiusKm: 6_778, apogeeRadiusKm: 6_798 } as ScreeningBody;
  it("keeps overlapping and near-overlapping ranges, drops distant ones", () => {
    expect(radialRangesOverlap(leo, { perigeeRadiusKm: 6_790, apogeeRadiusKm: 6_800 } as ScreeningBody, 10)).toBe(true);
    // 35 km above the apogee: inside threshold (10) + pad (30).
    expect(radialRangesOverlap(leo, { perigeeRadiusKm: 6_833, apogeeRadiusKm: 6_900 } as ScreeningBody, 10)).toBe(true);
    expect(radialRangesOverlap(leo, { perigeeRadiusKm: 6_900, apogeeRadiusKm: 6_950 } as ScreeningBody, 10)).toBe(false);
    // A highly elliptical orbit sweeping through LEO overlaps.
    expect(radialRangesOverlap(leo, { perigeeRadiusKm: 6_600, apogeeRadiusKm: 42_000 } as ScreeningBody, 10)).toBe(true);
  });
});

describe("ricComponents", () => {
  it("resolves a miss vector into radial, in-track and cross-track", () => {
    const t = Float64Array.from([7_000, 0, 0, 0, 7.5, 0]);
    const o = Float64Array.from([7_001, 2, 3, 0, 0, 0]);
    const ric = ricComponents(t, o);
    expect(ric.radial).toBeCloseTo(1, 9);
    expect(ric.inTrack).toBeCloseTo(2, 9);
    expect(ric.crossTrack).toBeCloseTo(3, 9);
  });
});
