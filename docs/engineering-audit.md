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
| Full e2e suite re-run on closing day (provider still down) | **5 passed / 6 externally blocked** | the six failures are exactly the live-provider-dependent journeys; detail API answered `502 {"kind":"provider","message":"Could not reach CelesTrak"}`; a direct machine-to-CelesTrak probe timed out after 20 s (`curl` exit 28) — the upstream was genuinely unreachable from this network, not an app defect |
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

### G2. Search-speed and wow-surface upgrade (same day, post-deployment)

Driven by two user-reported weaknesses with receipts: (1) cold-instance
search cost **7.68 s** (measured on production) because the response waited
on a chain of throttled provider fetches; (2) the WebGL-failure fallback
globe engaged slowly and nondeterministically because the honest fallback
message only appeared after the multi-megabyte Cesium module and imagery
provider finished loading and failing.

Fixes (code committed `4d8e5aa`):

- **Build-time catalog snapshot** (`npm prebuild` →
  `scripts/build-search-index.mjs` → `src/server/search-index.static.json`,
  128 entries across the four bounded curated groups, real TLE element sets
  included). The server seeds its caches from the snapshot at startup:
  search, detail-for-curated-objects, and overhead answers never wait for a
  provider chain. Snapshot data is labelled honestly — "cached", never
  "live" (via `fromSnapshot`) — and the provider still refreshes the same
  groups quietly in the background.
- **`/api/overhead`** — reuses the production-validated SGP4 → TEME→ECF →
  look-angle chain to answer which crewed stations and HST are above an
  observer right now; per-candidate failures are skipped, never fabricated.
- **Explorer landing surface** — new "What's above you now" widget
  (geolocation with a manual-coordinate fallback, 60 s auto-refresh).
- **WebGL preflight + sticky fallback** — a throwaway canvas probe runs
  before the heavy Cesium module is imported; machines without a GPU stack
  engage the fallback instantly, and it stays engaged for the session
  (WebGL availability is a machine property, not a satellite property — the
  earlier per-satellite reset left such sessions stuck on the loader
  permanently).

Receipts after the upgrade:

| Check | Result |
| --- | --- |
| Cold search on production, immediately after deploy | **0.68 s** (was 7.68 s) |
| `/api/overhead`, cold, on production | **0.50 s**, honest empty set (nothing above 15° over Florida at that instant — physics, not failure) |
| Full gate re-run | tsc 0 · eslint 0 errors (14 style warnings, matching the build-script console pattern of the pre-existing copy script) · vitest **57 passed / 1 skipped** (new overhead + seeded-search suites) · build 0 (prebuild regenerated the snapshot cleanly) · e2e **14/14 in 17.9 s** |
| Fresh-browser e2e against production | **3/3 in 9.6 s** (seeded-instant search, overhead widget, forced-WebGL fallback) |
| Deployment | `deploy_exit=0`, production deployment `orbital-insight-dh5y6gmtk`; all pages 200; detail 200; honest typed 404 intact |
| Honesty details | search index = public CelesTrak data snapshot (attributed), committed and regenerated per build; explicit `gaps` marker when a group fetch fails at build; unit tests pin selection/filtering/compass/skip semantics |
| Verification notes | two of the new journeys were initially failed by wrong *test-text* probes (the detail page labels lack a trailing colon; a regex collided with sibling texts) — fixed against real page receipts; a stale local server that booted before a rebuild reproduced the user's original chunk-mismatch incident and was replaced (server hygiene item, see C7-pattern) |

### G3. Ground-track entity crash (deployed-site report) — FIXED

A user reported, on production, `DeveloperError: An entity with id
"ground-track" already exists in this collection.` thrown from the globe's
track-update effect. Root cause: the ground-track entity was added with a
fixed id but the track-update effect never removed a stale one, so any data
refresh arriving while the previous entity still lived crashed the Cesium
entity collection and took the page down. A second, silent defect sat on the
same code path: the orbit effect's `removeAll()` (fired on its own
dependencies, e.g. sample-interval changes) also removed the ground-track
line, which was then not re-added until the next track update.

Fix (commit `97a29bc`): remove-then-add makes track updates idempotent (no
exception is possible), and the ground-track effect's dependency set now
includes `sampleIntervalSeconds`, so anything that wipes the entities also
rebuilds the track.

