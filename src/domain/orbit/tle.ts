/**
 * TLE (two-line element set) parsing and validation.
 *
 * Implements the published TLE format rules from CelesTrak's GP data
 * documentation (https://celestrak.org/NORAD/documentation/gp-data-formats.php):
 * fixed columns, modulo-10 checksum over columns 1–68 of each line, and
 * cross-line consistency of the catalog number. Real-world lines are often
 * right-trimmed; normalization handles that (see normalizeTleLine).
 */

import { AppError } from "@/lib/errors";
import type { TwoLineElementSet } from "./types";

const LINE1_LENGTH = 69;
const LINE2_LENGTH = 69;

function checksum9(line: string): number {
  // Columns 1–68; '+' counts 0, non-digits count as their printed digit sum
  // per the published rule: sum of digits, with '-' counting as 1.
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line[i] ?? " ";
    if (ch >= "0" && ch <= "9") sum += Number(ch);
    else if (ch === "-") sum += 1;
  }
  return sum % 10;
}

/**
 * Normalize a possibly-trimmed TLE line to the fixed 69-column format:
 * trim whitespace, pad the element body to 68 columns, keep the checksum
 * digit as the last character.
 */
function normalizeTleLine(raw: string, lineNo: 1 | 2): string {
  const trimmed = raw.replace(/\s+$/, "");
  if (trimmed.length === LINE1_LENGTH) return trimmed;
  if (trimmed.length < 68) {
    // Not enough columns for a body - malformed (e.g. truncated fetch).
    throw new AppError("validation", `TLE line ${lineNo} is too short (${trimmed.length} chars, need ≥68)`);
  }
  if (trimmed.length > LINE1_LENGTH) {
    throw new AppError("validation", `TLE line ${lineNo} is too long (${trimmed.length} chars)`);
  }
  return trimmed.slice(0, -1).padEnd(68) + trimmed.slice(-1);
}

function parseEpoch(line1: string): Date {
  const year2 = Number(line1.slice(18, 20));
  const year = year2 < 57 ? 2000 + year2 : 1900 + year2; // sliding window per TLE spec
  const dayOfYear = Number(line1.slice(20, 32));
  // dayOfYear = day-of-year including fractional day (day 1 at 00:00 Jan 1)
  const msPerDay = 86_400_000;
  const jan1 = Date.UTC(year, 0, 1);
  return new Date(jan1 + (dayOfYear - 1) * msPerDay);
}

/**
 * Parse and validate a two-line element set.
 * Throws AppError("validation") on malformed input.
 *
 * Real-world TLE text is frequently right-trimmed by providers (the published
 * format fixes columns but sources often drop trailing spaces); normalization
 * re-inserts the trimmed spacing before the trailing checksum digit so the
 * fixed-column checks are meaningful.
 */
export function parseTle(line1Raw: string, line2Raw: string, name?: string): TwoLineElementSet {
  const line1 = normalizeTleLine(line1Raw, 1);
  const line2 = normalizeTleLine(line2Raw, 2);

  if (!line1Raw.trimStart().startsWith("1 ")) {
    throw new AppError("validation", "TLE line 1 must start with the line number 1", { details: { line: 1 } });
  }
  if (!line2Raw.trimStart().startsWith("2 ")) {
    throw new AppError("validation", "TLE line 2 must start with the line number 2", { details: { line: 2 } });
  }
  if (checksum9(line1) !== Number(line1[68])) {
    throw new AppError("validation", "TLE line 1 checksum mismatch");
  }
  if (checksum9(line2) !== Number(line2[68])) {
    throw new AppError("validation", "TLE line 2 checksum mismatch");
  }

  const satNum1 = line1.slice(2, 7).trim();
  const satNum2 = line2.slice(2, 7).trim();
  if (satNum1 !== satNum2) {
    throw new AppError("validation", "TLE lines disagree on satellite catalog number", {
      details: { line1: satNum1, line2: satNum2 },
    });
  }

  const classification = line1[7] as typeof line1[7] | undefined;
  if (classification !== "U" && classification !== "C" && classification !== "S" && classification !== "O") {
    throw new AppError("validation", `Unknown classification character: ${classification ?? "(empty)"}`);
  }

  const internationalDesignator = line1.slice(9, 17).trim() || null;

  let epoch: Date;
  try {
    epoch = parseEpoch(line1);
  } catch {
    throw new AppError("validation", "TLE epoch is malformed");
  }
  if (Number.isNaN(epoch.getTime())) {
    throw new AppError("validation", "TLE epoch is malformed");
  }

  return {
    format: "tle",
    satelliteNumber: satNum1,
    classification,
    internationalDesignator,
    epoch,
    line1,
    line2,
  };
}
