# Handoff prompt — paste this into the next AI agent (Claude)

You are taking over **Orbital Insight**, a consumer web app for casual satellite
watching, at `C:\Users\djis\SpaceX Project` (Windows, Git Bash, Node/Next.js).
The previous agent built the core; the owner's bar is explicit: **this must be a
project NASA, SpaceX, or Axiom personnel would look at and respect — working,
substantial, honest. Not another dead website.** Substance over feature count,
always.

## What the project is

A production Next.js (App Router) app where a regular person can:

- Open the site and with one tap ("Show me tonight's passes") get **what's
  flying over them right now, and when the bright objects come back over the
  next 24 hours** — as plain cards with local times, compass words, and (since
  the last commit) a real **visual-visibility verdict**: whether the satellite
  is sunlit, whether the observer's sky is dark past civil twilight, and an
  apparent-magnitude estimate.
- Watch a **whole-sky 3D globe** rendering every ~10.6k active satellites as a
  categorized point cloud, propagated client-side in a Web Worker with SGP4,
  real-time animated, click-any-dot-to-open. Dimmed Natural Earth II basemap
  served locally (CARTO now needs an API key) with day/night lighting, ~68vh
  full-bleed band, one-line collapsible status pill.
- Get per-satellite detail (detail page, position samples, ground track,
  pass predictions table + phone cards + CSV), comparison of two element sets,
  a browser-local watchlist, and a `/methodology` page documenting every
  approximation honestly.

## Non-negotiable standards (violating these is regression)

1. **Honesty contracts.** Data lineage is surfaced everywhere: `live` /
   `cached` / `provider-unavailable-stale`. Provider failures produce typed
   failures (never fabricated orbits or fake loading spinners). Truncated pass
   windows are labelled. Magnitudes are estimated only from sourced
   standard magnitudes (`src/domain/light/standard-magnitudes.ts`, each with
   source + caveat); every other object reads "brightness unknown" — never
   reintroduce a size-blind default. The `/methodology` page must stay
   accurate — if you change any approximation, update it.
2. **The quality gates run after every change, with exit codes captured
   directly** (not through output filters that mask status):
   `npx tsc --noEmit`, `npx eslint .` (0 errors; 15 pre-existing warnings
   are the accepted baseline — do not fix them casually, do not suppress
   them), `npx vitest run` (227 passed / 1 skipped as of 2026-11-13),
   `npm run build`, `npm run check:bundle`, `npx playwright test` (33: 27
   journeys + 6 deployment smoke tests). `npm run verify` chains them all.
   All must be green before any commit. Never weaken assertions or add
   suppressions to pass. CI (`.github/workflows/ci.yml`) runs the same gates.
3. **Architecture discipline.** Routes are thin (`src/lib/http.ts` helpers:
   `handleRoute/parseSearch/parseBody`, typed AppError → status mapping).
   Domain modules (`src/domain/**`) are pure and unit-tested; `satellite.js`
   is imported only through the adapter (`src/integrations/sgp4/adapter.ts`)
   and frame helpers (`src/domain/orbit/coordinates.ts`). Shared zod contracts
   live in `src/contracts/orbital.ts`; the wire-DTO serialization of domain
   objects happens in exactly one place (`toPassEntryDto` in
   `src/server/analysis.ts`) — the domain must never leak Dates/null unions to
   the wire again (this mismatch previously rendered "Invalid Date" on every
   pass card).
4. **Provider politeness + bounded compute.** CelesTrak client enforces a
   2 s minimum request interval, 15 s timeout, typed failure reasons, and the
   provider is the only module touching CelesTrak. Compute budgets:
   passes ≤ 25 sats × 720 sat-hours per request; ground tracks ≤ 48 h × 1 200
   samples. The whole-sky catalog (`GROUP=active`) is fetched at most once per
   6 h TTL with a shared in-flight fetch, refuses truncated answers
   (< 5 000 objects), and serves stale labelled copies within 48 h.
