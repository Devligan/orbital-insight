# Orbital Insight — Independent Engineering Audit

Audit date: 2026-10-13. Performed as a production-readiness review of the
repository in this workspace, treating the code as unfamiliar. All results
below come from commands actually executed during the audit; exit codes are
shown for every gate. Nothing was projected or fabricated.

---

## A. Executive summary

> **Addendum (final pre-deployment verification, same day):** a closing
> verification pass re-ran the controllable checks (§G), executed the
> optional live-provider test against the real network (pass, 433 ms),
> closed the two biggest §A risks with new evidence — the WebGL-failure 2D
> fallback and the compare-page flow are now **Verified** by real-browser
> e2e journeys — and *observed* provider-failure handling live during a real
> CelesTrak outage (typed 502, honest error panels, no fabricated data).
> The repository was also committed as a git checkpoint after a staged-diff
> secret scan (clean). Supabase RLS stayed **statically reviewed only** (no
> docker/DB available) and deployment stayed **not performed** (no Vercel
> credentials); exact remaining steps are in §H.

The application is substantively correct, honest about its limits, and
deployable on the intended free tier after this audit's fixes. The core
scientific claim — SGP4 propagation agreeing with the official Vallado
verification suite across 700 published rows at the upstream tolerance — was
re-verified during the audit and stands. The independent audit found and
fixed: an unbounded pass-prediction compute request (measured 10.99 s worst
case, at risk of exceeding Vercel Hobby's 30 s request ceiling), a ground-track
window whose request-time extent contradicted its "next 24 hours" label, an
application-layer boundary violation (direct satellite.js use duplicating a
domain conversion), inconsistent antimeridian-boundary conventions between the
radians and degrees longitude normalizers, and dead code. CSV export was
upgraded from "code exists" to **Verified** via a real browser-download test.

Biggest remaining risks, in priority order:

1. **Snapshot comparison has never been exercised against a live Supabase
   instance** (no credentials in this environment). The code, migrations, and
   dedup constraint are implemented, but its end-to-end behavior — including
   RLS — is marked *Not verified*, not *Verified*.
2. **The WebGL-failure swap-in of the 2D ground track has not been observed in
   a real browser** (CI Chromium has WebGL; forcing the path in the e2e suite
   fell outside this audit). Classified *Partially verified* with a manual
   procedure in the matrix.
3. **Deployment has not been performed** (no Vercel credentials available).
   Sections G/H list the exact steps that remain.

Not a risk: nothing was found that fabricates data, silently degrades to fake
success, or presents predictions as measurements. Provider failures surface as
typed errors or clearly-labelled stale data.

## B. Quality-gate results (baseline, before audit fixes)

| Command | Exit code | Notes |
| --- | --- | --- |
| `git status --short` | 0 | clean working tree at audit start (no pre-existing uncommitted edits) |
| `npm ci` | first run **127** (EPERM unlink of `next-swc.win32-x64-msvc.node` — binary held open by a stale `next start` process from the authoring session); after killing stale dev servers, **0** | environment issue, not a project defect; reproducible-from-lockfile install confirmed |
| `npx eslint .` | 0 | 9 warnings, 0 errors |
| `npx tsc --noEmit` | 0 | strict typecheck clean |
| `npx vitest run` | 0 | 41 passed / 1 skipped (the optional live-provider test) |
| `npm run build` | 0 | 12 routes compiled |
| `npx playwright test` | 0 | 7 passed against the production build (`next start`) |

The `npm ci` EPERM was *not* counted as a project failure: it reproduced only
because authoring-session dev servers still held the Windows file lock.

## C. Findings

Severity contexts: *Critical* would fabricate scientific results, leak
secrets, or corrupt user persistence. *High* would mislead users about data
meaning or fail on the target free tier. *Medium* materially degrades
reliability or honesty. *Low* is hygiene.

### C1. Unbounded pass-prediction compute — **Medium — FIXED**

- **File:** `src/server/analysis.ts` (`computePasses`), `src/app/api/passes/route.ts`
- **Evidence:** worst legal request (25 satellites × 720 h = 18,000
  satellite-hours, 30 s sweep = ≈2.16M SGP4+look-angle evaluations) measured
  **10.99 s** end-to-end against the production build via `curl
  -w "time_total=%{time_total}s"` on a warm cache (2026-10-13, dev-class CPU).
  Vercel Hobby enforces `maxDuration` ≤ 30 s, and cold instances are slower;
  additionally the request may include up to 25 uncached provider lookups
  (client throttles at 2 s spacing ≈ up to 50 s).
- **Impact:** guaranteed failed/aborted pass predictions for large windows;
  a slow-instance request could be silently cut off mid-computation.
- **Fix:** compute budget `satelliteCount × windowHours ≤
  PASS_SEARCH_MAX_SATELLITE_HOURS (720)` validated in the service layer with
  a plain-language 400 (`"compute-bounded: …"`); the UI default (≤ 5
  satellites × 24 h = 120) is unaffected.
- **Verification:** unit regression test asserts rejection with
  `details: { budget: 2160, max: 720 }` and acceptance at 600 sat-hours;
  e2e journey types 25 IDs × 720 h into the real UI and asserts the
  explanatory error message appears.

### C2. Ground-track window mislabeled ("next 24 hours" covered −2 h→+22 h) — **Medium — FIXED**

- **File:** `src/server/analysis.ts` (`computeGroundTrack`), `src/app/satellites/[satelliteNumber]/page.tsx`
- **Evidence:** `start = new Date(Date.now() - 2 * 60 * 60 * 1000)` with a
  comment calling it a "slight back-cast"; the detail page Chart header read
  "Ground track — next 24 hours (predicted)". The window actually spanned
  [now−2 h, now+22 h].
- **Impact:** chart extent did not match its stated window; erodes the data
  honesty the UI otherwise maintains.
- **Fix:** default start is now the request time; the back-cast was removed
  (its stated benefit was speculative).
- **Verification:** code review; e2e detail-page journey still passes
  (chart/data flow unchanged); label and window now agree by construction.

### C3. Application layer imported satellite.js directly — **Low — FIXED**

- **File:** `src/server/analysis.ts`
- **Evidence:** `import { eciToEcf, gstime } from "satellite.js"` mid-file;
  `samplePositions` re-implemented TEME→ECF that the domain module
  `src/domain/orbit/coordinates.ts` (`temeToEcf`) already owns. Works, but
  puts vendor API surface inside the application layer, duplicating a domain
  operation.
- **Fix:** `samplePositions` now calls the domain `temeToEcf`; the
  satellite.js import was removed from `src/server/analysis.ts`.
- **Verification:** typecheck + full test suite; boundary restored
  (application layer touches only domain exports).

### C4. Inconsistent antimeridian-boundary conventions — **Low — FIXED**

- **File:** `src/lib/units.ts`
- **Evidence:** `normalizeLongitudeDeg` maps −180°→+180° (documented
  (-180, 180] convention), but `normalizeLongitudeRad` returned −π for
  boundary inputs — two callers fixing a point 360° apart depending on which
  helper they used. Found by a new property test; the radians test initially
  failed.
- **Fix:** radians variant now normalizes into (−π, π] with the same boundary
  mapping.
- **Verification:** `tests/unit/coordinates.test.ts` longitude-wrapping tests
  (passes after fix).

### C5. Dead code — **Low — FIXED**

- **Files:** as listed.
- **Evidence:** grep across `src/` — no callers for any symbol below.
- **Removed:**
  `src/domain/orbit/vectors.ts` (entire module, zero imports),
  `passSearchSpanMs` (finder),
  `lookAngleFromTeme`, `geodeticPositionToEcf` (coordinates),
  `fetchSatcat` + `SATCAT_URL` (provider client; existed only with a test
  stub), `SatelliteAnalysisResult` (analysis), and `julianToMs` demoted to a
  private function (was exported without external users).
- **Verification:** typecheck + lint + full suite after removal.

### C6. CSV-export e2e race (test defect, not app defect) — **Low — FIXED**

- **File:** `tests/e2e/journeys.spec.ts`
- **Evidence:** the download listener was attached *after* clicking Export;
  the download fires synchronously with the click, so the first e2e run
  failed with `TimeoutError … waiting for event "download"`.
- **Fix:** register `page.waitForEvent("download")` before the click.
- **Verification:** e2e suite passes (9/9), the download filename assertion
  now actually exercises `exportCsv` in a real browser.

### C7. `npm ci` EPERM on Windows — **Low — Environmental, not fixed (not applicable)**

- Stale authoring-session dev servers held `node_modules/@next/swc-…/next-swc…node`
  open. Resolved by terminating them; `npm ci` exit 0 afterwards. No code
  change; nothing to fix in the project beyond documenting reproducible
  server hygiene (dev servers should be stopped before reinstalling).

## D. Feature verification matrix

See the README ("Feature verification matrix") — the audit-maintained table
with per-feature status and evidence. Summary counts after the closing
verification pass: **Verified: 14 · Partially verified: 1 · Not verified: 1 ·
Broken: 0 · Not implemented: 0** (for advertised features). The remaining
"Partially verified" entry (3D globe pixel-level rendering) and the "Not
verified" entry (snapshot comparison end-to-end, which requires a configured
Supabase database) list their exact remaining procedures in that table.

