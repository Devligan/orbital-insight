import { describe, expect, it } from "vitest";
import {
  dotMoveVisible,
  metersPerPixelAt,
  pixelAngle,
  simSecondsPerCloudUpdate,
  simSecondsPerRedraw,
} from "@/features/orbit-visualization/render-cadence";

/**
 * The globe redraws for the clock only as often as motion is visible: a
 * low-orbit object (~7.8 km/s) should move under a pixel per redraw, with a
 * ceiling of 30 clock redraws per wall second and a floor of one per 2 s.
 */

const LEO_SPEED = 7_800; // m/s
const FOVY = (44 * Math.PI) / 180; // Cesium's 60° field of view on a ~1.4:1 canvas
const CANVAS_PX = 700;

function jumpPx(distanceM: number, rate: number): number {
  const mpp = metersPerPixelAt(distanceM, FOVY, CANVAS_PX);
  return (simSecondsPerRedraw(mpp, rate) * LEO_SPEED) / mpp;
}

function redrawsPerWallSecond(distanceM: number, rate: number): number {
  return Math.max(rate, 1) / simSecondsPerRedraw(metersPerPixelAt(distanceM, FOVY, CANVAS_PX), rate);
}

describe("clock-driven redraw cadence", () => {
  it("whole-Earth view, live: about one redraw every 2 s, and motion still under a pixel", () => {
    expect(redrawsPerWallSecond(20_000_000, 1)).toBeCloseTo(0.5, 5);
    expect(jumpPx(20_000_000, 1)).toBeLessThan(1);
  });

  it("whole-Earth view, 60×: smooth (≤ 0.75 px per redraw) within the 30/s ceiling", () => {
    expect(jumpPx(20_000_000, 60)).toBeLessThanOrEqual(0.75 + 1e-9);
    expect(redrawsPerWallSecond(20_000_000, 60)).toBeLessThanOrEqual(30);
  });

  it("zoomed in close, live: redraws faster so a low-orbit dot never jumps more than 0.75 px", () => {
    expect(jumpPx(1_500_000, 1)).toBeLessThanOrEqual(0.75 + 1e-9);
    expect(redrawsPerWallSecond(1_500_000, 1)).toBeGreaterThan(1);
  });

  it("never asks for more than 30 clock redraws per wall second, or fewer than one per 2 s", () => {
    for (const distance of [100_000, 1_000_000, 5_000_000, 20_000_000, 60_000_000]) {
      for (const rate of [0, 1, 60]) {
        const perSecond = redrawsPerWallSecond(distance, rate);
        expect(perSecond).toBeLessThanOrEqual(30 + 1e-9);
        expect(perSecond).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
    }
  });

  it("moves the whole-sky dots at most 10 times per wall second, and never more often than redraws", () => {
    for (const rate of [0, 1, 60]) {
      const r = Math.max(rate, 1);
      // Zoomed right in: redraws want 30/s, the dots stay at 10/s.
      expect(r / simSecondsPerCloudUpdate(r / 30, rate)).toBeCloseTo(10, 9);
      // Whole-Earth view, live: redraws every 2 s and the dots move with them.
      expect(simSecondsPerCloudUpdate(2, 1)).toBe(2);
    }
  });

  it("re-uploads a whole-sky dot only when it would move at least half a pixel", () => {
    const angle = pixelAngle(FOVY, CANVAS_PX); // ~1.15 mrad: 11.5 km per pixel at 10,000 km
    // 1 km of motion: invisible 10,000 km away (~0.09 px), visible 1,000 km away (~0.9 px).
    expect(dotMoveVisible(1_000 ** 2, 10_000_000 ** 2, angle)).toBe(false);
    expect(dotMoveVisible(1_000 ** 2, 1_000_000 ** 2, angle)).toBe(true);
    // The threshold is half a pixel.
    const halfPixelAt5000Km = 0.5 * angle * 5_000_000;
    expect(dotMoveVisible((halfPixelAt5000Km * 1.01) ** 2, 5_000_000 ** 2, angle)).toBe(true);
    expect(dotMoveVisible((halfPixelAt5000Km * 0.99) ** 2, 5_000_000 ** 2, angle)).toBe(false);
  });

  it("sizes a pixel from distance, field of view and canvas height", () => {
    // 20,000 km away, 44° vertical field, 700 px: ~23 km per pixel.
    expect(metersPerPixelAt(20_000_000, FOVY, CANVAS_PX)).toBeCloseTo(23_076, -2);
  });
});
