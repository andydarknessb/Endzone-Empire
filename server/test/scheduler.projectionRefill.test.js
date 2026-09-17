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
    const detail = spec && typeof spec === 'object' && spec.detail ? spec.detail : null;
    const row = (finishedAt, ok) => (finishedAt ? { id: 1, finished_at: finishedAt, ok, detail } : null);
    if (spec && typeof spec === 'object') {
      return { rows: [{ latest: row(spec.latest, spec.latest === spec.latestOk), latestOk: row(spec.latestOk, true) }] };
    }
    return { rows: [{ latest: row(spec, true), latestOk: row(spec, true) }] };
  }];
}

// The due/not-due decision itself (a pass crossing UTC midnight, a durable
// row surviving a restart) is now the cadence gate's own concern and lives as
// cadence.test.js table rows (fleet#1508 f3): the "green for the wrong
// reason" row there covers the midnight-crossing case this file used to fake
// a pool read for, and the "ok today" row covers the restart/no-repeat case.
// What is left here is the scheduler's OWN behavior around that decision,
// with cadence.due stubbed directly - no fabricated `FROM "data_sync_runs"`
// read decides due or not due in this file.

test('a successful pass records its own Sync run, with detail.day set to the UTC day it started', async (t) => {
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const fake = createFakePool([[/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })]]).install(t);

  const result = await scheduler.runDailyStatCorrections({ now: new Date('2026-09-23T00:06:00Z') });
  assert.equal(resyncCalls, 1, 'due: true delegates straight to resyncPriorWeeks');
  assert.ok(result);
  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.equal(JSON.parse(inserted.params[3]).day, '2026-09-23', 'the new row records the UTC day the pass started');
});

test('a thrown pass records a failed Sync run for its day and does not move the in-memory short-circuit', async (t) => {
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    resyncCalls += 1;
    const err = new Error('stat correction: 1 projection cache maintenance operation(s) failed');
    err.invalidated = [{ season: 2026, fromWeek: 2, deletedRuns: 31 }];
    throw err;
  });
  const fake = createFakePool([
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);

  const now = new Date('2026-09-29T00:04:00Z');
  await assert.rejects(() => scheduler.runDailyStatCorrections({ now }), /cache maintenance/);
  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.equal(inserted.params[0], 'stat-corrections');
  assert.equal(inserted.params[2], false);
  assert.equal(JSON.parse(inserted.params[3]).day, '2026-09-29');
  // Same day, next tick: a failed run never sets the in-memory stamp (the
  // gate is stubbed due: true throughout, so this is the scheduler's own
  // "did not stamp" behavior, not a gate re-decision), so it retries.
  await assert.rejects(() => scheduler.runDailyStatCorrections({ now: new Date('2026-09-29T00:09:00Z') }));
  assert.equal(resyncCalls, 2);
});

test('runDailyStatCorrections runs once on a correction day and records it as its own Sync run; a same-day retry short-circuits before the gate is asked again', async (t) => {
  const cadence = require('../modules/cadence');
  let dueCalls = 0;
  t.mock.method(cadence, 'due', async () => { dueCalls += 1; return { due: true, reason: 'stubbed due' }; });
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    resyncCalls += 1;
    return { corrected: [], invalidated: [{ season: 2026, fromWeek: 2, deletedRuns: 31 }] };
  });
  const fake = createFakePool([
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);

  const now = new Date('2026-09-16T00:04:00Z');
  const result = await scheduler.runDailyStatCorrections({ now });
  assert.equal(resyncCalls, 1);
  assert.equal(dueCalls, 1);
  assert.deepEqual(result.invalidated, [{ season: 2026, fromWeek: 2, deletedRuns: 31 }]);

  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.ok(inserted, 'the pass is recorded as a Sync run so a restarted worker can see it ran');
  assert.equal(inserted.params[0], 'stat-corrections');
  assert.equal(inserted.params[2], true);
  const detail = JSON.parse(inserted.params[3]);
  assert.equal(detail.invalidated[0].deletedRuns, 31);

  // Same process, same day: the in-memory stamp short-circuits BEFORE the
  // gate is even asked again.
  assert.equal(await scheduler.runDailyStatCorrections({ now: new Date('2026-09-16T00:09:00Z') }), null);
  assert.equal(resyncCalls, 1);
  assert.equal(dueCalls, 1, 'the cadence gate is never re-consulted the same UTC day once this process has already run the pass');
});

