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
  real-time animated, click-any-dot-to-open. Dark CARTO basemap, ~68vh
  full-bleed band, one-line collapsible status pill.
- Get per-satellite detail (detail page, position samples, ground track,
  pass predictions table + phone cards + CSV), comparison of two element sets,
  a browser-local watchlist, and a `/methodology` page documenting every
  approximation honestly.

## Non-negotiable standards (violating these is regression)

1. **Honesty contracts.** Data lineage is surfaced everywhere: `live` /
   `cached` / `provider-unavailable-stale`. Provider failures produce typed
   failures (never fabricated orbits or fake loading spinners). Truncated pass
   windows are labelled. Magnitude estimates carry ~±1.5 mag uncertainty
   because object sizes are unknown. The `/methodology` page must stay
   accurate — if you change any approximation, update it.
2. **The quality gates run after every change, with exit codes captured
   directly** (not through output filters that mask status):
   `npx tsc --noEmit`, `npx eslint` (0 errors; 2 pre-existing warnings in
   `src/domain/passes/finder.ts` are accepted baseline — do not fix them
   casually, do not suppress them), `npx vitest run` (currently 83 passed /
   1 skipped), `npm run build`, `npx playwright test` (21 journeys). All must
   be green before any commit. Never weaken assertions or add suppressions to
   pass.
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
  build 0 · e2e 21/21. Working tree clean.
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

## Known environmental realities

- Windows host, Git Bash. Use POSIX syntax (forward slashes, `rm -rf`).
  `start` plays no part; long servers must run as background processes.
- Playwright's webServer runs `next start` — you must `npm run build` after
  clearing or changing `.next`, or e2e fails with "no production build".
- A stale `.next` directory causes the notorious `Cannot find module
  './887.js'` runtime error: fix by `rm -rf .next && npm run build`, never by
  editing generated chunks.
- CelesTrak rate-limits aggressive IPs (HTTP 403/429). Local runs may get
  typed 502s from `/api/sky/catalog` — that is the honest-degradation path
  working, not a bug.
- E2E uses granted geolocation (lat 0/lon 0) for the "tonight" journey.

## What to build next (owner-approved priorities, in order)

1. **Make the visibility verdict the headline.** SkyTonight currently lists
   next passes; the follow-up loop is a first-class "Tonight you can actually
   see: 0–N objects" list — only passes whose `visibility.fromGround` is
   true, sorted by time, with countdown "in 2 h 05 m", direction words, and
   the magnitude line. Empty state must stay truthful ("not the right night —
   passes are up but cross your sunlit sky or Earth's shadow").
2. **Alert loop (retention).** Browser-local watchlist + a scheduled daily
   digest: "tomorrow, you'll get two visible ISS passes" — can be
   client-side (localStorage + service worker notification) to respect the
   no-account architecture. No accounts, no server-side PII.
3. **Magnitude honesty upgrade.** Provider object sizes (RCS / apogee /
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
