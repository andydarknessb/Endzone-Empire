const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const scheduler = require('../modules/scheduler');

// #2230: a job's throttle lives in its TICK_JOBS row as `gate` (and, when the
// job only runs on certain days or hours, `when`), and the tick reads both.
// Every case below drives one real row through `tickUnlocked([row])` over a
// fake pool whose `data_sync_runs` is a small table, so the cadence gate's own
// arithmetic decides due or not due. Nothing here stubs `cadence.due`.
//
// This file is its own process (node --test isolates files), and a row's gate
// state (its same-day memo, its tick count, its memory stamp) lives as long as
// the process, so each case uses its own UTC day.

const row = (name) => {
  const found = scheduler.TICK_JOBS.find((job) => job.name === name);
  assert.ok(found, `TICK_JOBS has a ${name} row`);
  return found;
};

/**
 * A fake pool holding a `data_sync_runs` table, a settable game window, and a
 * mocked Date the tests move with `tick(name, iso)`.
 */
function world(t, { gameWindow = false } = {}) {
  const w = { runs: [], reads: [], gameWindow, failReads: false, errors: [], warnings: [], leagues: [], live: false, leagueReads: 0 };
  w.record = (job, { ok = true, detail = null, at = new Date() } = {}) => {
    w.runs.push({ job, ok, detail, finished_at: at });
  };
  w.fake = createFakePool([
    [/^INSERT INTO "data_sync_runs"/, (text, [job, , ok, detail]) => {
      w.record(job, { ok, detail: detail ? JSON.parse(detail) : null });
      return { rows: [] };
    }],
    [/FROM "data_sync_runs"/, (text, [job]) => {
      w.reads.push(job);
      if (w.failReads) throw new Error('data_sync_runs unavailable');
      const mine = w.runs
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.job === job)
        .sort((a, b) => b.r.finished_at - a.r.finished_at || b.i - a.i)
        .map(({ r }) => r);
      const shape = (r) => (r ? { id: 1, finished_at: r.finished_at, ok: r.ok, detail: r.detail } : null);
      return { rows: [{ latest: shape(mine[0]), latestOk: shape(mine.find((r) => r.ok)) }] };
    }],
    [/FROM "live_game_states"/, () => ({ rows: w.gameWindow ? [{ '?column?': 1 }] : [] })],
    [/FROM "leagues"/, () => { w.leagueReads += 1; return { rows: w.leagues }; }],
    [/FROM "nfl_games"/, () => ({ rows: w.live ? [{ '?column?': 1 }] : [] })],
  ]).install(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-01-01T00:00:00Z') });
  t.mock.method(console, 'error', (...args) => { w.errors.push(args.join(' ')); });
  t.mock.method(console, 'warn', (...args) => { w.warnings.push(args.join(' ')); });
  t.mock.method(console, 'log', () => {});
  w.setTime = (iso) => t.mock.timers.setTime(new Date(iso).getTime());
  w.tick = async (name, iso) => {
    w.setTime(iso);
    await scheduler.tickUnlocked([row(name)]);
  };
  return w;
}

// ---- cadence --------------------------------------------------------------
// The adp row: `cadence({ job: 'adp', every: 'utc-day', retryMs: 15 min })`.

function adpWorld(t, w, behavior = () => 'ok') {
  const adp = require('../services/adp.service');
  const calls = [];
  t.mock.method(adp, 'syncAdp', async ({ now }) => {
    calls.push(now.toISOString());
    const day = now.toISOString().slice(0, 10);
    const outcome = behavior(calls.length);
    if (outcome === 'fail') {
      w.record('adp', { ok: false, detail: { reason: 'fetch_failed', message: 'FFC unavailable' } });
      throw new Error('FFC unavailable');
    }
    if (outcome === 'refused') {
      w.record('adp', { ok: false, detail: { day, reason: 'refused', refusalReason: 'thin_market' } });
      return { status: 'refused', results: [] };
    }
    w.record('adp', { ok: true, detail: { day } });
    return { status: 'ok', results: [] };
  });
  return calls;
}

