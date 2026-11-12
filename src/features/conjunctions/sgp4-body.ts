import type { ScreeningBody } from "@/domain/conjunction/screening";
import { compileTleLines, epochMillis, temeStateInto } from "@/integrations/sgp4/bulk";

/** WGS-72 values, matching SGP4's own constants. */
const MU_KM3_S2 = 398_600.8;

/** A catalog row as a screening body propagated by SGP4 (TEME frame), or null if SGP4 rejects it. */
export function sgp4Body(id: string, name: string, line1: string, line2: string): ScreeningBody | null {
  const satrec = compileTleLines(line1, line2);
  if (!satrec || !(satrec.no > 0)) return null;
  const epochMs = epochMillis(satrec);
  const nRadPerSec = satrec.no / 60; // satellite.js v7: `no` is rad/min
  const semiMajorAxisKm = Math.cbrt(MU_KM3_S2 / (nRadPerSec * nRadPerSec));
  const e = satrec.ecco;
  return {
    id,
    name,
    perigeeRadiusKm: semiMajorAxisKm * (1 - e),
    apogeeRadiusKm: semiMajorAxisKm * (1 + e),
    state: (tMs, out, offset) => temeStateInto(satrec, (tMs - epochMs) / 60_000, out, offset),
  };
}
