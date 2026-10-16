/**
 * Observer time zone lookup: real cities resolve to their IANA zones, open
 * ocean to nautical zones, invalid input to null (never a guess).
 */

import { describe, expect, it } from "vitest";
import { timeZoneAt } from "@/integrations/timezone/lookup";

describe("timeZoneAt", () => {
  it.each([
    [40.7128, -74.006, "America/New_York"],
    [35.6762, 139.6503, "Asia/Tokyo"],
    [51.5072, -0.1276, "Europe/London"],
    [-33.8688, 151.2093, "Australia/Sydney"],
    [28.5721, -80.648, "America/New_York"], // Kennedy Space Center
    [45.92, 63.342, "Asia/Qyzylorda"], // Baikonur — Kyzylorda Region, Kazakhstan
  ])("(%f, %f) → %s", (lat, lon, zone) => {
    expect(timeZoneAt(lat, lon)).toBe(zone);
  });

  it("puts the open South Pacific in its nautical zone", () => {
    // 130°W is within 127.5°–142.5°W → UTC−9, which IANA spells Etc/GMT+9.
    expect(timeZoneAt(-40, -130)).toBe("Etc/GMT+9");
  });

  it("returns null for impossible coordinates instead of guessing", () => {
    expect(timeZoneAt(95, 0)).toBeNull();
  });
});
