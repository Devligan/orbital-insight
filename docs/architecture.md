# Orbital Insight — Architecture

## Overview

Orbital Insight is a satellite analysis platform: it retrieves real orbital
element sets from CelesTrak, propagates satellite positions with SGP4,
visualizes orbits on a 3D globe and 2D ground track, predicts satellite passes
for a ground observer, and lets users compare and persist orbital element
snapshots.

The application is a single Next.js (App Router) deployment on Vercel Hobby.
Everything that requires network access, secrets, or heavy computation runs in
Route Handlers. The browser consumes JSON APIs only.

## Dependency direction

```
src/app (routes, page components, route handlers)
  ↓ uses
src/features/* (presentation/workflows per feature area)
  ↓ uses
src/contracts (Zod schemas shared across HTTP + persistence boundaries)
  ↓ uses
src/domain/* (pure orbital domain: no React, no HTTP, no database)
  ↓ may use only
src/integrations/sgp4 (adapter over satellite.js)

src/server (application services: caching, provider orchestration, persistence)
  → uses src/integrations/celestrak (external provider client)
  → uses src/server/supabase (persistence, optional at runtime)
```

Key rule: **`src/domain/**` never imports React, `next`, HTTP utilities, or the
database.** This makes orbital math independently executable and testable
(`vitest` runs it in plain Node, no DOM, no network).

## Module responsibilities

| Path | Responsibility |
| --- | --- |
| `src/app/api/**` | Thin Route Handlers: validate input, call a service, map errors to HTTP responses |
| `src/app/(pages)` | Pages and layouts; render server-fetched or client-fetched data |
| `src/features/**` | Feature-specific UI and client workflow code |
| `src/components/ui` | Shared design-system primitives (buttons, panels, tables, badges) |
| `src/domain/catalog` | Constellation atlas: Keplerian orbit shape from TLE columns, name-rule constellation membership, summaries and histograms |
| `src/domain/conjunction` | Close-approach screening (radius filter → sampled sweep with time skipping → golden-section TCA → RIC frame); propagator-agnostic, driven by SGP4 in a Web Worker |
| `src/integrations/sgp4/bulk.ts` | Allocation-free SGP4 hot path for browser workers (no server-only imports) |
| `src/domain/orbit` | Orbital element parsing, SGP4 invocation via adapter, coordinate conversions (TEME→ECF→geodetic), ground-track sampling with dateline handling, orbital characteristics |
| `src/domain/passes` | Observer geometry, pass prediction (rise/max-elevation/set), pass interval search |
| `src/integrations/sgp4` | The only module that imports `satellite.js`. Owns unit/coordinate conventions for the library (TEME frames, km, minutes-from-epoch) |
| `src/integrations/celestrak` | Provider client: bounded GP fetches, Zod-validated parsing, timeouts, rate-limit awareness |
| `src/server` | Application services: catalog cache, snapshot persistence, watchlist persistence, request error mapping |
| `src/contracts` | Zod schemas for API requests/responses and GP element sets |

## Key decisions

### 1. SGP4 behind a small adapter

`satellite.js` is the SGP4 implementation (a port of Vallado's reference code,
validated against `SGP4-VER.TLE` / `tcppver.out` — see `tests/unit/propagation.test.ts`).
Only `src/integrations/sgp4` knows the library:
- it returns TEME (ECI) position/velocity in **kilometers and km/s**,
- propagation time is expressed as **minutes from element-set epoch**,
- errors surface as the satellite.js `SatRec.error` code, which the adapter
  maps to a domain enum so callers never depend on library internals.

If the library ever changes or is replaced, the adapter signature
(`elementSet → propagatedState at date`) is the only contract to preserve.

### 2. Coordinate and time conventions

- All timestamps are UTC; JS `Date` in Node is UTC-only arithmetic.
- SGP4 output is in the **TEME** frame (this is what the element sets are fit
  to and what satellite.js's `sgp4` returns; labelled ECI in the library).
  Converting to ECF uses the Greenwich sidereal time from `gstime()`, which
  derives GMST from the input Date — sub-arcsecond polar motion and UT1-UTC are
  not modelled (well below the accuracy ceiling of a TLE/SGP4 prediction).
- Geodetic altitude/latitude/longitude use satellite.js's WGS-72-derived
  conversions. Ground-track and pass calculations consume geodetic values.
- Observer look angles use `ecfToLookAngles` (azimuth/elevation from
  geodetic ECF vectors).

### 3. Data freshness and caching

- CelesTrak GP lookup is cached server-side in a bounded in-process LRU
  (`src/server/catalog-cache.ts`) keyed by catalog number, with a TTL of
  2 hours (TLE element sets for active objects are typically updated at least
  daily; 2 h keeps us well inside "fresh" while remaining polite to the free
  provider). Cache entries record `retrievedAt` and are served with a
  `stale-but-labelled` policy: on a provider failure, last-known-good data is
  returned and explicitly flagged `stale` in the response payload.
- No cron jobs: freshness advances lazily on request.
- Snapshots written to Supabase (when configured) deduplicate on
  `(satellite_number, epoch)` unique constraint, so page views never inflate
  storage.

### 4. Persistence is optional at runtime

Supabase is configured via env vars. If they are absent (public demo without
secrets), the persistence layer reports "unavailable" and every feature that
depends on it degrades: watchlists persist to browser localStorage instead,
snapshot comparison works on live/cached data only, and API responses include
a `persistence: "unavailable"` field. Read-only demo mode is the default
code path, not an emergency shim.

### 5. Error model

`AppError` (src/lib/errors.ts) discriminates expected failure kinds:
`validation`, `not-found`, `provider` (upstream outage/rate-limit),
`propagation`, `stale-data`, `persistence`. Route handlers translate this to
HTTP status codes (400/404/502/422/503) and a body
`{ error: { kind, message, details? } }`. Unexpected exceptions get a
correlation id, are logged with context, and surface as generic 500s — no
prompt-looking default values are ever returned on failure.

### 6. Free-tier protections

- Trajectory sampling is bounded: the API rejects windows beyond
  `MAX_PROPAGATION_HOURS` (default 48 h core + coarse envelope) and clamps the
  number of samples.
- Pass-prediction endpoints bound the search window (30 days) and the number
  of satellites per request (25).
- The catalog fetches small curated CelesTrak groups (e.g. `stations`,
  `starlink-limited` is deliberately not used) rather than the entire catalog,
  and serves everything from cache after the first fetch.
- CesiumJS is dynamically imported only on the globe route.

## Testing strategy

- `tests/unit/` — orbital domain against Vallado's published SGP4 verification
  data (`tests/fixtures/SGP4-VER.TLE` + `tcppver.out` from the
  [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) distribution,
  which mirrors the original C++ `SGP4-VER` test). Position tolerance
  1.5 km/velocity 5 mm/s relative errors reflect TRANSIT of the printed
  8-decimal outputs; actual agreement is far tighter.
- `tests/integration/` — CelesTrak client against recorded response fixtures /
  mocked fetch, API handlers via direct invocation, persistence fallbacks.
- `tests/e2e/` — Playwright specs for the critical user journeys (no sign-in).