## E. Scientific validation report

### E1. SGP4 propagation vs. the official verification suite — **PASS**

1. **Tested:** SGP4 TEME position (km) and velocity (km/s) at epoch-sky
   offets from 0 to thousands of minutes, for 33 element sets, including
   propagated failures and decay cases.
2. **Reference:** the official SGP4 verification data published with
   Vallado's reference implementation — `SGP4-VER.TLE` + expected-output
   `tcppver.out` — mirrored by the python-sgp4 project
   (github.com/brandon-rhodes/python-sgp4, `sgp4/tests.py`).
3. **Actual result:** end-to-end regeneration of all **700** published
   output rows (including the "(Use previous data line)" failure
   substitutions and per-satellite error-stop semantics, ported from the
   upstream harness) — every one of the first seven numeric fields of every
   row agreed within the bound; 50 tests currently green across the suite.
4. **Tolerance:** `|Δ| < 2e-7` per field — the same bound python-sgp4 applies
   to its own comparison against these files; it exists because the printed
   values carry 8 decimals while compilers round differently at the bit
   level. Our observed agreement is tighter than the bound.
5. **Status:** **PASS**. Source-of-truth independence: expected values come
   from the published file, never from our own implementation.

### E2. TLE parsing, checksum, epoch semantics — **PASS**

