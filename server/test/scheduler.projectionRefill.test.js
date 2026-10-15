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

// A single live league on week 2 of a 14-week regular season with a 4-team
// playoff (last playoff week 16): the fixture every test below shares that
// only cares that SOME live league exists, not its particular shape
// (pl-endzone formal review n2, #1511).
const LIVE_LEAGUE_ROW = { id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 };

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

// The rows are driven through the tick (tickUnlocked([row])) over a mocked Date,
// so the row's `when`, its cadence gate and its body all see the tick's one
// `now`. The due/not-due decision itself is the cadence gate's own concern,
// covered generically as cadence.test.js table rows (fleet#1508 f3); what is
// pinned here is each row's OWN behavior around that decision, with the gate
// reading fake `data_sync_runs` rows - nothing stubs `cadence.due`.
//
// A row's gate keeps its same-day memo for the life of this process, so a test
// that drives a stat-corrections row uses a UTC day no other test uses.

const clocked = new WeakSet();
async function tickRow(t, name, at) {
  const ms = new Date(at).getTime();
  if (clocked.has(t)) t.mock.timers.setTime(ms);
  else { t.mock.timers.enable({ apis: ['Date'], now: ms }); clocked.add(t); }
  const row = scheduler.TICK_JOBS.find((job) => job.name === name);
  assert.ok(row, `TICK_JOBS has a ${name} row`);
  const out = { ran: false, result: undefined, error: undefined };
  await scheduler.tickUnlocked([{
    ...row,
    run: async (arg) => {
      out.ran = true;
      try {
        out.result = await row.run(arg);
        return out.result;
      } catch (err) {
        out.error = err;
        throw err;
      }
    },
  }]);
  return out;
}

const NO_GAME_WINDOW = [/FROM "live_game_states"/, () => ({ rows: [] })];

/** data_sync_runs as a table the fake pool reads and the runs' own INSERTs append to. */
function runsTable() {
  const runs = [];
  const shape = (r) => (r ? { id: 1, finished_at: r.finished_at, ok: r.ok, detail: r.detail } : null);
  return {
    runs,
    handlers: [
      [/^INSERT INTO "data_sync_runs"/, (text, [job, , ok, detail]) => {
        runs.push({ job, ok, detail: detail ? JSON.parse(detail) : null, finished_at: new Date() });
        return { rows: [] };
      }],
      [/FROM "data_sync_runs"/, (text, [job]) => {
        const mine = runs.filter((r) => r.job === job).reverse();
        return { rows: [{ latest: shape(mine[0]), latestOk: shape(mine.find((r) => r.ok)) }] };
      }],
    ],
  };
}

test('a successful pass records its own Sync run, with detail.day set to the UTC day it started', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const table = runsTable();
  const fake = createFakePool(table.handlers).install(t);

  const out = await tickRow(t, 'stat-corrections', '2026-09-23T00:06:00Z');
  assert.equal(resyncCalls, 1, 'never run: due, delegates straight to resyncPriorWeeks');
  assert.ok(out.result);
  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.equal(JSON.parse(inserted.params[3]).day, '2026-09-23', 'the new row records the UTC day the pass started');
});

test('a thrown pass records a failed Sync run for its day, does not settle it, and is retried once the one hour retry wait has passed', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    resyncCalls += 1;
    const err = new Error('stat correction: 1 projection cache maintenance operation(s) failed');
    err.invalidated = [{ season: 2026, fromWeek: 2, deletedRuns: 31 }];
    throw err;
  });
  const table = runsTable();
  const fake = createFakePool(table.handlers).install(t);

  const first = await tickRow(t, 'stat-corrections', '2026-09-29T00:04:00Z');
  assert.match(first.error.message, /cache maintenance/);
  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.equal(inserted.params[0], 'stat-corrections');
  assert.equal(inserted.params[2], false);
  assert.equal(JSON.parse(inserted.params[3]).day, '2026-09-29');
  // Same day, next tick: the failed row holds the pass back for its retry
  // interval (a wait, not a settled day), and past it the pass retries.
  assert.equal((await tickRow(t, 'stat-corrections', '2026-09-29T00:09:00Z')).ran, false);
  assert.equal(resyncCalls, 1);
  assert.match((await tickRow(t, 'stat-corrections', '2026-09-29T01:05:00Z')).error.message, /cache maintenance/);
  assert.equal(resyncCalls, 2);
});

