/**
 * Published standard magnitudes — the only brightness facts this project
 * claims about specific objects.
 *
 * Convention (Mallama 2020, "The Brightness of OneWeb Satellites",
 * arXiv:2012.05100 §2): the standard magnitude is the visual magnitude of the
 * object at 1 000 km range and 90° phase angle ("half-illuminated"), with the
 * phase adjustment 2.5·log₁₀(0.5 + 0.5·cos φ).
 *
 * Every entry names its source and its known weaknesses. An object absent
 * from this table has *unknown* brightness: the light model can still say it
 * is sunlit against a dark sky, but no magnitude is estimated for it — a
 * size-blind default would rate a tumbling cubesat as conspicuous as a
 * space station.
 */

export interface StandardMagnitude {
  /** Visual magnitude at 1 000 km, 90° phase. */
  value: number;
  source: string;
  caveat: string;
}

export const STANDARD_MAGNITUDES: Readonly<Record<string, StandardMagnitude>> = {
  "25544": {
    value: -1.3,
    source:
      "T. Molczan, SeeSat-L, 2005-08-08 (satobs.org/seesat/Aug-2005/0114.html): 47 visual observations by R. Eberst, Dec 2002–Jul 2005, normalized to 1 000 km and 90° phase",
    caveat:
      "Derived before the station's truss and solar arrays were completed (2009); today's larger ISS is likely brighter, so estimates may read faint",
  },
  "48274": {
    value: 0.0,
    source:
      "Heavens-Above satellite information for 48274 (heavens-above.com/SatInfo.aspx?satid=48274: \"intrinsic brightness 0.0 at 1000 km distance, 50% illuminated\"), as quoted by a web search on 2026-10-16 — the page itself refused our connection, so the value is not yet confirmed first-hand",
    caveat:
      "Single published value with no stated observation basis or date; the station grew from one module to three in 2022 (Wentian, Mengtian), and it is unclear which configuration the value describes",
  },
};

export function standardMagnitudeFor(satelliteNumber: string): StandardMagnitude | null {
  return STANDARD_MAGNITUDES[satelliteNumber.replace(/^0+(?=\d)/, "")] ?? null;
}
