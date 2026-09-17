const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const scheduler = require('../modules/scheduler');
const cadence = require('../modules/cadence');
const projection = require('../services/projection.service');

// #1543 (spec #1493, "UTC day everywhere"): runNightlyProjectionFill's
// in-process once-per-window stamp used to key on the host's LOCAL calendar
// day (`now.toLocaleDateString('en-CA')`), unlike its siblings
// runNightlyStatsIntegrityScan and runDailyStatCorrections, which already key
// on `cadence.utcDateKey(now)`. Pacific/Marquesas (UTC-9:30) is a half-hour
// zone that crosses local midnight inside the 09:00-09:59 UTC off-peak
// window: 09:10Z and 09:40Z on the same UTC day, 2026-09-17, land on two
// different LOCAL calendar days there. The in-window path (scheduler.js
// :814-815) bypasses the cadence gate entirely and compares only against the
// stamp, so a local-day stamp never matched between the two ticks and the
// fill ran twice inside one window. Reverting scheduler.js:813 to
// `now.toLocaleDateString('en-CA')` turns this test red (verified by hand
// against the reverted line before this fix landed).
//
// This file is its own process (node --test isolates files), so
// `lastProjectionFillDay` starts null here, and the pinned TZ cannot reach
// another test file.
test('runNightlyProjectionFill keys its in-process day stamp on the UTC day, not the local day, so a half-hour zone crossing local midnight inside the window still runs once (#1543)', async (t) => {
  const prevTz = process.env.TZ;
  process.env.TZ = 'Pacific/Marquesas';
  t.after(() => {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  });

  // Stubbed `due: false`: after the fix the second tick is no longer inside
  // the window and falls through to the cadence gate, so this is the only
  // path that can run the fill a second time. A `due: true` stub would run
  // the fill again regardless of the stamp fix under test and leave this
  // test green for the wrong reason.
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));

  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({
      rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const first = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-17T09:10:00Z') });
  assert.ok(first && first.weeksGenerated > 0, `the first in-window tick ran the fill: ${JSON.stringify(first)}`);
  const callsAfterFirst = calls;
  assert.ok(callsAfterFirst > 0, 'the fill actually did work on the first tick');

  const second = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-17T09:40:00Z') });
  assert.equal(second, null, 'the same UTC calendar day, still inside the window, must not run the fill a second time');
  assert.equal(calls, callsAfterFirst, 'no additional work ran on the second tick');
});
