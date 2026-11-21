import { describe, expect, it } from "vitest";
import {
  checkPassForm,
  MAX_PASS_SATELLITES,
  parseDecimal,
  rangeMessage,
  splitCatalogIds,
  type PassFormValues,
} from "@/contracts/pass-request";

const VALID: PassFormValues = {
  satellites: "25544",
  latitude: "51.5072",
  longitude: "-0.1276",
  altitudeMeters: "11",
  windowHours: "24",
  minElevationDeg: "10",
};

describe("parseDecimal", () => {
  it.each([
    ["51.5", 51.5],
    ["-0.1276", -0.1276],
    ["+12", 12],
    [" 7 ", 7],
    [".5", 0.5],
    ["10.", 10],
    ["−45", -45], // a typographic minus, as copied from "±90°"-style labels
  ])("reads %j as %d", (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  // Number() says 0 for "" and 16 for "0x10"; a person typing coordinates means neither.
  it.each(["", "   ", "abc", "0x10", "1e3", "Infinity", "NaN", "1,5", "--1", "1.2.3", "<script>"])("refuses %j", (text) => {
    expect(parseDecimal(text)).toBeNull();
  });
});

describe("splitCatalogIds", () => {
  it("splits on spaces and commas, drops empties and duplicates, keeps order", () => {
    expect(splitCatalogIds(" 25544, 20580  25544,,48274 ")).toEqual(["25544", "20580", "48274"]);
  });
});

describe("checkPassForm", () => {
  it("turns a valid form into the request the route expects", () => {
    expect(checkPassForm(VALID)).toEqual({
      ok: true,
      request: {
        satelliteNumbers: ["25544"],
        observer: { latitudeDeg: 51.5072, longitudeDeg: -0.1276, altitudeMeters: 11 },
        windowHours: 24,
        minElevationDeg: 10,
      },
    });
  });

  it("accepts every limit exactly", () => {
    const edges = checkPassForm({ ...VALID, latitude: "-90", longitude: "180", altitudeMeters: "10000", windowHours: "720", minElevationDeg: "85" });
    expect(edges.ok).toBe(true);
  });

  it("an empty latitude is an error, not the equator", () => {
    const result = checkPassForm({ ...VALID, latitude: "" });
    expect(result).toEqual({ ok: false, errors: { latitudeDeg: "Latitude is required." } });
  });

  it("names every bad field at once, each with its own range", () => {
    const result = checkPassForm({
      satellites: "25544",
      latitude: "9999",
      longitude: "-999999",
      altitudeMeters: "-100000000",
      windowHours: "9999999",
      minElevationDeg: "200",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      latitudeDeg: "Latitude must be between -90° and 90°.",
      longitudeDeg: "Longitude must be between -180° and 180°.",
      altitudeMeters: "Altitude must be between -1,000 m and 10,000 m.",
      windowHours: "Prediction window must be between 1 h and 720 h.",
      minElevationDeg: "Minimum elevation must be between 0° and 85°.",
    });
  });

  it("says a non-number is not a number", () => {
    const result = checkPassForm({ ...VALID, minElevationDeg: "0x10" });
    expect(!result.ok && result.errors.minElevationDeg).toBe("Minimum elevation must be a number.");
  });

  it("names a catalog token it can't use instead of silently dropping it", () => {
    const result = checkPassForm({ ...VALID, satellites: "25544 abc NaN" });
    expect(!result.ok && result.errors.satellites).toBe('"abc" isn\'t a catalog ID (1 to 5 digits).');
  });

  it("shortens a long bad token in the message", () => {
    const result = checkPassForm({ ...VALID, satellites: "<script>alert(1)</script>" });
    expect(!result.ok && result.errors.satellites).toBe('"<script>aler…" isn\'t a catalog ID (1 to 5 digits).');
  });

  it("requires at least one ID and at most the budgeted count", () => {
    const none = checkPassForm({ ...VALID, satellites: " , " });
    expect(!none.ok && none.errors.satellites).toBe("Enter at least one catalog ID.");
    const many = Array.from({ length: MAX_PASS_SATELLITES + 1 }, (_, i) => String(10000 + i)).join(" ");
    const tooMany = checkPassForm({ ...VALID, satellites: many });
    expect(!tooMany.ok && tooMany.errors.satellites).toBe(`Enter at most ${MAX_PASS_SATELLITES} catalog IDs.`);
  });

  it("counts duplicates once against the limit", () => {
    const repeated = Array.from({ length: MAX_PASS_SATELLITES + 5 }, () => "25544").join(" ");
    expect(checkPassForm({ ...VALID, satellites: repeated }).ok).toBe(true);
  });
});

describe("rangeMessage", () => {
  it("is the sentence both the form and the server use", () => {
    expect(rangeMessage("latitudeDeg")).toBe("Latitude must be between -90° and 90°.");
  });
});