test('runDailyStatCorrections never runs outside the UTC Tue/Wed window, restart or not', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const fake = createFakePool([dataSyncRunsHandler({})]).install(t);
  assert.equal(await scheduler.runDailyStatCorrections({ now: new Date('2026-09-17T12:00:00Z') }), null); // Thursday
  assert.equal(resyncCalls, 0);
  assert.equal(fake.calls.length, 0, 'no data_sync_runs read outside the window');
});

// ---------------------------------------------------------------------------
// The cadence gate (server/modules/cadence.js, spec #1492 step two, #1508):
// stat-corrections is the first job on it. These two stub the gate itself
// (not data_sync_runs) and assert delegation only - every "is it actually
// due" case is the cadence table suite's job (server/test/cadence.test.js).
// ---------------------------------------------------------------------------

test('runDailyStatCorrections delegates the due/not-due decision to the cadence gate', async (t) => {
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  let dueOpts = null;
  t.mock.method(cadence, 'due', async (args, opts) => {
    dueArgs = args;
    dueOpts = opts;
    return { due: true, reason: 'stubbed due' };
  });
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  createFakePool([[/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })]]).install(t);

  const now = new Date('2030-06-04T12:00:00Z'); // a Tuesday, inside the correction window
  const result = await scheduler.runDailyStatCorrections({ now });

  assert.deepEqual(dueArgs, { job: 'stat-corrections', every: 'utc-day', now });
  assert.equal(typeof dueOpts.lastRun, 'function', 'a job-specific lastRun reader is injected, per cadence.js\'s own contract');
  assert.equal(resyncCalls, 1, 'due: true delegates straight to resyncPriorWeeks');
  assert.deepEqual(result, { corrected: [], invalidated: [] });
});

test('runDailyStatCorrections never runs the pass when the cadence gate says it is not due', async (t) => {
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });

  const now = new Date('2030-06-05T12:00:00Z'); // a Wednesday, inside the window, a different day from above
  const result = await scheduler.runDailyStatCorrections({ now });

  assert.equal(result, null);
  assert.equal(resyncCalls, 0, 'due: false never reaches resyncPriorWeeks');
});

// ---------------------------------------------------------------------------
// The owed-check itself used to be 150 lines of hand-rolled `data_sync_runs`
// comparison (`projectionRefillOwed`); it is now the cadence gate's own
// concern (server/modules/cadence.js, spec #1492 step two, #1511):
// `cadence.due({ job: 'nightly-projection-run', every: 'utc-day', after:
// 'stat-corrections' })`. Every "is it actually owed" case - the `after`
// dependency's own arithmetic - is the cadence table suite's job
// (cadence.test.js); these two stub the gate directly and assert only this
// function's OWN delegation to it, mirroring `runHourlyOddsSync`'s and
// `runDailyStatCorrections`' equivalent pair of tests (#1510, #1508).
// ---------------------------------------------------------------------------

