# Paddock Life

Offline-first motorsport management simulation for Android. The final project documents are the product source of truth.

## Monorepo
- `app/` — React + TypeScript + Vite + Capacitor Android application.
- `app/src/core/` — deterministic simulation, qualifying, race-weekend, economy, sponsor, development and settlement logic.
- `app/src/storage/` — SQLite adapters, schema migrations, finance ledger and save orchestration.
- `app/src/seed/` — source-data validation and deterministic career-world generation.
- `backend/` — reserved for Supabase SQL and Edge Functions.
- `adminpanel/` — separate web admin panel, planned in the documented phase.
- `tools/` — seed validation and build helpers.
- `.github/workflows/` — CI and Android debug APK build.

## Current test readiness

The current main branch is an **early playable development build**, not a complete release. The Android debug APK workflow builds successfully, but the APK still needs a real-device smoke test.

### Implemented and covered by automated tests
- Deterministic seeded RNG and lap-by-lap race simulation, tyre pace/wear, weather transitions, qualifying classification and season calendar.
- Race-weekend orchestration: qualifying, optional sprint, main race, result persistence, driver/constructor standings and points.
- Separate pit-stop, incident, reliability and neutralization engines. Their logic is tested independently, but not all of these systems are yet orchestrated by the career race flow.
- Canonical source pools: 30 circuits, 72 teams, 3,325 names across 52 cultures and 199 country profiles, blocked full names, and 100 sponsor entries. Seed validators check the source data.
- Deterministic career creation and world generation, including team takeover/new-team paths, local SQLite career data, generated roster/staff/managers, sponsor offers and save-slot discovery.
- Sponsor offer acceptance/rejection and active sponsor contract persistence.
- Source-backed economy formulas, opening cash/entry-fee ledger entries, per-round operating/payroll costs, overdraft protection and atomic finance writes.
- Idempotent season financial settlement for prize money, commercial revenue, achieved sponsor targets, debt interest and facility maintenance.
- 36 development catalog projects and deterministic development-engine calculations.
- Local SQLite schema migrations, native Capacitor SQLite adapter and checksum-verified save orchestration interfaces.
- Race QA workbench for simulation checks.

### Known gaps before the game can be considered fully testable
- **Race integration:** the Career Mode race flow still uses simplified dry-track inputs and does not yet fully orchestrate pit stops, incidents, component failures, dynamic weather transitions and safety-car/virtual-safety-car effects into each race result.
- **Qualifying-to-race behavior:** the qualifying grid is persisted and displayed, but the race kernel still needs source-backed starting-grid integration; no undocumented grid-start time penalty should be added.
- **Development gameplay:** the 36-project catalog and engine exist, but starting, progressing, completing and cancelling projects are not yet wired into a persistent player-facing workflow.
- **Season loop:** season settlement is available, but next-season rollover, transfers, contracts, driver/staff progression, retirements and promotion/relegation are not complete.
- **Save recovery:** save slots can be found and resumed, but the rotating backup/snapshot/restore path needs concrete end-to-end integration and failure-recovery tests.
- **Roster management:** persistent contract actions, recruitment/release rules and complete team management are still incomplete.
- **Platform services:** cloud sync, authentication, server-authoritative rewarded ads and purchase validation are not complete; do not enable real monetization until their validation is in place.
- **Device verification:** APK build success is not a substitute for installing and smoke-testing the APK on an Android device.

## Development commands

Requires Node.js 24 and npm.

```sh
npm install
npm run validate:seed
npm run typecheck
npm test
npm run build
```

## Android debug APK
Open **Actions → Android Debug APK → Run workflow**. The workflow builds a debug APK and uploads it as a workflow artifact. Install the artifact on an Android device and smoke-test new career creation, save/resume, a complete race weekend, sponsor actions, finance ledger and season settlement before treating the build as ready for broader testing.

## Engineering rules
- Use a new `feat/<system>` or `fix/<system>` branch for every change; keep `main` stable.
- Core simulation must be deterministic. Use `SeededRandom`; never use `Math.random()` or `Date.now()` in `app/src/core/`.
- Do not invent game rules or balance values. Source them from the final documents and validated game configuration.
- Purchase, entitlement, online reward and share eligibility must be server-authoritative.
- Never commit secrets.
