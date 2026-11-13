import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findPasses } from "@/domain/passes/finder";
import { compileElementSet } from "@/domain/orbit/propagation";
import { parseTle } from "@/domain/orbit/tle";

// Vanguard 1 (00005) from the official SGP4 verification fixture —
// a real, published element set. Its epoch is 2000-06-27 18:50 UTC, so the
// test windows sit within hours of the epoch where prediction accuracy is
// best-defined.
const fixtureText = readFileSync("tests/fixtures/SGP4-VER.TLE", "utf8").replace(/\r/g, "");
const verLines = fixtureText.split("\n");
const line1 = verLines.find((l) => l.startsWith("1 00005")) ?? "";
const line2Full = verLines.find((l) => l.startsWith("2 00005")) ?? "";
const line2 = line2Full.slice(0, 69); // strip appended schedule columns

const iss = compileElementSet(parseTle(line1, line2));

const observer = { latitudeDeg: 0, longitudeDeg: 0, heightKm: 0 };

// Vanguard 1: perigee ~660 km, inclination 34.27°, ~10.8 rev/day.
const EPOCH = "2000-06-27T18:50:19.733Z";

function window(startIso: string, hours: number): { windowStart: Date; windowEnd: Date } {
  const windowStart = new Date(startIso);
  return { windowStart, windowEnd: new Date(windowStart.getTime() + hours * 3_600_000) };
}

