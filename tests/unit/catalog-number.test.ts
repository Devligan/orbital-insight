import { describe, expect, it } from "vitest";
import { canonicalCatalogNumber, catalogQueryValue } from "@/contracts/catalog-number";

describe("canonicalCatalogNumber", () => {
  it.each([
    ["25544", "25544"],
    ["00025544", "25544"], // zero-padded, as copied from elsewhere
    ["5", "00005"], // Vanguard 1, typed the natural way
    ["00005", "00005"], // the TLE's own spelling
    ["900", "00900"],
    [" 48274 ", "48274"],
    ["99999", "99999"],
  ])("spells %j as %j", (text, canonical) => {
    expect(canonicalCatalogNumber(text)).toBe(canonical);
  });

  it.each(["", "0", "00000", "100000", "999999999", "-5", "+5", "5.0", "1e3", "A0001", "25544x", "9".repeat(400)])(
    "refuses %j",
    (text) => {
      expect(canonicalCatalogNumber(text)).toBeNull();
    },
  );
});

describe("catalogQueryValue", () => {
  it("drops the padding for CelesTrak's CATNR query", () => {
    expect(catalogQueryValue("00005")).toBe("5");
    expect(catalogQueryValue("25544")).toBe("25544");
  });
});