test('the stat-corrections row runs once on a correction day and records it as its own Sync run; once settled, the rest of that UTC day reads nothing', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    resyncCalls += 1;
    return { corrected: [], invalidated: [{ season: 2026, fromWeek: 2, deletedRuns: 31 }] };
  });
  const table = runsTable();
  const fake = createFakePool(table.handlers).install(t);
  const reads = () => fake.calls.filter((c) => /^SELECT .*FROM "data_sync_runs"/.test(c.text)).length;

  const out = await tickRow(t, 'stat-corrections', '2026-09-16T00:04:00Z');
  assert.equal(resyncCalls, 1);
  assert.deepEqual(out.result.invalidated, [{ season: 2026, fromWeek: 2, deletedRuns: 31 }]);

  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.ok(inserted, 'the pass is recorded as a Sync run so a restarted worker can see it ran');
  assert.equal(inserted.params[0], 'stat-corrections');
  assert.equal(inserted.params[2], true);
  const detail = JSON.parse(inserted.params[3]);
  assert.equal(detail.invalidated[0].deletedRuns, 31);

  // Same process, same day: the next tick reads the row, finds the day settled
  // and runs nothing; the tick after that does not even read.
  assert.equal((await tickRow(t, 'stat-corrections', '2026-09-16T00:09:00Z')).ran, false);
  assert.equal(resyncCalls, 1);
  const readsAfterSecond = reads();
  assert.equal((await tickRow(t, 'stat-corrections', '2026-09-16T00:14:00Z')).ran, false);
  assert.equal(reads(), readsAfterSecond, 'the gate is never re-read the same UTC day once it answered settled');
});

test('the stat-corrections row never runs outside the UTC Tue/Wed window, restart or not', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const fake = createFakePool([dataSyncRunsHandler({})]).install(t);
  const out = await tickRow(t, 'stat-corrections', '2026-09-17T12:00:00Z'); // Thursday
  assert.equal(out.ran, false);
  assert.equal(resyncCalls, 0);
  assert.equal(fake.calls.length, 0, 'no data_sync_runs read outside the window');
});

// ---------------------------------------------------------------------------
// The cadence gate (server/modules/cadence.js, spec #1492 step two, #1508):
// stat-corrections is the first job on it. Every "is it actually due" case is
// the cadence table suite's job (server/test/cadence.test.js); these two assert
// the row's delegation: the job it reads, and that it runs only when due.
// ---------------------------------------------------------------------------

test('the stat-corrections row runs the pass when the job has not succeeded today, reading its own job', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  const table = runsTable();
  const fake = createFakePool(table.handlers).install(t);

  const out = await tickRow(t, 'stat-corrections', '2030-06-04T12:00:00Z'); // a Tuesday, inside the correction window
  assert.deepEqual(fake.calls.filter((c) => /^SELECT .*FROM "data_sync_runs"/.test(c.text)).map((c) => c.params[0]), ['stat-corrections']);
  assert.equal(resyncCalls, 1, 'due: true delegates straight to resyncPriorWeeks');
  assert.deepEqual(out.result, { corrected: 0, invalidated: [] });
});

test('the stat-corrections row never runs the pass when the job already succeeded today', async (t) => {
  let resyncCalls = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => { resyncCalls += 1; return { corrected: [], invalidated: [] }; });
  createFakePool([dataSyncRunsHandler({ 'stat-corrections': '2030-06-05T00:06:00Z' })]).install(t);

  const out = await tickRow(t, 'stat-corrections', '2030-06-05T12:00:00Z'); // a Wednesday, inside the window
  assert.equal(out.ran, false);
  assert.equal(resyncCalls, 0, 'due: false never reaches resyncPriorWeeks');
});

