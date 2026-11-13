/**
 * Visible pass → calendar event (src/features/tonight/pass-calendar.ts).
 *
 * Checked against RFC 5545 itself rather than a snapshot: CRLF line endings,
 * 75-octet folding that never splits a UTF-8 character, TEXT escaping, UTC
 * date-times, balanced components - plus the product rules: the event spans
 * only the visible stretch, and the alarm fires ahead of it.
 */

import { describe, expect, it } from "vitest";
import type { PassResultDto } from "@/contracts/orbital";
import {
  ALARM_MINUTES_BEFORE,
  foldLine,
  icsText,
  icsUtc,
  passEventFileName,
  visiblePassesIcs,
} from "@/features/tonight/pass-calendar";
import type { VisiblePass } from "@/features/tonight/visible-tonight";

type Pass = PassResultDto["passes"][number];

const window = {
  start: { timeIso: "2026-11-13T01:15:22.400Z", azimuthDeg: 225, elevationDeg: 10 },
  end: { timeIso: "2026-11-13T01:19:47.000Z", azimuthDeg: 95, elevationDeg: 24 },
  startsFromShadow: false,
  endsInShadow: true,
};

const pass: Pass = {
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
    visibleWindow: window,
    skyTrack: [],
  },
};

const item: VisiblePass = { satelliteNumber: "25544", label: "ISS", lineage: "live", pass, window, magnitude: -3.4 };
const ctx = { nowMs: Date.parse("2026-11-12T20:00:00Z"), origin: "https://orbit.example", spot: "40.7°N, 74.0°W" };

/** RFC 5545 §3.1 unfolding: CRLF followed by one space joins lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const prop = (lines: string[], name: string) => lines.filter((l) => l.startsWith(`${name}:`)).map((l) => l.slice(name.length + 1));

describe("iCalendar primitives", () => {
  it("writes UTC date-times in basic format, dropping milliseconds", () => {
    expect(icsUtc("2026-11-13T01:15:22.400Z")).toBe("20261113T011522Z");
  });

  it("escapes TEXT values", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds at 75 octets without splitting multi-byte characters, and unfolds losslessly", () => {
    const line = "DESCRIPTION:" + "appears 10° up in the SW → highest 63° in the S → ".repeat(6);
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    for (const physical of folded.split("\r\n")) {
      expect(encoder.encode(physical).length).toBeLessThanOrEqual(75);
      expect(physical).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    expect(foldLine("SHORT:line")).toBe("SHORT:line");
  });
});

describe("visiblePassesIcs", () => {
  const ics = visiblePassesIcs([item], ctx);
  const lines = unfold(ics);

  it("is a well-formed calendar: CRLF everywhere, balanced components, required properties", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const component of ["VCALENDAR", "VEVENT", "VALARM"]) {
      expect(lines.filter((l) => l === `BEGIN:${component}`)).toHaveLength(1);
      expect(lines.filter((l) => l === `END:${component}`)).toHaveLength(1);
    }
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(prop(lines, "VERSION")).toEqual(["2.0"]);
    expect(prop(lines, "PRODID")).toHaveLength(1);
    expect(prop(lines, "DTSTAMP")).toEqual(["20261112T200000Z"]);
  });

  it("spans exactly the visible stretch, not rise to set", () => {
    expect(prop(lines, "DTSTART")).toEqual(["20261113T011522Z"]);
    expect(prop(lines, "DTEND")).toEqual(["20261113T011947Z"]);
  });

  it("alarms ahead of the visible stretch", () => {
    expect(prop(lines, "TRIGGER")).toEqual([`-PT${ALARM_MINUTES_BEFORE}M`]);
    expect(prop(lines, "ACTION")).toEqual(["DISPLAY"]);
  });

  it("tells you where to look, how bright, and links back to the live prediction", () => {
    expect(prop(lines, "SUMMARY")).toEqual(["ISS visible — look SW"]);
    const description = prop(lines, "DESCRIPTION")[0] ?? "";
    expect(description).toContain(
      "Where to look: appears 10° up in the SW → highest 63° in the S (about 6½ fists above the horizon) → fades into Earth's shadow 24° up in the E.",
    );
    expect(description).toContain("Estimated magnitude -3.4 (conspicuous).");
    expect(description).toContain("Predicted for 40.7°N\\, 74.0°W");
    expect(prop(lines, "URL")).toEqual(["https://orbit.example/satellites/25544"]);
    expect(prop(lines, "LOCATION")).toEqual(["40.7°N\\, 74.0°W"]);
  });

  it("gives each pass a stable UID, so re-adding the same pass updates rather than duplicates", () => {
    const again = unfold(visiblePassesIcs([item], { ...ctx, nowMs: ctx.nowMs + 3_600_000 }));
    expect(prop(lines, "UID")).toEqual(["25544-20261113T011522Z@orbital-insight"]);
    expect(prop(again, "UID")).toEqual(prop(lines, "UID"));
  });

  it("says brightness is unknown rather than inventing one", () => {
    const unknown = unfold(visiblePassesIcs([{ ...item, magnitude: null }], ctx));
    expect(prop(unknown, "DESCRIPTION")[0]).toContain("Brightness unknown");
  });
});

describe("passEventFileName", () => {
  it("names the file for the object and its (UTC) date", () => {
    expect(passEventFileName(item)).toBe("iss-pass-2026-11-13.ics");
    expect(passEventFileName({ ...item, label: "CSS (TIANHE)" })).toBe("css-tianhe-pass-2026-11-13.ics");
  });
});
