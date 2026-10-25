# Paddock Life — Session Handoff

Last updated: 2026-10-25
Resume keyword: **Lanjut Paddock life**
Repository: https://github.com/Morepp461/Paddock-life
Source of truth: `Paddock_Life_Docs_FINAL.zip` and the final specification documents in the project repository. Never invent missing game rules, probabilities, configuration values, or economy balance.

## Current verified repository state

- Default branch: `main`
- Latest main commit at handoff: `90011564fb271321d05807df4f9ef169709776be`; CI completed successfully. Android Debug APK build completed successfully on the preceding runtime-code commit `b1e66f2ee455a8cdf9d6724c4c565f4ab26a8d05`.
- Debug APK artifact: workflow run `40148029506` built `paddock-life-debug-apk` from the same runtime code as merged main; artifact expires 2027-01-23. Run page: https://github.com/Morepp461/Paddock-life/actions/runs/40148029506.
- This means the project can produce a debug APK, **not** that the game has been verified on a real Android device or is release-ready.
- Check the live open-PR list before continuing. Do not rely on old PR numbers or merge stale branches.
- Use a fresh `feat/<system>`, `fix/<system>`, or `docs/<topic>` branch for each change. Keep `main` stable. Review the diff and CI before merge.

## Implemented on main (per current README and merged work)

- Monorepo: React + TypeScript + Vite + Capacitor Android app, SQLite local-first storage, CI and Android debug APK workflow.
- Deterministic RNG and race/simulation engines; qualifying classification, calendar, tyre wear/pace, weather engine, pit-stop engine, incident engine, reliability engine, neutralization engine, race reporting, overtaking-related configuration and race weekend orchestration.
- Race-weekend result persistence, driver/constructor standings and points, sprint support where the calendar says so, grid persistence, circuit condition/overtaking difficulty, QA workbench. Career Mode dry Tier 1–3 races now expose first/second compound and pit-lap choices, enforce the mandatory two-compound stop, and persist/display actual strategy. Pit loss uses an explicit QA override, not an official default; full PitStopEngine integration remains incomplete.
- Source data: 30 circuits, 72 teams, 3,325 names across 52 cultures and 199 country profiles, blocked full names, 100 sponsor entries. Seed validation exists.
- Career creation/world generation for new team or takeover, local SQLite career data, roster/staff/manager generation, sponsor offers, save-slot discovery, and two free career slots. Driver market/contract offers now enforce the documented pre-race-one and mid-season transfer windows in both service and UI; mid-season active-contract buyout/release-clause transfers remain incomplete.
- Board objectives: source-backed objectives, standings/finance/unlock results, confidence/reputation, consecutive misses, dismissal eligibility and manager job offers; repeated resolution is idempotent. Documented 50%/80% mid-season warnings are persisted.
- Sponsor offer acceptance/rejection and active contracts.
- Source-backed economy, opening balance and entry-fee ledger, per-round operating/payroll expenses, overdraft limits, atomic finance writes, and idempotent season settlement (prize money, commercial revenue, achieved sponsor targets, interest, facility maintenance).
- End-of-season rollover: settle all six divisions, resolve board objectives, apply financial movement, fill Tier 6 vacancies, generate next calendars, carry active-team cars forward, negotiate AI contracts and prepare next-season AI rosters, age drivers/staff, retire drivers above documented max age, and atomically advance season.
- Financial division movement and Tier 6 replacement teams; player-controlled promotion choice and some long-term progression still need verification.
- 36 documented development projects, deterministic development engine, persistent project lifecycle/history, finance integration, and facility upgrades.
- SQLite migrations/native Capacitor SQLite adapter; versioned snapshots, IndexedDB current save plus two rotating backups, SHA-256 verification, atomic restore and foreign-key validation; automatic snapshots after key career transactions. A fault-injected `QuotaExceededError` test verifies the last valid save survives and saving recovers.
- Stress-test coverage includes 10,000 deterministic race simulations and 1,000 economy season cycles across six tiers/12 constructor positions (per README).

## Eight remaining work batches

Work in this order unless tests reveal a more urgent correctness or data-safety issue. Each batch needs source-document traceability, tests, a review, and green CI before merge.

### Batch 1 — Complete race-kernel integration
- Orchestrate pit stops, mandatory compound strategy where documented, DRS activation windows, incidents, component failures, weather transitions, safety car/VSC, red-flag recovery and their effects into actual career race results.
- Wire pit-stop rules by tier, tyre restrictions, track condition and reliability/component history.
- Wire the documented FormModifier update.
- Replace the temporary 25°C race-temperature placeholder only when the source provides valid circuit temperature data; otherwise preserve an explicit unresolved configuration gap rather than inventing values.
- Keep optional dynamic weather until complete source-backed per-circuit transition matrices/configuration exist.
- Test race-result persistence, determinism, DNF/neutralization edge cases and idempotency.