// ---------------------------------------------------------------------------
// The owed-check itself used to be a hand-rolled `data_sync_runs` comparison
// (`projectionRefillOwed`); it is now the cadence gate's own concern
// (server/modules/cadence.js, spec #1492 step two, #1511): the fill row's
// second `anyOf` member is a `nightly-projection-run` cadence with `after:
// 'stat-corrections'`, on days with no game window open. Every "is it actually
// owed" case - the `after` dependency's own arithmetic - is the cadence table
// suite's job (cadence.test.js); these assert the row's delegation to it.
// ---------------------------------------------------------------------------

test('the nightly-projection-fill row refills outside the window when a correction pass is newer than the fill\'s last success', async (t) => {
  const generated = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, week, playerIds }) => {
    generated.push({ leagueId: league.id, week });
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    dataSyncRunsHandler({
      'stat-corrections': '2026-09-18T06:00:00Z',
      'nightly-projection-run': '2026-09-17T09:10:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }, { id: 202 }] })],
  ]).install(t);

  // 17:10 UTC, hours outside NIGHTLY_PROJECTION_FILL_UTC_HOUR: due alone (no
  // game window open) is what delegates straight to the fill.
  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-18T17:10:00Z');
  assert.ok(out.result && out.result.weeksGenerated > 0, `a refill ran: ${JSON.stringify(out.result)}`);
  assert.deepEqual(generated.map((g) => g.week), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test('the nightly-projection-fill row never reads the leagues table when nothing is owed outside the window', async (t) => {
  const fake = createFakePool([
    dataSyncRunsHandler({}),
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-19T17:10:00Z');
  assert.equal(out.ran, false);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'not due, so the leagues read never happens');
});

// ---------------------------------------------------------------------------
// #1511 AC4: the three pinned cases, driving the REAL cadence.due through fake
// `data_sync_runs` rows - same style as the odds row's real-gate cases (#1510).
// Each is pinned AT THE GATE: `cadence.due`'s own `after`-dependency arithmetic
// (covered generically by cadence.test.js) is what decides due or not due
// here: the row only acts on the verdict. The projection fill has no
// day-of-week filter of its own (unlike the stat-corrections and nflverse
// finalization rows' Tue-Wed and Mon-Thu `when`s), so its "Thursday" case is
// not distinct from any other non-correction day; that pinned case lives with
// nflverse finalization in scheduler.test.js instead.
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
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  // Tuesday 2026-09-22, outside the off-peak window.
  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-22T17:10:00Z');
  assert.equal(out.ran, false);
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
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  // 17:10 UTC Tuesday: outside the off-peak window, so this is the owed path.
  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-22T17:10:00Z');
  assert.ok(out.result && out.result.weeksGenerated > 0, `a refill ran: ${JSON.stringify(out.result)}`);
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

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-22T00:10:00Z');
  assert.equal(out.ran, false);
  assert.equal(calls, 0, 'the fill must not hold the tick while live scoring is running');
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0);
});

// pl-endzone formal review f2 (#1511): a stat-correction pass that succeeds
// AFTER the day's off-peak fill has already run once - even on the same UTC
// day - must still refill on the very next tick. `cadence.due`'s `after`
// override (cadence.js, same fleet#1511 f2) is what makes this due despite
// the fill's own `every: 'utc-day'` cadence already having fired today; see
// cadence.test.js's "overrides an already-succeeded-today verdict" case for
// the gate arithmetic itself. AC4's "a Tuesday with a successful pass ...
// unchanged" covers this timing, not only the corrections-before-fill order
// the two pinned tests above exercise.

