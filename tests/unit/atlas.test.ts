import { describe, expect, it } from "vitest";
import {
  altitudeHistogram,
  atlasPoint,
  constellationOf,
  constellationProfiles,
  orbitalPlanes,
  regimeOf,
  summarize,
  type AtlasPoint,
} from "@/domain/catalog/atlas";

/** ISS element set as published by CelesTrak (2026-11-12). */
const ISS_LINE2 = "2 25544  51.6324 286.4897 0007327  17.4271 342.6968 15.49332729594739";

/** Builds a TLE line 2 with fields at their fixed columns (checksum not needed here). */
function line2({ incl, ecc, revsPerDay }: { incl: number; ecc: number; revsPerDay: number }): string {
  const eccDigits = ecc.toFixed(7).slice(2); // implied leading decimal point
  return (
    "2 99999 " +
    incl.toFixed(4).padStart(8) +
    " " +
    "100.0000" +
    " " +
    eccDigits +
    " " +
    "100.0000" +
    " " +
    "200.0000" +
    " " +
    revsPerDay.toFixed(8).padStart(11) +
    "    10" +
    "0"
  );
}

describe("atlasPoint — Keplerian shape from TLE columns", () => {
  it("places the ISS at its published 414–424 km band (same as the detail page)", () => {
    const iss = atlasPoint("25544", "ISS (ZARYA)", ISS_LINE2)!;
    expect(iss.inclinationDeg).toBeCloseTo(51.6324, 4);
    expect(iss.eccentricity).toBeCloseTo(0.0007327, 7);
    expect(iss.perigeeKm).toBeGreaterThan(412);
    expect(iss.perigeeKm).toBeLessThan(416);
    expect(iss.apogeeKm).toBeGreaterThan(422);
    expect(iss.apogeeKm).toBeLessThan(426);
    expect(iss.periodMinutes).toBeCloseTo(92.94, 1);
    expect(iss.regime).toBe("LEO");
    expect(iss.constellation).toBe("station");
  });

  it("puts a one-revolution-per-sidereal-day orbit on the geostationary radius", () => {
    // 1.00273791 rev/day is one revolution per sidereal day.
    const geo = atlasPoint("1", "SOME GEO SAT", line2({ incl: 0.05, ecc: 0.0002, revsPerDay: 1.00273791 }))!;
    expect(geo.meanAltitudeKm).toBeGreaterThan(35_770);
    expect(geo.meanAltitudeKm).toBeLessThan(35_800);
    expect(geo.regime).toBe("GEO");
  });

  it("classifies GPS-like and Molniya-like orbits", () => {
    const gps = atlasPoint("2", "NAVSTAR 81 (USA 319)", line2({ incl: 55, ecc: 0.004, revsPerDay: 2.0056 }))!;
    expect(gps.meanAltitudeKm).toBeGreaterThan(20_000);
    expect(gps.meanAltitudeKm).toBeLessThan(20_400);
    expect(gps.regime).toBe("MEO");
    expect(gps.constellation).toBe("gnss");

    const molniya = atlasPoint("3", "MOLNIYA 1-93", line2({ incl: 63.4, ecc: 0.72, revsPerDay: 2.006 }))!;
    expect(molniya.regime).toBe("HEO");
    expect(molniya.apogeeKm).toBeGreaterThan(38_000);
    expect(molniya.perigeeKm).toBeLessThan(2_000);
  });

  it("skips rows whose columns do not hold a physical orbit", () => {
    expect(atlasPoint("4", "X", "")).toBeNull();
    expect(atlasPoint("4", "X", ISS_LINE2.replace(/^2/, "1"))).toBeNull();
    expect(atlasPoint("4", "X", line2({ incl: 51, ecc: 0.001, revsPerDay: 0 }))).toBeNull();
    expect(atlasPoint("4", "X", ISS_LINE2.slice(0, 40))).toBeNull();
  });
});

describe("constellationOf — name rules", () => {
  it.each([
    ["STARLINK-30423", "starlink"],
    ["ONEWEB-0012", "oneweb"],
    ["KUIPER-00042", "kuiper"],
    ["QIANFAN-18", "qianfan"],
    ["HULIANWANG DIGUI-37", "guowang"],
    ["IRIDIUM 180", "iridium"],
    ["NAVSTAR 81 (USA 319)", "gnss"],
    ["GSAT0101 (GALILEO-PFM)", "gnss"],
    ["COSMOS 2545 [GLONASS-M]", "gnss"],
    ["BEIDOU-3 M23", "gnss"],
    ["ISS (ZARYA)", "station"],
    ["CSS (TIANHE)", "station"],
  ] as const)("%s → %s", (name, expected) => {
    expect(constellationOf(name)).toBe(expected);
  });

  it.each([
    "GSAT-30", // India's GSAT is a GEO comms series, not Galileo
    "COSMOS 2558", // not every COSMOS is a GLONASS satellite
    "ISS OBJECT YM", // deployed from the ISS, not the station itself
    "STARLINKER 1", // whole-word match only
    "",
  ])("%j is not guessed into a constellation", (name) => {
    expect(constellationOf(name)).toBe("other");
  });
});

