import { describe, expect, it } from "vitest";
import { parseWatchlist } from "@/features/watchlist/local-store";

const raw = (value: unknown) => JSON.stringify(value);

describe("parseWatchlist", () => {
  it("keeps well-formed entries as they are", () => {
    const items = [{ satelliteNumber: "25544", name: "ISS (ZARYA)", addedAt: "2026-11-20T21:00:00.000Z" }];
    expect(parseWatchlist(raw(items))).toEqual(items);
  });

  it.each([null, "", "{not json", raw({ satelliteNumber: "25544" }), raw("25544"), raw(42)])("treats %j as empty", (value) => {
    expect(parseWatchlist(value)).toEqual([]);
  });

  // The number becomes a link and a /passes request; only a catalog number may.
  it("spells every catalog number one way, so 5 and 00005 are one entry", () => {
    const items = parseWatchlist(raw([
      { satelliteNumber: "5", name: "VANGUARD 1" },
      { satelliteNumber: "00005", name: "duplicate" },
      { satelliteNumber: " 25544", name: "ISS" },
    ]));
    expect(items.map((i) => i.satelliteNumber)).toEqual(["00005", "25544"]);
  });

  it.each(["../../api/passes", "25544?x=1", "javascript:alert(1)", "123456", "", "0", "-1"])(
    "drops an entry whose number is %j",
    (satelliteNumber) => {
      expect(parseWatchlist(raw([{ satelliteNumber, name: "x" }]))).toEqual([]);
    },
  );

  it("skips junk entries without losing the good ones around them", () => {
    const items = parseWatchlist(raw([null, "25544", 7, [], { satelliteNumber: 25544 }, { satelliteNumber: "20580", name: "HST" }]));
    expect(items.map((i) => i.satelliteNumber)).toEqual(["20580"]);
  });

  it("keeps the first of repeated numbers (they're React keys)", () => {
    const items = parseWatchlist(raw([
      { satelliteNumber: "25544", name: "first" },
      { satelliteNumber: "25544", name: "second" },
    ]));
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("first");
  });

  it("caps long names and names nameless entries by number", () => {
    const items = parseWatchlist(raw([
      { satelliteNumber: "25544", name: "A".repeat(10_000) },
      { satelliteNumber: "20580", name: "   " },
      { satelliteNumber: "48274", name: { toString: "x" } },
    ]));
    expect(items[0]?.name).toHaveLength(120);
    expect(items[1]?.name).toBe("NORAD 20580");
    expect(items[2]?.name).toBe("NORAD 48274");
  });

  it("keeps a markup-looking name as plain text (React escapes it when rendering)", () => {
    const name = "<img src=x onerror=alert(1)>";
    expect(parseWatchlist(raw([{ satelliteNumber: "25544", name }]))[0]?.name).toBe(name);
  });

  it("turns a time that doesn't parse into null, not an Invalid Date", () => {
    const items = parseWatchlist(raw([
      { satelliteNumber: "25544", name: "ISS", addedAt: "not a date" },
      { satelliteNumber: "20580", name: "HST", addedAt: 1_700_000_000_000 },
    ]));
    expect(items.map((i) => i.addedAt)).toEqual([null, null]);
  });

  it("reads at most 500 entries from a stuffed store", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({ satelliteNumber: String(i + 1), name: "x" }));
    expect(parseWatchlist(raw(many))).toHaveLength(500);
  });
});
