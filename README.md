# Paddock Life

Offline-first motorsport management simulation for Android. The final project documents are the product source of truth.

## Monorepo
- `app/` — React + TypeScript + Vite + Capacitor Android application.
- `app/src/core/` — pure TypeScript simulation modules; no DOM or Capacitor imports.
- `app/src/storage/` — SQLite adapters, migrations, save orchestration, and finance ledger.
- `app/src/seed/` — source-data validators and world seed loaders.
- `backend/` — reserved for Supabase SQL and Edge Functions.
- `adminpanel/` — separate web admin panel, planned in the documented phase.
- `tools/` — seed validation and build helpers.
- `.github/workflows/` — CI and manual debug APK build.

## Current implementation status

Implemented and covered by automated tests:
- Seeded, deterministic race kernel with per-lap weather input.
- Tyre pace and wear calculations, weather transition engine, qualifying classification, and season calendar generation.
- Pit-stop loss, incident probability/outcomes, component reliability risk, and neutralization selection.
- Race report strategy score and five-cause classification.
- Source-backed initial distributions, 36 development projects, development success/gain formulas, and project eligibility checks.
- RequiredBudget-based economy formulas, overdraft rules, rewarded-ad limits, and atomic SQLite finance ledger.
- 30-circuit and 72-team source pools with schema/data validation.
- Local SQLite schema migrations, native Capacitor SQLite adapter, and checksum-verified rotating save orchestration.

Not yet complete; do not treat the current app as publish-ready:
- The complete name seed from `Pool_Nama_v2` (3,325 names, 52 cultures, 199 countries) has not yet been imported. The name-generation engine exists, but career-world generation must not ship until the complete source pool is present and validated.
- Career creation/world population, full team/driver/staff generation, and persistent in-game workflows are not yet wired into the UI.
- The save manager still needs a concrete native file/database snapshot adapter and restore integration.
- Race systems such as incidents, pit stops, component failures, and neutralization still need full orchestration in the race kernel.
- Remaining economy, contracts, sponsors, media, regulations, season progression, cloud save, monetization validation, and UI screens require implementation and simulation tests.
- An Android debug APK build and device smoke test must pass before release readiness can be claimed.

## Development
Requires Node.js 24 and npm.

```sh
npm install
npm run validate:seed
npm run typecheck
npm test
npm run build
```

## Android debug APK
Open **Actions → Android Debug APK → Run workflow**. The workflow generates the Capacitor Android project, builds a debug APK, and uploads it as an artifact. The APK is not considered verified until the workflow passes and the result is smoke-tested on a device.

## Rules
- Work in `feat/<system>` or `fix/<system>` branches; keep `main` stable.
- Core simulation must be deterministic. RNG must use `SeededRandom`; never use `Math.random()` or `Date.now()` in `app/src/core/`.
- Do not invent game rules or balance values. Source them from the final documents and validated game configuration.
- Keep purchase, entitlement, online reward, and share eligibility validation server-authoritative.
- Never commit secrets.