test('cadence: due when never run, not due again the same UTC day, due the next UTC day', async (t) => {
  const w = world(t);
  const calls = adpWorld(t, w);
  await w.tick('adp', '2026-08-20T09:00:00Z');
  assert.equal(calls.length, 1, 'never run: due');
  await w.tick('adp', '2026-08-20T09:05:00Z');
  assert.equal(calls.length, 1, 'the next tick, same UTC day: not due');
  await w.tick('adp', '2026-08-20T23:55:00Z');
  assert.equal(calls.length, 1, 'late the same UTC day: not due');
  await w.tick('adp', '2026-08-21T00:05:00Z');
  assert.equal(calls.length, 2, 'the next UTC day: due');
});

test('cadence: a not-due utc-day answer is remembered for the rest of the UTC day, with no further data_sync_runs read', async (t) => {
  const w = world(t);
  adpWorld(t, w);
  await w.tick('adp', '2026-08-22T09:00:00Z'); // reads once, runs
  await w.tick('adp', '2026-08-22T09:05:00Z'); // reads once, not due: the day is settled
  assert.equal(w.reads.length, 2);
  await w.tick('adp', '2026-08-22T09:10:00Z');
  await w.tick('adp', '2026-08-22T20:00:00Z');
  assert.equal(w.reads.length, 2, 'the rest of the UTC day reads nothing');
  await w.tick('adp', '2026-08-23T00:05:00Z');
  assert.equal(w.reads.length, 3, 'a new UTC day reads again');
});

test('cadence: a retry backoff leaves the day unstamped, so the gate reopens on its own and is read every tick meanwhile', async (t) => {
  const w = world(t);
  const calls = adpWorld(t, w, (n) => (n === 1 ? 'fail' : 'ok'));
  await w.tick('adp', '2026-08-24T09:00:00Z');
  assert.equal(calls.length, 1, 'the first run fails');
  await w.tick('adp', '2026-08-24T09:05:00Z');
  await w.tick('adp', '2026-08-24T09:10:00Z');
  assert.equal(calls.length, 1, 'inside the 15 minute retry interval nothing runs');
  assert.equal(w.reads.length, 3, 'a backoff answer is never remembered: each tick still reads');
  // Red tell: stamping the day on the backoff answer would skip this run.
  await w.tick('adp', '2026-08-24T09:16:00Z');
  assert.equal(calls.length, 2, 'once the interval has passed the same UTC day runs again');
});

test('cadence: a refused run settles the UTC day, the next UTC day is due again', async (t) => {
  const w = world(t);
  const calls = adpWorld(t, w, () => 'refused');
  await w.tick('adp', '2026-08-25T09:00:00Z');
  await w.tick('adp', '2026-08-25T09:05:00Z');
  await w.tick('adp', '2026-08-25T18:00:00Z');
  assert.equal(calls.length, 1, 'a same-day refusal settles the day like a success would');
  await w.tick('adp', '2026-08-26T09:00:00Z');
  assert.equal(calls.length, 2);
});

test('cadence: a failed data_sync_runs read counts as due (fail open), warns, and is not remembered', async (t) => {
  const w = world(t);
  const calls = adpWorld(t, w);
  w.failReads = true;
  await w.tick('adp', '2026-08-27T09:00:00Z');
  assert.equal(calls.length, 1, 'the job must not sit blocked on an unreadable table');
  assert.ok(w.warnings.some((line) => /adp/.test(line) && /data_sync_runs unavailable/.test(line)), 'the failed read is logged');
  w.failReads = false;
  await w.tick('adp', '2026-08-27T09:05:00Z');
  assert.equal(calls.length, 1, 'the run recorded a row, so the readable table now says settled');
});

test('cadence: an interval job reads its table every tick and is due once the interval has passed', async (t) => {
  const w = world(t);
  const espnOdds = require('../services/espnOdds.provider');
  const synced = [];
  t.mock.method(espnOdds, 'syncOdds', async ({ week }) => {
    synced.push(week);
    w.record('odds');
    return { gamesWritten: 1 };
  });
  w.leagues = [{ current_season: 2026, current_week: 2 }];
  await w.tick('odds', '2026-09-11T12:00:00Z');
  await w.tick('odds', '2026-09-11T12:30:00Z');
  await w.tick('odds', '2026-09-11T12:59:00Z');
  assert.deepEqual(synced, [2], 'inside the hour: not due');
  await w.tick('odds', '2026-09-11T13:00:00Z');
  assert.deepEqual(synced, [2, 2], 'an hour after the last success: due');
});

// ---- when -----------------------------------------------------------------

