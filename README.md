# Orbital Insight

A production-quality satellite analysis platform: live orbital element data
from CelesTrak, SGP4 propagation validated against the official reference
suite, an interactive 3D globe + 2D ground tracks, observer pass predictions,
and orbital element comparison — free-tier deployable, no sign-in required
for the core demo.

**State of this repository:** complete, with automated tests passing
(see [Testing](#testing) for the exact commands used and their real output
counts). There is no deployed demo URL yet no deployment credentials were
configured in this environment; deployment instructions are below and the
Vercel configuration follows the documented free-tier limits.

## Feature map

| Route | What it does |
| --- | --- |
| `/` | Explorer: 3D globe (Cesium, no token required — OpenStreetMap imagery), curated examples (ISS default), bounded time slider, provenance badges, browser-local watchlist toggle |
| `/satellites/[id]` | Full detail: parsed TLE, element epoch, retrieval timestamp, approximate characteristics, 24 h ground track, source links |
| `/passes` | Observer pass predictions (rise / max elevation / set + azimuths), bounded to 25 satellites × 30 days, CSV export |
| `/compare` | Element-set + propagated-position comparison between two objects, with explicit interpretation notes |
| `/watchlist` | Demo watchlist persisted in browser localStorage (labelled as local) |
| `/methodology` | Data sources, coordinate frames, propagation limits, validation approach, unsupported use cases |

## Technology

- **Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind CSS v4**
- **satellite.js 7** as the SGP4 implementation (adapter-isolated; see `src/integrations/sgp4`)
- **CesiumJS 1.x** lazily loaded only on the explorer; OpenStreetMap raster imagery (no Ion token, no paid imagery)
- **Recharts** for the comparison delta chart
- **Zod 4** for runtime contracts (provider responses, API boundaries)
- **Vitest 5** (unit + integration) and **Playwright 1.x** (e2e)
- **Supabase (optional at runtime)** for orbital snapshots and authenticated watchlists, with RLS migrations

## Feature verification matrix

An independent engineering audit was performed (see
[`docs/engineering-audit.md`](docs/engineering-audit.md)); the matrix below
reflects its evidence-based verdicts.

| Feature | Status | Evidence |
| --- | --- | --- |
| Satellite search & selection | **Verified** | e2e journey (search → detail navigation); service tests |
| Satellite details / epoch / provenance | **Verified** | e2e + live HTTP smoke (epoch = fetch-day value) |
| 3D globe (orbit, satellite, ground track) | **Partially verified** | e2e loads the globe in Chromium with WebGL; pixel-level rendering is not asserted |
| 2D WebGL fallback (swap-in on globe failure) | **Partially verified** | swap logic implemented + type/lint-checked; the failure path is not triggered under CI WebGL — manual procedure: block WebGL in browser DevTools and reload `/` |
| Ground track (antimeridian handling) | **Verified** | unit tests (dateline split, wrap conventions) + API ground-track smoke |
| Time controls (prediction window slider) | **Verified** | e2e journey (timestamp readout changes with slider) |
| Pass predictions (rise/max/set + azimuths) | **Verified** | unit tests incl. truncation semantics; live HTTP smoke (ISS × Florida ≈ 42.1° apex) |
| Pass compute budget guard | **Verified** | unit regression test (2160 sat-h rejected, 600 sat-h accepted) + e2e message assertion |
| Orbital element comparison | **Partially verified** | service-level identity/delta regression tests pass; the compare-page UI flow has no e2e journey yet — manual procedure on `/compare` |
| Snapshot comparison (requires Supabase) | **Not verified** | persistence + deduplicating writes implemented with migrations; no live Supabase instance was configured in this environment — nothing could assert it end-to-end |
| Watchlist (browser-local persistence) | **Verified** | e2e (save → navigate → list shows the entry) |
| CSV export | **Verified** | e2e download event, `.csv` filename, non-empty file path |
| Methodology & limitations page | **Verified** | e2e content assertions |
| First-load without sign-in / no secrets client-side | **Verified** | e2e opens the explorer with zero configuration; dependency audit (secret sweep) found none |
| Read-only mode without Supabase | **Verified** | entire test suite + e2e ran with no environment variables configured |

## Architecture

See [`docs/architecture.md`](docs/architecture.md) — the short version:

```
src/app/            routes + route handlers (thin: validate → service → respond)
src/features/       feature UI + client workflows  (satellites, orbit-visualization, passes, comparisons, watchlist)
src/domain/orbit    pure orbital domain: parsing, propagation, coordinates, ground track, characteristics
src/domain/passes   pass-prediction engine (30 s sweep → bisection → ternary apex)
src/integrations/   celestrak client · sgp4 adapter (only module importing satellite.js)
src/server/         application services: satellites, analysis, catalog cache, detail loader, persistence
src/contracts/      zod schemas shared across boundaries
supabase/migrations RLS-protected schema
```

Key boundaries: the orbital domain never imports React/HTTP/DB; only the
adapted integrations touch external libraries; every privilege stays
server-side; the app degrades to a read-only demo without Supabase
credentials (and tells the user so).

## Data sources

Orbital element sets come from CelesTrak's current GP interface
(`https://celestrak.org/NORAD/elements/gp.php?CATNR=…&FORMAT=tle`). Notes:

- **Parameter names are case-sensitive** (`CATNR`, `GROUP`, `NAME`); unknown
  identifiers answer `404 "No GP data found"` and are surfaced as HTTP 404
  **not-found**, never as fake data.
- The client sleeps ≥ 2 s between outbound requests (politeness, since
  CelesTrak is a free service), times out at 15 s, and distinguishes empty
  responses, rate-limits, and schema violations as separate typed failures.
- Reconstructed responses are cached server-side for 2 hours; after a
  provider outage the last-known-good element set is served and explicitly
  labelled `cached` / `provider-unavailable-stale` in the API and UI.
- Only bounded curated groups are fetched (crewed stations, GNSS
  constellations, scientific satellites — a few hundred records total), never
  the full active catalog.

## Orbital calculation methodology (summary)

Full details, including honest limitations and unsupported use cases, live on
the `/methodology` page. In brief:

- Positions are **SGP4 predictions** in TEME (km, km/s), converted to ECEF via
  GMST and to geodetic coordinates on the same WGS-72 ellipsoid the model
  uses. All timestamps are UTC.
- Elements carry their published epoch; data older than 36 h is flagged (a
  conservative operational warning, not an asserted accuracy cutoff).
- Ground tracks are sampled at bounded rates and **split at the antimeridian**
  so plots never draw false lines across the globe.
- Pass prediction sweeps elevation every 30 s, refines rise/set crossings by
  bisection to < 1 s and the apex by ternary search; passes already in
  progress at window start are marked **truncated** rather than invented.
- Approximate characteristics (period, semi-major axis, perigee/apogee) are
  Keplerian close-forms from the element set, labelled as approximations.

## Local setup

```bash
npm install
cp .env.example .env.local        # optional — Supabase only
npm run predev                    # copies Cesium runtime assets into public/cesium
npm run dev                       # http://localhost:3000
```

The core explorer runs with **zero environment configuration**: no API keys,
no database. Supabase persistence (snapshots, authenticated watchlists)
activates when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ anon key for
user watchlists) are set.

