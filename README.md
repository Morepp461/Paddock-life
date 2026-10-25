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
- Race-weekend orchestration: qualifying, optional sprint, main race, result persistence, driver/constructor standings and points; qualifying poles are recorded, and the simulation seed uses the active season. Career Mode's dry Tier 1–3 race control now accepts the documented first/second compound and pit-lap choices and enforces the mandatory one-stop/two-compound strategy.
- Stress tests cover 10,000 deterministic race simulations and 1,000 economy season cycles across all six tiers and 12 constructor positions.
- Separate, source-backed pit-stop, incident, reliability, neutralization and overtaking engines. The mandatory dry strategy is now connected to the player race flow using an explicit QA total-pit-loss override; this is not an official pit-time default and does not replace full PitStopEngine integration. Incidents, component failures and neutralization are not yet fully orchestrated by the career race flow.
- Canonical source pools: 30 circuits, 72 teams, 3,325 names across 52 cultures and 199 country profiles, blocked full names, and 100 sponsor entries. Seed validators check the source data.
- Deterministic career creation and world generation, including team takeover/new-team paths, local SQLite career data, generated roster/staff/managers, sponsor offers and save-slot discovery. Driver contract offers and the market UI enforce the documented pre-race-one and mid-season transfer windows; active-contract release-clause buyouts are not implemented yet.
- Career save management enforces the two free Career slots from the product spec and supports confirmed permanent deletion of a save database.
- Player Youth Loan flow is available in Drivers: contracted Driver Academy drivers can be loaned one full season to an age-compatible lower division, owner/borrower payroll is split 80/20, the borrower grid uses the loaned driver exactly once, and rollover expires loans idempotently.
- Source-traceable `game_config` storage seeds only constants explicitly defined in the final documents; missing simulation values remain missing rather than receiving invented defaults. Car component service age is persisted and advances inside the race-result transaction.
- Board Objective lifecycle is wired end to end: initial source-backed objectives, standings/financial/unlock results, manager confidence and reputation changes, consecutive misses, dismissal eligibility, manager job offers and accept/decline UI. Repeated resolution is idempotent. Mid-season warnings are persisted at the documented 50% and 80% checkpoints when current constructor position is outside target; warnings do not reduce manager confidence.
- Sponsor offer acceptance/rejection and active sponsor contract persistence.
- Source-backed economy formulas, opening cash/entry-fee ledger entries, per-round operating/payroll costs, overdraft protection and atomic finance writes.
- Idempotent season financial settlement for prize money, commercial revenue, achieved sponsor targets, debt interest and facility maintenance.
- End-of-season world transition is connected: settle all six divisions, resolve board objectives, apply source-defined financial movement, fill Tier 6 vacancies, generate each next-season calendar, carry active-team cars forward, prepare age-eligible AI race rosters using contract negotiations and source-distributed rookies, age drivers/staff, apply deterministic source-defined driver retirement decisions before rebuilding AI grids, record the documented 40% retired-driver staff-candidate outcome, and atomically switch the career to the next season. Save-slot metadata and the dashboard now resync to the player team’s actual division after financial movement.
- Source-backed financial division movement, projected-income, atomic persistence and Tier 6 replacement-team generation are individually tested and idempotent. Player-controlled division promotion choices and some longer-term progression rules still need verification.
- 36 source-defined development catalog projects, deterministic development calculations, persistent project start/progress/completion/failure/cancellation, finance-ledger integration, development history, and player-team facility upgrades with source-defined costs and atomic finance writes. Broader long-term progression is still incomplete.
- Local SQLite schema migrations and native Capacitor SQLite adapter; versioned database snapshots, IndexedDB-backed current save plus two rotating backups, SHA-256 checksums, atomic snapshot restore with foreign-key validation, and automatic snapshots after career creation, race weekends, sponsor/contract/development transactions and season settlement. A fault-injected SaveManager test verifies that a simulated QuotaExceededError preserves the last valid snapshot and saving recovers afterward.
- Race QA workbench for simulation checks.

### Known gaps before the game can be considered fully testable
- **Race integration:** Career Mode respects the scheduled track condition, validates player/AI tyre compounds, applies circuit overtaking difficulty, persists the adjusted starting grid, and enforces mandatory dry two-compound strategy for the player's Tier 1–3 race when the explicit QA pit-loss override is supplied. The full PitStopEngine is not yet wired to the career flow; incidents, component failures, dynamic weather transitions, safety-car/VSC effects, and red-flag recovery are not yet fully applied to race results. Dynamic weather remains optional because the final source documents do not supply a complete per-circuit transition matrix.
- **Race rules still to wire:** source-backed pit timing, crew-error/unsafe-release effects, DRS activation windows, incident outcomes, component failure consequences, safety-car/VSC effects and red-flag recovery. Component service age increments transactionally, but reliability failure outcomes are not yet applied to race classification.
- **Missing source-backed simulation configuration:** no per-circuit weather transition matrix; no exact Tier 2/3 stationary pit time; no exact crew-error/unsafe-release skill curves; no VSC probability, red-flag probability, or mapping from driver/track attributes to incident BaseRisk and weather risk; no explicit DRS activation window; and no track-temperature field in the circuit pool. The career flow still uses a temporary 25°C placeholder, and the source-defined FormModifier update remains unwired. The config store deliberately does not seed these unknown values.
- **Development gameplay:** the player-facing project lifecycle and facility upgrade transactions are wired and covered by automated tests; broader team development controls and season-to-season development balance still need end-to-end verification.
- **Season loop and board outcomes:** next-season calendar/car/AI-roster rollover, financial promotion/relegation, player division-promotion choice, and board objective resolution are wired. Remaining work includes active-contract release-clause buyouts, staff contract negotiation, converting retired-driver staff candidates into actual staff records with source-backed role/salary handling, retirement-probability adjustments for overall decline, and further verification of mid-season board warnings.
- **Save recovery:** snapshot/backup/restore is integrated and covered by SQL.js tests for corruption and foreign-key rollback; a fault-injected SaveManager test also covers quota failure recovery. Real IndexedDB quota/availability behavior and device-level fault injection still require verification.
- **Roster management:** driver contract offers, transfer-window enforcement, and current-season vacancies work, and AI grids are rebuilt during rollover. Player driver release/active-contract transfer, staff contract negotiation and full roster-management polish remain incomplete. Youth Loan's documented 1.15 development-rate multiplier is a tested helper, but the player-driver growth progression service is not yet implemented, so that multiplier is not yet applied to a growth tick.
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
