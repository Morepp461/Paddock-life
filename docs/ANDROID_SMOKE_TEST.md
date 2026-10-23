# Android Debug APK Smoke Test

Use this checklist after installing the APK produced by **Actions → Android Debug APK**. This is a development build, not a store release.

## Install and launch
- [ ] Install the APK on an Android device.
- [ ] Confirm the app opens in landscape orientation and the screen does not overflow at the device's resolution.
- [ ] Confirm the world seed/catalog loading finishes without an error.
- [ ] Confirm the new-career screen lists the source-backed team, country, and tier choices.

## Career creation and save recovery
- [ ] Create a career using a recognizable manager name and a fixed world seed.
- [ ] Try both supported paths: take over an existing team, and create a team by replacing an eligible weak/medium AI team.
- [ ] Confirm world generation completes without a half-created career or duplicate-team/driver errors.
- [ ] Return to the main menu, then resume the career from the local save list.
- [ ] Force-close and reopen the app, then confirm the save is still discoverable and resumes correctly.

## Race weekend
- [ ] Run the next race weekend.
- [ ] Confirm qualifying classification appears and the grid contains the configured number of drivers.
- [ ] For a scheduled sprint round, confirm sprint results and points appear.
- [ ] Confirm the main race classification, driver standings, constructor standings, and finance ledger update.
- [ ] Confirm repeated taps cannot run the same scheduled race twice.
- [ ] Check that an error leaves the race scheduled rather than partially committing results.

## Team operations
- [ ] Open Drivers and verify current contracted drivers and salaries are shown.
- [ ] Open Transfer Market. Confirm it only lists candidates without a contract for the next season and within the next-season age band.
- [ ] Confirm the market explains when both race seats are already committed. If a seat is available, submit an offer and verify the displayed accepted/counter-offer/rejected result.
- [ ] Open Sponsors, accept one offer and decline another. Confirm each decision persists after leaving and reopening the career.
- [ ] Open Development, start an eligible project, run races to advance it, and verify completion/failure is recorded. Test cancellation and refund separately.
- [ ] Upgrade a facility when affordable and confirm both the facility level and finance ledger change together.
- [ ] Open Finance and verify cash, debt, budget, and recent ledger entries are readable.
- [ ] Complete every scheduled round for the player tier, settle the season, and verify a second settlement attempt is rejected.
- [ ] If a promotion/stay decision appears, test both paths in separate saves; confirm the next season has a fresh calendar, cars, and two age-eligible AI drivers per active team.
- [ ] Confirm the career resumes after season rollover and the dashboard reflects the player team’s actual division.

## Known limitations (do not mark as passing)
- Season rollover, financial movement, promotion/stay choice, AI grid rebuild, and deterministic age/no-team retirement are implemented and covered by CI tests. Staff recruitment/contract negotiation, retired-driver conversion into actual staff roles, and full transfer-window depth remain incomplete.
- The Career Mode race flow still does not fully orchestrate pit stops, incidents, reliability failures, dynamic weather transitions, and safety-car/VSC effects.
- Save snapshot/backup/restore is integrated and SQL.js-tested; native device fault injection and IndexedDB quota/availability behavior still need device verification.
- Cloud sync, authentication, server-authoritative ads, and purchase validation are not release-ready. Do not test real monetization or treat this build as publish-ready.

## Report a failure
Record the device model, Android version, exact steps, expected behavior, actual behavior, and any visible error text. Avoid sending private account credentials or personal data.
