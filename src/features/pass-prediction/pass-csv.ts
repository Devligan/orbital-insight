/**
 * Pass predictions as a CSV file (RFC 4180), built from exactly what the
 * server returned.
 *
 * Object names come from the provider's catalog, not from this app, so every
 * text cell is treated as untrusted. Spreadsheets run a cell that starts with
 * = + - @ (or a tab or carriage return) as a formula, so such a cell is written
 * with a leading apostrophe, which they read as "this is text". A plain number
 * is left alone: estimated magnitudes are negative (-3.40) and must stay numbers.
 */

import type { PassCardData } from "./sky-words";

export interface CsvSatellite {
  satelliteNumber: string;
  name: string;
  passes: PassCardData[];
  failure?: { reason: string };
}

const HEADER = [
  "satellite_number",
  "name",
  "rise_utc",
  "rise_azimuth_deg",
  "max_utc",
  "max_elevation_deg",
  "max_azimuth_deg",
  "set_utc",
  "set_azimuth_deg",
  "truncated",
  "visible",
  "estimated_magnitude",
];

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** One cell: defused if a spreadsheet would run it, quoted if it needs to be. */
export function csvCell(value: string): string {
  const text = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const fixed = (value: number | null | undefined) => (value === null || value === undefined ? "" : value.toFixed(2));

export function passesCsv(satellites: CsvSatellite[]): string {
  const rows: string[][] = [HEADER];
  for (const sat of satellites) {
    const name = sat.name || `NORAD ${sat.satelliteNumber}`;
    if (sat.failure) {
      rows.push([sat.satelliteNumber, name, "", "", "", "", "", "", "", `error: ${sat.failure.reason}`, "", ""]);
      continue;
    }
    for (const pass of sat.passes) {
      const seen = pass.visibility;
      rows.push([
        sat.satelliteNumber,
        name,
        pass.riseTime ?? "",
        fixed(pass.azimuthAtRiseDeg),
        pass.maxTime,
        fixed(pass.maxElevationDeg),
        fixed(pass.azimuthAtMaxDeg),
        pass.setTime ?? "",
        fixed(pass.azimuthAtSetDeg),
        pass.truncated,
        seen ? (seen.fromGround ? "yes" : "no" + (seen.reasonIfNotVisible ? `: ${seen.reasonIfNotVisible}` : "")) : "",
        fixed(seen?.bestEstimatedMagnitude),
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
