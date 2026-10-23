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
- Separate, source-backed pit-stop, incident, reliability, neutralization and overtaking engines. These systems are tested independently; pit stops, incidents, component failures and neutralization are not yet fully orchestrated by the career race flow.
- Canonical source pools: 30 circuits, 72 teams, 3,325 names across 52 cultures and 199 country profiles, blocked full names, and 100 sponsor entries. Seed validators check the source data.
- Deterministic career creation and world generation, including team takeover/new-team paths, local SQLite career data, generated roster/staff/managers, sponsor offers and save-slot discovery.
- Career save management enforces the two free Career slots from the product spec and supports confirmed permanent deletion of a save database.
- Board Objective lifecycle is wired end to end: initial source-backed objectives, standings/financial/unlock results, manager confidence and reputation changes, consecutive misses, dismissal eligibility, manager job offers and accept/decline UI. Repeated resolution is idempotent.
- Sponsor offer acceptance/rejection and active sponsor contract persistence.
- Source-backed economy formulas, opening cash/entry-fee ledger entries, per-round operating/payroll costs, overdraft protection and atomic finance writes.
- Idempotent season financial settlement for prize money, commercial revenue, achieved sponsor targets, debt interest and facility maintenance.
- End-of-season world transition is connected: settle all six divisions, resolve board objectives, apply source-defined financial movement, fill Tier 6 vacancies, generate each next-season calendar, carry active-team cars forward, prepare age-eligible AI race rosters using contract negotiations and source-distributed rookies, age drivers/staff, retire drivers above the documented maximum age, and atomically switch the career to the next season. Save-slot metadata and the dashboard now resync to the player team’s actual division after financial movement.
- Source-backed financial division movement, projected-income, atomic persistence and Tier 6 replacement-team generation are individually tested and idempotent. Player-controlled division promotion choices and some longer-term progression rules still need verification.
- 36 source-defined development catalog projects, deterministic development calculations, persistent project start/progress/completion/failure/cancellation, finance-ledger integration, development history, and player-team facility upgrades with source-defined costs and atomic finance writes. Broader long-term progression is still incomplete.
- Local SQLite schema migrations and native Capacitor SQLite adapter; versioned database snapshots, IndexedDB-backed current save plus two rotating backups, SHA-256 checksums, atomic snapshot restore with foreign-key validation, and automatic snapshots after career creation, race weekends, sponsor/contract/development transactions and season settlement.
- Race QA workbench for simulation checks.

### Known gaps before the game can be considered fully testable
- **Race integration:** Career Mode now respects the scheduled track condition, validates player/AI tyre compounds, applies the circuit's overtaking difficulty, and persists the adjusted starting grid. The race flow still does not fully orchestrate pit stops, incidents, component failures, dynamic weather transitions, safety-car/VSC effects, and red-flag recovery into race results. Dynamic weather remains optional in the simulation engine because the final source documents do not supply a complete per-circuit transition matrix.
- **Race rules still to wire:** pit-stop rules by tier, mandatory two-compound strategy where required, DRS activation windows, incident outcomes and neutralization effects need end-to-end persistence. Career Mode currently uses a temporary 25°C track-temperature placeholder because the final circuit pool has no track-temperature field; the source-defined FormModifier update also remains unwired. Do not invent missing values or probabilities to fill these configuration gaps.
- **Development gameplay:** the player-facing project lifecycle and facility upgrade transactions are wired and covered by automated tests; broader team development controls and season-to-season development balance still need end-to-end verification.
- **Season loop and board outcomes:** next-season calendar/car/AI-roster rollover, financial promotion/relegation and board objective resolution are wired. Remaining work includes optional player division-promotion choice, transfer-window depth, staff contract negotiation, retirement-to-staff conversion (40% source target), and mid-season board warnings.
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