test('when: a row whose predicate is false is skipped without reading data_sync_runs', async (t) => {
  const w = world(t);
  const correction = require('../services/correction.service');
  let passes = 0;
  t.mock.method(correction, 'runStatCorrections', async () => { passes += 1; return { failedWeeks: [] }; });
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizations = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizations += 1; return { finalized: [] }; });

  await w.tick('stat-corrections', '2026-09-17T12:00:00Z'); // Thursday: not a correction day
  await w.tick('nflverse-finalization', '2026-09-25T12:00:00Z'); // Friday: outside Mon-Thu
  assert.equal(passes, 0);
  assert.equal(finalizations, 0);
  assert.equal(w.reads.length, 0, 'a `when` that is false never reads the DB');

  await w.tick('stat-corrections', '2026-09-22T12:00:00Z'); // Tuesday
  await w.tick('nflverse-finalization', '2026-09-24T12:00:00Z'); // Thursday, last day of the window
  assert.equal(passes, 1);
  assert.equal(finalizations, 1);
});

test('when: the nightly stats integrity scan waits for its UTC hour, then the cadence gate decides', async (t) => {
  const w = world(t);
  const integrity = require('../services/playerStatsIntegrity.service');
  let scans = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => { scans += 1; return { scanned: 1, open: 0, resolved: 0 }; });
  await w.tick('nightly-stats-integrity', '2026-09-20T08:59:00Z');
  await w.tick('nightly-stats-integrity', '2026-09-20T10:00:00Z');
  assert.equal(scans, 0, 'outside 09:00-09:59 UTC: skipped');
  assert.equal(w.reads.length, 0);
  await w.tick('nightly-stats-integrity', '2026-09-20T09:30:00Z');
  await w.tick('nightly-stats-integrity', '2026-09-20T09:45:00Z');
  assert.equal(scans, 1, 'once per UTC day');
});

test('when: weather snapshots wait out an open game window before the cadence gate is read', async (t) => {
  const w = world(t, { gameWindow: true });
  const weatherSnapshots = require('../services/weatherSnapshots.service');
  let runs = 0;
  t.mock.method(weatherSnapshots, 'runWeatherSnapshots', async () => { runs += 1; w.record('weather-snapshots'); return { status: 'ok' }; });
  await w.tick('weather-snapshots', '2026-09-13T12:00:00Z');
  assert.equal(runs, 0, 'a game window is open');
  assert.equal(w.reads.length, 0, '`when` runs before the gate, so the gate was never read');
  w.gameWindow = false;
  await w.tick('weather-snapshots', '2026-09-13T12:05:00Z');
  assert.equal(runs, 1);
  await w.tick('weather-snapshots', '2026-09-13T12:10:00Z');
  assert.equal(runs, 1, 'six hour cadence');
});

// ---- none -----------------------------------------------------------------

test('none: a self-limiting row runs on every tick and never reads data_sync_runs', async (t) => {
  const w = world(t);
  const pickemSeason = require('../services/pickemSeason.service');
  let runs = 0;
  t.mock.method(pickemSeason, 'syncPickemOnlyWeeks', async () => { runs += 1; return []; });
  await w.tick('pickem-week-sync', '2026-09-29T12:00:00Z');
  await w.tick('pickem-week-sync', '2026-09-29T12:05:00Z');
  await w.tick('pickem-week-sync', '2026-09-29T12:10:00Z');
  assert.equal(runs, 3);
  assert.equal(w.reads.length, 0);
});

// ---- memory ---------------------------------------------------------------

test('memory: due when never run, then only once the interval has passed; the stamp is taken before the run', async (t) => {
  const w = world(t);
  const practiceParticipation = require('../services/practiceParticipation.service');
  let calls = 0;
  let fail = false;
  t.mock.method(practiceParticipation, 'syncCurrentWeeks', async () => {
    calls += 1;
    if (fail) throw new Error('nflverse unreachable');
    return { synced: [] };
  });
  await w.tick('nflverse-practice', '2026-11-03T09:00:00Z');
  await w.tick('nflverse-practice', '2026-11-03T09:14:00Z');
  assert.equal(calls, 1, '14 minutes on: not yet');
  await w.tick('nflverse-practice', '2026-11-03T09:15:00Z');
  assert.equal(calls, 2, '15 minutes on: due');
  assert.equal(w.reads.length, 0, 'a memory gate reads no table');

  fail = true;
  await w.tick('nflverse-practice', '2026-11-04T09:00:00Z');
  fail = false;
  await w.tick('nflverse-practice', '2026-11-04T09:05:00Z');
  assert.equal(calls, 3, 'a failing run is stamped too: not retried on the next tick');
  assert.ok(w.errors.some((line) => /nflverse-practice/.test(line) && /nflverse unreachable/.test(line)), 'the throw is contained and logged');
  await w.tick('nflverse-practice', '2026-11-04T09:15:00Z');
  assert.equal(calls, 4);
});