| Check | Result | Receipt |
| --- | --- | --- |
| New crash-regression e2e (rapid switching CSS → NOAA → STARLINK → ISS with a `pageerror` guard) | **pass, local suite 16/16 in 30.2 s** | `playwright_exit=0` |
| New outage console-cleanliness e2e (no unexplained console errors during provider outages) | **pass, same run** | local suite run |
| Production verification in a fresh browser | **4/4 in 14.9 s** | crash journey + real-catalog search + overhead widget + forced-WebGL fallback against `orbital-insight-drab.vercel.app` |
| Deployment | `deploy_exit=0` | production `orbital-insight-8ujt4eydg` |

**G3 addendum — the 2D fallback's prediction-time slider (user report: "sliding the prediction time does nothing").**

Two separate causes, both reconciled with receipts:

1. *Client-side (unchangeable from the application):* the reporter's browser
could not start WebGL, so every load showed the designed fallback — the
documented condition (hardware acceleration / VM / driver blocklist). The
fallback itself is correct behavior.
2. *Real application defect:* the fallback had
made the slider genuinely inert — the plot dropped sample timestamps and
never received the selection, so nothing moved. Fixed (commit `62582a9`,
deployment `orbital-insight-s6iuq0g65`, `deploy_exit=0`): the track plot
gained an absolute `markerPosition` (accent ring at the current
sub-satellite point), the fallback feeds it from the slider selection, and
the caption names the coupling. Receipts: extended fallback e2e asserts the
marker exists and its position changes across the slider range; local suite
**16/16 journeys**; fresh-browser verification against the deployed URL
**2/2 in 11.8 s** (slider-marker behavior + the §G3 crash-regression path).

## G4. User-first UX pass (same day, receipts as above convention)

Scope: the six user-standpoint gaps found in the live product review — location-first
discovery, phone-width pass reading, plain-language labels, shareable moments,
friendlier fallback copy, and an always-visible watchlist affordance.

| Change | Where | Receipt |
| --- | --- | --- |
| "Tonight from your spot": one device-location click → 24 h pass predictions for the curated bright objects, pass cards with local times | `src/features/pass-prediction/tonight-passes.tsx`; shared location state `src/features/observer/use-observer-location.ts` (geolocation prompted once across both panels) | e2e journey grants a fixed geolocation (0°, 0°) and asserts real pass cards or the honest no-pass message: **pass, full suite 19/19 in 4.9 min** |
| Phones read pass *cards* (peak height, compass points, local times); desktop keeps the technical table | `src/features/pass-prediction/pass-cards.tsx` + `/passes` results | phone-viewport e2e (390×844) asserts cards render and the table stays hidden |
| Shareable moments: object encoded in URL via `router.replace(''/?cat=<id>'')`; the prediction instant joins on "Copy share link" | `src/features/satellites/explorer-view.tsx`; deep links `?cat=&t=` reproduce the exact view | share-URL e2e: switch → URL contains `cat=20580`; copy → clipboard contains `cat=20580&t=12`; deep-link reopen → slider starts at 12 |
| Plain-language labels and captions ("Orbit tilt", "Lowest altitude", "One lap around Earth"; honesty line rephrased without losing the prediction-vs-telemetry contract) | `explorer-view.tsx`, `overhead-now.tsx` | existing journeys re-pinned to the new copy; all pass |
| Watchlist star always visible next to the object name (compact ★/☆ toggle) | `explorer-view.tsx` | watchlist journey still green (detail-page save path unchanged) |
| Curated examples kept honest: NOAA 19 (36511) now answers provider `not-found` — replaced with HST (20580), verified live | `explorer-view.tsx` CURATED | `curl /api/satellites/20580` → 200 `"lineage":"live"` |
| Build + environment findings: a background `next dev` watcher (user-started) and a stale `next start` on :3000 were overwriting `.next` under production builds — the source of intermittent `Loading chunk … failed` / `MODULE_NOT_FOUND` failures inside e2e. Cleared before the final gate run; build regenerated from a clean `.next`. | environment | final gates: tsc 0 · eslint 0 errors · vitest 57 passed/1 skipped · build 0 · e2e **19/19 (4.9 min)** |
| Deliberate finding kept in code comments: `window.history.replaceState(null, '', …)` inside the explorer silently broke every later `router.push` (Next Router state wipe) — URL sync now goes through `router.replace` only; the buggy effect was removed after a build-disabled A/B run reproduced the failure and its absence cleared it. | `explorer-view.tsx` comments | search-navigation journey failed with sync on (60 s URL timeout), passed with sync regime changed |

## G5. Consumer-redesign pass (same day, receipts as above convention)

