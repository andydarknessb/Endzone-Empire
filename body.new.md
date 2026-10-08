Stacks on #2110 (merge that first).

## Summary
- `syncInjuries` collects the players whose injury designation changed (prev vs new from the transitions) via the apply callback, and after the unit commits (outside the transaction, ADR 0036) reads who rosters them and calls `sendPushOnce` once per player: prefKey `injuryAlerts`, kind `injury`, subject = player id, fingerprint `<Label|healthy>:<UTC day>`, title `<Name> is now Questionable|Doubtful|Out|IR|healthy`, body = `injury_detail` or empty string, url = that manager's own first unfinished league's lineup page (managers are grouped by url, one `sendPushOnce` call per url). A manager rostering him in several leagues gets one push. Finished leagues are skipped. A push failure is logged and never fails the sync.
- `runDailyInjurySync` now gates on the last successful `injuries` run in both modes: `INJURY_GAME_WINDOW_MS` inside a game window (unchanged), new `INJURY_OFF_WINDOW_MS` (default 6 h, about 105 off-window Tank01 calls a month in season, roughly 75 more than the old once-a-day gate, in-window cost unchanged; doubled in degraded quota) outside one. This replaces the once-per-UTC-day cadence gate. A failed `data_sync_runs` read now fails closed (no Tank01 call) instead of running the sync. `injurySyncDue` is due when elapsed >= the window it is given.
- `render.yaml` documents `INJURY_OFF_WINDOW_MS` beside `INJURY_GAME_WINDOW_MS`.

## Tests
- `node --test server/test/injury.test.js server/test/scheduler.test.js`: 130 pass, 0 fail. New cases: null to Out with two managers in two leagues gives two `sendPushOnce` calls with kind `injury`, [11] with league 1's lineup url and [12] with league 2's; one manager in two leagues gives one target; unchanged designation gives no push and no roster read; cleared designation pushes "healthy"; the roster read follows COMMIT; off-window sync due at 6 h, not at 5 h; `injuryOffWindowMs` default, env and degraded doubling. The three outside-window "once per UTC day" cadence-gate tests in scheduler.test.js were rewritten to the new 6 h rule, not deleted.
- `npm run test:server`: node suites 5387 tests, 5347 pass, 0 fail, 40 skipped; jest 342 of 343 pass, the one failure being `src/lib/scoringMatrix.integration.test.js` (network error, expected on a clean checkout).
- `npm run guards`: exit 0. `npm run lint`: exit 0.

Closes #2106

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01ExiwXacLc2UTjsdQsmVj3v


