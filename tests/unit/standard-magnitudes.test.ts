/**
 * The published-standard-magnitude table is the project's only source of
 * per-object brightness claims: every entry must carry a source and a
 * caveat, and unknown objects must stay unknown.
 */

import { describe, expect, it } from "vitest";
import { STANDARD_MAGNITUDES, standardMagnitudeFor } from "@/domain/light/standard-magnitudes";

describe("standard magnitudes", () => {
  it("every entry names a source and a caveat", () => {
    for (const entry of Object.values(STANDARD_MAGNITUDES)) {
      expect(entry.source.length).toBeGreaterThan(20);
      expect(entry.caveat.length).toBeGreaterThan(20);
      expect(Number.isFinite(entry.value)).toBe(true);
    }
  });

  it("looks up catalog numbers with or without leading zeros", () => {
    expect(standardMagnitudeFor("25544")?.value).toBe(-1.3);
    expect(standardMagnitudeFor("025544")?.value).toBe(-1.3);
  });

  it("reports an unlisted object as unknown rather than guessing", () => {
    expect(standardMagnitudeFor("00005")).toBeNull();
    expect(standardMagnitudeFor("99999")).toBeNull();
  });
});
