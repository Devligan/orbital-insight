/**
 * Constellation atlas: who is in orbit, and where.
 *
 * Pure functions over the active catalog (name + both TLE lines per object):
 *  - orbit shape read straight from the TLE's fixed columns (inclination,
 *    eccentricity, mean motion) and turned into Keplerian perigee/apogee
 *    altitudes — the same two-body close form as `characteristics.ts`,
 *    labelled an approximation wherever it is shown;
 *  - constellation membership from the provider's own object names. That is
 *    transparent and reproducible (every rule is a pattern below, listed on
 *    /methodology) but not authoritative — an operator renaming a satellite
 *    would move it. Objects matching no rule are "everything else", never
 *    guessed into a constellation.
 *
 * No SGP4 here: these are element-set properties, not positions.
 */

import { EARTH_EQUATORIAL_RADIUS_KM } from "@/domain/orbit/characteristics";

/** μ (km³/s²) with the WGS-72 value the TLE close forms use (see characteristics.ts). */
const MU_EARTH_KM3_S2 = 398_600.7996;
const SECONDS_PER_DAY = 86_400;

export type ConstellationId =
  | "starlink"
  | "oneweb"
  | "kuiper"
  | "qianfan"
  | "guowang"
  | "iridium"
  | "gnss"
  | "station"
  | "other";

/**
 * Colour groups. A scatter of ~16k points can carry only three distinguishable
 * hues (every pair of colours sits side by side somewhere), so constellations
 * fold into three coloured groups plus a neutral "everything else".
 */
export type AtlasGroup = "starlink" | "broadband" | "navigation" | "other";

export interface ConstellationRule {
  id: ConstellationId;
  label: string;
  operator: string;
  group: AtlasGroup;
  /** Matched against the provider's object name (case-insensitive). */
  pattern: RegExp | null;
}

/** Order matters only for display; patterns are mutually exclusive. */
export const CONSTELLATIONS: readonly ConstellationRule[] = [
  { id: "starlink", label: "Starlink", operator: "SpaceX", group: "starlink", pattern: /^STARLINK\b/i },
  { id: "oneweb", label: "OneWeb", operator: "Eutelsat OneWeb", group: "broadband", pattern: /^ONEWEB\b/i },
  { id: "kuiper", label: "Kuiper", operator: "Amazon", group: "broadband", pattern: /^KUIPER\b/i },
  { id: "qianfan", label: "Qianfan", operator: "Shanghai Spacesail", group: "broadband", pattern: /^QIANFAN\b/i },
  { id: "guowang", label: "Guowang", operator: "China Satellite Network Group", group: "broadband", pattern: /^HULIANWANG\b/i },
  { id: "iridium", label: "Iridium", operator: "Iridium", group: "broadband", pattern: /^IRIDIUM\b/i },
  {
    id: "gnss",
    label: "Navigation (GPS · Galileo · BeiDou · GLONASS)",
    operator: "Various",
    group: "navigation",
    // GPS flies as NAVSTAR, Galileo as GSATnnnn (GALILEO …), GLONASS as COSMOS nnnn [GLONASS-…].
    pattern: /^(NAVSTAR\b|GPS\b|BEIDOU\b|GSAT\d{4}\b.*GALILEO|.*\bGLONASS\b|QZS\b|IRNSS\b)/i,
  },
  {
    id: "station",
    label: "Crewed stations",
    operator: "ISS partners · CMSA",
    group: "other",
    pattern: /^(ISS \((ZARYA|UNITY|ZVEZDA|DESTINY|NAUKA)\)|CSS \((TIANHE|WENTIAN|MENGTIAN)\))$/i,
  },
  { id: "other", label: "Everything else", operator: "—", group: "other", pattern: null },
];

const RULES_WITH_PATTERNS = CONSTELLATIONS.filter((rule) => rule.pattern !== null);
const RULE_BY_ID = new Map(CONSTELLATIONS.map((rule) => [rule.id, rule]));

