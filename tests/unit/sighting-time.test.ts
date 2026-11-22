import { describe, expect, it } from "vitest";
import snapshot from "../../data/sky-catalog.snapshot.json";
import { elementsUsableAt, MAX_ELEMENT_AGE_DAYS, MAX_SIGHTING_AGE_DAYS, sightingTimeProblem } from "@/domain/sighting/identify";
import { compileTleLines, epochMillis } from "@/integrations/sgp4/bulk";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-21T22:00:00Z");

describe("sightingTimeProblem", () => {
  it.each([
    ["just now", NOW],
    ["a minute of clock skew ahead", NOW + 59_000],
    ["last night", NOW - 20 * 3_600_000],
    [`exactly ${MAX_SIGHTING_AGE_DAYS} days ago`, NOW - MAX_SIGHTING_AGE_DAYS * DAY],
  ])("searches %s", (_label, reportMs) => {
    expect(sightingTimeProblem(reportMs, NOW)).toBeNull();
  });

  it("refuses the future", () => {
    expect(sightingTimeProblem(NOW + 2 * 60_000, NOW)).toMatch(/^That time is in the future/);
  });

  it("refuses more than a week back, and says why", () => {
    expect(sightingTimeProblem(NOW - MAX_SIGHTING_AGE_DAYS * DAY - 60_000, NOW)).toMatch(/^That's more than 7 days ago\./);
    // The QA report's case: a 1960 sighting used to search for ~26 minutes.
    expect(sightingTimeProblem(Date.parse("1960-01-01T02:00:00Z"), NOW)).toMatch(/^That's more than 7 days ago\./);
  });

  it("asks for a time when there isn't one", () => {
    expect(sightingTimeProblem(Number.NaN, NOW)).toBe("Pick a date and time.");
  });
});

describe("elementsUsableAt", () => {
  it(`uses elements up to ${MAX_ELEMENT_AGE_DAYS} days from the report, either side`, () => {
    expect(elementsUsableAt(NOW, NOW + MAX_ELEMENT_AGE_DAYS * DAY)).toBe(true);
    expect(elementsUsableAt(NOW, NOW - MAX_ELEMENT_AGE_DAYS * DAY)).toBe(true);
    expect(elementsUsableAt(NOW, NOW + MAX_ELEMENT_AGE_DAYS * DAY + 1)).toBe(false);
    expect(elementsUsableAt(NOW, NOW - MAX_ELEMENT_AGE_DAYS * DAY - 1)).toBe(false);
  });

  it("would skip the whole shipped catalog for a 1960 report, so no search can run that long", () => {
    const rows = (snapshot as { entries: { l1: string; l2: string }[] }).entries;
    const report = Date.parse("1960-01-01T02:00:00Z");
    const usable = rows.filter((row) => {
      const satrec = compileTleLines(row.l1, row.l2);
      return satrec !== null && elementsUsableAt(epochMillis(satrec), report);
    });
    expect(rows.length).toBeGreaterThan(5_000);
    expect(usable).toEqual([]);
  });
});
