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
- Race-weekend orchestration: qualifying, optional sprint, main race, result persistence, driver/constructor standings and points; qualifying poles are recorded, and the simulation seed uses the active season.
- Stress tests cover 10,000 deterministic race simulations and 1,000 economy season cycles across all six tiers and 12 constructor positions.
- Separate pit-stop, incident, reliability and neutralization engines. Their logic is tested independently, but not all of these systems are yet orchestrated by the career race flow.
- Canonical source pools: 30 circuits, 72 teams, 3,325 names across 52 cultures and 199 country profiles, blocked full names, and 100 sponsor entries. Seed validators check the source data.
- Deterministic career creation and world generation, including team takeover/new-team paths, local SQLite career data, generated roster/staff/managers, sponsor offers and save-slot discovery.
- Career save management enforces the two free Career slots from the product spec and supports confirmed permanent deletion of a save database.
- Board Objective calculations cover target rank, financial objective, confidence changes, manager reputation, consecutive primary misses and dismissal eligibility. Manager confidence is persisted and initialized from career path and difficulty; season-result persistence and initial target generation are not yet wired end to end.
- Sponsor offer acceptance/rejection and active sponsor contract persistence.
- Source-backed economy formulas, opening cash/entry-fee ledger entries, per-round operating/payroll costs, overdraft protection and atomic finance writes.
- Idempotent season financial settlement for prize money, commercial revenue, achieved sponsor targets, debt interest and facility maintenance.
- End-of-season world transition is now connected: settle all six divisions, apply source-defined financial movement, fill Tier 6 vacancies, generate each next-season calendar, carry active-team cars forward, prepare age-eligible AI race rosters using contract negotiations and source-distributed rookies, age drivers/staff, retire drivers above the documented maximum age, and atomically switch the career to the next season. Player roster vacancies are handled through the current-season transfer market.
- Source-backed financial division movement, projected-income, atomic persistence, and Tier 6 replacement-team generation; these steps are individually tested and idempotent, but still need full season-transition orchestration with aging, contract-market resolution, calendar/car generation and player division-unlock flow.
- 36 source-defined development catalog projects, deterministic development calculations, persistent project start/progress/completion/failure/cancellation, finance-ledger integration, development history, and player-team facility upgrades with source-defined costs and atomic finance writes. Broader long-term progression is still incomplete.
- Local SQLite schema migrations and native Capacitor SQLite adapter; versioned database snapshots, IndexedDB-backed current save plus two rotating backups, SHA-256 checksums, atomic snapshot restore with foreign-key validation, and automatic snapshots after career creation, race weekends, sponsor/contract/development transactions and season settlement.
- Race QA workbench for simulation checks.

### Known gaps before the game can be considered fully testable
- **Race integration:** the Career Mode race flow still uses simplified dry-track inputs and does not yet fully orchestrate pit stops, incidents, component failures, dynamic weather transitions and safety-car/virtual-safety-car effects into each race result.
- **Qualifying-to-race behavior:** the qualifying grid is persisted and displayed, but the race kernel still needs source-backed starting-grid integration; no undocumented grid-start time penalty should be added.
- **Development gameplay:** the player-facing project lifecycle and facility upgrade transactions are wired and covered by automated tests; broader team development controls and season-to-season development balance still need end-to-end verification.
- **Season loop and board outcomes:** next-season calendar/car/AI-roster rollover and financial promotion/relegation are wired. Remaining work includes optional player division-promotion choice, transfer-window depth, staff contract negotiation, retirement-to-staff conversion (40% source target), initial Board Objective generation, mid-season warnings, final confidence changes and committing dismissal/job-offer outcomes.
- **Save recovery:** snapshot/backup/restore is integrated and covered by SQL.js tests for corruption and foreign-key rollback. Device-level fault injection and IndexedDB quota/availability testing remain required.
- **Roster management:** driver contract offers and current-season vacancies work, and AI grids are rebuilt during rollover. Player driver release/transfer, staff recruitment and full roster-management polish remain incomplete.
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