1. **Tested:** fixed-column parsing, modulo-10 checksums over columns 1–68,
   cross-line catalog-number consistency, epoch conversion.
2. **Reference:** the TLE format definition in CelesTrak's GP data
   documentation; checksum rule applied arithmetically (('=' and '-') per the
   published rule) — fixtures derived from the verification TLE with
   independently recomputed checksums (`tests/helpers/tles.ts`).
3. **Actual result:** valid lines parse; every malformed variant
   (bad checksum, short lines, line-number/music mismatch, inconsistent
   catalog numbers) is rejected with a typed validation error.
4. **Tolerance:** exact (checksum arithmetic and ISO-millisecond comparison;
   JS `Date` precision truncates sub-millisecond epoch digits — asserted
   explicitly in the test).
5. **Status:** **PASS**.

### E3. TEME→ECF frame conversion — **PASS by property, cross-check partial**

1. **Tested:** rotation invariance across 48 samples over a full day of a
   real element set.
2. **Reference:** mathematical property — TEME→ECF is a rotation about the Z
   axis (by Greenwich sidereal time), and rotations preserve vector length:
   ‖r_ECF‖ must equal ‖r_TEME‖ to floating-point precision. This property is
   implementation-independent and does not use satellite.js output as its own
   reference.
3. **Actual result:** relative norm error < **1e-9** at every sample.
4. **Tolerance:** 1e-9 relative (machine-epsilon scale).
5. **Status:** **PASS** (property). Honest note: absolute ECF values were not
   compared against an independent geodesy/greenwich-time reference
   implementation — the GMST source is the same library. Marked
   **cross-check partial**; no independent second implementation was run.