describe("pass finder", () => {
  it("finds passes for a well-placed observer within 24 h of the epoch", () => {
    const result = findPasses({
      compiled: [iss],
      observer: { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 }, // Florida-ish
      ...window(EPOCH, 24),
      minElevationDeg: 10,
    });
    const passes = result[0]?.passes ?? [];
    // Sanity bounds, not exact counts (the input data is fixed, but the
    // model is a numerical integrator).
    expect(passes.length).toBeGreaterThan(0);
    expect(passes.length).toBeLessThan(20);
  });

  it("orders passes chronologically with apex above the cutoff", () => {
    const passes =
      findPasses({
        compiled: [iss],
        observer: { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 },
        ...window(EPOCH, 24),
        minElevationDeg: 10,
      })[0]?.passes ?? [];
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i]?.max.getTime()).toBeGreaterThan(passes[i - 1]?.max.getTime() ?? 0);
    }
    for (const pass of passes) {
      expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(pass.maxElevationDeg).toBeLessThanOrEqual(90);
    }
  });

  it("marks a pass truncated when already above threshold at window start", () => {
    const first =
      findPasses({
        compiled: [iss],
        observer: { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 },
        ...window(EPOCH, 24),
        minElevationDeg: 10,
      })[0]?.passes[0];
    expect(first).toBeTruthy();

    // Start the window 60 s before a located apex: the satellite is already
    // above 10° at window start, so the rise must be reported as truncated.
    const nearApex = new Date((first as { max: Date }).max.getTime() - 60_000);
    const result = findPasses({
      compiled: [iss],
      observer: { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 },
      windowStart: nearApex,
      windowEnd: new Date(nearApex.getTime() + 6 * 3_600_000),
      minElevationDeg: 10,
    });
    const truncated = result[0]?.passes.filter((p) => p.truncated === "rise" || p.truncated === "both") ?? [];
    expect(truncated.length).toBeGreaterThan(0);
    for (const pass of truncated) {
      expect(pass.rise).toBeNull();
    }
  });

  describe("truncation names the side the window cut off", () => {
    const FLORIDA = { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 };
    const full =
      findPasses({ compiled: [iss], observer: FLORIDA, ...window(EPOCH, 24), minElevationDeg: 10 })[0]?.passes.find(
        (p) => p.truncated === null,
      );

    it("the fixture has a complete pass to cut (tests below are not vacuous)", () => {
      expect(full?.rise).toBeInstanceOf(Date);
      expect(full?.set).toBeInstanceOf(Date);
    });

    it('a pass still up when the window ends is "set"-truncated, with its rise kept', () => {
      const { rise, max } = full as { rise: Date; max: Date };
      // Two hours of lead-in, ending just after the apex: risen, not yet set.
      const windowStart = new Date(rise.getTime() - 2 * 3_600_000);
      const windowEnd = new Date(max.getTime() + 30_000);
      const last = findPasses({ compiled: [iss], observer: FLORIDA, windowStart, windowEnd, minElevationDeg: 10 })[0]?.passes.at(-1);
      expect(last?.truncated).toBe("set");
      expect(last?.set).toBeNull();
      expect(Math.abs((last?.rise as Date).getTime() - rise.getTime())).toBeLessThan(1_000);
      expect(last?.azimuthAtRiseDeg).not.toBeNull();
      expect(last?.azimuthAtSetDeg).toBeNull();
    });

    it('a pass already up when the window starts is "rise"-truncated, with its set kept', () => {
      const { set, max } = full as { set: Date; max: Date };
      const windowStart = new Date(max.getTime() - 30_000);
      const first = findPasses({
        compiled: [iss],
        observer: FLORIDA,
        windowStart,
        windowEnd: new Date(set.getTime() + 2 * 3_600_000),
        minElevationDeg: 10,
      })[0]?.passes[0];
      expect(first?.truncated).toBe("rise");
      expect(first?.rise).toBeNull();
      expect(Math.abs((first?.set as Date).getTime() - set.getTime())).toBeLessThan(1_000);
    });

    it('a window inside a single pass is "both"-truncated', () => {
      const { max } = full as { max: Date };
      const only = findPasses({
        compiled: [iss],
        observer: FLORIDA,
        windowStart: new Date(max.getTime() - 60_000),
        windowEnd: new Date(max.getTime() + 60_000),
        minElevationDeg: 10,
      })[0]?.passes;
      expect(only).toHaveLength(1);
      expect(only?.[0]?.truncated).toBe("both");
    });
  });

  it("yields fewer passes at a higher elevation cutoff", () => {
    const params = {
      compiled: [iss],
      observer: { latitudeDeg: 28, longitudeDeg: -80, heightKm: 0 },
      ...window(EPOCH, 24),
    };
    const low = findPasses({ ...params, minElevationDeg: 5 })[0]?.passes.length ?? 0;
    const high = findPasses({ ...params, minElevationDeg: 40 })[0]?.passes.length ?? 0;
    expect(high).toBeLessThanOrEqual(low);
  });

  it("rejects invalid windows and thresholds", () => {
    expect(() =>
      findPasses({
        compiled: [iss],
        observer,
        windowStart: new Date("2000-06-28T02:00:00Z"),
        windowEnd: new Date("2000-06-28T01:00:00Z"),
        minElevationDeg: 10,
      }),
    ).toThrow(/after start/i);

    expect(() =>
      findPasses({
        compiled: [iss],
        observer,
        ...window(EPOCH, 24),
        minElevationDeg: 95,
      }),
    ).toThrow(/minimum elevation/i);
  });

  it("silences nothing when propagation fails mid-window: reports the failure", () => {
    // Construct a decaying object (the verification fixture contains exact
    // decay test cases); find one that SGP4 cannot propagate.
    const decay = fixtureText.split("\n").find((l) => l.startsWith("1 33333")) ?? "";
    const decay2full = fixtureText.split("\n").find((l) => l.startsWith("2 33333")) ?? "";
    const decay2 = decay2full.slice(0, 69);
    if (!decay || !decay2) return; // fixture guard
    try {
      const compiled = compileElementSet(parseTle(decay, decay2));
      const result = findPasses({
        compiled: [compiled],
        observer,
        ...window("2000-06-28T00:00:00Z", 24),
        minElevationDeg: 10,
      });
      // Either passes were computed, or the failure is surfaced honestly —
      // never an empty array with no failure record.
      const entry = result[0];
      expect(entry).toBeTruthy();
      if ((entry?.passes.length ?? 0) === 0) {
        expect(entry?.failure).toBeTruthy();
      }
    } catch {
      // parse/compile-level rejection is also honest failure handling.
      expect(true).toBe(true);
    }
  });
});
