/**
 * SGP4 numerical validation.
 *
 * Reference data: the official "SGP4 Verification" distributed with David
 * Vallado's reference SGP4 code - `SGP4-VER.TLE` plus its expected-output
 * file `tcppver.out`. These files are mirrored by the python-sgp4 project
 * (github.com/brandon-rhodes/python-sgp4, sgp4/tests.py, which they document
 * as testing both implementations against the official 2010 reference
 * release).
 *
 * Test algorithm (port of python-sgp4's `run_satellite_against_tcppver`):
 * regenerate the expected output row-by-row and compare against the file.
 *
 * File conventions encoded here (all from the file itself):
 *   - TLE lines are truncated to the standard 69 characters; the fixture
 *     appends the row schedule `tstart tend tstep` after column 69 of line 2.
 *   - Each satellite section starts with a `<satnum> xx` header row,
 *     a short row at t=0, then rows from tstart→tend in tstep increments.
 *   - When SGP4 cannot produce a state, the C++ harness prints
 *     "(Use previous data line)"; comparison replaces it with t=0 plus the
 *     previous row's ephemeris, as python-sgp4 does.
 *
 * Tolerance: |actual − expected| < 2e-7 on the first seven fields
 * (position km, velocity km/s, TEME frame), the same tolerance the upstream
 * comparison uses. The bound exists because the file prints 8 decimal
 * places while bit-level rounding differs across compilers.
 *
 * The keplerian/date tail of long rows is C++-formatted at low precision;
 * we do not numerically validate it - the physical state fields are the
 * authoritative comparison target.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  invjday,
  sgp4,
  twoline2satrec,
  type SatRec,
  type EciVec3,
} from "satellite.js";

const FIXTURE_DIR = path.resolve(import.meta.dirname ?? __dirname, "../fixtures");
const TLE_TEXT = readFileSync(path.join(FIXTURE_DIR, "SGP4-VER.TLE"), "utf8").replace(/\r/g, "");
const EXPECTED_LINES = readFileSync(path.join(FIXTURE_DIR, "tcppver.out"), "utf8")
  .replace(/\r/g, "")
  .split("\n")
  .filter((l) => l.length > 0);

/** Upstream comparison tolerance for the first seven numeric fields. */
const TOLERANCE = 2e-7;

const ALL_TLE_LINES = TLE_TEXT.split("\n");

interface VerificationCase {
  satnum: string;
  line1: string;
  line2: string; // first 69 chars (standard TLE)
  schedule: [number, number, number]; // tstart, tend, tstep (minutes)
}

const VERIFICATION_CASES: VerificationCase[] = (() => {
  const cases: VerificationCase[] = [];
  // Sequential pairing, mirroring the reference "1 …" immediately followed by
  // "2 …" layout (satnum 20413 appears twice with different elements, so a
  // satnum search would mis-pair).
  for (let i = 0; i < ALL_TLE_LINES.length; i++) {
    const line1Full = ALL_TLE_LINES[i];
    if (line1Full === undefined || !line1Full.startsWith("1 ")) continue;
    const line2Full = ALL_TLE_LINES[i + 1];
    if (line2Full === undefined || !line2Full.startsWith("2 ")) continue;
    const satnum = line1Full.slice(2, 7).trim();
    const [tstart, tend, tstep] = (line2Full.slice(69).trim().split(/\s+/).map(Number)) as [number, number, number];
    cases.push({ satnum, line1: line1Full.slice(0, 69), line2: line2Full.slice(0, 69), schedule: [tstart, tend, tstep] });
    i += 1; // consume the line2 block
  }
  return cases;
})();

// ---------------------------------------------------------------------------

type Vec = EciVec3<number>;

/** satellite.js's public typings differ from its runtime behavior (it can
 * return null, or `{position:false}` at runtime); narrow through this shape. */
type Sgp4Result = { position: Vec | false; velocity: Vec | false } | null;

function stateAt(satrec: SatRec, t: number): { position: Vec; velocity: Vec } | { failure: true } {
  const r = sgp4(satrec, t) as unknown as Sgp4Result;
  if (r === null || r.position === false || r.velocity === false) return { failure: true };
  if (
    !Number.isFinite(r.position.x) ||
    !Number.isFinite(r.position.y) ||
    !Number.isFinite(r.position.z) ||
    !Number.isFinite(r.velocity.x) ||
    !Number.isFinite(r.velocity.y) ||
    !Number.isFinite(r.velocity.z)
  ) { return { failure: true }; }
  return { position: r.position, velocity: r.velocity };
}

function formatShort(t: number, r: Vec, v: Vec): string {
  return " " + pad(t.toFixed(8)) + " " + pad(r.x.toFixed(8)) + " " + pad(r.y.toFixed(8)) + " " + pad(r.z.toFixed(8)) + " "
    + pad(v.x.toFixed(9)) + " " + pad(v.y.toFixed(9)) + " " + pad(v.z.toFixed(9));
}

function pad(s: string): string {
  return s.padStart(16);
}

