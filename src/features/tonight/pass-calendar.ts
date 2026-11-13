/**
 * A visible pass as a calendar event (RFC 5545 iCalendar).
 *
 * The retention loop without an account: the pass goes into the calendar the
 * person already lives in, with a 10-minute alarm, and the event spans only
 * the stretch they can actually see (not rise → set). Nothing leaves the
 * browser - the file is built here and handed to the device.
 *
 * Pure: the clock (`nowMs`, DTSTAMP) and the site origin are inputs, so the
 * output is byte-for-byte testable.
 */

import { brightnessWord, compassPoint } from "@/features/pass-prediction/sky-words";
import { skyPath, type VisiblePass } from "./visible-tonight";

/** Minutes of warning before the visible stretch begins. */
export const ALARM_MINUTES_BEFORE = 10;

/** RFC 5545 §3.1: content lines SHOULD NOT exceed 75 octets. */
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/** 2026-11-13T01:15:22.400Z → 20261113T011522Z (UTC form, §3.3.5). */
export function icsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** TEXT escaping (§3.3.11): backslash, semicolon, comma, newline. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * Fold a content line at 75 octets (§3.1): continuation lines start with one
 * space, and a multi-byte UTF-8 character ("°", "→") is never split.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines spend one octet on the leading space.
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export interface PassEventContext {
  /** Instant the file is generated (DTSTAMP). */
  nowMs: number;
  /** Site origin for the event's link back, e.g. https://example.app */
  origin: string;
  /** "40.7°N, 74.0°W" - where the prediction is for. */
  spot: string;
}

/** One VEVENT's lines (unfolded) for a visible pass. */
function eventLines(item: VisiblePass, ctx: PassEventContext): string[] {
  const { window } = item;
  const look = compassPoint(window.start.azimuthDeg);
  const brightness =
    item.magnitude !== null
      ? `Estimated magnitude ${item.magnitude.toFixed(1)} (${brightnessWord(item.magnitude)}).`
      : "Brightness unknown (no published standard magnitude).";
  const link = `${ctx.origin}/satellites/${item.satelliteNumber}`;
  const description = [
    `Where to look: ${skyPath(item.pass, window).join(" → ")}.`,
    brightness,
    `Predicted for ${ctx.spot} from published orbital elements. Times shift as the orbit is updated (a station reboost moves them most); check the live prediction on the day.`,
    link,
  ].join("\n");

  return [
    "BEGIN:VEVENT",
    `UID:${item.satelliteNumber}-${icsUtc(window.start.timeIso)}@orbital-insight`,
    `DTSTAMP:${icsUtc(new Date(ctx.nowMs).toISOString())}`,
    `DTSTART:${icsUtc(window.start.timeIso)}`,
    `DTEND:${icsUtc(window.end.timeIso)}`,
    `SUMMARY:${icsText(`${item.label} visible — look ${look}`)}`,
    `LOCATION:${icsText(ctx.spot)}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${link}`,
    "TRANSP:TRANSPARENT",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`${item.label} is visible in ${ALARM_MINUTES_BEFORE} minutes — look ${look}`)}`,
    `TRIGGER:-PT${ALARM_MINUTES_BEFORE}M`,
    "END:VALARM",
    "END:VEVENT",
  ];
}

/** A complete calendar file for one or more visible passes. */
export function visiblePassesIcs(items: VisiblePass[], ctx: PassEventContext): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orbital Insight//Visible satellite passes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...items.flatMap((item) => eventLines(item, ctx)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** "iss-pass-2026-11-13.ics" - named for what it is and when (UTC date). */
export function passEventFileName(item: VisiblePass): string {
  const slug = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || item.satelliteNumber;
  return `${slug}-pass-${item.window.start.timeIso.slice(0, 10)}.ics`;
}
