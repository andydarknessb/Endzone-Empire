const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const scheduler = require('../modules/scheduler');
const correction = require('../services/correction.service');
const projection = require('../services/projection.service');

// The Tue/Wed stat-correction pass invalidates every Weekly projection run
// from week+1 through the end of the season (correction.service). Two things
// made that wipe land on managers as a slow Players page (2026-09-15):
//
//  1. the once-a-day gate was an in-memory stamp, so every worker restart on
//     a correction day (three releases that Tuesday) re-ran the pass and
//     re-wiped a cache the nightly fill had just rebuilt;
//  2. nothing refilled the cache until the next 09:00 UTC nightly window, so
//     every list page in between generated 25 players x 17 weeks on demand
//     (~12 s, 228 queries per page in the route-level loop).
//
// This file is its own process (node --test isolates files), so the
// scheduler's module-level day stamps start null here - exactly the state a
// freshly restarted worker is in.

/**
 * `lastRun`-shaped rows for the two jobs the gates read, keyed by job: a
 * string is one successful run at that instant; `{ latest, latestOk }` sets
 * the two instants apart (a failed attempt newer than the last success).
 */
function dataSyncRunsHandler(byJob) {
  return [/FROM "data_sync_runs"/, (text, params) => {
    const spec = byJob[params[0]] || null;
    const row = (finishedAt, ok) => (finishedAt ? { id: 1, finished_at: finishedAt, ok, detail: null } : null);
    if (spec && typeof spec === 'object') {
      return { rows: [{ latest: row(spec.latest, spec.latest === spec.latestOk), latestOk: row(spec.latestOk, true) }] };
    }
    return { rows: [{ latest: row(spec, true), latestOk: row(spec, true) }] };
  }];
}

test('runDailyStatCorrections does not repeat the pass after a restart when data_sync_runs already records today\'s successful pass', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const fake = createFakePool([
    dataSyncRunsHandler({ 'stat-corrections': '2026-09-15T00:05:00Z' }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);

  // Tuesday 17:01 UTC: the worker just restarted on a release, in-memory
  // stamps are gone, but the durable row says this UTC day's pass already ran.
  const result = await scheduler.runDailyStatCorrections({ now: new Date('2026-09-15T17:01:00Z') });
  assert.equal(result, null);
  assert.equal(resyncCalls, 0, 'the pass (and its cache wipe) must not run a second time on the same correction day');
  assert.equal(fake.calls.filter((c) => c.text.startsWith('INSERT INTO "data_sync_runs"')).length, 0);
});

test('runDailyStatCorrections runs once on a correction day with no successful pass recorded, and records it as its own Sync run', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    resyncCalls += 1;
    return { corrected: [], invalidated: [{ season: 2026, fromWeek: 2, deletedRuns: 31 }] };
  });
  const fake = createFakePool([
    // Yesterday's pass, not today's: Wednesday is the second correction day.
    dataSyncRunsHandler({ 'stat-corrections': '2026-09-15T00:05:00Z' }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);

  const now = new Date('2026-09-16T00:04:00Z');
  const result = await scheduler.runDailyStatCorrections({ now });
  assert.equal(resyncCalls, 1);
  assert.deepEqual(result.invalidated, [{ season: 2026, fromWeek: 2, deletedRuns: 31 }]);

  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.ok(inserted, 'the pass is recorded as a Sync run so a restarted worker can see it ran');
  assert.equal(inserted.params[0], 'stat-corrections');
  assert.equal(inserted.params[2], true);
  const detail = JSON.parse(inserted.params[3]);
  assert.equal(detail.invalidated[0].deletedRuns, 31);

  // Same process, same day: the in-memory stamp short-circuits before any read.
  const readsBefore = fake.calls.filter((c) => /FROM "data_sync_runs"/.test(c.text)).length;
  assert.equal(await scheduler.runDailyStatCorrections({ now: new Date('2026-09-16T00:09:00Z') }), null);
  assert.equal(resyncCalls, 1);
  assert.equal(fake.calls.filter((c) => /FROM "data_sync_runs"/.test(c.text)).length, readsBefore);
});

test('runDailyStatCorrections never runs outside the UTC Tue/Wed window, restart or not', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const fake = createFakePool([dataSyncRunsHandler({})]).install(t);
  assert.equal(await scheduler.runDailyStatCorrections({ now: new Date('2026-09-17T12:00:00Z') }), null); // Thursday
  assert.equal(resyncCalls, 0);
  assert.equal(fake.calls.length, 0, 'no data_sync_runs read outside the window');
});

test('runNightlyProjectionFill refills outside its off-peak window when the last successful correction pass is newer than the last successful fill', async (t) => {
  const generated = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, week, playerIds }) => {
    generated.push({ leagueId: league.id, week });
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    dataSyncRunsHandler({
      'stat-corrections': '2026-09-15T17:02:00Z',
      'nightly-projection-run': '2026-09-15T09:10:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({
      rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }, { id: 202 }] })],
  ]).install(t);

  // 17:10 UTC on the correction day: hours outside NIGHTLY_PROJECTION_FILL_UTC_HOUR,
  // and the wipe at 17:02 post-dates the 09:10 fill, so a refill is owed now.
  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-15T17:10:00Z') });
  assert.ok(result && result.weeksGenerated > 0, `a refill ran: ${JSON.stringify(result)}`);
  assert.deepEqual(generated.map((g) => g.week), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test('an owed refill waits out an open game window (the Tuesday 00:00 UTC pass lands during Monday Night Football)', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  const fake = createFakePool([
    dataSyncRunsHandler({
      'stat-corrections': '2026-09-22T00:06:00Z',
      'nightly-projection-run': '2026-09-21T09:10:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "live_game_states"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 3, regular_season_weeks: 14, playoff_teams: 4 }] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  assert.equal(await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-22T00:10:00Z') }), null);
  assert.equal(calls, 0, 'the fill must not hold the tick while live scoring is running');
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0);
});

test('an owed refill is attempted once per wipe: a failed fill attempt newer than the wipe defers the rest to the off-peak window', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    dataSyncRunsHandler({
      'stat-corrections': '2026-09-15T17:02:00Z',
      // The owed attempt at 17:06 failed on one league (ok=false); the last
      // SUCCESSFUL fill is still the 09:10 window run.
      'nightly-projection-run': { latest: '2026-09-15T17:06:00Z', latestOk: '2026-09-15T09:10:00Z' },
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  assert.equal(await scheduler.projectionRefillOwed(), false);
  assert.equal(await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-15T17:11:00Z') }), null);
  assert.equal(calls, 0, 'no five-minute retry storm for the rest of the day');
});

test('runNightlyProjectionFill stays inside its window when the last successful fill post-dates the last correction pass', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: true }])) };
  });
  const fake = createFakePool([
    dataSyncRunsHandler({
      'stat-corrections': '2026-09-16T00:05:00Z',
      'nightly-projection-run': '2026-09-16T09:10:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  assert.equal(await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-16T17:10:00Z') }), null);
  assert.equal(calls, 0);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'no eligibility read when nothing is owed outside the window');
});
