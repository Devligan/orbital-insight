import { readFileSync } from "node:fs";

/**
 * TLE fixture utilities.
 *
 * Source: the official SGP4 verification fixture (Vallado's SGP4-VER.TLE),
 * which contains real published TLEs. These helpers derive correctly
 * checksummed variants of them (e.g. re-numbered catalogs) per the published
 * modulo-10 checksum rule, so tests never construct spec-violating fixtures
 * by hand.
 */

const FIXTURE_PATH = "tests/fixtures/SGP4-VER.TLE";

export interface TlePair {
  line1: string; // 69 columns
  line2: string; // 69 columns (schedule columns stripped)
}

export function vanguardTle(): TlePair {
  const text = readFileSync(FIXTURE_PATH, "utf8").replace(/\r/g, "");
  const line1Raw = text.split("\n").find((l) => l.startsWith("1 00005"));
  const line2Raw = text.split("\n").find((l) => l.startsWith("2 00005"));
  if (!line1Raw || !line2Raw) throw new Error("Vanguard verification TLE missing from fixture");
  return { line1: normalize(line1Raw), line2: line2Raw.slice(0, 69) };
}

function normalize(raw: string): string {
  return raw.length >= 69 ? raw.slice(0, 69) : raw.replace(/\s+$/, "").slice(0, -1).padEnd(68) + raw.replace(/\s+$/, "").slice(-1);
}

/** Modulo-10 checksum over columns 1–68 ("-" counts 1). */
export function checksumDigit(body68: string): string {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = body68[i] ?? " ";
    if (ch >= "0" && ch <= "9") sum += Number(ch);
    else if (ch === "-") sum += 1;
  }
  return String(sum % 10);
}

function recChecksum(line: string): string {
  const body = line.slice(0, -1).padEnd(68);
  return body + checksumDigit(body);
}

/** Derive a pair carrying a different catalog number (checksum recomputed). */
export function withCatalogNumber(pair: TlePair, satNum: string): TlePair {
  const line1 = recChecksum("1 " + satNum.padStart(5, "0") + pair.line1.slice(7));
  const line2 = recChecksum("2 " + satNum.padStart(5, "0") + pair.line2.slice(7));
  return { line1, line2 };
}