test('an owed refill runs on the very next tick when a corrections pass succeeds after today\'s off-peak fill, even on the same UTC day', async (t) => {
  const generated = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, week, playerIds }) => {
    generated.push({ leagueId: league.id, week });
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    dataSyncRunsHandler({
      // The fill already succeeded once today at 09:10 (the window run);
      // corrections then succeeded LATER the same day, at 17:02.
      'nightly-projection-run': '2026-09-15T09:10:00Z',
      'stat-corrections': '2026-09-15T17:02:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-15T17:10:00Z');
  assert.ok(out.result && out.result.weeksGenerated > 0, `the same-day wipe was refilled: ${JSON.stringify(out.result)}`);
  assert.deepEqual(generated.map((g) => g.week), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test('the nightly-projection-fill row runs its unit with no transaction (#1913)', async (t) => {
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => ({
    projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])),
  }));
  const fake = createFakePool([
    dataSyncRunsHandler({}),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-17T09:10:00Z');

  assert.ok(out.result && out.result.weeksGenerated > 0, 'the fill ran');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0);
});

test('a successful same-day owed refill is not repeated on the following tick', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  const fake = createFakePool([
    dataSyncRunsHandler({
      // The owed refill above already succeeded at 17:10, AFTER corrections'
      // 17:02 success: nothing is fresher than the fill's own last success
      // any more, so the override no longer fires.
      'nightly-projection-run': '2026-09-15T17:10:00Z',
      'stat-corrections': '2026-09-15T17:02:00Z',
    }),
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-15T17:15:00Z');
  assert.equal(out.ran, false);
  assert.equal(calls, 0, 'no re-run on the very next tick');
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0);
});

// pl-endzone formal review f4 (#1511): spec #1493 story 5 changes the fill's
// failure behaviour - a failed attempt now retries on the very next tick,
// where the old `projectionRefillOwed` treated ANY attempt (`latest`, failed
// or not) as having addressed a wipe and deferred a retry to the next
// off-peak window. The gate reads `latestOk` only, so a failed `latest`
// attempt is invisible to it and never blocks a retry.

test('an owed refill that failed earlier today is retried on the very next tick, not deferred to tomorrow\'s window (spec #1493 story 5)', async (t) => {
  let calls = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    calls += 1;
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    dataSyncRunsHandler({
      // A failed attempt at 05:00 today; the fill's own last SUCCESS is still
      // yesterday's window run, older than today's stat-corrections success.
      'nightly-projection-run': { latest: '2026-09-16T05:00:00Z', latestOk: '2026-09-15T09:10:00Z' },
      'stat-corrections': '2026-09-16T00:06:00Z',
    }),
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-16T05:05:00Z');
  assert.ok(out.result && out.result.weeksGenerated > 0, `retried despite the earlier failed attempt: ${JSON.stringify(out.result)}`);
  assert.ok(calls > 0);
});

test('the nightly-projection-fill row stays idle when the last successful fill post-dates the last correction pass', async (t) => {
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
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-16T17:10:00Z');
  assert.equal(out.ran, false);
  assert.equal(calls, 0);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'no eligibility read when nothing is owed outside the window');
});

// ---------------------------------------------------------------------------
// #1789: a full availability reconcile sweep follows the fill itself - belt
// and braces for a day the injury sync and the roster-status sync both miss
// the 48h practice-squad expiry or a cleared No NFL team. No id list: the
// fill has no "who changed" set, only the players it just generated for.
// ---------------------------------------------------------------------------

// A refill owed outside the window: stat-corrections succeeded after the fill's last success.
const OWED_REFILL_RUNS = dataSyncRunsHandler({
  'stat-corrections': '2026-09-18T06:00:00Z',
  'nightly-projection-run': '2026-09-17T09:10:00Z',
});