### Database migrations

```bash
supabase db push   # applies supabase/migrations/*.sql
```

- `0001_snapshots.sql` — `orbital_snapshots`, unique on `(satellite_number,
  epoch)` so repeated page views never duplicate history; RLS-closed, written
  only via the service role.
- `0002_watchlists.sql` — `watchlist_items`, unique on `(user_id,
  satellite_number)`, full RLS policy set for owner-only access.

## Testing

All results below are from the actual runs in this workspace; nothing is
projected or fabricated.

### Unit + integration (Vitest)

```bash
npm test
# Test Files  7 passed (7)
#      Tests  41 passed (41)
```

Covers:
- **SGP4 numerical validation** against the official verification data
  (`SGP4-VER.TLE` + `tcppver.out`, mirrored from the python-sgp4 project):
  the suite regenerates all **700 published output rows** across 33 element
  sets and demands **|Δ| < 2e-7** on every TEME field (km / km/s) — the same
  tolerance the upstream reference harness uses.
- TLE parse/checksum validation (including derived, re-checksummed fixtures).
- Ground-track antimeridian splitting.
- Pass-finder behaviour: ordering, apex bounds, truncation semantics,
  threshold sensitivity, failure reporting.
- CelesTrak client against mocked HTTP: malformed bodies, rate-limits,
  timeouts, network failures, validated TLE triplets.
- Satellite service: caching, stale-serve labelling, not-found behaviour.
- API error → HTTP status mapping and request-bounds enforcement.

### Optional live provider check

```bash
RUN_LIVE_TESTS=1 npx vitest run tests/integration/celestrak-live.test.ts
# ✓ fetches the ISS element set over the real network
```

Skipped by default so the standard suite never requires network access.

### End-to-end (Playwright, production build)

```bash
npm run build
npx playwright test
# 7 passed (31s)
```

Journeys verified in a real Chromium session against `next start`: open the
app without signing in → load a real satellite with its epoch/characteristics
→ move the prediction time → search + navigate to a detail page → calculate
passes for a typed location → save a satellite to the watchlist → check the
methodology page content.

## Deployment

Target platform is **Vercel Hobby** (free tier):

```bash
npm i -g vercel
vercel            # link the project
vercel deploy --prod
```

Free-tier considerations actually implemented (see
`docs/architecture.md` §6 for the full list): no background workers, no cron
(in-memory freshness on request), bounded sampling windows and result sizes,
provider throttling + caching, lazy Cesium bundle (~102 kB shared JS + Cesium
on the explorer only), no secrets client-side. If you deploy, set
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` in the
Vercel project env only if you want persistence features.

## Known limitations

- No deployed demo URL yet; the README will carry it once the project is
  deployed.
- Historical *snapshot* comparison requires a configured Supabase instance;
  in demo mode `/compare` works on live/cached element sets only, which is
  stated in the UI.
- Position accuracy claims are deliberately avoided: the UI shows element
  age and provenance and links to provider guidance instead of asserting
  numbers that depend on each object's fit quality.
- The in-memory catalog cache is per server instance (typical serverless
  cold/warm behaviour), not a global cache — an accepted free-tier trade-off.
```
