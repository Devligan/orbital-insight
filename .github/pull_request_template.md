## What and why

<!-- The user-visible change, and the reason for it. -->

## How it was verified

- [ ] `npm run typecheck` · `npm run lint` · `npm test` green (CI runs them too)
- [ ] `npm run build` + `npx playwright test` green
- [ ] UI change: looked at the **production build** at 1440 px and 390 px (dev mode hides minifier bugs)
- [ ] An approximation changed: `/methodology` updated to match

## Honesty contracts

- [ ] No fabricated data paths: provider failures stay typed failures, stale data stays labelled
