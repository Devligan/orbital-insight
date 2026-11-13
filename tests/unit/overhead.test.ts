/**
 * Overhead computation - behavioral unit tests.
 *
 * `computeOverheadFor` is a pure function over (observer, candidates, time):
 * real element sets from the test helpers, no provider, no snapshot state.
 * Assertions check behavior, not absolute numbers (positions themselves are
 * SGP4-validated in their own suite).
 */

import { describe, expect, it } from "vitest";
import { computeOverheadFor, selectCandidates, type OverheadCandidate } from "@/server/overhead";
import { parseTle } from "@/domain/orbit/tle";
import { vanguardTle, withCatalogNumber } from "../helpers/tles";

const { line1, line2 } = vanguardTle();

function candidate(number: string, name: string): OverheadCandidate {
  const pair = withCatalogNumber(vanguardTle(), number);
  return { satelliteNumber: number, name, elementSet: parseTle(pair.line1, pair.line2, name), lineage: "live" };
}

const OBSERVER = { latitudeDeg: 28.5, longitudeDeg: -80.6, heightKm: 0 };
const AS_OF = new Date("2026-10-15T09:00:00.000Z");

describe("selectCandidates", () => {
  it("prioritizes stations, adds only the HST from science, and is bounded", () => {
    const entries = [
      ...Array.from({ length: 12 }, (_, i) => ({ satelliteNumber: `1000${i}`, name: `STATION ${i}`, group: "stations", elementSet: null as never })),
      ...Array.from({ length: 12 }, (_, i) => ({ satelliteNumber: `2000${i}`, name: `OTHER SCI ${i}`, group: "science", elementSet: null as never })),
      { satelliteNumber: "20580", name: "HST", group: "science", elementSet: null as never },
    ];
    const chosen = selectCandidates(entries as never);
    expect(chosen.length).toBeLessThanOrEqual(16);
    expect(chosen.filter((c) => c.group === "stations")).toHaveLength(12);
    expect(chosen.filter((c) => c.name === "HST")).toHaveLength(1);
    expect(chosen.some((c) => c.name.startsWith("OTHER SCI"))).toBe(false);
  });
});

describe("computeOverheadFor", () => {
  it("computes entries for real element sets and skips broken candidates honestly", () => {
    const candidates: OverheadCandidate[] = [candidate("00005", "VANGUARD 1"), candidate("00006", "SECOND")];
    const broken = { satelliteNumber: "00099", name: "BROKEN", elementSet: {} as never, lineage: "live" as const };
    const { visible, skipped } = computeOverheadFor(OBSERVER, [...candidates, broken], AS_OF, -90);
    expect(visible).toHaveLength(2);
    expect(skipped).toBe(1);
    for (const entry of visible) {
      expect(entry.elevationDeg).toBeGreaterThanOrEqual(-90);
      expect(entry.elevationDeg).toBeLessThanOrEqual(90);
      expect(entry.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(entry.azimuthDeg).toBeLessThan(360);
      expect(entry.altitudeKm).toBeGreaterThan(0);
      expect(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]).toContain(entry.direction);
      expect(entry.name).toBeTruthy();
    }
    // Sorted by elevation, highest first.
    expect(visible[0]?.elevationDeg).toBeGreaterThanOrEqual(visible[1]?.elevationDeg ?? Infinity);
  });

  it("filters out everything below the requested elevation threshold", () => {
    const candidates = [candidate("00005", "VANGUARD 1")];
    const { visible } = computeOverheadFor(OBSERVER, candidates, AS_OF, -90);
    expect(visible.length).toBeGreaterThan(0);
    const top = visible[0]?.elevationDeg ?? -999;
    const afterFilter = computeOverheadFor(OBSERVER, candidates, AS_OF, top + 0.5);
    expect(afterFilter.visible).toHaveLength(0);
  });

  it("returns nothing when no candidates exist", () => {
    const result = computeOverheadFor(OBSERVER, [], AS_OF);
    expect(result.visible).toEqual([]);
    expect(result.skipped).toBe(0);
  });
});