### E4. Topocentric look angles — **PASS by property**

1. **Tested:** elevation from an observer exactly at the sub-satellite point;
   elevation bounds in pass results; LEO altitude-vs-geocentric-radius
   envelope (≤ 21.5 km ≈ the ellipsoid-flattening difference).
2. **Reference:** geometric symmetry (the radial look vector must yield 90°
   elevation), not another implementation.
3. **Actual result:** elevation = 90° within 0.01°; pass apex bounds hold
   (0–90°, ≥ cutoff); altitude envelope holds.
4. **Tolerance:** 0.01° for the symmetry property; envelope per E.
5. **Status:** **PASS** (property). Absolute azimuth consistency relies on
   satellite.js's north-referenced convention; verified self-consistent
   between rise/set/apex samples in the pass-output order, not against an
   independent geodesy reference.

### E5. Ground-track dateline handling — **PASS**

1. **Tested:** synthetic tracks crossing the antimeridian (once and twice),
   monotonic tracks, negative-direction motion, empty input.
2. **Reference:** the definition of the cut (raw longitude delta ≥ 180°
   between 30 s-spaced samples is a wrap, not motion) — a definitional check,
   with the edge points placed at the correct side of the frame.
3. **Actual result:** segments split exactly at crossings, edge longitudes
   ±180° placed on the appropriate side; no segment spans the frame.
4. **Tolerance:** exact.
5. **Status:** **PASS**.

### E6. Pass prediction semantics — **PASS (behavior), independent cross-check partial**

1. **Tested:** pass ordering and apex above cutoff; higher cutoff ⇒ fewer
   passes; truncation marking for passes open at window start/still in
   progress at window end; per-satellite propagation-failure reporting;
   invalid-window/threshold rejection.
2. **Reference:** internal geometric self-consistency plus a manual
   elevation-vs-time probe of the same TLE computed independently in a
   scratch script during this audit (elevations of −60.5°→+48.1°→−22.6°… over
   4 h for Vanguard 1 at lat 28/lon −80, matching the detected pass apex
   window).
3. **Actual result:** all behavioral assertions hold; live ISS × Florida
   prediction (real provider, real HTTP) produced physically plausible
   rise/max/set with azimuths (apex 42.08°).
4. **Tolerance:** behavioral (ordering, bounds), not a fixed numeric one.
5. **Status:** **PASS**. Absolute timing cross-check against a second,
   independent pass-prediction implementation was **not** performed in this
   audit (e.g., ephemeris from Heavens-Above) — marked **cross-check
   partial**. The rise/set bisection converges to < 1 s by its declared
   tolerance (500 ms).

### Explicitly unverified assumptions

- **WGS-72 geodetic conversions** (`eciToGeodetic`): validated by property
  tests (E3/E4 envelopes) and consistent use, not against an independent
  geodesy reference; the ~100 m geoid-vs-ellipsoid treatment of observer
  height is documented, not independently measured.
- **Pass timing vs. operational ephemeris**: no external, live-verified
  referencing of pass times to a third-party service was performed during the
  audit.
- **RLS behavior of the watchlist migrations** — policy text reviewed against
  the migrations; not executed against a live Supabase instance.

## F. Architecture assessment