export function constellationOf(name: string): ConstellationId {
  const trimmed = name.trim();
  for (const rule of RULES_WITH_PATTERNS) {
    if (rule.pattern!.test(trimmed)) return rule.id;
  }
  return "other";
}

export function constellationRule(id: ConstellationId): ConstellationRule {
  return RULE_BY_ID.get(id)!;
}

export type OrbitRegime = "LEO" | "MEO" | "GEO" | "HEO";

export interface AtlasPoint {
  id: string;
  name: string;
  constellation: ConstellationId;
  inclinationDeg: number;
  eccentricity: number;
  periodMinutes: number;
  perigeeKm: number;
  apogeeKm: number;
  /** Mean of perigee and apogee altitudes — the y position on the atlas. */
  meanAltitudeKm: number;
  regime: OrbitRegime;
}

/**
 * Same regime boundaries as the globe's colouring (features/sky/category.ts):
 * strongly eccentric → HEO; period < 129 min → LEO; 22–26 h → GEO belt.
 */
export function regimeOf(periodMinutes: number, eccentricity: number): OrbitRegime {
  if (eccentricity > 0.25) return "HEO";
  if (periodMinutes < 129) return "LEO";
  if (periodMinutes > 1_320 && periodMinutes < 1_560) return "GEO";
  return "MEO";
}

/**
 * One atlas point from a TLE pair, or null when the fixed columns don't hold
 * a physical orbit (bad rows are skipped, never patched).
 * Columns (1-based, line 2): inclination 9–16, eccentricity 27–33 (implied
 * leading decimal point), mean motion 53–63 rev/day.
 */
export function atlasPoint(id: string, name: string, line2: string): AtlasPoint | null {
  if (line2.length < 63 || line2[0] !== "2") return null;
  const inclinationDeg = Number(line2.slice(8, 16));
  const eccentricity = Number(`0.${line2.slice(26, 33).trim()}`);
  const revsPerDay = Number(line2.slice(52, 63));
  if (!Number.isFinite(inclinationDeg) || inclinationDeg < 0 || inclinationDeg > 180) return null;
  if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) return null;
  if (!Number.isFinite(revsPerDay) || revsPerDay <= 0) return null;

  const nRadPerSec = (revsPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH_KM3_S2 / (nRadPerSec * nRadPerSec));
  const perigeeKm = semiMajorAxisKm * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM;
  const apogeeKm = semiMajorAxisKm * (1 + eccentricity) - EARTH_EQUATORIAL_RADIUS_KM;
  const periodMinutes = 1_440 / revsPerDay;

  return {
    id,
    name: name.trim(),
    constellation: constellationOf(name),
    inclinationDeg,
    eccentricity,
    periodMinutes,
    perigeeKm,
    apogeeKm,
    meanAltitudeKm: (perigeeKm + apogeeKm) / 2,
    regime: regimeOf(periodMinutes, eccentricity),
  };
}

export interface AtlasSummary {
  total: number;
  byConstellation: Record<ConstellationId, number>;
  byRegime: Record<OrbitRegime, number>;
}

export function summarize(points: readonly AtlasPoint[]): AtlasSummary {
  const byConstellation = Object.fromEntries(CONSTELLATIONS.map((c) => [c.id, 0])) as Record<ConstellationId, number>;
  const byRegime: Record<OrbitRegime, number> = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };
  for (const point of points) {
    byConstellation[point.constellation] += 1;
    byRegime[point.regime] += 1;
  }
  return { total: points.length, byConstellation, byRegime };
}

export interface ConstellationProfile {
  id: ConstellationId;
  count: number;
  /** Fraction of all points, 0–1. */
  share: number;
  medianAltitudeKm: number;
  /**
   * Dominant orbital planes: inclinations (rounded to whole degrees) holding
   * at least 5% of the constellation, most populated first, at most four.
   */
  inclinations: { deg: number; count: number }[];
}

