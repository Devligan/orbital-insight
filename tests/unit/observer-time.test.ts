/**
 * Pass times read on the observer's wall clock, with a zone note only when
 * that clock differs from the viewer's device.
 */

import { describe, expect, it } from "vitest";
import { observerClock, observerZoneNote } from "@/features/pass-prediction/sky-words";

const ISO = "2026-10-17T09:06:00Z";

describe("observerClock", () => {
  it("renders the same instant on each observer's own clock", () => {
    expect(observerClock(ISO, "America/New_York")).toBe("Sat 5:06 AM");
    expect(observerClock(ISO, "Asia/Tokyo")).toBe("Sat 6:06 PM");
    expect(observerClock(ISO, "Asia/Tokyo", false)).toBe("6:06 PM");
  });
});

describe("observerZoneNote", () => {
  const at = new Date(ISO);

  it("stays silent when observer and device share a clock", () => {
    expect(observerZoneNote("America/New_York", "America/New_York", at)).toBeNull();
    // Different names, same offset at that instant: still no noise.
    expect(observerZoneNote("America/Detroit", "America/New_York", at)).toBeNull();
    expect(observerZoneNote(null, "America/New_York", at)).toBeNull();
  });

  it("names the observer's zone when it differs from the device", () => {
    expect(observerZoneNote("Asia/Tokyo", "America/New_York", at)).toBe("Times are Tokyo time (GMT+9).");
    expect(observerZoneNote("America/Los_Angeles", "America/New_York", at)).toBe("Times are Los Angeles time (GMT-7).");
    expect(observerZoneNote("Etc/GMT+9", "America/New_York", at)).toBe("Times are local to that spot (GMT-9).");
  });
});