Verified dependency direction (traced): `src/app` (pages/route handlers) →
`src/features` (UI/workflow) → `src/contracts` + `src/server` services →
`src/domain/orbit` + `src/domain/passes` (pure) → `src/integrations/sgp4` /
`src/integrations/celestrak`. The orbital domain compiles and runs with zero
React/HTTP/DB involvement; all 50 domain/service tests execute in plain Node.

- **Boundaries that hold:** the Celestrak integration is the sole touchpoint
  for the provider (parsing, validation, throttling, failure mapping); the
  SGP4 adapter is the only satellite.js importer; route handlers are thin
  (validate → service → respond) and the largest handler is a Zod schema plus
  a service call.
- **Violations found and fixed:** the application-layer direct satellite.js
  import (C3).
- **Maintainability observations (accepted, documented):** the domain finder
  and analysis service are the two largest modules (≈250 and ≈330 lines) but
  each owns a single cohesive responsibility; splitting them further would
  scatter the pass-search algorithm without improving testing (they are
  already unit-testable without UI or network).
- **Circular dependencies:** none found (grep-based check of module imports;
  the earlier mid-file import anomaly was removed with C3).

## G. Final verification (after fixes)

Every gate re-run after the fixes, with exit codes:

| Command | Exit code | Result |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 | clean |
| `npx eslint .` | 0 | 0 errors, 9 warnings (unused-import style hints in test scaffolding) |
| `npx vitest run` | 0 | **50 passed / 1 skipped** (new: pass-budget, comparison-identity, coordinate-property, longitude-boundary tests) |
| `npm run build` | 0 | compiled successfully, 12 routes |
| `npx playwright test` | 0 | **9 passed** (pass-budget e2e + CSV-download e2e added) |
| `npm ci` | 0 | reproducible install from lockfile (baseline run) |

Failures encountered and resolved during the audit are itemized in §C
(C1–C6). No gate failure remains unresolved.

### G1. Final pre-deployment verification (closing pass, addendum)

| Check | Result | Receipt |
| --- | --- | --- |
| `npx tsc --noEmit` / `npx eslint` (after each test edit) | 0 / 0 | repeated four times |
| Optional live-provider test executed (not skipped-blind): `RUN_LIVE_TESTS=1 npx vitest run tests/integration/celestrak-live.test.ts` | **pass, 433 ms** | real ISS record, epoch age < 30 d |
| 2D WebGL fallback e2e (WebGL contexts forced to fail in real Chromium) | **pass** | journey uses `addInitScript` to null every `getContext("webgl*")`; asserts the computed 2D ground track swaps in |
| Compare-page flow e2e | **pass** | both defaults load, `.recharts-wrapper` renders, interpretation notes visible |
| Provider-failure handling, observed **live** during a real outage | **verified** | CelesTrak returned HTTP 403 to this IP; app API answered `502 {kind:"provider", "CelesTrak returned HTTP 403"}` (curl receipt); `/satellites/25544` SSR'd the honest "Satellite data unavailable — shown honestly" panel; new provider-state-agnostic e2e journey passed in 13.6 s |
| Search journey during the outage | **blocked externally** | no options rendered; API 502 receipt above; same build had passed this journey when the provider was healthy earlier the same day |
| Chunk-load anomaly in one reused-server run | **transient infrastructure artifact** | `Loading chunk 782 failed` reproduced only against a stale `next start` process; a fresh manual server served the same chunk `HTTP 200` and the test passed afterwards; chunk file exists in the committed build |
| Supabase migrations + RLS policies, static review | **done, runtime not claimed** | 0001: `orbital_snapshots` RLS enabled with **no policies** → deny-all for anon/authed; only service role (RLS-bypassing) writes. 0002: `watchlist_items` full owner-only policy set (`select/insert/delete/update` all scoped by `auth.uid() = user_id`; insert/update use `with check`). No defect found statically |
| Vercel availability check | **blocked** | `vercel` CLI absent; no `VERCEL_TOKEN`/org/project env vars in this environment |
| Docker availability check | **absent** | no local Supabase/policy execution possible |
| Git checkpoint | **created** | repository was not a git repo; `git init -b main`; `.gitignore` verified to exclude `node_modules`, `.next`, `.env*`, `test-results/`, build assets; staged tree = 77 files (src/tests/config/docs only, zero generated artifacts); regex secret scan over the staged diff = no hits; commit `3230295` |

