import { describe, expect, it } from "vitest";
import { parseTle } from "@/domain/orbit/tle";
import { AppError } from "@/lib/errors";
import { vanguardTle, withCatalogNumber, checksumDigit } from "../helpers/tles";

describe("TLE parsing", () => {
  it("parses a valid verification TLE with correct epoch and fields", () => {
    const { line1, line2 } = vanguardTle();
    const tle = parseTle(line1, line2);
    expect(tle.satelliteNumber).toBe("00005");
    expect(tle.classification).toBe("U");
    expect(tle.format).toBe("tle");
    // Epoch 00179.78495062 → day 179.78495 of 2000 → June 27, 2000 18:50:19.733… UTC
    // (JS Date precision is milliseconds; sub-ms digits of the TLE are truncated.)
    expect(tle.epoch.toISOString()).toBe("2000-06-27T18:50:19.733Z");
  });

  it("rejects malformed line counts", () => {
    const { line1, line2 } = vanguardTle();
    expect(() => parseTle(line1.slice(0, 40), line2)).toThrow(AppError);
  });

  it("rejects bad checksums", () => {
    const { line1, line2 } = vanguardTle();
    const wrongDigit = line1[68] === "5" ? "6" : "5";
    const bad = line1.slice(0, 68) + wrongDigit;
    expect(() => parseTle(bad, line2)).toThrow(/checksum/i);
  });

  it("rejects mismatched satellite numbers across lines", () => {
    const { line1 } = vanguardTle();
    // Recompute line2's checksum so only the cross-line consistency fails.
    const mismatched = recChecksum("2 00006" + vanguardTle().line2.slice(7));
    expect(() => parseTle(line1, mismatched)).toThrow(/disagree/i);
  });

  it("rejects wrong leading line numbers", () => {
    const { line1, line2 } = vanguardTle();
    expect(() => parseTle(recChecksum("2 " + line1.slice(2)), line2)).toThrow(AppError);
  });

  it("parses a checksum-correct re-numbered TLE pair", () => {
    const renumbered = withCatalogNumber(vanguardTle(), "25544");
    const tle = parseTle(renumbered.line1, renumbered.line2);
    expect(tle.satelliteNumber).toBe("25544");
    expect(tle.epoch.toISOString()).toBe("2000-06-27T18:50:19.733Z");
  });

  it("checksumDigit matches the published rule on a known line", () => {
    const { line2 } = vanguardTle();
    expect(Number(line2[68])).toBe(Number(checksumDigit(line2.slice(0, 68))));
  });
});

function recChecksum(line: string): string {
  const body = line.slice(0, -1).padEnd(68);
  return body + checksumDigit(body);
}