Scope: verdict from the owner — “the plumbing works but the surface looks like an
engineering dashboard” (three location panels fighting on one screen, tech chrome
above the fold, badge clutter, 10 px type). This pass restructured the surface
consumer-first; no data/propagation contracts changed.

| Change | Where | Receipt |
| --- | --- | --- |
| Design system: sane type scale, softer surfaces, real hierarchy (token/class names unchanged so every page benefits) | `src/app/globals.css` | gates re-run after edits |
| App shell: sidebar + tech chrome → simple top nav (“Sky / Passes / Compare / Watchlist”) + honest footer links (methodology, no-navigation disclaimer) | `src/components/app-shell.tsx` | a11y snapshots in failing-test receipts show the new structure |
| One hero: “What's flying over you tonight?” — single location ask (device one-tap or typed coords) answering both “what's up right now” and “when do the bright stations return” | `src/features/tonight/sky-tonight.tsx` (replaces `overhead-now.tsx` + `tonight-passes.tsx`, both deleted) | geolocation journey and manual-coordinates journey pass against it |
| Explorer: friendly headline aside (“About 416–425 km up, one lap every 93 minutes”), provenance link always visible, engineering prose + TLE table demoted into a collapsed “Technical details & provenance” `<details>` | `src/features/satellites/explorer-view.tsx` | e2e journeys updated to open the panel when asserting the data contract |
| Journeys re-pinned to the new surface (locators: role/label-based hero region; collapsed-details opened before epoch assertions; new fallback copy) | `tests/e2e/journeys.spec.ts` | tsc 0 · vitest 57 passed/1 skipped · build 0 · e2e **19/19 (56.9 s)** — all after the edits, nothing skipped |

## H. Deployment readiness

> **Executed 2026-10-14:** authorized by the account owner via a Vercel token
> kept in the gitignored `.env` (never printed, not committed). Project
> linked as `orbital-insight` (`devligan` account); first production attempt
> was **blocked by Vercel's security gate** ("Vulnerable version of Next.js
> detected") against Next 15.5.6 — fixed by the documented remediation,
> upgrading the direct dependency to **next@15.5.27** (exact pin, the
> published security-patch release; audit severity critical → moderate) —
> then all local gates were re-run green (tsc 0, eslint 0/9 warnings, vitest
> **50 passed / 1 skipped**) and the deployment succeeded:
> **https://orbital-insight-drab.vercel.app** (`deploy_exit=0`).
>
> Production smoke tests (curl receipts against the live URL):
>
> | Check | Result |
> | --- | --- |
> | `/`, `/methodology`, `/compare`, `/passes`, `/watchlist` | **200** each |
> | Search API (`/api/satellites/search?q=ISS`) | **200**, real catalog hits, 6.4 s cold start |
> | Detail API (`/api/satellites/25544`) | **200**, `"lineage":"live"` |
> | Passes API (ISS × Florida, 24 h) | **200**, real pass: rise 08:58:28Z → apex **21.1°** 09:01:05Z → set 09:03:43Z — physically plausible |
> | Unknown catalog ID (`…/99999`) | honest **404** `kind:"not-found"`, no fabricated data |
> | Static asset (live-build chunk) | **200**, bytes present |
>
> Note: the earlier local e2e blockage was confirmed *local*: the deployed
> app reaches CelesTrak from Vercel's network while this workspace's direct
> connection did not. The six provider-dependent local journeys still
> re-run when the local network path answers; nothing in the project
> requires changes for them.
>
> **Deployment audit (same day, after a user-reported chunk-load error):
> ** a user's browser reported `Loading chunk 782 failed (missing:
> /_next/static/chunks/2117a04a.dabf5508675aba07.js)` during the same
> minute the production alias was re-pointed at the Ready deployment —
> a tab straddling two deployments (the same chunk-name, changed hash
> suffix per deploy). The audit verified the current state is healthy:
> the exact reported chunk now serves **HTTP 200 (274 kB)**; `vercel ls`
> shows exactly one Ready production deployment (`7hkxv7yaz`) plus one
> blocked-by-security-gate Error build (`bwyc06fr1`), no half-live state;
> and fresh-browser e2e against the live URL passed 3/3 in 11.6 s
> (explorer, detail+provenance, and the forced-WebGL-failure journey —
> which loads the very chunk that 404'd, then exercises the 2D
> fallback). The "WebGL could not start" wording is a separate,
> client-side condition (GPU stack of that browser; hardware-acceleration
> off, VM/remote sessions, or driver blocklists) for which the app's
> computed 2D fallback is the designed and working behavior.

The original readiness assessment (now executed above):

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