Scope of the closing pass: exactly two test-only fixes (a too-loose fallback
assertion regex; a file-formatting blemish) and one new e2e journey
(provider-failure handling). No application code changed in the closing
pass; the earlier audit fixes (C1–C6) are unchanged and their gates were
re-run above.

## H. Deployment readiness

The project is deploy-ready under the intended free-tier configuration; the
following steps have **not** been executed in this environment (no
credentials) and complete the deployment:

1. `npm i -g vercel && vercel link` in the repository root.
2. `vercel deploy --prod`. Region choice mostly irrelevant; no KV/queue
   needed. No cron jobs, no Always-On features required.
3. **Required/optional environment variables:**
   - *None required* — the read-only demo boots with no configuration.
   - For persistence: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
     (server-side only), `SUPABASE_ANON_KEY` (user watchlists). Never commit
     them; set only in the Vercel project env.
4. **Database:** create a Supabase project → run
   `supabase db push` to apply `supabase/migrations/000[12]_*.sql`
   (snapshots with `(satellite_number, epoch)` dedup; watchlists with
   owner-only RLS) → set the env vars.
5. **Known external-data risks for a public deployment:**
   - CelesTrak throttling: the in-process cache (2 h TTL) and ≥ 2 s outbound
     throttle bound usage, but multiple concurrent cold instances can still
     duplicate fetches; monitor for `provider/rate-limited` responses.
   - CelesTrak's live behavior was verified against the *current* interface
     (`/NORAD/elements/gp.php`, case-sensitive `CATNR/GROUP/NAME`, 404-style
     "no match" answers); a provider interface change will surface as typed
     `provider` failures, which the UI renders as retry-able errors rather
     than fake data.
   - Per-instance caching means the first request after a cold start may pay
     up to ~15 s of provider latency (timeouts at 15 s, then a clear error).
6. **Post-deploy smoke test:** hit `/api/satellites/25544` and confirm
   `lineage:"live"` + today's epoch; run `RUN_LIVE_TESTS=1 npx vitest run
   tests/integration/celestrak-live.test.ts` locally against the deployed
   API if desired.

### Items a deploying engineer must not skip reading

- The UI is a *prediction* tool: the methodology page states this and the
  feature matrix marks the unverified paths. Public deployment should keep
  the "not for collision avoidance or safety-of-life" statements visible.
- Windows development quirk (C7): stop dev servers before `npm ci` to avoid
  the file-lock EPERM.
- **Remaining steps in one place (what this workspace could not run):**
  1. *Deployment requires Vercel credentials:* install the CLI
     (`npm i -g vercel`), `vercel link`, set `SUPABASE_*` only if persistence
     is wanted, then `vercel deploy --prod`. No deployment was attempted:
     neither the CLI nor any token exists in this environment.
  2. *Supabase runtime RLS verification requires a database:* create the
     Supabase project, `supabase db push`, then execute the documented policy
     tests — with the anon key, attempt (a) reading another user's rows
     (expect: empty), (b) inserting a row carrying someone else's `user_id`
     (expect: RLS violation), (c) anonymous reads of `orbital_snapshots`
     (expect: empty; write only via service role). Not executed here: no
     docker and no credentials; only the static review in §G1 was done.
  3. *Provider rate-limit recovery:* CelesTrak throttled this IP (403) after
     the audit's many real fetches; the app handled it per design (typed
     errors, honest panels). Before re-running provider-dependent e2e
     journeys, confirm the provider answers again (e.g.
     `curl /api/satellites/search?q=ISS`).