/**
 * Groups inclinations into planes: whole-degree bins, with runs of adjacent
 * occupied degrees merged (a 97.6° shell straddles 97 and 98; GNSS spreads
 * over 54–57°). Each plane reports its count-weighted mean, rounded. Most
 * populated first.
 */
export function orbitalPlanes(inclinationsDeg: readonly number[]): { deg: number; count: number }[] {
  const bins = new Map<number, { count: number; sum: number }>();
  for (const incl of inclinationsDeg) {
    const deg = Math.round(incl);
    const bin = bins.get(deg) ?? { count: 0, sum: 0 };
    bin.count += 1;
    bin.sum += incl;
    bins.set(deg, bin);
  }
  const planes: { deg: number; count: number }[] = [];
  let run: { count: number; sum: number; last: number } | null = null;
  const flush = () => {
    if (run) planes.push({ deg: Math.round(run.sum / run.count), count: run.count });
  };
  for (const deg of [...bins.keys()].sort((a, b) => a - b)) {
    const bin = bins.get(deg)!;
    if (run && deg - run.last <= 1) {
      run.count += bin.count;
      run.sum += bin.sum;
      run.last = deg;
    } else {
      flush();
      run = { count: bin.count, sum: bin.sum, last: deg };
    }
  }
  flush();
  return planes.sort((a, b) => b.count - a.count || a.deg - b.deg);
}

/** One profile per constellation that has members, largest first; "other" last. */
export function constellationProfiles(points: readonly AtlasPoint[]): ConstellationProfile[] {
  const members = new Map<ConstellationId, AtlasPoint[]>();
  for (const point of points) {
    const list = members.get(point.constellation);
    if (list) list.push(point);
    else members.set(point.constellation, [point]);
  }
  const profiles: ConstellationProfile[] = [];
  for (const [id, list] of members) {
    const altitudes = list.map((p) => p.meanAltitudeKm).sort((a, b) => a - b);
    const mid = Math.floor(altitudes.length / 2);
    const median = altitudes.length % 2 ? altitudes[mid]! : (altitudes[mid - 1]! + altitudes[mid]!) / 2;
    const inclinations = orbitalPlanes(list.map((p) => p.inclinationDeg))
      .filter((plane) => plane.count >= list.length * 0.05)
      .slice(0, 4);
    profiles.push({ id, count: list.length, share: list.length / points.length, medianAltitudeKm: median, inclinations });
  }
  return profiles.sort((a, b) => Number(a.id === "other") - Number(b.id === "other") || b.count - a.count);
}

export interface AltitudeBin {
  /** Lower edge, km (inclusive). */
  fromKm: number;
  toKm: number;
  /** Count per colour group, so the histogram stacks the same way the scatter colours. */
  counts: Record<AtlasGroup, number>;
  total: number;
}

/**
 * Objects per altitude band (by mean altitude), stacked by colour group.
 * Objects outside [minKm, maxKm) are not counted — the caller labels the range.
 */
export function altitudeHistogram(
  points: readonly AtlasPoint[],
  { minKm, maxKm, binKm }: { minKm: number; maxKm: number; binKm: number },
): AltitudeBin[] {
  if (!(binKm > 0) || !(maxKm > minKm)) throw new RangeError("altitudeHistogram: need binKm > 0 and maxKm > minKm");
  const binCount = Math.ceil((maxKm - minKm) / binKm);
  const bins: AltitudeBin[] = Array.from({ length: binCount }, (_, i) => ({
    fromKm: minKm + i * binKm,
    toKm: Math.min(maxKm, minKm + (i + 1) * binKm),
    counts: { starlink: 0, broadband: 0, navigation: 0, other: 0 },
    total: 0,
  }));
  for (const point of points) {
    const altitude = point.meanAltitudeKm;
    if (altitude < minKm || altitude >= maxKm) continue;
    const bin = bins[Math.floor((altitude - minKm) / binKm)]!;
    bin.counts[constellationRule(point.constellation).group] += 1;
    bin.total += 1;
  }
  return bins;
}