test('runNightlyProjectionFill delegates the due/not-due decision to the cadence gate', async (t) => {
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  t.mock.method(cadence, 'due', async (args) => { dueArgs = args; return { due: true, reason: 'stubbed due' }; });
  const generated = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, week, playerIds }) => {
    generated.push({ leagueId: league.id, week });
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({
      rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }, { id: 202 }] })],
  ]).install(t);

  // 17:10 UTC, hours outside NIGHTLY_PROJECTION_FILL_UTC_HOUR: due: true alone
  // (no game window open) is what delegates straight to the fill.
  const now = new Date('2026-09-18T17:10:00Z');
  const result = await scheduler.runNightlyProjectionFill({ now });
  assert.ok(result && result.weeksGenerated > 0, `a refill ran: ${JSON.stringify(result)}`);
  assert.deepEqual(generated.map((g) => g.week), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(dueArgs, { job: 'nightly-projection-run', every: 'utc-day', after: 'stat-corrections', now });
});

test('runNightlyProjectionFill never reads the leagues table when the cadence gate says it is not due', async (t) => {
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }] })],
  ]).install(t);

  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-19T17:10:00Z') });
  assert.equal(result, null);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'due: false never reaches the leagues read');
});

// ---------------------------------------------------------------------------
// #1511 AC4: the three pinned cases, driving the REAL cadence.due (no stub on
// cadence itself) through fake `data_sync_runs` rows - same style as
// `runHourlyOddsSync`'s real-gate cases (#1510). Both cases below are pinned
// AT THE GATE: `cadence.due`'s own `after`-dependency arithmetic (covered
// generically by cadence.test.js) is what decides due or not due here: this
// function only acts on the verdict. The projection fill has no day-of-week
// filter of its own (unlike `runDailyStatCorrections`'/`runNflverseFinalization`'s
// Tue-Wed/Mon-Thu windows), so its "Thursday" case is not distinct from any
// other non-correction day; that pinned case lives with nflverse finalization
// in scheduler.test.js instead, where Mon-Thu is a real scheduler-level
// filter beside the gate.
// ---------------------------------------------------------------------------

test('Tuesday with a failed corrections pass: an owed refill does not run (pinned at the gate)', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  const fake = createFakePool([
    dataSyncRunsHandler({
      // Tuesday's correction attempt failed, so stat-corrections' last
      // SUCCESS is still last Tuesday - no fresher than the fill's own last
      // success (Monday), so the gate's `after` dependency stays unsatisfied.
      'stat-corrections': '2026-09-15T00:06:00Z',
      'nightly-projection-run': '2026-09-21T09:10:00Z',
    }),
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  // Tuesday 2026-09-22, outside the off-peak window.
  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-22T17:10:00Z') });
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'not due, so the eligibility read never happens');
});

test('Tuesday with a successful corrections pass: an owed refill runs (pinned at the gate)', async (t) => {
  const generated = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, week, playerIds }) => {
    generated.push({ leagueId: league.id, week });
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    dataSyncRunsHandler({
      // This Tuesday's correction succeeded fresh (00:06); the fill's own
      // last success is still Monday's, so the gate's `after` dependency is
      // satisfied and the daily cadence itself is due (no success yet today).
      'stat-corrections': '2026-09-22T00:06:00Z',
      'nightly-projection-run': '2026-09-21T09:10:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  // 17:10 UTC Tuesday: outside the off-peak window, so this is the owed path.
  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-22T17:10:00Z') });
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

test('an owed refill does not retry-storm once a fill has already succeeded today, even after a later same-day correction (the gate is keyed on latestOk, not on a failed attempt)', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  const fake = createFakePool([
    dataSyncRunsHandler({
      'stat-corrections': '2026-09-15T17:02:00Z',
      // The fill already succeeded once today, at the 09:10 window run - the
      // gate's own `every: 'utc-day'` cadence is not due again today
      // regardless of `after`, so a later same-day correction does not force
      // a second same-day refill; it waits for tomorrow's window instead.
      'nightly-projection-run': '2026-09-15T09:10:00Z',
    }),
    [/FROM "leagues"/, () => ({ rows: [{ id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 }] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  assert.equal(await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-15T17:11:00Z') }), null);
  assert.equal(calls, 0, 'no five-minute retry storm for the rest of the day');
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0);
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