### Batch 2 — Finish season progression and board lifecycle
- Verify the full season rollover end to end across all six divisions and all financial movement edge cases.
- Implement player-controlled promotion/division choice where specified.
- Complete active-contract release-clause buyouts, staff contract negotiations, and source-backed conversion of retired-driver staff candidates into actual staff records.
- Verify mid-season board warnings, objective resolution, dismissal/job offers and save metadata across division changes.
- Confirm that rollover is atomic and cannot run twice.

### Batch 3 — Complete roster and contract management
- Finish player driver release/transfer, recruitment, staff hiring, contract negotiation and roster-management screens.
- Verify contract validation, season bounds, salary/finance ledger effects, vacancy filling and legal grid sizes.
- Resolve the current contract-related open PR chain only after checking ancestry, CI and the generated roster baseline; never merge a test-only workaround that hides a real rule violation.

### Batch 4 — Development, facilities and long-term balance
- Verify player-facing development lifecycle and facility upgrades end to end across tiers/seasons.
- Test costs, eligibility, engineers/facility constraints, progress, success/failure, secondary attribute/reliability effects, cancellation refund and transaction rollback.
- Verify how development, aging, staff changes and upgrades carry across season rollover.
- Do not invent missing balance values. Keep source-backed gaps documented.

### Batch 5 — Save/load integrity and recovery
- Validate native Capacitor SQLite operation on Android, save discovery/resume, two rotating backups, checksums, corruption handling and atomic restore. The simulated quota-failure recovery test is merged; real IndexedDB quota/unavailable-path behavior and device-level fault injection remain.
- Add device-level fault injection and IndexedDB quota/unavailable-path tests where applicable.
- Verify automatic snapshots around career creation, race weekend, sponsor/contract/development transactions and settlement.
- Test interrupted writes and foreign-key failures without destroying a valid save.

### Batch 6 — Online services and monetization security
- Implement and test authentication/cloud sync only as documented; preserve offline-first play.
- Add server-authoritative rewarded ads and purchase validation before enabling real rewards or purchases.
- Verify entitlement/reward replay protection, idempotency, offline failure behavior and secure secret handling.
- Keep monetization disabled until server validation exists; never trust the client as authority for purchases/rewards/shares.

### Batch 7 — Gameplay UI and usability completion
- Audit all documented screens and flows: first launch, manager profile, difficulty, new team/takeover, tier selection, sponsor offers, career summary, dashboard, race weekend/results, finances, development/facilities, roster/contracts, board objectives, season rollover and save management.
- Ensure errors, loading, confirmation, empty states and small-screen Android layout are usable.
- Confirm the UI reflects persisted database state after navigation/reload and never advertises an unavailable action as completed.
- Keep the existing visual/product direction and avoid unrelated rewrites.

### Batch 8 — Full regression, Android device testing and release readiness
- Run seed validation, typecheck, unit/integration/stress tests, production build and Android debug APK workflow from the final candidate commit.
- Install APK on a real Android device and smoke-test new career, takeover/new team, save/resume, complete race weekend, standings, sponsor decisions, finance, development, season settlement/rollover, backup/restore and offline operation.
- Check performance, crashes, layout, database migration from a clean install and upgrade path.
- Fix findings on new branches, repeat tests, then write a release checklist. Do not call the game release-ready until device testing and all blocking gaps pass.
- Cloud sync, purchase/reward validation and any platform feature that remains unimplemented must be clearly marked unavailable rather than faked.

## Immediate next actions when resuming

1. Read this file and current `README.md`; treat the current GitHub `main` state as authoritative, not old chat snippets.
2. Fetch latest main commit, CI/Android workflow runs, open PRs and branch ancestry.
3. Inspect the latest changes since this handoff and run/inspect CI before making another change.
4. Continue Batch 1 race integration: audit the live race flow against the source docs, then integrate only fully specified rules. Current blockers include exact pit configuration for every tier, complete weather transition matrices, incident risk mappings, neutralization probabilities, red-flag recovery, DRS activation windows and track-temperature data.
5. Create a fresh branch for each logical change; add tests first or alongside implementation; do not touch stable code without a source-backed reason.
6. Update this handoff and README after meaningful merges, including the latest commit, tests and unresolved blockers.

## Important constraints

- User wants development continued until the game is fully testable; target incremental development cost is Rp0 where possible.
- Source-of-truth documents override assumptions and generic motorsport conventions.
- Do not claim the app is fully playable, device-tested, or release-ready merely because CI/APK build succeeds.
- Do not commit secrets or real credentials.
