/**
 * 2D ground-track projection: north up, west left — the convention every
 * map reader assumes. Pinned because the plot once rendered upside down.
 */

import { describe, expect, it } from "vitest";
import { PLOT_LAT_MARGIN, PLOT_WIDTH, projectEquirectangular } from "@/features/orbit-visualization/equirectangular";

const H = 320;

describe("equirectangular projection", () => {
  it("puts the north pole at the top and the south pole at the bottom", () => {
    expect(projectEquirectangular(90, 0, H).y).toBe(PLOT_LAT_MARGIN);
    expect(projectEquirectangular(-90, 0, H).y).toBe(H - PLOT_LAT_MARGIN);
    expect(projectEquirectangular(0, 0, H).y).toBe(H / 2);
    // London (51.5°N) is above Sydney (33.9°S).
    expect(projectEquirectangular(51.5, -0.1, H).y).toBeLessThan(projectEquirectangular(-33.9, 151.2, H).y);
  });

  it("spans −180° → 180° left to right, Greenwich in the middle", () => {
    expect(projectEquirectangular(0, -180, H).x).toBe(0);
    expect(projectEquirectangular(0, 180, H).x).toBe(PLOT_WIDTH);
    expect(projectEquirectangular(0, 0, H).x).toBe(PLOT_WIDTH / 2);
  });
});