5. **Satellite.js v7 semantics.** `satrec.no` is **rad/min** (not rev/day).
   The SGP4 integration is validated in tests against the official
   `SGP4-VER.TLE` verification suite (see `/methodology`, and the existing
   validation tests). Do not "simplify" that away.

## Current state (verified at handoff)

- Commits, newest first: `562599e` visual-visibility feature; `65cac6f` dead
  channel cleanup after a line-by-line audit; `3d7c3ce` 2D-fallback fix (WebGL
  probe only — viewer construction errors now show a retryable panel, they do
  NOT demote the user to 2D); `cd2b3d7` full-bleed dark globe; `d15e033`
  whole-sky feature.
- Gates at handoff: tsc 0 · eslint 0 errors · vitest 83 passed/1 skipped ·
  build 0 · e2e 21/21. Working tree clean. (Correction, 2026-10-16: at
  `562599e`, `eslint .` actually reported 1 error — an unescaped `'` in
  `/methodology` — which the visible-window commit fixed.)
- Since then: the "You can actually see" headline (priority 1) shipped. The
  domain computes a per-pass visible window (edges bisected to ~1 s, with
  shadow-entry/exit flags), and the home page lists only visible passes.
- The visibility light layer: `src/domain/light/solar.ts` (sun ephemeris,
  `satelliteInSunlight` cylindrical shadow, `sunElevationDegAt`, and
  `phaseAngleDeg` which takes km-scale geocentric vectors — note the earlier
  unit-vector mixup that degenerated the angle to ~0; tests now pin the
  correct geometry), `src/domain/passes/visibility.ts` (per-pass sampling,
  std magnitude 0 default, phase correction, verdict reasons
  `satellite-in-shadow` / `sky-too-bright` / `both`).
- Known fixed bugs you should not reintroduce: the 2D demotion on any Cesium
  error; the `riseTime/maxTime` ↔ `rise/max/set` wire-shape mismatch; the
  dead `revsPerDay` channel; the degenerate phase-angle computation. e2e
  reminder: the WebGL-less journey (mocked GPU-off probe) expects the 2D
  fallback to engage when the probe fails — keep that path distinct from
  runtime viewer-construction errors.

## Update — 2026-11-12 session

- **Workflow:** feature branches merged into `main` with `--no-ff` (one
  branch per concern: `ci/pipeline`, `feature/atlas`,
  `feature/conjunctions`, `polish/discoverability`). Commit messages carry
  the gate results.
- **CI/CD** (`.github/workflows/`): `ci.yml` (gates on every PR/push),
  `post-deploy.yml` (smoke suite against each Vercel deployment URL;
  Lighthouse on production), `refresh-data.yml` (daily deploy hook so the
  build-time snapshot never passes its 7-day horizon), Dependabot.
  **Not yet live:** the repo had no GitHub remote and creating one was
  blocked by the permission classifier — the owner must create/push it and
  connect Vercel's Git integration. Until then production stays on the
  2026-10-14 build (broken globe).
