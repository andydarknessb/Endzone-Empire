const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const scheduler = require('../modules/scheduler');
const projection = require('../services/projection.service');

// #1543 (spec #1493, "UTC day everywhere"): the nightly projection fill's
// once-per-window stamp used to key on the host's LOCAL calendar day
// (`now.toLocaleDateString('en-CA')`), unlike its siblings, which already key
// on `cadence.utcDateKey(now)`. Pacific/Marquesas (UTC-9:30) is a half-hour
// zone that crosses local midnight inside the 09:00-09:59 UTC off-peak
// window: 09:10Z and 09:40Z on the same UTC day, 2026-09-17, land on two
// different LOCAL calendar days there. The in-window path bypassed the
// cadence gate entirely and compared only against the stamp, so a local-day
// stamp never matched between the two ticks and the fill ran twice inside one
// window.
//
// The day is now the cadence gate's (server/modules/cadence.js, UTC keys):
// the nightly-projection-fill row's in-window member reads the fill's own
// `nightly-projection-run` Sync run row. This test keeps the same scenario
// through the tick over a fake data_sync_runs table the fill's own insert
// appends to, so a regression to a local-day comparison anywhere on the path
// runs the fill twice and turns it red.
//
// This file is its own process (node --test isolates files), so the row's
// gate state starts empty here - exactly the state a freshly restarted worker
// is in - and the pinned TZ cannot reach another test file.
test('the nightly-projection-fill row keys its day on the UTC day, not the local day, so a half-hour zone crossing local midnight inside the window still runs once (#1543)', async (t) => {
  const prevTz = process.env.TZ;
  process.env.TZ = 'Pacific/Marquesas';
  t.after(() => {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  });

  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  const runs = [];
  const shape = (r) => (r ? { id: 1, finished_at: r.finished_at, ok: r.ok, detail: r.detail } : null);
  createFakePool([
    [/INSERT INTO "data_sync_runs"/, (text, params) => {
      runs.push({ job: params[0], ok: params[2], detail: params[3] ? JSON.parse(params[3]) : null, finished_at: new Date() });
      return { rows: [] };
    }],
    [/FROM "data_sync_runs"/, (text, [job]) => {
      const mine = runs.filter((r) => r.job === job).reverse();
      return { rows: [{ latest: shape(mine[0]), latestOk: shape(mine.find((r) => r.ok)) }] };
    }],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({
      rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-17T09:10:00Z') });
  const row = scheduler.TICK_JOBS.find((job) => job.name === 'nightly-projection-fill');
  let first;
  let ranSecond = false;
  await scheduler.tickUnlocked([{ ...row, run: async (arg) => { first = await row.run(arg); return first; } }]);
  assert.ok(first && first.weeksGenerated > 0, `the first in-window tick ran the fill: ${JSON.stringify(first)}`);
  const callsAfterFirst = calls;
  assert.ok(callsAfterFirst > 0, 'the fill actually did work on the first tick');

  t.mock.timers.setTime(new Date('2026-09-17T09:40:00Z').getTime());
  await scheduler.tickUnlocked([{ ...row, run: async () => { ranSecond = true; } }]);
  assert.equal(ranSecond, false, 'the same UTC calendar day, still inside the window, must not run the fill a second time');
  assert.equal(calls, callsAfterFirst, 'no additional work ran on the second tick');
});
