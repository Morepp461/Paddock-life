# Paddock Life

Offline-first motorsport management simulation for Android. The final project documents are the product source of truth.

## Monorepo
- `app/` — React + TypeScript + Vite + Capacitor Android application.
- `app/src/core/` — pure TypeScript simulation modules; no DOM or Capacitor imports.
- `backend/` — reserved for Supabase SQL and Edge Functions.
- `adminpanel/` — separate web admin panel, planned in the documented phase.
- `tools/` — validation and build helpers.
- `.github/workflows/` — CI and manual debug APK build.

## Development
Requires Node.js 24 and npm.

```sh
npm install
npm run typecheck
npm test
npm run build
```

## Android debug APK
Open **Actions → Android Debug APK → Run workflow**. The workflow generates the Capacitor Android project, builds a debug APK, and uploads it as an artifact. The APK is not considered verified until the workflow passes.

## Rules
- Work in `feat/<system>` or `fix/<system>` branches; keep `main` stable.
- Core simulation must be deterministic. RNG must use `SeededRandom`; never use `Math.random()` or `Date.now()` in `app/src/core/`.
- Do not invent game rules or balance values. Source them from the final documents and validated game configuration.
- Never commit secrets.
