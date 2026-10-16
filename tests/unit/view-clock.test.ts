/**
 * The explorer's shared simulation clock: live, paused (slider), and
 * fast-forward must agree on the shown instant and never jump on re-basing.
 */

import { describe, expect, it } from "vitest";
import {
  FAST_FORWARD_RATE,
  isLive,
  liveClock,
  offsetLabel,
  pausedAt,
  simTimeAt,
  sliderIndexFor,
  withRate,
} from "@/features/orbit-visualization/view-clock";

const T0 = Date.parse("2026-10-16T20:00:00Z");

describe("view clock", () => {
  it("live runs in real time", () => {
    const clock = liveClock(T0);
    expect(simTimeAt(clock, T0 + 90_000)).toBe(T0 + 90_000);
    expect(isLive(clock, T0 + 90_000)).toBe(true);
  });

  it("paused holds the chosen instant however long the page sits", () => {
    const clock = pausedAt(T0 + 3_600_000, T0);
    expect(simTimeAt(clock, T0 + 10 * 60_000)).toBe(T0 + 3_600_000);
    expect(isLive(clock, T0)).toBe(false);
  });

  it("changing rate re-bases without a jump", () => {
    const live = liveClock(T0);
    const fast = withRate(live, FAST_FORWARD_RATE, T0 + 10_000);
    expect(simTimeAt(fast, T0 + 10_000)).toBe(T0 + 10_000);
    // One wall minute at 60× is one simulated hour.
    expect(simTimeAt(fast, T0 + 70_000)).toBe(T0 + 10_000 + 3_600_000);
    expect(isLive(fast, T0 + 70_000)).toBe(false);
  });

  it("maps a simulated instant to the nearest slider step, clamped", () => {
    const step = 5 * 60_000;
    expect(sliderIndexFor(T0, T0, step, 72)).toBe(0);
    expect(sliderIndexFor(T0 + 12 * step + 60_000, T0, step, 72)).toBe(12);
    expect(sliderIndexFor(T0 - step, T0, step, 72)).toBe(0);
    expect(sliderIndexFor(T0 + 999 * step, T0, step, 72)).toBe(71);
    expect(sliderIndexFor(T0, T0, step, 0)).toBe(0);
  });

  it("labels the offset from now in planning units", () => {
    expect(offsetLabel(T0, T0)).toBe("now");
    expect(offsetLabel(T0 + 40 * 60_000, T0)).toBe("+40 m");
    expect(offsetLabel(T0 + 75 * 60_000, T0)).toBe("+1 h 15 m");
    expect(offsetLabel(T0 - 3 * 60_000, T0)).toBe("−3 m");
  });
});