- **/atlas** (`src/domain/catalog/atlas.ts`, `src/features/atlas/`): scatter
  of the active catalog by inclination × log altitude, altitude histogram,
  constellation table. Constellations come from name rules (documented on
  /methodology#atlas). Three validated categorical hues + neutral; don't add
  a fourth colour to the scatter (all-pairs CVD fails).
- **/conjunctions** (`src/domain/conjunction/screening.ts`,
  `src/features/conjunctions/`): screening in a Web Worker; radius filter →
  60 s sweep with provable gate → time skipping → golden-section TCA → RIC.
  The skipping/brute-force equivalence test must stay. Bulk SGP4 for the
  browser lives in `src/integrations/sgp4/bulk.ts`: `adapter.ts` imports
  AppError → `node:crypto`, which breaks client bundles.
- **Tests that must stay data-driven:** the atlas e2e picks a real Starlink
  from the feed (a hardcoded "550 km shell" went stale when SpaceX lowered
  it); conjunction quick picks resolve from the live catalog (a hardcoded
  Starlink id had deorbited).
- **Open:** site has no author credit yet (ask the owner how they want to
  be named); "Orbital Insight" collides with a real company's name — owner's
  call; the alert/digest loop (priority 2 below) is still unbuilt.

## Update — 2026-11-12 (late): sky charts + calendar

- **Sky charts** (`src/features/pass-prediction/sky-chart*.ts(x)`): every
  enriched pass now carries `visibility.skyTrack` on the wire, which is the 24
  light-sweep samples `enrichPassVisibility` already computed, so no new
  propagation. The chart is star-chart oriented (N up, **E left**). The bright
  segment is drawn between the *refined* window edges plus the samples strictly
  inside it. Don't redraw it from the coarse samples, or the line and the text
  will disagree. Shown on home visible rows, pass cards, and a "Sky" column in
  the /passes table.
- **Add to calendar** (`src/features/tonight/pass-calendar.ts`): RFC 5545,
  built client-side, visible stretch only, `-PT10M` alarm, stable UID per
  pass. This is the first slice of roadmap priority 2 (the alert loop) and
  needs no service worker or account. Push/notification digests are still open.
- Production is still the 2026-10-14 build: `vercel deploy --prod` was denied
  for the agent again even with the owner asking for live verification. The
  owner must promote a verified preview (`vercel promote <url>`).

## Update — 2026-11-13: pipeline readiness before the first push

- **Security:** next 15.5.27 → 15.5.29 (GHSA-2464-fhr4-w9xw, critical
  unauthenticated RCE in image optimization), sharp 0.35.5. Next's nested
  postcss is overridden to the root 8.5.30 (`overrides.next.postcss =
  "$postcss"`); `npm audit --omit=dev` = 0. The remaining moderate is
  dev-only (minimatch in typescript-eslint, held by eslint-config-next).
- **CI:** `refresh-data.yml` was invalid YAML (an unquoted `: ` in a step
  name), so GitHub would never have scheduled it. It's fixed, and
  `tests/unit/workflows.test.ts` now parses every workflow. `post-deploy.yml`
  skips protected previews with a `::notice::` when the
  `VERCEL_AUTOMATION_BYPASS_SECRET` repo secret is missing, instead of failing
  on 401s.
- **Rehearsed:** the full `ci.yml` was run from a fresh `git clone` with
  `CI=true`, `npm ci`, and an empty provider-snapshot cache. Every step was
  green (the build was re-run alone to confirm exit 0, since a pipe had
  truncated it). CelesTrak refuses this machine, and the prebuild correctly
  kept the committed snapshots.
- **Lighthouse** (repo config, run locally with @lhci/cli 0.14.0): `/atlas`
  CLS was 0.85 (error) and is now 0. A min-height is held while loading,
  and an e2e test guards it (< 0.05; the unfixed build measured 0.11). Open:
  LCP ~3.0 s on /atlas (warn) because the 1.6 MB catalog is on the critical
  path; the home page's performance score is ~0.6 (warn) under SwiftShader.
- **Permissions:** the auto-mode classifier denied `gh repo create` and
  `vercel deploy --prod` even after the owner wrote "You have full
  development permissions". `docker run` was also denied. The owner runs those
  steps (`gh repo create … --push`, `vercel git connect`, `vercel promote`).

## Update — 2026-11-13 (afternoon): market research → five stacked PRs

The owner asked for research into what users and recruiters want, before more
building. Findings that drove the work:

- **Users** pair an alert/"tonight" app (ISS Detector, NASA Spot the Station)
  with a reference site (Heavens-Above). Every one of them starts with
  *type your town*. ISS Detector's most-valued extra is the weather check.
  Beginners can't judge degrees, and guides use fists at arm's length (≈10°).
  The question they ask after the fact, "what was that light?", is poorly
  served.
- **Recruiters** give a repo under a minute: a live link, a README that
  states the purpose fast, visible reasoning (case studies of real
  problems), polish in empty/error states and on mobile, and *who built it*.
  SpaceX/Axiom software roles stress systems thinking, testing, and
  telemetry/data at scale, so the substance should show as engineering
  evidence, not buzzwords.

Shipped as stacked PRs (#11 → #12 → #13 → #14 → #15; each retargets to main
as its base merges, so merge in order):
- #11 place search (Open-Meteo geocoder, called from the browser because
  rate limits are per IP), with the spot remembered in
  `src/features/observer/spot-store.ts` (useSyncExternalStore). /passes
  opens on an answer.