test('the nightly-projection-fill row sweeps availability once after the fill, scoped to the lowest live current_week', async (t) => {
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => (
    { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) }
  ));
  let reconcileArgs = null;
  let reconcileCalls = 0;
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 2 }));
  t.mock.method(projection, 'reconcileAvailability', async (args) => {
    reconcileCalls += 1;
    reconcileArgs = args;
    return { checked: 3702, updated: 12 };
  });
  createFakePool([
    OWED_REFILL_RUNS,
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }, { id: 202 }] })],
  ]).install(t);

  const now = new Date('2026-09-18T17:10:00Z');
  const out = await tickRow(t, 'nightly-projection-fill', now);

  assert.ok(out.result && out.result.weeksGenerated > 0, 'the fill ran');
  assert.equal(reconcileCalls, 1, 'the sweep runs exactly once, not per league or per week');
  assert.equal(reconcileArgs.season, 2026);
  assert.equal(reconcileArgs.fromWeek, 2);
  assert.equal(reconcileArgs.playerIds, undefined, 'a full sweep - no id list');
  assert.equal(reconcileArgs.now.getTime(), now.getTime());
});

test('the nightly-projection-fill row never sweeps when the fill itself fails', async (t) => {
  let reconcileCalls = 0;
  // QA f2: `liveReconcileScope` is stubbed to resolve a REAL scope, same as
  // the positive sweep test above - the fake pool's OWN `FROM "leagues"`
  // handler below throws for a different reason (it is what makes the
  // FILL's own fetch fail), and if left unstubbed a reached sweep would hit
  // that SAME throwing handler, get swallowed by the sweep's own catch, and
  // pass this test whether or not the guard on failure actually exists.
  // Stubbing the function directly (not the pool) means a sweep reached on
  // this failure path is guaranteed to call `reconcileAvailability` below.
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 3 }));
  t.mock.method(projection, 'reconcileAvailability', async () => { reconcileCalls += 1; return { checked: 0, updated: 0 }; });
  t.mock.method(console, 'error', () => {});
  createFakePool([
    OWED_REFILL_RUNS,
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => { throw new Error('leagues read blew up'); }],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-18T17:10:00Z');

  assert.equal(out.result, null, 'the fill records its own failure and returns null');
  assert.equal(reconcileCalls, 0, 'a failed fill never reaches the sweep');
});

test('the nightly-projection-fill row: a reconcile failure is logged and never fails the fill', async (t) => {
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => (
    { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) }
  ));
  t.mock.method(projection, 'liveReconcileScope', async () => { throw new Error('scope read blew up'); });
  createFakePool([
    OWED_REFILL_RUNS,
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-18T17:10:00Z');
  assert.ok(out.result && out.result.weeksGenerated > 0, 'the fill itself still succeeds');
});

// ADR 0063: Projection explanations follow the fill, once, for the live week.
test('the nightly-projection-fill row writes Projection explanations once after the fill, and a failure there never fails it', async (t) => {
  const explanations = require('../services/projectionExplanation.service');
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => (
    { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) }
  ));
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 2 }));
  t.mock.method(projection, 'reconcileAvailability', async () => ({ checked: 0, updated: 0 }));
  t.mock.method(console, 'log', () => {});
  // The NFL calendar's week in play, not the league's current_week (2 here).
  t.mock.method(require('../services/nflSeason.service'), 'upcomingNflSeason', async () => 2026);
  t.mock.method(require('../services/pickemSeason.service'), 'getSeasonWeekBounds', async () => [
    { week: 4, lastKickoffAt: new Date('2026-09-21T01:00:00Z') },
    { week: 5, lastKickoffAt: new Date('2026-09-28T01:00:00Z') },
  ]);
  const generate = t.mock.method(explanations, 'generateForWeek', async () => { throw new Error('model blew up'); });
  createFakePool([
    OWED_REFILL_RUNS,
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    NO_GAME_WINDOW,
    [/FROM "leagues"/, () => ({ rows: [LIVE_LEAGUE_ROW] })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
  ]).install(t);

  const now = new Date('2026-09-18T17:10:00Z');
  const out = await tickRow(t, 'nightly-projection-fill', now);
  assert.ok(out.result && out.result.weeksGenerated > 0, 'the fill itself still succeeds');
  assert.equal(generate.mock.callCount(), 1);
  const [scope, opts] = generate.mock.calls[0].arguments;
  assert.deepEqual(scope, { season: 2026, week: 4 });
  assert.equal(opts.now.getTime(), now.getTime());
});