describe("regimeOf", () => {
  it("uses the globe's band boundaries", () => {
    expect(regimeOf(92.9, 0.0007)).toBe("LEO");
    expect(regimeOf(128.9, 0)).toBe("LEO");
    expect(regimeOf(718, 0.01)).toBe("MEO");
    expect(regimeOf(1_436, 0.0002)).toBe("GEO");
    expect(regimeOf(718, 0.7)).toBe("HEO");
  });
});

describe("summaries", () => {
  const points = [
    atlasPoint("25544", "ISS (ZARYA)", ISS_LINE2),
    atlasPoint("10", "STARLINK-1", line2({ incl: 53, ecc: 0.0001, revsPerDay: 15.06 })),
    atlasPoint("11", "STARLINK-2", line2({ incl: 53, ecc: 0.0001, revsPerDay: 15.06 })),
    atlasPoint("12", "ONEWEB-0001", line2({ incl: 87.9, ecc: 0.0002, revsPerDay: 13.1 })), // ~1,220 km
    atlasPoint("13", "NAVSTAR 1", line2({ incl: 55, ecc: 0.004, revsPerDay: 2.0056 })),
  ].filter((p): p is AtlasPoint => p !== null);

  it("counts by constellation and regime", () => {
    const summary = summarize(points);
    expect(summary.total).toBe(5);
    expect(summary.byConstellation.starlink).toBe(2);
    expect(summary.byConstellation.oneweb).toBe(1);
    expect(summary.byConstellation.gnss).toBe(1);
    expect(summary.byConstellation.station).toBe(1);
    expect(summary.byConstellation.other).toBe(0);
    expect(summary.byRegime).toEqual({ LEO: 4, MEO: 1, GEO: 0, HEO: 0 });
  });

  it("bins mean altitude by colour group and leaves out-of-range objects uncounted", () => {
    const bins = altitudeHistogram(points, { minKm: 300, maxKm: 1_500, binKm: 100 });
    expect(bins).toHaveLength(12);
    const iss = bins.find((b) => b.fromKm === 400)!;
    expect(iss.counts.other).toBe(1); // stations fold into the neutral group
    const starlink = bins.find((b) => b.fromKm === 500)!;
    expect(starlink.counts.starlink).toBe(2);
    const oneweb = bins.find((b) => b.fromKm === 1_200)!;
    expect(oneweb.counts.broadband).toBe(1);
    // GPS at ~20,200 km is outside the range: not silently clamped into the top bin.
    expect(bins.reduce((sum, b) => sum + b.total, 0)).toBe(4);
  });

  it("profiles constellations: share, median altitude, dominant planes; 'other' last", () => {
    const shells = [
      ...Array.from({ length: 6 }, (_, i) => atlasPoint(`2${i}`, `STARLINK-${i}`, line2({ incl: 53.05, ecc: 0.0001, revsPerDay: 15.06 }))),
      ...Array.from({ length: 3 }, (_, i) => atlasPoint(`3${i}`, `STARLINK-9${i}`, line2({ incl: 97.6, ecc: 0.0001, revsPerDay: 15.06 }))),
      atlasPoint("40", "STARLINK-X", line2({ incl: 70, ecc: 0.0001, revsPerDay: 15.4 })), // 1 of 10 = 10% ≥ 5%: still a plane
      atlasPoint("41", "DEBRIS-ISH THING", line2({ incl: 20, ecc: 0.0001, revsPerDay: 14 })),
    ].filter((p): p is AtlasPoint => p !== null);

    const [starlink, other] = constellationProfiles(shells);
    expect(starlink!.id).toBe("starlink");
    expect(starlink!.count).toBe(10);
    expect(starlink!.share).toBeCloseTo(10 / 11, 6);
    expect(starlink!.inclinations).toEqual([
      { deg: 53, count: 6 },
      { deg: 98, count: 3 },
      { deg: 70, count: 1 },
    ]);
    expect(starlink!.medianAltitudeKm).toBeGreaterThan(540);
    expect(starlink!.medianAltitudeKm).toBeLessThan(560);
    expect(other!.id).toBe("other");
  });

  it("merges adjacent whole-degree bins into one plane at their weighted mean", () => {
    // GNSS-like spread across 54–57°, a 97.6° shell straddling 97/98, a lone 65° plane.
    expect(orbitalPlanes([54.2, 55.1, 55.0, 56.0, 57.3, 97.4, 97.7, 97.6, 64.8])).toEqual([
      { deg: 56, count: 5 },
      { deg: 98, count: 3 },
      { deg: 65, count: 1 },
    ]);
    expect(orbitalPlanes([])).toEqual([]);
  });

  it("rejects a degenerate range", () => {
    expect(() => altitudeHistogram(points, { minKm: 500, maxKm: 500, binKm: 10 })).toThrow(RangeError);
  });
});