// ---- everyTicks -----------------------------------------------------------

test('everyTicks: live-sync runs on the first tick, again next tick after a falsy result, and paces by the resolved tick count only after a sync that happened', async (t) => {
  const w = world(t);
  const prev = { key: process.env.RAPID_API_KEY, host: process.env.RAPID_API_HOST };
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  t.after(() => {
    for (const [name, value] of [['RAPID_API_KEY', prev.key], ['RAPID_API_HOST', prev.host]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const tank01Client = require('../modules/tank01Client');
  let mode = 'ok';
  t.mock.method(tank01Client, 'getQuotaState', async () => {
    if (mode === 'unavailable') throw new Error('quota table missing');
    return { mode };
  });
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  const matchupScoring = require('../services/matchupScoring.service');
  const pushAlerts = require('../services/pushAlerts.service');
  t.mock.method(feedSyncRuns, 'syncWeekStats', async () => ({ plays: [] }));
  t.mock.method(matchupScoring, 'scoreMatchups', async () => ({ scored: [] }));
  t.mock.method(pushAlerts, 'sendAlert', async () => {});
  w.leagues = [{ id: 42, current_season: 2026, current_week: 3 }];
  let minute = 0;
  const next = async () => {
    minute += 5;
    await w.tick('live-sync', new Date(Date.UTC(2026, 8, 13, 17, 0) + minute * 60000).toISOString());
  };

  await next();
  assert.equal(w.leagueReads, 1, 'quota healthy: the first tick syncs');
  await next();
  // Red tell: resetting the count on any run (not only a truthy result) skips this tick.
  assert.equal(w.leagueReads, 2, 'after a run whose result was falsy, the next tick runs again');

  w.live = true;
  await next();
  assert.equal(w.leagueReads, 3, 'a game window is open: this sync happens, which resets the count');
  for (let i = 1; i <= 5; i += 1) {
    await next();
    assert.equal(w.leagueReads, 3, `tick ${i} after a sync that happened: still counting`);
  }
  // Red tell: a constant 7 in place of the resolved tick count (6) turns this red.
  await next();
  assert.equal(w.leagueReads, 4, 'the sixth tick after a sync that happened is due again');

  mode = 'degraded';
  for (let i = 1; i <= 11; i += 1) {
    await next();
    assert.equal(w.leagueReads, 4, `degraded quota doubles the interval: tick ${i} of 12`);
  }
  await next();
  assert.equal(w.leagueReads, 5, 'the twelfth tick under degraded quota syncs');

  mode = 'unavailable';
  for (let i = 1; i <= 5; i += 1) {
    await next();
    assert.equal(w.leagueReads, 5, `quota state unavailable falls back to the default: tick ${i} of 6`);
  }
  await next();
  assert.equal(w.leagueReads, 6, 'the sixth tick with no quota state syncs');
});

// ---- anyOf: the nightly projection fill ----------------------------------

function fillWorld(t, w) {
  const projectionFill = require('../services/projectionFill.service');
  const calls = [];
  t.mock.method(projectionFill, 'runNightlyFill', async ({ now }) => {
    calls.push(now.toISOString());
    w.record('nightly-projection-run', { detail: { day: now.toISOString().slice(0, 10) } });
    return { weeksGenerated: 1 };
  });
  return calls;
}

test('anyOf: the fill runs inside 09:00 UTC without waiting on a stat-correction pass, once per UTC day', async (t) => {
  const w = world(t);
  const calls = fillWorld(t, w);
  await w.tick('nightly-projection-fill', '2026-09-21T08:59:00Z');
  assert.equal(calls.length, 0, 'before the window, and no refill is owed');
  await w.tick('nightly-projection-fill', '2026-09-21T09:05:00Z');
  assert.equal(calls.length, 1, 'inside the window, with stat-corrections never having run');
  await w.tick('nightly-projection-fill', '2026-09-21T09:40:00Z');
  assert.equal(calls.length, 1, 'the same UTC day, still inside the window: not again');
  await w.tick('nightly-projection-fill', '2026-09-22T09:05:00Z');
  assert.equal(calls.length, 2, 'the next UTC day');
});

test('anyOf: the fill is due outside 09:00 UTC when stat-corrections succeeded after the fill\'s last success', async (t) => {
  const w = world(t);
  const calls = fillWorld(t, w);
  w.record('nightly-projection-run', { at: new Date('2026-09-23T09:05:00Z'), detail: { day: '2026-09-23' } });
  w.record('stat-corrections', { at: new Date('2026-09-23T13:00:00Z'), detail: { day: '2026-09-23' } });
  await w.tick('nightly-projection-fill', '2026-09-23T14:00:00Z');
  assert.equal(calls.length, 1, 'the correction wiped the cache after the fill: refilled the same UTC day');
  await w.tick('nightly-projection-fill', '2026-09-23T14:05:00Z');
  assert.equal(calls.length, 1, 'refilled once, no longer owed');
});

test('anyOf: an owed refill waits for the game window to close, and nothing is owed without a newer stat-correction pass', async (t) => {
  const w = world(t, { gameWindow: true });
  const calls = fillWorld(t, w);
  w.record('nightly-projection-run', { at: new Date('2026-09-30T09:05:00Z'), detail: { day: '2026-09-30' } });
  w.record('stat-corrections', { at: new Date('2026-09-30T13:00:00Z'), detail: { day: '2026-09-30' } });
  await w.tick('nightly-projection-fill', '2026-09-30T14:00:00Z');
  assert.equal(calls.length, 0, 'a game window is open');
  w.gameWindow = false;
  await w.tick('nightly-projection-fill', '2026-09-30T14:05:00Z');
  assert.equal(calls.length, 1, 'the first tick after the slate goes final');

  w.record('nightly-projection-run', { at: new Date('2026-10-07T09:05:00Z'), detail: { day: '2026-10-07' } });
  w.record('stat-corrections', { at: new Date('2026-10-06T13:00:00Z'), detail: { day: '2026-10-06' } });
  await w.tick('nightly-projection-fill', '2026-10-07T14:00:00Z');
  assert.equal(calls.length, 1, 'stat-corrections is older than the fill\'s last success: nothing owed');
});

test('anyOf: a failed fill is not stamped, so the next tick inside the window retries it and the throw is contained', async (t) => {
  const w = world(t);
  const projectionFill = require('../services/projectionFill.service');
  let calls = 0;
  t.mock.method(projectionFill, 'runNightlyFill', async ({ now }) => {
    calls += 1;
    if (calls === 1) {
      w.record('nightly-projection-run', { ok: false, detail: { reason: 'write_failed' } });
      throw new Error('league 7 failed');
    }
    w.record('nightly-projection-run', { detail: { day: now.toISOString().slice(0, 10) } });
    return { weeksGenerated: 1 };
  });
  await w.tick('nightly-projection-fill', '2026-10-14T09:05:00Z');
  await w.tick('nightly-projection-fill', '2026-10-14T09:10:00Z');
  assert.equal(calls, 2, 'the failed run left the day open');
  await w.tick('nightly-projection-fill', '2026-10-14T09:15:00Z');
  assert.equal(calls, 2, 'and the success settles it');
  assert.equal(scheduler.TICK_JOBS.find((j) => j.name === 'nightly-projection-fill').syncRun, undefined);
  assert.ok(w.errors.some((line) => /league 7 failed/.test(line)));
});

// ---- retention ------------------------------------------------------------

test('retention: a Sync run on a UTC cadence: one run row on the first tick of the UTC day, none on the second, listed in status', async (t) => {
  const w = world(t);
  const retention = require('../services/retention.service');
  let passes = 0;
  t.mock.method(retention, 'enforceRetention', async () => {
    passes += 1;
    return { authTokens: 2, refreshTokens: 0, notifications: 0, chatMessages: 0 };
  });

  await w.tick('retention', '2026-10-20T03:00:00Z');
  await w.tick('retention', '2026-10-20T03:05:00Z');
  await w.tick('retention', '2026-10-20T22:00:00Z');
  assert.equal(passes, 1);
  const rows = w.runs.filter((r) => r.job === 'retention');
  assert.equal(rows.length, 1, 'one data_sync_runs row for the UTC day');
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].detail.authTokens, 2, 'the counts ride in the row\'s detail');
  assert.equal(rows[0].detail.day, '2026-10-20');
  assert.ok(w.fake.calls.every((c) => c.via === 'pool'), 'transaction: false: no client was checked out for the deletes');

  await w.tick('retention', '2026-10-21T00:05:00Z');
  assert.equal(passes, 2, 'the next UTC day');
  assert.equal(w.runs.filter((r) => r.job === 'retention').length, 2);

  const status = await scheduler.getSchedulerStatus();
  assert.ok('retention' in status.syncRuns, 'getSchedulerStatus lists retention');
  assert.ok(status.syncRuns.retention.latestOk, 'with its latest ok run');
  assert.ok(scheduler.SYNC_RUN_JOBS.includes('retention'));
});

test('retention: a thrown pass records a failed run and is retried on the next tick', async (t) => {
  const w = world(t);
  const retention = require('../services/retention.service');
  let passes = 0;
  t.mock.method(retention, 'enforceRetention', async () => {
    passes += 1;
    if (passes === 1) throw new Error('deadlock detected');
    return { authTokens: 0, refreshTokens: 0, notifications: 0, chatMessages: 0 };
  });
  await w.tick('retention', '2026-10-22T03:00:00Z');
  assert.equal(w.runs.filter((r) => r.job === 'retention' && !r.ok).length, 1);
  await w.tick('retention', '2026-10-22T03:05:00Z');
  assert.equal(passes, 2, 'a failed run does not settle the day');
  await w.tick('retention', '2026-10-22T03:10:00Z');
  assert.equal(passes, 2);
});

// ---- the table ------------------------------------------------------------

test('every TICK_JOBS row declares a gate, and its `when`, if any, is a function', () => {
  for (const job of scheduler.TICK_JOBS) {
    assert.equal(typeof job.gate.due, 'function', `${job.name} has a gate`);
    if (job.when !== undefined) assert.equal(typeof job.when, 'function', `${job.name}.when`);
  }
});

test('the tick contains a throw from `when`, `due` or `run`, and the rows after it still run', async (t) => {
  const w = world(t);
  w.setTime('2026-10-27T12:00:00Z');
  const ran = [];
  const due = { due: async () => ({ due: true, reason: 'test' }) };
  await scheduler.tickUnlocked([
    { name: 'bad-when', tier: 'deadline', when: async () => { throw new Error('when blew up'); }, gate: due, run: async () => { ran.push('bad-when'); } },
    { name: 'bad-due', tier: 'deadline', gate: { due: async () => { throw new Error('due blew up'); } }, run: async () => { ran.push('bad-due'); } },
    { name: 'bad-run', tier: 'deadline', gate: due, run: async () => { throw new Error('run blew up'); } },
    { name: 'skipped', tier: 'deadline', when: () => false, gate: due, run: async () => { ran.push('skipped'); } },
    { name: 'not-due', tier: 'deadline', gate: { due: async () => ({ due: false, reason: 'test' }) }, run: async () => { ran.push('not-due'); } },
    { name: 'last', tier: 'deadline', gate: due, run: async () => { ran.push('last'); } },
  ]);
  assert.deepEqual(ran, ['last']);
  for (const message of ['when blew up', 'due blew up', 'run blew up']) {
    assert.ok(w.errors.some((line) => line.includes(message)), message);
  }
  assert.match((await scheduler.getSchedulerStatus()).lastTickError, /bad-run: run blew up/);
});

test('the tick hands every row one shared `now` and settles a gate with the row\'s result', async (t) => {
  world(t);
  const seen = [];
  const settled = [];
  const gate = { due: async (now) => { seen.push(now); return { due: true, reason: 'test' }; }, settle: (result) => { settled.push(result); } };
  await scheduler.tickUnlocked([
    { name: 'one', tier: 'deadline', gate, run: async ({ now }) => { seen.push(now); return 'first'; } },
    { name: 'two', tier: 'deadline', gate, run: async ({ now }) => { seen.push(now); return 'second'; } },
  ]);
  assert.equal(new Set(seen).size, 1, 'one Date object per tick, passed to every gate and run');
  assert.deepEqual(settled, ['first', 'second']);
});