/** Regenenerate the full expected row sequence for all satellites. */
function regenerateAllRows(): string[] {
  const rows: string[] = [];
  for (const c of VERIFICATION_CASES) {
    rows.push(`${Number(c.satnum)} xx`);
    const satrec = twoline2satrec(c.line1, c.line2);

    const [tstart, tend, tstep] = c.schedule;
    if (!(Number.isFinite(tstart) && Number.isFinite(tend) && Number.isFinite(tstep))) continue;

    const first = stateAt(satrec, 0);
    if ("failure" in first) {
      rows.push("(Use previous data line)");
      continue;
    }
    if (!("position" in first)) continue;
    rows.push(formatShort(0, first.position, first.velocity));

    // After the t=0 row, the C++ generator walks tstart→tend in tstep
    // increments; the FIRST SGP4 error ends this satellite's output
    // entirely (python-sgp4's `return` inside its loop).
    let tsince = tstart;
    let failed = false;
    for (; tsince <= tend; tsince += tstep) {
      if (tsince === tstart && tstart === 0) continue; // already emitted t=0 short row
      const r = stateAt(satrec, tsince);
      if ("failure" in r) {
        failed = true;
        break;
      }
      if (!("position" in r)) continue;
      rows.push(formatLong(satrec, tsince, tstep, r.position, r.velocity));
    }
    // Tail row when the step does not land exactly on tend (per the C++
    // generator: "do not miss last line!").
    if (!failed && tsince - tend < tstep - 1e-6) {
      const r = stateAt(satrec, tend);
      if (!("failure" in r) && "position" in r) {
        rows.push(formatLong(satrec, tend, tstep, r.position, r.velocity));
      }
    }
  }
  return rows;
}

function formatLong(satrec: SatRec, t: number, _tstep: number, r: Vec, v: Vec): string {
  // Row shape: short fields + computed UTC date tail. The C++ harness also
  // prints low-precision keplerians; those are not compared numerically (they
  // would require porting rv2coe's C++ formatting), which matches how the
  // upstream python tests treat them textually. We append the date so the
  // row shape stays comparable to the file.
  const jd = (satrec.jdsatepoch ?? 0) + t / 1440;
  const date = invjday(jd) as unknown as { toISOString: () => string };
  // Row shape: short fields + date tail text (not numerically compared).
  return `${formatShort(t, r, v)} ${date.toISOString()}`;
}

// ---------------------------------------------------------------------------

describe("SGP4 verification (Vallado SGP4-VER.TLE / tcppver.out)", () => {
  it("fixture contains the expected 33 verification TLEs", () => {
    expect(VERIFICATION_CASES.length).toBe(33);
  });

  it("regenerated output has the same 700-line structure as the file", () => {
    const regenerated = regenerateAllRows();
    expect(regenerated).toHaveLength(EXPECTED_LINES.length);
    expect(EXPECTED_LINES).toHaveLength(700);
  });

  it("reproduces published TEME position/velocity within 2e-7 on every data row", () => {
    const regenerated = regenerateAllRows();
    expect(regenerated).toHaveLength(EXPECTED_LINES.length);

    let compared = 0;
    let worstDelta = 0;
    let worstLine = -1;
    let previousDataLine: string | null = null;

    for (let i = 0; i < EXPECTED_LINES.length; i++) {
      const expected = EXPECTED_LINES[i] ?? "";
      let actual = regenerated[i] ?? "";

      if (actual === "(Use previous data line)") {
        expect(previousDataLine, `line ${i + 1}: substituted row needs a prior data row`).toBeTruthy();
        const fields = (previousDataLine as string).trim().split(/\s+/);
        actual = "        0.00000000" + " " + fields.slice(1).join(" ");
      }

      if (/^\d+ xx$/.test(expected.trim())) {
        // Section header: satnum must match.
        expect(actual.trim()).toBe(expected.trim());
        continue;
      }

      const aFields = actual.trim().split(/\s+/);
      const eFields = expected.trim().split(/\s+/);
      expect(aFields.length, `line ${i + 1}`).toBeGreaterThanOrEqual(7);
      expect(eFields.length, `line ${i + 1}`).toBeGreaterThanOrEqual(7);

      for (let k = 0; k < 7; k++) {
        const a = Number(aFields[k]);
        const e = Number(eFields[k]);
        if (!Number.isFinite(a) || !Number.isFinite(e)) continue; // date tail text
        const delta = Math.abs(a - e);
        if (delta > worstDelta) {
          worstDelta = delta;
          worstLine = i + 1;
        }
        expect(delta, `line ${i + 1} field ${k}: ${a} vs ${e}`).toBeLessThan(TOLERANCE);
      }
      compared++;
      previousDataLine = actual;
    }

    // The suite must exercise rows across the file, not silently compare nothing.
    expect(compared).toBeGreaterThan(600);
    // Report the observed worst-case spread in the failure message if it ever trips.
    expect(worstDelta, `worst delta on line ${worstLine}`).toBeLessThan(TOLERANCE);
  });
});
