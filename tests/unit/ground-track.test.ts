import { describe, expect, it } from "vitest";
import { buildGroundTrackSegments } from "@/domain/orbit/ground-track";
import type { GeodeticPoint } from "@/domain/orbit/types";

function point(lat: number, lon: number, minutes: number): GeodeticPoint {
  return { latitudeDeg: lat, longitudeDeg: lon, altitudeKm: 400, time: new Date(Date.UTC(2025, 0, 1, 0, minutes)) };
}

describe("ground track antimeridian splitting", () => {
  it("keeps a monotonic track in one segment", () => {
    const points = [point(0, 10, 0), point(1, 12, 1), point(2, 14, 2), point(3, 16, 3)];
    const segments = buildGroundTrackSegments(points);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.points).toHaveLength(4);
  });

  it("splits when longitude jumps from +179 to -179", () => {
    const points = [point(0, 179.0, 0), point(0.5, 179.9, 1), point(1, -179.9, 2), point(1.5, -179.0, 3)];
    const segments = buildGroundTrackSegments(points);
    expect(segments.length).toBe(2);
    // First segment ends at the (+180) boundary edge point.
    const first = segments[0];
    expect(first?.points[first.points.length - 1]?.longitudeDeg).toBe(180);
    // Second segment starts at the (-180) boundary edge point.
    const second = segments[1];
    expect(second?.points[0]?.longitudeDeg).toBe(-180);
  });

  it("does not split for normal negative-direction movements", () => {
    const points = [point(0, -30, 0), point(0, -60, 1), point(0, -90, 2)];
    const segments = buildGroundTrackSegments(points);
    expect(segments).toHaveLength(1);
  });

  it("handles multiple crossings", () => {
    const points = [point(0, 179.5, 0), point(0, -179.5, 1), point(0, -178, 2), point(0, -179.5, 3), point(0, 179.5, 4)];
    const segments = buildGroundTrackSegments(points);
    // crossings: +→- (once) and -→+ (once) → 3 segments
    expect(segments).toHaveLength(3);
  });

  it("returns no segments for no points", () => {
    expect(buildGroundTrackSegments([])).toHaveLength(0);
  });
});