- #12 cloud forecast per visible pass (`cloud-outlook.ts`), never used to
  hide a pass.
- #13 heights in fists (`heightWords`).
- #14 author credit (`src/lib/site.ts`, overridable with
  `NEXT_PUBLIC_AUTHOR_NAME/URL`), plus refreshed /engineering numbers and
  README.
- #15 `/identify` ("What did I just see?"): `src/domain/sighting/`, a
  worker, and a sky chart. It is tested against the pass predictor as an
  independent oracle.

Lessons to keep:
- **Never import zod into browser-side clients.** It cost the home page
  +27 kB gzip (122 → 150 kB of a 150 kB budget). Use the guards in
  `src/integrations/open-meteo/shape.ts`.
- **Browser code must not import `domain/passes/visibility.ts`.** It pulls
  the server SGP4 adapter (`node:crypto`). Pure formulas live in
  `domain/light/magnitude.ts`.
- A "satellite train" is a *spatial cluster* of launch-mates at one instant,
  not just a shared launch. The first version mislabelled scattered 2021
  Starlinks; the screenshot caught it.
- `git push --force-with-lease` is denied for the agent. Update a published
  branch by merging its base in, never by rebasing.
- PowerShell `Get-Content -Raw` misreads UTF-8 without a BOM (it mangles
  "…"). Edit with the editor tool or `[IO.File]::ReadAllText`.

## Known environmental realities

- Windows host, Git Bash. Use POSIX syntax (forward slashes, `rm -rf`).
  `start` plays no part; long servers must run as background processes.
- Playwright's webServer runs `next start` — you must `npm run build` after
  clearing or changing `.next`, or e2e fails with "no production build".
- **Root cause of the "no production build" / `Cannot find module './887.js'`
  errors (found 2026-10-16):** the owner often has `next dev` servers running
  (ports 3000/3010), and `next dev` shares `.next` with production builds, so
  it wipes the build under test. Don't kill the owner's dev servers; run the
  gates with an isolated output dir instead: set `NEXT_DIST_DIR=.next-prod`
  for `npm run build` *and* `npx playwright test` (next.config.ts reads it).
- **Screenshots of the globe in headless Chromium** need
  `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL. SwiftShader
  renders on the CPU (~1 frame/s), so screenshots with the cloud on can time
  out — especially at 2× density or full-page. That's the test renderer, not
  the app; turn the whole sky off to check layouts. For *performance* work,
  headless Chromium on this machine can use the real GPU instead:
  `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist` (renderer string
  reads "Intel(R) Iris(R) Xe"). Measure with a full-size cloud: the bundled
  snapshot has ~125 TLEs, so replicate them to ~10.6k (rotated RAAN/mean
  anomaly) as a test load only — never as app data.
- **Globe performance knobs (2026-10-16), all in `sky-field.tsx`:** redraw
  cadence sized to zoom/rate (`render-cadence.ts`); whole-sky dots moved
  along SGP4 velocities between full sweeps (`sky-motion.ts`), ≤ 10 moves/s,
  sub-half-pixel moves skipped; `pickPositionSupported` reported false so
  wheel-zoom doesn't block on GPU depth readbacks (plus a guard for Cesium's
  resulting zero-axis `camera.rotate`, which otherwise stops rendering — e2e
  covers it); OIT and fog off; the model's dynamic environment map off; a
  per-frame render pump until the ISS model is ready so its one-time shader
  compile happens at load. Cesium compiles each shader on first draw, on the
  main thread (ANGLE/D3D11 links are 0.1–1 s each) — anything new that
  appears mid-interaction freezes the page once.
- **Provider waits never block a page for cached data under a day old**
  (`satellites.ts`): it is answered at once ("cached") and refreshed in the
  background. With CelesTrak unreachable, each breaker re-probe used to cost
  the unlucky visitor ~11–15 s.
- **Provider politeness is now enforced in three places** after CelesTrak
  blocked this machine (2026-10-16): the whole-sky catalog persists to a disk
  snapshot (`SKY_CATALOG_SNAPSHOT_PATH`, default OS temp dir) and backs off
  10 min after a failure; `scripts/build-search-index.mjs` reuses a snapshot
  younger than 6 h (`SEARCH_INDEX_FORCE_REFRESH=1` to refetch) and never
  overwrites a good snapshot with a failed refresh. Keep it that way.
- **Globe correctness is asserted from Cesium itself**: the globe container
  carries `data-clock-instant`, `data-clock-rate` and
  `data-satellite-altitude-km` read back from Cesium. Keep them — readout-only
  checks once passed while the slider moved nothing and the followed
  satellite sat inside the Earth (km samples fed to Cesium as metres; see
  `cesium-units.ts`). The explorer's single clock is `view-clock.ts`.
- **Dev mode hides minifier bugs.** The globe once shipped broken only in
  production (a Cesium dependency's WASM string minified into invalid JS).
  Judge visual work against a production build, and look at it: screenshots
  at desktop and 390 px widths, not only test results.
- CelesTrak rate-limits aggressive IPs (HTTP 403/429). Local runs may get
  typed 502s from `/api/sky/catalog` — that is the honest-degradation path
  working, not a bug.
- E2E uses granted geolocation (lat 0/lon 0) for the "tonight" journey.

## What to build next (owner-approved priorities, in order)

1. **(Done — see `src/features/tonight/visible-tonight.ts`.)** **Make the visibility verdict the headline.** SkyTonight currently lists
   next passes; the follow-up loop is a first-class "Tonight you can actually
   see: 0–N objects" list — only passes whose `visibility.fromGround` is
   true, sorted by time, with countdown "in 2 h 05 m", direction words, and
   the magnitude line. Empty state must stay truthful ("not the right night —
   passes are up but cross your sunlit sky or Earth's shadow").
2. **Alert loop (retention).** Browser-local watchlist + a scheduled daily
   digest: "tomorrow, you'll get two visible ISS passes" — can be
   client-side (localStorage + service worker notification) to respect the
   no-account architecture. No accounts, no server-side PII.
3. **(Done — standard-magnitude convention per Mallama 2020; sourced ISS/CSS values; unknowns stay unknown. Open: confirm the CSS value first-hand, find a post-2009 ISS value.)** **Magnitude honesty upgrade.** Provider object sizes (RCS / apogee /
   object type) can replace the flat std-mag 0.0 default for the handful of
   flagship objects (ISS −1.3 etc.); document every source.
4. **Performance + polish.** Lighthouse budget on the home page; audit the
   worker cadence; mobile layout of the globe band and pass cards.
5. **Documentation.** README + `/methodology` must remain truthful after any
   change; consider an architecture diagram that would impress a reviewer.

## How to work

- Read before editing; prefer the smallest change that satisfies the request.
  The previous agent's own regressions here (a corrupted JSX line from a bad
  string replace, a phase-angle function built on unit vectors, a fabricated
  import, unanchored test fixtures) were all caught by re-reading and the
  gates. Re-read your own diffs before claiming "done".
- Every claim of a passing gate must trace to a captured exit code.
- When uncertain about a visual/UX decision, prefer the more honest and the
  calmer option; this app's identity is "serious orbits, zero drama".
- Keep commits focused, with messages that explain the *why* and list the
  gate results.
