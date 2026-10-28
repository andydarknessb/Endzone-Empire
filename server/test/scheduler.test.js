const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const push = require('../services/push.service');
const { sendAlert } = require('../services/pushAlerts.service');
const { banterFor } = require('../services/pushBanter');

test('close-matchup push targets Game Center instead of the retired Matchups route', async (t) => {
  const sent = [];
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    [insert('push_events'), (text, [user_id]) => ({ rows: [{ user_id }] })],
  ]);
  fake.install(t);
  t.mock.method(push, 'sendPushToUsers', async (ownerIds, payload) => {
    sent.push({ ownerIds, payload });
    return { sent: ownerIds.length };
  });

  await sendAlert({
    kind: 'close-matchup',
    leagueId: 42,
    week: 7,
    scored: [{ matchupId: 987654, homeTeamId: 3, awayTeamId: 4, homeScore: 101, awayScore: 96.5 }],
  });

  const prefsQuery = fake.calls.find((c) => /notification_prefs/.test(c.text));
  assert.deepEqual(prefsQuery.params, [[11, 22]], 'both owners are checked against their preferences');
  assert.deepEqual(sent.map((s) => s.ownerIds), [[11], [22]], 'one push per owner');
  assert.deepEqual(sent[1].payload, sent[0].payload);
  assert.equal(sent[0].payload.url, '/#/league/42/game-center');
  assert.equal(sent[0].payload.title, 'Your matchup is close!');
  assert.equal(sent[0].payload.banter, banterFor('closeMatchup', 'close:987654:7', { margin: 4.5, week: 7 }));
});

const scheduler = require('../modules/scheduler');
const tank01Client = require('../modules/tank01Client');
const pool = require('../modules/pool');
const pickClock = require('../services/pickClock.service');
const draftSweepLiveness = require('../modules/draftSweepLiveness');


// ---- driving one real TICK_JOBS row ----------------------------------------
// Every job below is a row of TICK_JOBS, and the row (its `when`, its gate, its
// run) is what these tests drive, through the tick: `tickUnlocked([row])`, over
// a mocked Date so the tick's one `now` is the instant under test. `tickRow`
// reports what the row did: `ran` (its `run` was called, i.e. the gate said
// due), `result` (what `run` returned) and `error` (what it threw; the tick
// contains the throw and logs it). A row's gate keeps its state (the same-day
// memo, a tick count, a memory stamp) for the life of this process, so a test
// that drives a cadence row uses a UTC day no other test uses for that row.

const clocked = new WeakSet();
function setClock(t, at) {
  const ms = new Date(at).getTime();
  if (clocked.has(t)) {
    t.mock.timers.setTime(ms);
    return;
  }
  t.mock.timers.enable({ apis: ['Date'], now: ms });
  clocked.add(t);
}

async function tickRow(t, name, at) {
  const row = scheduler.TICK_JOBS.find((job) => job.name === name);
  assert.ok(row, `TICK_JOBS has a ${name} row`);
  setClock(t, at);
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

const runRow = async (t, name, at) => (await tickRow(t, name, at)).result;

/** data_sync_runs as a table the fake pool both reads (lastRun's shape) and appends to (runSyncJob's INSERT). */
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
        const mine = runs
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => r.job === job)
          .sort((a, b) => b.r.finished_at - a.r.finished_at || b.i - a.i)
          .map(({ r }) => r);
        return { rows: [{ latest: shape(mine[0]), latestOk: shape(mine.find((r) => r.ok)) }] };
      }],
    ],
  };
}

/** `lastRun`-shaped `{ latest, latestOk }` for one ok run that finished at `iso`. */
function ranAt(iso, detail = null) {
  const run = { id: 1, finished_at: iso, ok: true, detail };
  return { latest: run, latestOk: run };
}

const ALWAYS_DUE = { due: async () => ({ due: true, reason: 'test' }) };

// ---- draft-clock tick containment (#600) -----------------------------------
// draftTick is not exported: it runs off the scheduler's draft-clock interval,
// so these start the scheduler with only setInterval mocked and fire that
// interval by hand.

const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

test('the draft-clock interval stamps the draft-sweep liveness key after the sweep runs, and not on a skipped tick (#842)', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => scheduler.stopScheduler());
  const stamps = [];
  t.mock.method(draftSweepLiveness, 'recordDraftSweep', async () => { stamps.push(Date.now()); return true; });
  let locked = true;
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] };
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
      throw new Error(`unexpected: ${text}`);
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  // The sweep's one read: no active draft, so it returns at once.
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  scheduler.startScheduler();
  t.mock.timers.tick(10 * 1000);
  await flush();
  assert.equal(stamps.length, 1, 'an acquired tick stamps liveness exactly once');

  locked = false;
  t.mock.timers.tick(10 * 1000);
  await flush();
  // Red tell: stamping before the lock (or on skip) would count 2 here and let a
  // worker that never runs its sweep look alive.
  assert.equal(stamps.length, 1, 'a skipped tick does not stamp');
});

test('the draft-clock interval contains a failure in the advisory-lock acquisition itself, without an unhandled rejection', async (t) => {
  // The sweep contains its own failures, and draftTickUnlocked has always caught
  // the sweep. The gap #600 closes is withAdvisoryLock's OWN acquisition - the
  // pool.connect() and the try-lock query - which runs before the work callback
  // and is covered by no inner catch. A rejection there used to reach setInterval
  // as an unhandled rejection and could take the worker (and every live draft's
  // clock) down. draftTick now catches it. Red tell: drop draftTick's try/catch
  // and the rejection is unhandled, which node:test fails the run for.
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => scheduler.stopScheduler());
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  t.mock.method(pool, 'connect', async () => { throw new Error('pool exhausted acquiring the draft-clock lock'); });

  scheduler.startScheduler();
  t.mock.timers.tick(10 * 1000);
  await flush();

  assert.ok(errors.some((line) => /draft clock tick failed to acquire its lock/.test(line) && /pool exhausted/.test(line)));
});

// ---- the 5-minute tick's own containment (#2541) ---------------------------
// Same gap #600 closed on the draft clock, on the league-scheduler lock:
// withAdvisoryLock's acquisition (the pool connect and the try-lock query) runs
// before tickUnlocked, so a rejection there used to reach setInterval unhandled
// and exit the worker (processHandlers.js settles an unhandled rejection by
// exiting 1).

test('the 5-minute tick records a failed lock acquisition as its last tick error, and the next tick runs its work (#2541)', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
      throw new Error(`unexpected: ${text}`);
    },
    release: () => {},
  };
  let connectFails = true;
  t.mock.method(pool, 'connect', async () => {
    if (connectFails) throw new Error('pool exhausted acquiring the league-scheduler lock');
    return client;
  });
  // getSchedulerStatus reads every feed job's last run; nothing has run here.
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const ran = [];
  const row = { name: 'test-duty', gate: ALWAYS_DUE, run: async () => { ran.push('ran'); return 'ok'; } };

  // Red tell: remove tick's try/catch and this await rejects (the worker's exit).
  await scheduler.tick([row]);
  assert.deepEqual(ran, [], 'the work never ran');
  assert.ok(
    errors.some((line) => /scheduler tick failed to acquire its lock/.test(line) && /pool exhausted/.test(line)),
    'the failure is logged'
  );
  const failed = await scheduler.getSchedulerStatus();
  assert.match(failed.lastTickError, /pool exhausted acquiring the league-scheduler lock/, 'and recorded as the last tick error');

  // The following tick takes the lock and runs its work normally.
  connectFails = false;
  await scheduler.tick([row]);
  assert.deepEqual(ran, ['ran'], 'the following tick runs its work');
  assert.equal((await scheduler.getSchedulerStatus()).lastTickError, null, 'and a clean tick clears the error');
});

test('stopScheduler tears down armed Pick-clock timers so none fire after a stop (#601)', (t) => {
  // Timers are torn down with the scheduler: after a stop, no armed in-process
  // expiry timer may fire, so a test run or a shutdown cannot leak a late
  // Autopick. autoPick's first act is to read the league row; counting that
  // read is a faithful proxy for "the timer fired autoPick".
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => pickClock.cancelAllExpiryTimers());
  let leagueReads = 0;
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM "leagues" WHERE "id" = $1')) leagueReads += 1;
    return { rows: [] };
  });

  pickClock.armExpiryTimer(9001, new Date(Date.now() + 5000));
  scheduler.stopScheduler();
  t.mock.timers.tick(10000); // well past the 5s deadline

  // Red tell: drop cancelAllExpiryTimers() from stopScheduler and the timer
  // survives the stop, fires autoPick on this tick, and leagueReads becomes 1.
  assert.equal(leagueReads, 0, 'no armed timer fired autoPick after the scheduler stopped');
});


/**
 * #1188, #2115: the every-INJURY_SYNC_MS decision reads the last successful
 * `injuries` run in data_sync_runs, not a module variable, so a worker restart
 * (a fresh module instance) cannot re-run it more often than the cadence
 * allows. One cadence inside and outside a game window: the ESPN document is
 * free, so there is no quota doubling and no window branch (ADR 0060).
 */
function injuryWorld(t, { inWindow = true } = {}) {
  const scoring = require('../services/feedSyncRuns.service');
  // ESPN needs no credential: the job must run with no Tank01 key configured.
  const previousKey = process.env.RAPID_API_KEY;
  const previousHost = process.env.RAPID_API_HOST;
  delete process.env.RAPID_API_KEY;
  delete process.env.RAPID_API_HOST;
  t.after(() => {
    if (previousKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = previousKey;
    if (previousHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = previousHost;
  });
  const world = { runs: [], calls: 0, fail: false, inWindow, clock: null };
  const fake = createFakePool([
    // The cadence gate's read: lastRun('injuries') (#1205), shaped the way
    // syncRun.js's lastRun query does, `{ latest, latestOk }`.
    [/FROM "data_sync_runs"/, () => {
      const sorted = [...world.runs].sort((a, b) => b.finished_at - a.finished_at);
      const latest = sorted[0];
      const latestOk = sorted.find((r) => r.ok);
      return {
        rows: [{
          latest: latest ? { id: sorted.length, finished_at: latest.finished_at, ok: latest.ok, detail: null } : null,
          latestOk: latestOk ? { id: sorted.length, finished_at: latestOk.finished_at, ok: true, detail: null } : null,
        }],
      };
    }],
    [/FROM "live_game_states"/, () => ({ rows: world.inWindow ? [{ '?column?': 1 }] : [] })],
  ]);
  fake.install(t);
  t.mock.method(scoring, 'syncInjuries', async () => {
    world.calls += 1;
    if (world.fail) {
      world.runs.push({ ok: false, finished_at: world.clock });
      throw new Error('ESPN unavailable');
    }
    world.runs.push({ ok: true, finished_at: world.clock });
    return { playersUpdated: 10, irFlags: 1 };
  });
  world.run = (now) => {
    world.clock = new Date(now);
    return tickRow(t, 'injuries', now);
  };
  return world;
}

for (const [label, inWindow, T] of [
  ['inside a game window', true, new Date('2026-09-13T12:00:00-05:00')], // Sunday, first kickoff minus 90 min
  ['outside a game window', false, new Date('2026-08-20T12:00:00-05:00')],
]) {
  test(`the injuries row ${label}: due at 15 minutes after the last ok run, not at 14 (#2115)`, async (t) => {
    const world = injuryWorld(t, { inWindow });
    assert.ok((await world.run(T)).ran, 'never run: due');
    assert.equal((await world.run(new Date(T.getTime() + 14 * 60 * 1000))).ran, false, 'fourteen minutes on: not yet');
    assert.ok((await world.run(new Date(T.getTime() + 15 * 60 * 1000))).ran, 'fifteen minutes on: runs');
    assert.ok((await world.run(new Date(T.getTime() + 60 * 60 * 1000))).ran, 'an hour on: long past due');
    assert.equal(world.calls, 3);
  });
}

test('the injuries row is unchanged by degraded Tank01 quota: still due at 15 minutes, and quota is never read (#2115)', async (t) => {
  const world = injuryWorld(t, { inWindow: true });
  const quota = t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'degraded' }));
  const T = new Date('2026-09-13T12:00:00-05:00');
  assert.ok((await world.run(T)).ran);
  assert.ok((await world.run(new Date(T.getTime() + 15 * 60 * 1000))).ran, 'degraded quota does not double the cadence');
  assert.equal(quota.mock.callCount(), 0, 'ESPN spends no Tank01 budget, so quota is not consulted');
});

test('the injuries row propagates a thrown syncInjuries; the failed run does not move the gate', async (t) => {
  const world = injuryWorld(t, { inWindow: false });
  const T = new Date('2026-08-20T12:00:00-05:00');
  assert.ok((await world.run(T)).ran);
  world.fail = true;
  const retryAt = new Date(T.getTime() + 15 * 60 * 1000);
  const failed = await world.run(retryAt);
  assert.match(failed.error.message, /ESPN unavailable/);
  world.fail = false;
  assert.ok((await world.run(new Date(retryAt.getTime() + 5 * 60 * 1000))).ran, 'next tick retries off the last OK run');
});

test('the injuries row fails closed when the data_sync_runs read fails: no sync, the error surfaces', async (t) => {
  const world = injuryWorld(t, { inWindow: false });
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  const original = pool.query;
  t.mock.method(pool, 'query', (sql, params) => (/FROM "data_sync_runs"/.test(sql)
    ? Promise.reject(new Error('db down'))
    : original.call(pool, sql, params)));
  const out = await world.run(new Date('2026-08-20T12:00:00-05:00'));
  assert.equal(out.ran, false);
  assert.equal(world.calls, 0);
  assert.ok(errors.some((line) => /injuries/.test(line) && /db down/.test(line)), 'the tick logs it as the row\'s failure');
});

test('the injuries row honors INJURY_SYNC_MS and falls back to 15 minutes on an unusable value (#2115)', async (t) => {
  const prev = process.env.INJURY_SYNC_MS;
  t.after(() => {
    if (prev === undefined) delete process.env.INJURY_SYNC_MS; else process.env.INJURY_SYNC_MS = prev;
  });
  const world = injuryWorld(t, { inWindow: false });
  const T = new Date('2026-08-21T12:00:00-05:00');

  process.env.INJURY_SYNC_MS = '60000';
  assert.ok((await world.run(T)).ran);
  assert.equal((await world.run(new Date(T.getTime() + 59 * 1000))).ran, false, '59 seconds on: not yet at a 60 second cadence');
  assert.ok((await world.run(new Date(T.getTime() + 60 * 1000))).ran, 'the env value is read each tick: due at 60 seconds');

  process.env.INJURY_SYNC_MS = 'not a number';
  const U = new Date(T.getTime() + 60 * 60 * 1000);
  assert.ok((await world.run(U)).ran, 'an hour on: long past due');
  assert.equal((await world.run(new Date(U.getTime() + 14 * 60 * 1000))).ran, false, 'an unusable value falls back to 15 minutes: not due at 14');
  assert.ok((await world.run(new Date(U.getTime() + 15 * 60 * 1000))).ran, 'and due at 15');
});

// ---- daily player sync (#2115, #2117, ADR 0060) ------------------------------
// The run reads the ESPN team rosters, so it needs no Tank01 credentials: the
// world runs with none set.

function playerSyncWorld(t) {
  const scoring = require('../services/feedSyncRuns.service');
  const saved = { key: process.env.RAPID_API_KEY, host: process.env.RAPID_API_HOST };
  delete process.env.RAPID_API_KEY;
  delete process.env.RAPID_API_HOST;
  t.after(() => {
    for (const [name, value] of [['RAPID_API_KEY', saved.key], ['RAPID_API_HOST', saved.host]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const world = { runs: [], calls: [], clock: null, fail: false };
  createFakePool([
    [/FROM "data_sync_runs"/, () => {
      const row = (r) => (r ? { id: world.runs.length, finished_at: r.finished_at, ok: r.ok, detail: null } : null);
      const sorted = [...world.runs].sort((a, b) => b.finished_at - a.finished_at);
      return { rows: [{ latest: row(sorted[0]), latestOk: row(sorted.find((r) => r.ok)) }] };
    }],
  ]).install(t);
  t.mock.method(scoring, 'syncPlayers', async (args) => {
    world.calls.push({ season: args.season, now: args.now.toISOString() });
    world.runs.push({ finished_at: world.clock, ok: !world.fail });
    if (world.fail) throw new Error('ESPN unavailable');
    return { season: args.season, playersUpserted: 3 };
  });
  world.run = (now) => {
    world.clock = new Date(now);
    return tickRow(t, 'player-sync', now);
  };
  return world;
}

test('the player-sync row runs once per UTC day, not twice, and again the next UTC day', async (t) => {
  const world = playerSyncWorld(t);
  const T = new Date('2026-10-08T09:00:00Z');
  assert.ok((await world.run(T)).ran, 'never run: due');
  assert.equal((await world.run(new Date(T.getTime() + 5 * 60 * 1000))).ran, false, 'the next tick, same UTC day: not due');
  assert.equal((await world.run(new Date('2026-10-08T23:55:00Z'))).ran, false, 'late the same UTC day: not due');
  assert.ok((await world.run(new Date('2026-10-09T00:05:00Z'))).ran, 'the next UTC day: due');
  assert.equal(world.calls.length, 2);
  assert.deepEqual(world.calls[0], { season: 2026, now: T.toISOString() });
});

test('the player-sync row backs off an hour after a failed run, then retries the same UTC day', async (t) => {
  const world = playerSyncWorld(t);
  const T = new Date('2026-10-15T09:00:00Z');
  world.fail = true;
  assert.match((await world.run(T)).error.message, /ESPN unavailable/);
  assert.equal((await world.run(new Date(T.getTime() + 30 * 60 * 1000))).ran, false, '30 minutes after the failure: backing off');
  world.fail = false;
  assert.ok((await world.run(new Date(T.getTime() + 60 * 60 * 1000))).ran, 'an hour after the failure: retries');
  assert.equal(world.calls.length, 2, 'the backed-off tick spent no ESPN sweep');
});

test('the player-sync row runs with no Tank01 credentials set (#2117: it reads ESPN)', async (t) => {
  const world = playerSyncWorld(t);
  assert.equal(process.env.RAPID_API_KEY, undefined);
  assert.equal(process.env.RAPID_API_HOST, undefined);
  assert.ok((await world.run(new Date('2026-10-22T09:00:00Z'))).ran, 'due, and not gated on credentials');
  assert.equal(world.calls.length, 1);
});

test('the player-sync tick job is housekeeping tier and names the players Sync run once', () => {
  const job = scheduler.TICK_JOBS.find((j) => j.name === 'player-sync');
  assert.equal(job.tier, 'housekeeping');
  assert.deepEqual(job.syncRun, ['players']);
  assert.equal(scheduler.SYNC_RUN_JOBS.filter((name) => name === 'players').length, 1);
});

// ---- daily ADP sync (#747, #1509) -------------------------------------------
// The due/not-due decision is the cadence gate's own concern (server/modules/
// cadence.js, cadence.test.js's table suite covers the 'utc-day' cadence and
// the "a failed run is never latestOk" case generically). No in-memory day
// stamp decides it here (#1509 AC1): these drive the adp row over a fake
// data_sync_runs table and assert this row's OWN behavior around that decision.

test('the adp row runs syncAdp with the tick\'s now when the job has never run', async (t) => {
  const adp = require('../services/adp.service');
  const calls = [];
  t.mock.method(adp, 'syncAdp', async (opts) => {
    calls.push(opts.now.toISOString());
    return { ok: true, playersUpdated: 180 };
  });
  dataSyncRunsPool({}).install(t);

  const out = await tickRow(t, 'adp', '2026-08-10T12:00:00Z');
  assert.deepEqual(out.result, { ok: true, playersUpdated: 180 });
  assert.deepEqual(calls, ['2026-08-10T12:00:00.000Z'], 'due: true delegates straight to syncAdp with the same now');
});

test('the adp row never calls syncAdp when the job already succeeded today', async (t) => {
  const adp = require('../services/adp.service');
  let calls = 0;
  t.mock.method(adp, 'syncAdp', async () => { calls += 1; return { ok: true }; });
  dataSyncRunsPool({ adp: ranAt('2026-08-11T06:00:00.000Z', { day: '2026-08-11' }) }).install(t);

  const out = await tickRow(t, 'adp', '2026-08-11T12:00:00Z');
  assert.equal(out.ran, false);
  assert.equal(calls, 0);
});

test('the adp row propagates a thrown syncAdp so the next tick retries (a throw never moves the gate)', async (t) => {
  const adp = require('../services/adp.service');
  t.mock.method(adp, 'syncAdp', async () => { throw new Error('FFC unavailable'); });
  dataSyncRunsPool({}).install(t);

  const out = await tickRow(t, 'adp', '2026-08-12T12:00:00Z');
  assert.match(out.error.message, /FFC unavailable/);
});

// The two tests below exercise the REAL cadence gate against a fake
// data_sync_runs table, because the gate's own `latestOk`-only read is
// exactly what #1509's risk review found wrong for this job: a thin-market/
// thin-match refusal (adp.service.js's wipe guard) resolves rather than
// throws and records ok=false, so on the gate's plain default reader it would
// never close for the day, and every five-minute tick would re-hit FFC for
// the rest of the UTC day while the market stays thin - the exact hazard the
// pre-#1509 in-memory `lastAdpSyncDay` stamp existed to prevent. The gate
// (cadence.js) fixes this by reading the latest run's typed outcome: a
// same-day `refused` run settles the day.
//
// Built on `dataSyncRunsPool` below (formal review, fix 3) rather than a
// second hand-rolled data_sync_runs fake: `adp` is a GETTER, so
// `byJob['adp']` recomputes `{ latest, latestOk }` from the live `runs` array
// on every read, the same way the hand-rolled version did, with no separate
// pattern of its own.
function adpRunsWorld(t) {
  const runs = [];
  dataSyncRunsPool({
    get adp() {
      const sorted = [...runs].sort((a, b) => b.finished_at - a.finished_at);
      const latest = sorted[0];
      const latestOk = sorted.find((r) => r.ok);
      return {
        latest: latest ? { id: sorted.length, finished_at: latest.finished_at, ok: latest.ok, detail: latest.detail } : null,
        latestOk: latestOk ? { id: sorted.length, finished_at: latestOk.finished_at, ok: true, detail: latestOk.detail } : null,
      };
    },
  }).install(t);
  return runs;
}

test('the adp row: a same-UTC-day refusal (thin market) also closes the gate, not just a success (#1509 risk review)', async (t) => {
  const adp = require('../services/adp.service');
  const cadenceModule = require('../modules/cadence');
  const runs = adpRunsWorld(t);
  let calls = 0;
  t.mock.method(adp, 'syncAdp', async ({ now }) => {
    calls += 1;
    const day = cadenceModule.utcDateKey(now);
    runs.push({ finished_at: new Date(now), ok: false, detail: { day, reason: 'refused', refusalReason: 'thin_market', adpPlayers: 40 } });
    return { ok: false, skipped: true, reason: 'thin_market', format: 'half-ppr', teams: 12, adpPlayers: 40, playersMatched: 0, playersUpdated: 0 };
  });

  assert.ok((await tickRow(t, 'adp', '2026-08-20T12:00:00-05:00')).ran);
  assert.equal(calls, 1);
  // A second tick the same UTC day must NOT re-hit FFC, even though the only
  // recorded run so far is a refusal (ok=false), not a success.
  assert.equal((await tickRow(t, 'adp', '2026-08-20T18:00:00-05:00')).ran, false);
  assert.equal(calls, 1, 'a same-day refusal closes the gate the same way a success would');
  // The next UTC day, the gate opens again.
  assert.ok((await tickRow(t, 'adp', '2026-08-21T12:00:00-05:00')).ran);
  assert.equal(calls, 2);
});

test('the adp row: a thrown syncAdp (fetch_failed/write_failed) never closes the gate; it retries once ADP_RETRY_MS has passed', async (t) => {
  const adp = require('../services/adp.service');
  const runs = adpRunsWorld(t);
  let calls = 0;
  t.mock.method(adp, 'syncAdp', async ({ now }) => {
    calls += 1;
    // fetch_failed carries no run-level detail (runSyncJob.js): the throw
    // happens before any { units, detail } wrapper is returned, so there is
    // no detail.day and no detail.reason === 'refused' to substitute for
    // latestOk - this row must never close the gate.
    runs.push({ finished_at: new Date(now), ok: false, detail: { reason: 'fetch_failed', message: 'FFC unavailable' } });
    throw new Error('FFC unavailable');
  });

  assert.match((await tickRow(t, 'adp', '2026-08-30T12:00:00-05:00')).error.message, /FFC unavailable/);
  assert.equal(calls, 1);
  assert.equal((await tickRow(t, 'adp', '2026-08-30T12:05:00-05:00')).ran, false);
  assert.equal(calls, 1, 'inside ADP_RETRY_MS the failed run holds the job back');
  assert.match((await tickRow(t, 'adp', '2026-08-30T12:16:00-05:00')).error.message, /FFC unavailable/);
  assert.equal(calls, 2, 'a thrown run never closes the gate, so the job retries after its interval');
});

// ---- daily ESPN depth-chart & Ownership syncs (#1308, #1509) ----------------
// Same shape as the ADP section above: the due/not-due decision is the
// cadence gate's own concern, so these drive the rows over a fake data_sync_runs
// table and assert this row's OWN delegation to espnFactsSync.runDepthChartSync /
// runOwnershipSync. No in-memory day stamp or lastEspnFactsSyncAt wrapper
// remains for either job (#1509 AC1).

test('the espn-depth-chart row runs runDepthChartSync with the tick\'s now when never run, and not once it succeeded today', async (t) => {
  const espnFactsSync = require('../modules/espnFactsSync');
  const calls = [];
  t.mock.method(espnFactsSync, 'runDepthChartSync', async (opts) => { calls.push(opts.now.toISOString()); return { results: [] }; });
  dataSyncRunsPool({ 'espn-depth-chart': ranAt('2026-08-14T06:00:00.000Z', { day: '2026-08-14' }) }).install(t);

  const out = await tickRow(t, 'espn-depth-chart', '2026-08-13T12:00:00Z');
  assert.deepEqual(out.result, { results: [] });
  assert.deepEqual(calls, ['2026-08-13T12:00:00.000Z'], 'due: delegates straight to runDepthChartSync with the same now');
  assert.equal((await tickRow(t, 'espn-depth-chart', '2026-08-14T12:00:00Z')).ran, false, 'a success earlier today: not due');
  assert.equal(calls.length, 1);
});

test('the espn-ownership row runs runOwnershipSync with the tick\'s now when never run, and not once it succeeded today', async (t) => {
  const espnFactsSync = require('../modules/espnFactsSync');
  const calls = [];
  t.mock.method(espnFactsSync, 'runOwnershipSync', async (opts) => { calls.push(opts.now.toISOString()); return { written: 4000 }; });
  dataSyncRunsPool({ 'espn-ownership': ranAt('2026-08-14T06:00:00.000Z', { day: '2026-08-14' }) }).install(t);

  const out = await tickRow(t, 'espn-ownership', '2026-08-13T12:00:00Z');
  assert.deepEqual(out.result, { written: 4000 });
  assert.deepEqual(calls, ['2026-08-13T12:00:00.000Z']);
  assert.equal((await tickRow(t, 'espn-ownership', '2026-08-14T12:00:00Z')).ran, false, 'a success earlier today: not due');
  assert.equal(calls.length, 1);
});

// ---- hourly Line (odds) refresh (#1234, #1510) -------------------------------
// The due/not-due decision is the cadence gate's own concern, reading the odds
// job's own data_sync_runs rows. No in-memory epoch remains here (#1510 AC2).

const LEAGUES_ON_WEEK_2 = [/FROM "leagues"/, () => ({ rows: [{ current_season: 2026, current_week: 2 }] })];

test('the odds row syncs the slate a live league is on when never run', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const calls = [];
  t.mock.method(espnOdds, 'syncOdds', async ({ season, week }) => {
    calls.push({ season, week });
    return { gamesWritten: 1 };
  });
  dataSyncRunsPool({}, [LEAGUES_ON_WEEK_2]).install(t);

  const out = await tickRow(t, 'odds', '2026-09-11T12:00:00Z');
  assert.deepEqual(out.result, [{ gamesWritten: 1 }]);
  assert.deepEqual(calls, [{ season: 2026, week: 2 }], 'due: true delegates straight to the leagues read and syncOdds');
});

test('the odds row never reads the leagues table when the job succeeded inside the hour', async (t) => {
  const fake = dataSyncRunsPool({ odds: ranAt('2026-09-11T12:05:00.000Z') }, [LEAGUES_ON_WEEK_2]).install(t);

  const out = await tickRow(t, 'odds', '2026-09-11T12:10:00Z');
  assert.equal(out.ran, false);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'due: false never reaches the leagues read');
});

test('the odds row syncs every distinct (season, week) a live league is on, and one week failing does not stop another', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const calls = [];
  t.mock.method(espnOdds, 'syncOdds', async ({ season, week }) => {
    calls.push({ season, week });
    if (week === 2) throw new Error('ESPN unavailable');
    return { gamesWritten: 3 };
  });
  dataSyncRunsPool({}, [
    [/FROM "leagues"/, () => ({
      rows: [
        { current_season: 2026, current_week: 2 },
        { current_season: 2026, current_week: 3 },
      ],
    })],
  ]).install(t);

  const out = await tickRow(t, 'odds', '2026-09-12T12:00:00Z');
  assert.deepEqual(calls, [{ season: 2026, week: 2 }, { season: 2026, week: 3 }]);
  assert.deepEqual(out.result, [{ gamesWritten: 3 }], 'the failed week is skipped, not thrown');
});

// The three cases below drive the REAL cadence gate over a fake data_sync_runs
// table, so the gate's actual due/not-due arithmetic is what decides each case,
// per the lead's review (pl-endzone, PR #1530 f2).

test('the odds row reads the leagues table again on the very next tick when no league was live, because nothing ever became latestOk', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  let syncCalls = 0;
  t.mock.method(espnOdds, 'syncOdds', async () => { syncCalls += 1; return { gamesWritten: 1 }; });
  const fake = dataSyncRunsPool({}, [[/FROM "leagues"/, () => ({ rows: [] })]]).install(t);

  const first = await tickRow(t, 'odds', '2026-09-13T12:00:00Z');
  assert.deepEqual(first.result, [], 'no live league, so no odds Sync run is attempted');
  assert.equal(syncCalls, 0);
  assert.equal(fake.calls.filter((c) => c.text.includes('FROM "leagues"')).length, 1);

  // Ten minutes later: nothing was ever written, so `latestOk` is still null
  // and the real gate is still due - the leagues table is read again rather
  // than staying silent for the rest of the hour.
  const second = await tickRow(t, 'odds', '2026-09-13T12:10:00Z');
  assert.deepEqual(second.result, []);
  assert.equal(fake.calls.filter((c) => c.text.includes('FROM "leagues"')).length, 2, 'the gate answers due again, so the leagues read repeats');
});

test('the odds row retries on the very next tick, not the full hour, when every week on a tick fails', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  let syncCalls = 0;
  t.mock.method(espnOdds, 'syncOdds', async ({ week }) => {
    syncCalls += 1;
    throw new Error(`ESPN unavailable for week ${week}`);
  });
  dataSyncRunsPool({}, [
    [/FROM "leagues"/, () => ({
      rows: [
        { current_season: 2026, current_week: 2 },
        { current_season: 2026, current_week: 3 },
      ],
    })],
  ]).install(t); // no week has ever succeeded

  const first = await tickRow(t, 'odds', '2026-09-14T12:00:00Z');
  assert.deepEqual(first.result, [], 'every week failed, so no result is pushed');
  assert.equal(syncCalls, 2);

  // Five minutes later, same never-succeeded table (no failed week's row
  // ever becomes latestOk): the real gate is still due, so both weeks are
  // retried - the retry spec #1493 story 5 wants, rather than waiting out
  // the full hour.
  const second = await tickRow(t, 'odds', '2026-09-14T12:05:00Z');
  assert.deepEqual(second.result, []);
  assert.equal(syncCalls, 4, 'both weeks are retried on the very next tick');
});

test('the odds row is not due when the job already succeeded inside the hour, and is an hour on (contrast case)', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  let syncCalls = 0;
  t.mock.method(espnOdds, 'syncOdds', async () => { syncCalls += 1; return { gamesWritten: 1 }; });
  const fake = dataSyncRunsPool({ odds: ranAt('2026-09-15T11:55:00.000Z', { gamesWritten: 3 }) }, [LEAGUES_ON_WEEK_2]).install(t);

  // Ten minutes after the last success - well inside the hour.
  const early = await tickRow(t, 'odds', '2026-09-15T12:05:00Z');
  assert.equal(early.ran, false);
  assert.equal(syncCalls, 0);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'not due, so the leagues table is never read');

  const late = await tickRow(t, 'odds', '2026-09-15T12:55:00Z');
  assert.ok(late.ran, 'an hour after the last success it is due');
  assert.equal(syncCalls, 1);
});

// ---- nflverse IDP-finalization pass (#1511) --------------------------------
// The second consumer of the cadence gate (server/modules/cadence.js, spec
// #1492 step two): `syncNflverseWeek` (nflverseSync.service.js) already
// writes a `nflverse-week` Sync run through `runSyncJob` for every
// (season, week) `finalizePriorWeeks` processes, on every run regardless of
// outcome (ADR 0036), so the gate reads that job directly - no second,
// scheduler-level row, same as the odds row's `job: 'odds'` gate above.
// Deliberately no `after: 'stat-corrections'` (pl-endzone formal review f1,
// #1511): this pass runs Mon-Thu, stat-corrections only ever succeeded
// Tue/Wed, and an `after` dependency here starved Monday and Thursday
// outright (on those days stat-corrections' last success is never fresher
// than nflverse-week's own). The Mon-Thu window is the row's `when`, which
// has no gate equivalent: a day outside it never reads the table at all.

test('the nflverse-finalization row runs finalizePriorWeeks when the job has not succeeded today', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] }; });
  const fake = dataSyncRunsPool({}).install(t);

  const out = await tickRow(t, 'nflverse-finalization', '2026-09-22T12:00:00Z'); // a Tuesday, inside the Mon-Thu window
  assert.equal(finalizeCalls, 1, 'due: true delegates straight to finalizePriorWeeks');
  assert.deepEqual(out.result, { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] });
  assert.deepEqual(fake.calls.map((c) => c.params[0]), ['nflverse-week'], 'no `after` (f1): this pass never depended on stat-corrections');
});

test('the nflverse-finalization row never calls finalizePriorWeeks when the job already succeeded today', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [] }; });
  dataSyncRunsPool({ 'nflverse-week': ranAt('2026-09-23T09:10:00.000Z', { day: '2026-09-23' }) }).install(t);

  const out = await tickRow(t, 'nflverse-finalization', '2026-09-23T12:00:00Z'); // a Wednesday, inside the window
  assert.equal(out.ran, false);
  assert.equal(finalizeCalls, 0, 'due: false never reaches finalizePriorWeeks');
});

// The Mon-Thu day filter (`isNflverseFinalizationDay`) has no cadence
// equivalent, so it is pinned at the row: a day outside the window must never
// even read the table, and Thursday - the window's last day - must still run.

test('the nflverse-finalization row never reads the gate on a Friday, outside its Mon-Thu window', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [] }; });
  const fake = dataSyncRunsPool({}).install(t);

  const out = await tickRow(t, 'nflverse-finalization', '2026-09-25T12:00:00Z'); // Friday
  assert.equal(out.ran, false);
  assert.equal(fake.calls.length, 0, 'the day filter short-circuits before the gate is ever read');
  assert.equal(finalizeCalls, 0);
});

test('Thursday: the nflverse-finalization row still runs, the last day of its Mon-Thu window (pinned at the row)', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [] }; });
  const fake = dataSyncRunsPool({}).install(t);

  await tickRow(t, 'nflverse-finalization', '2026-10-01T12:00:00Z'); // Thursday
  assert.equal(fake.calls.length, 1, 'Thursday is still inside the window, so the gate is read');
  assert.equal(finalizeCalls, 1);
});

// pl-endzone formal review f1 (#1511): finalization's behaviour no longer
// depends on stat-corrections at all (no `after`). The table handler asserts it
// is never asked for 'stat-corrections' - proving independence, not merely a
// case where corrections happens to be irrelevant.

test('the nflverse-finalization row runs on a Tuesday off its own cadence alone, never reading stat-corrections (pinned at the gate)', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] }; });
  // Last succeeded Monday, a prior UTC day relative to Tuesday's `now`.
  const monday = { id: 2, finished_at: '2026-10-05T09:10:00.000Z', ok: true, detail: null };
  createFakePool([
    [/FROM "data_sync_runs"/, (text, [job]) => {
      assert.equal(job, 'nflverse-week', 'no `after` dependency: stat-corrections is never read');
      return { rows: [{ latest: monday, latestOk: monday }] };
    }],
  ]).install(t);

  const out = await tickRow(t, 'nflverse-finalization', '2026-10-06T12:00:00Z'); // Tuesday
  assert.deepEqual(out.result, { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] });
  assert.equal(finalizeCalls, 1);
});

test('the nflverse-finalization row runs on a Thursday after a Wednesday success (regression pin: an after: stat-corrections dependency would starve this day, f1)', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [{ season: 2026, week: 3, playersUpdated: 2 }] }; });
  // Wednesday's run is the last success; stat-corrections' own last success
  // (also Wednesday) would never look fresher than this under `after` -
  // exactly the starvation f1 found. Without `after`, the plain daily
  // cadence alone is due: Wednesday is a prior UTC day relative to Thursday.
  const wednesday = { id: 3, finished_at: '2026-10-14T09:10:00.000Z', ok: true, detail: null };
  createFakePool([
    [/FROM "data_sync_runs"/, (text, [job]) => {
      assert.equal(job, 'nflverse-week');
      return { rows: [{ latest: wednesday, latestOk: wednesday }] };
    }],
  ]).install(t);

  const out = await tickRow(t, 'nflverse-finalization', '2026-10-15T12:00:00Z'); // Thursday
  assert.deepEqual(out.result, { finalized: [{ season: 2026, week: 3, playersUpdated: 2 }] });
  assert.equal(finalizeCalls, 1);
});

// ---- nflverse game-context fill (#1725) --------------------------------------
// `syncScheduleFromNflverse` fills nfl_games venue/roof/surface/rest_days (COALESCE)
// and nothing else ran it. Once per UTC day, current season only, through the
// cadence gate on the job the sync already writes a run row for
// ('schedule-nflverse'), so a manual POST /scoring/sync-schedule that ran today
// also satisfies the gate. Every "is it actually due" case is the cadence suite's.

test('the nflverse-game-context-fill row asks about schedule-nflverse once per UTC day and fills the current season', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const nflSeason = require('../services/nflSeason.service');
  t.mock.method(nflSeason, 'upcomingNflSeason', async () => 2026);
  const calls = [];
  t.mock.method(nflverseSync, 'syncScheduleFromNflverse', async (args) => { calls.push(args); return { ok: true }; });
  const fake = dataSyncRunsPool({}).install(t);

  const out = await tickRow(t, 'nflverse-game-context-fill', '2026-09-28T12:00:00Z');

  assert.deepEqual(fake.calls.map((c) => c.params[0]), ['schedule-nflverse']);
  assert.deepEqual(calls, [{ season: 2026 }], 'the current season only, never a past one');
  assert.deepEqual(out.result, { ok: true });
});

test('the nflverse-game-context-fill row does nothing when the job already ran today', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const nflSeason = require('../services/nflSeason.service');
  let seasonReads = 0;
  t.mock.method(nflSeason, 'upcomingNflSeason', async () => { seasonReads += 1; return 2026; });
  let syncCalls = 0;
  t.mock.method(nflverseSync, 'syncScheduleFromNflverse', async () => { syncCalls += 1; return {}; });
  dataSyncRunsPool({ 'schedule-nflverse': ranAt('2026-10-07T09:00:00.000Z', { day: '2026-10-07' }) }).install(t);

  const out = await tickRow(t, 'nflverse-game-context-fill', '2026-10-07T12:05:00Z');
  assert.equal(out.ran, false);
  assert.equal(syncCalls, 0, 'due: false never reaches the fill');
  assert.equal(seasonReads, 0);
});

test('the nflverse-game-context-fill row runs at most once per UTC day against the real gate, and again the next UTC day', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const nflSeason = require('../services/nflSeason.service');
  const syncRun = require('../modules/syncRun');
  t.mock.method(nflSeason, 'upcomingNflSeason', async () => 2026);
  let syncCalls = 0;
  const runs = [];
  t.mock.method(nflverseSync, 'syncScheduleFromNflverse', async () => {
    syncCalls += 1;
    return {};
  });
  // The sync writes its own run row; model it as the gate's reader would see it.
  t.mock.method(syncRun, 'lastRun', async (job) => {
    assert.equal(job, 'schedule-nflverse');
    const last = runs[runs.length - 1] || null;
    return { latest: last, latestOk: last };
  });
  const tickAt = async (iso) => {
    const before = syncCalls;
    await tickRow(t, 'nflverse-game-context-fill', iso);
    if (syncCalls > before) runs.push({ id: runs.length + 1, finishedAt: new Date(iso), ok: true, detail: null });
  };

  await tickAt('2026-11-10T09:00:00Z');
  await tickAt('2026-11-10T09:05:00Z');
  await tickAt('2026-11-10T23:55:00Z');
  assert.equal(syncCalls, 1, 'every later tick the same UTC day is gated out');
  await tickAt('2026-11-11T00:05:00Z');
  assert.equal(syncCalls, 2, 'the next UTC day runs again');
});

test('the nflverse-game-context-fill row lets a failed fill throw so the tick can log it, and the failed run stays due', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const nflSeason = require('../services/nflSeason.service');
  t.mock.method(nflSeason, 'upcomingNflSeason', async () => 2026);
  t.mock.method(nflverseSync, 'syncScheduleFromNflverse', async () => { throw new Error('games.csv unreachable'); });
  dataSyncRunsPool({}).install(t);
  const out = await tickRow(t, 'nflverse-game-context-fill', '2026-12-01T12:00:00Z');
  assert.match(out.error.message, /games\.csv unreachable/);
  assert.ok((await tickRow(t, 'nflverse-game-context-fill', '2026-12-01T12:05:00Z')).ran, 'nothing succeeded, so the next tick is due again');
});

// ---- ESPN schedule, hourly -----------------------------------------------------
// syncSchedule (ESPN scoreboard) is the only writer that moves a kickoff, and it
// ran by hand only, so a game moved after its first nflverse insert kept its
// old slot (CHI@GB 2026 wk5, lineup lock open mid-game). It skips ESPN's
// timeValid:false placeholders, so week 18's 1:00 ET TBDs are never written.

test('the espn-schedule row syncs the current season when never run', async (t) => {
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  const nflSeason = require('../services/nflSeason.service');
  t.mock.method(nflSeason, 'upcomingNflSeason', async () => 2026);
  const calls = [];
  t.mock.method(feedSyncRuns, 'syncSchedule', async (args) => { calls.push(args); return { season: 2026, gamesUpserted: 544 }; });
  dataSyncRunsPool({}).install(t);

  const out = await tickRow(t, 'espn-schedule', '2026-10-11T12:00:00Z');
  assert.deepEqual(calls, [{ season: 2026 }]);
  assert.deepEqual(out.result, { season: 2026, gamesUpserted: 544 });
});

test('the espn-schedule row backs off 15 minutes after a failed run, not the full hour', async (t) => {
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  const nflSeason = require('../services/nflSeason.service');
  t.mock.method(nflSeason, 'upcomingNflSeason', async () => 2026);
  let syncCalls = 0;
  t.mock.method(feedSyncRuns, 'syncSchedule', async () => { syncCalls += 1; return {}; });
  // An ok run two hours ago, then a failed attempt at 14:00.
  dataSyncRunsPool({
    schedule: {
      latest: { id: 2, finished_at: '2026-10-19T14:00:00.000Z', ok: false, detail: { reason: 'fetch_failed' } },
      latestOk: { id: 1, finished_at: '2026-10-19T12:00:00.000Z', ok: true, detail: null },
    },
  }).install(t);
  assert.equal((await tickRow(t, 'espn-schedule', '2026-10-19T14:10:00Z')).ran, false, '10 minutes after the failure: backing off');
  assert.equal(syncCalls, 0);
  assert.ok((await tickRow(t, 'espn-schedule', '2026-10-19T14:16:00Z')).ran, '16 minutes after the failure: retries');
  assert.equal(syncCalls, 1);
});

test('the espn-schedule row does nothing when the job succeeded inside the hour', async (t) => {
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  let syncCalls = 0;
  t.mock.method(feedSyncRuns, 'syncSchedule', async () => { syncCalls += 1; return {}; });
  dataSyncRunsPool({ schedule: ranAt('2026-10-18T12:00:00.000Z') }).install(t);
  assert.equal((await tickRow(t, 'espn-schedule', '2026-10-18T12:05:00Z')).ran, false);
  assert.equal(syncCalls, 0);
});

// ---- nflverse current-week pass ---------------------------------------------
// Checked every 15 minutes at any hour of any day: the service's own HEAD
// decides whether there is anything to download. These stub the service and
// pin only the throttle, which is the row's `memory` gate.

test('the nflverse-current-week row checks at most every 15 minutes, at any hour', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let calls = 0;
  t.mock.method(nflverseSync, 'patchCurrentWeeks', async () => {
    calls += 1;
    return { patched: [{ season: 2026, week: 3, playersUpdated: 3 }] };
  });

  // 04:40 UTC Tuesday: nflverse has just published Monday night's game and
  // the week's live window is still open.
  const first = await tickRow(t, 'nflverse-current-week', '2026-10-06T04:40:00Z');
  assert.deepEqual(first.result, { patched: [{ season: 2026, week: 3, playersUpdated: 3 }] });
  assert.equal((await tickRow(t, 'nflverse-current-week', '2026-10-06T04:50:00Z')).ran, false, '10 minutes later is too soon');
  assert.ok((await tickRow(t, 'nflverse-current-week', '2026-10-06T04:55:00Z')).ran, '15 minutes later checks again');
  assert.equal(calls, 2);
});

test('the nflverse-current-week row waits 15 minutes after a failed check too', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  let calls = 0;
  t.mock.method(nflverseSync, 'patchCurrentWeeks', async () => {
    calls += 1;
    throw new Error('nflverse unreachable');
  });

  assert.match((await tickRow(t, 'nflverse-current-week', '2026-10-13T05:00:00Z')).error.message, /nflverse unreachable/);
  assert.equal((await tickRow(t, 'nflverse-current-week', '2026-10-13T05:05:00Z')).ran, false, 'not retried on the next tick');
  assert.equal(calls, 1);
});

// ---- nflverse practice-participation poll (#1922) ----------------------------
// The same 15-minute in-memory throttle as the current-week pass, in its own
// gate so one pass never satisfies the other.

test('the nflverse-practice row checks at most every 15 minutes, at any hour', async (t) => {
  const practiceParticipation = require('../services/practiceParticipation.service');
  let calls = 0;
  t.mock.method(practiceParticipation, 'syncCurrentWeeks', async () => {
    calls += 1;
    return { synced: [{ season: 2026, week: 5, inserted: 4, unmapped: 0 }] };
  });

  const first = await tickRow(t, 'nflverse-practice', '2026-10-20T15:00:00Z');
  assert.deepEqual(first.result, { synced: [{ season: 2026, week: 5, inserted: 4, unmapped: 0 }] });
  assert.equal((await tickRow(t, 'nflverse-practice', '2026-10-20T15:10:00Z')).ran, false, '10 minutes later is too soon');
  assert.ok((await tickRow(t, 'nflverse-practice', '2026-10-20T15:15:00Z')).ran, '15 minutes later checks again');
  assert.equal(calls, 2);
});

test('the nflverse-practice row waits 15 minutes after a failed check too', async (t) => {
  const practiceParticipation = require('../services/practiceParticipation.service');
  let calls = 0;
  t.mock.method(practiceParticipation, 'syncCurrentWeeks', async () => {
    calls += 1;
    throw new Error('nflverse unreachable');
  });

  assert.match((await tickRow(t, 'nflverse-practice', '2026-10-27T15:00:00Z')).error.message, /nflverse unreachable/);
  assert.equal((await tickRow(t, 'nflverse-practice', '2026-10-27T15:05:00Z')).ran, false, 'not retried on the next tick');
  assert.equal(calls, 1);
});

// ---- hourly game-context Sync run (#1262, ADR 0038) ------------------------
// Named for what it writes, not "Line" (pl-endzone formal review, #1262 f1):
// CONTEXT.md's Line is the spread/total Sync run tested above as the odds row.

test('the game-context row syncs the slate a live league is on when never run, and reads the game-context job', async (t) => {
  const gameContextSync = require('../services/gameContextSync.service');
  const calls = [];
  t.mock.method(gameContextSync, 'syncGameContext', async ({ season, week }) => {
    calls.push({ season, week });
    return { gamesUpdated: 1 };
  });
  const fake = dataSyncRunsPool({}, [LEAGUES_ON_WEEK_2]).install(t);

  const out = await tickRow(t, 'game-context', '2026-09-13T12:00:00Z');
  assert.deepEqual(out.result, [{ gamesUpdated: 1 }]);
  assert.deepEqual(calls, [{ season: 2026, week: 2 }]);
  assert.equal(fake.calls.find((c) => /data_sync_runs/.test(c.text)).params[0], 'game-context');
});

test('the game-context row performs no sync on a first tick when a recent successful run row exists (fresh module state, a worker restart)', async (t) => {
  const gameContextSync = require('../services/gameContextSync.service');
  const calls = [];
  t.mock.method(gameContextSync, 'syncGameContext', async (a) => { calls.push(a); return {}; });
  const fake = dataSyncRunsPool({ 'game-context': ranAt('2026-09-20T11:50:00.000Z') }, [LEAGUES_ON_WEEK_2]).install(t);

  assert.equal((await tickRow(t, 'game-context', '2026-09-20T12:00:00Z')).ran, false);
  assert.equal(calls.length, 0);
  assert.equal(fake.calls.filter((c) => /FROM "leagues"/.test(c.text)).length, 0, 'not due never reaches the leagues read');
});

test('the game-context row syncs every distinct (season, week) a live league is on, and one week failing does not stop another', async (t) => {
  const gameContextSync = require('../services/gameContextSync.service');
  const calls = [];
  t.mock.method(gameContextSync, 'syncGameContext', async ({ season, week }) => {
    calls.push({ season, week });
    if (week === 2) throw new Error('ESPN unavailable');
    return { gamesUpdated: 3 };
  });
  dataSyncRunsPool({}, [
    [/FROM "leagues"/, () => ({
      rows: [
        { current_season: 2026, current_week: 2 },
        { current_season: 2026, current_week: 3 },
      ],
    })],
  ]).install(t);

  const out = await tickRow(t, 'game-context', '2026-09-14T12:00:00Z');
  assert.deepEqual(calls, [{ season: 2026, week: 2 }, { season: 2026, week: 3 }]);
  assert.deepEqual(out.result, [{ gamesUpdated: 3 }], 'the failed week is skipped, not thrown');
});

// Row shape matching syncRun.js's lastRun($job) query: `{ latest, latestOk }`,
// each a row_to_json-shaped object (snake_case) or null. `byJob` maps a job
// literal to that shape; a job with no entry answers { latest: null, latestOk: null }.
function dataSyncRunsPool(byJob, extraHandlers = []) {
  return createFakePool([
    [/FROM "data_sync_runs"/, (text, params) => ({
      rows: [byJob[params[0]] || { latest: null, latestOk: null }],
    })],
    ...extraHandlers,
  ]);
}

test('getSchedulerStatus reports the latest ADP run, and null when none has run', async (t) => {
  // #1201 (ADR 0036): the probe read moved onto lastRun('adp'), the shared
  // { latest, latestOk } read every Sync run job uses (server/modules/syncRun.js).
  const noRuns = dataSyncRunsPool({}).install(t);
  const empty = await scheduler.getSchedulerStatus();
  assert.equal(empty.lastAdpSync, null);
  assert.equal(empty.lastAdpSuccess, null);
  noRuns.assertClean();

  t.mock.restoreAll();
  // A failed latest row and an older ok row: lastAdpSync reports the latest
  // row regardless of outcome (today's behaviour, unchanged), and
  // lastAdpSuccess reports the ok one - "last successful sync" (CONTEXT.md).
  dataSyncRunsPool({
    adp: {
      latest: { id: 2, finished_at: '2026-09-03T06:00:00.000Z', ok: false, detail: { reason: 'refused', refusalReason: 'thin_market', adpPlayers: 40 } },
      latestOk: { id: 1, finished_at: '2026-09-02T06:00:00.000Z', ok: true, detail: { matched: 182, adpPlayers: 200 } },
    },
  }).install(t);
  const status = await scheduler.getSchedulerStatus();
  assert.equal(status.lastAdpSync.ok, false);
  assert.equal(status.lastAdpSync.matched, null, 'the failed row carries no matched count');
  assert.ok(status.lastAdpSync.finishedAt instanceof Date);
  assert.equal(status.lastAdpSync.finishedAt.toISOString(), '2026-09-03T06:00:00.000Z');
  assert.deepEqual(status.lastAdpSuccess, {
    finishedAt: new Date('2026-09-02T06:00:00.000Z'),
    matched: 182,
  });
});

test('getSchedulerStatus never throws when the data_sync_runs read fails, and logs at most one warning', async (t) => {
  let warnings = 0;
  t.mock.method(console, 'warn', () => { warnings += 1; });
  createFakePool([
    [/FROM "data_sync_runs"/, () => { throw new Error('relation "data_sync_runs" does not exist'); }],
  ]).install(t);
  // Health probes and the worker heartbeat depend on this never throwing.
  const status = await scheduler.getSchedulerStatus();
  assert.equal(status.lastAdpSync, null);
  assert.equal(status.lastAdpSuccess, null);
  // Every one of the SYNC_RUN_JOBS reads rejects, but only one warning logs.
  assert.equal(warnings, 1);
  for (const job of scheduler.SYNC_RUN_JOBS) {
    assert.deepEqual(status.syncRuns[job], { latest: null, latestOk: null }, `${job} degrades to nulls`);
  }
});

// ---- syncRuns: lastRun(job) for every feed-sync job (#1205) ----------------

test('getSchedulerStatus.syncRuns reports every job, null for one with no rows', async (t) => {
  dataSyncRunsPool({}).install(t);
  const status = await scheduler.getSchedulerStatus();
  for (const job of ['nflverse-correction', 'nflverse-snaps']) {
    assert.ok(scheduler.SYNC_RUN_JOBS.includes(job), `${job} is a Sync run the health probe lists`);
    assert.ok(job in status.syncRuns, `${job} appears in the status report`);
  }
  assert.deepEqual(Object.keys(status.syncRuns), scheduler.SYNC_RUN_JOBS);
  for (const job of scheduler.SYNC_RUN_JOBS) {
    assert.deepEqual(status.syncRuns[job], { latest: null, latestOk: null });
  }
});

test('getSchedulerStatus.syncRuns maps outcome from detail.reason, not from ok alone', async (t) => {
  // Red-tell: a refused job's latest reports outcome: 'refused', with latestOk
  // still the older ok row - mapping outcome from ok alone goes red here.
  dataSyncRunsPool({
    injuries: {
      latest: { id: 5, finished_at: '2026-09-10T12:00:00.000Z', ok: false, detail: { reason: 'refused' } },
      latestOk: { id: 3, finished_at: '2026-09-09T12:00:00.000Z', ok: true, detail: null },
    },
    'week-stats': {
      latest: { id: 6, finished_at: '2026-09-10T12:00:00.000Z', ok: false, detail: { reason: 'fetch_failed' } },
      latestOk: null,
    },
    schedule: {
      latest: { id: 7, finished_at: '2026-09-10T12:00:00.000Z', ok: false, detail: { reason: 'bad_response' } },
      latestOk: null,
    },
    players: {
      latest: { id: 8, finished_at: '2026-09-10T12:00:00.000Z', ok: false, detail: { reason: 'write_failed' } },
      latestOk: null,
    },
    // A legacy row written before runSyncJob existed: an outcome never invented.
    'season-stats': {
      latest: { id: 9, finished_at: '2026-09-10T12:00:00.000Z', ok: false, detail: { reason: 'thin_market' } },
      latestOk: null,
    },
    adp: {
      latest: { id: 10, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: { matched: 200 } },
      latestOk: { id: 10, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: { matched: 200 } },
    },
  }).install(t);
  const status = await scheduler.getSchedulerStatus();
  assert.equal(status.syncRuns.injuries.latest.outcome, 'refused');
  assert.deepEqual(status.syncRuns.injuries.latestOk, { finishedAt: new Date('2026-09-09T12:00:00.000Z') });
  assert.equal(status.syncRuns['week-stats'].latest.outcome, 'fetch_failed');
  assert.equal(status.syncRuns.schedule.latest.outcome, 'bad_response');
  assert.equal(status.syncRuns.players.latest.outcome, 'write_failed');
  assert.equal(status.syncRuns['season-stats'].latest.outcome, null, 'an unmapped reason is never invented');
  assert.equal(status.syncRuns.adp.latest.outcome, 'ok');
});

test('getSchedulerStatus.syncRuns reports weather-snapshots, `unconfigured` for an ok run with no NWS_USER_AGENT (#1930)', async (t) => {
  const ok = (detail) => ({ id: 11, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail });
  dataSyncRunsPool({
    'weather-snapshots': {
      latest: ok({ reason: 'NWS_USER_AGENT not configured', unconfigured: true, requests: 0 }),
      latestOk: ok({ reason: 'NWS_USER_AGENT not configured', unconfigured: true, requests: 0 }),
    },
    adp: { latest: ok({ reason: 'something else' }), latestOk: null },
  }).install(t);
  const status = await scheduler.getSchedulerStatus();
  assert.ok(scheduler.SYNC_RUN_JOBS.includes('weather-snapshots'));
  assert.equal(status.syncRuns['weather-snapshots'].latest.outcome, 'unconfigured');
  assert.equal(status.syncRuns['weather-snapshots'].latest.ok, true, 'the run stays ok');
  assert.equal(status.syncRuns.adp.latest.outcome, 'ok', 'any other ok row, reason or not, stays ok');
});

test('getSchedulerStatus.syncRuns reports failedWeeks from detail.failedWeeks.length, independent of outcome (#1242)', async (t) => {
  dataSyncRunsPool({
    // ok: true with 13 skipped weeks still reports outcome: 'ok' - the count
    // is not derived into a new outcome.
    schedule: {
      latest: { id: 20, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: { failedWeeks: Array.from({ length: 13 }, (_, i) => i + 1) } },
      latestOk: { id: 20, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: { failedWeeks: Array.from({ length: 13 }, (_, i) => i + 1) } },
    },
    // detail present, no failedWeeks key at all.
    adp: {
      latest: { id: 21, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: { matched: 200 } },
      latestOk: { id: 21, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: { matched: 200 } },
    },
    // failedWeeks present but not an array: null, never a throw.
    'week-stats': {
      latest: { id: 22, finished_at: '2026-09-10T12:00:00.000Z', ok: false, detail: { failedWeeks: 'oops' } },
      latestOk: null,
    },
    // legacy row: detail itself is null.
    injuries: {
      latest: { id: 23, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: null },
      latestOk: { id: 23, finished_at: '2026-09-10T12:00:00.000Z', ok: true, detail: null },
    },
  }).install(t);
  const status = await scheduler.getSchedulerStatus();
  assert.equal(status.syncRuns.schedule.latest.failedWeeks, 13);
  assert.equal(status.syncRuns.schedule.latest.outcome, 'ok', 'outcome keeps the #1205 vocabulary regardless of the count');
  assert.equal(status.syncRuns.adp.latest.failedWeeks, null, 'no failedWeeks key on detail');
  assert.equal(status.syncRuns['week-stats'].latest.failedWeeks, null, 'failedWeeks present but not an array');
  assert.equal(status.syncRuns.injuries.latest.failedWeeks, null, 'legacy row: detail itself is null');
  assert.deepEqual(status.syncRuns.injuries.latestOk, { finishedAt: new Date('2026-09-10T12:00:00.000Z') }, 'latestOk keeps its { finishedAt } shape');
});

// ---- scoring is decoupled from syncing -------------------------------------

test('the live-sync row still scores when the stat sync fetched nothing', async (t) => {
  // Every game final and already ingested (or quota exhausted): scoreMatchups is
  // DB-only, so it must still run — finals ingested via the recap path get
  // scored promptly this way. The row's tick-count gate is due on its first tick.
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  const scoring = require('../services/matchupScoring.service');
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'ok' }));
  createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ id: 42, current_season: 2026, current_week: 3 }] })],
    [/FROM "nfl_games"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/./, () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(feedSyncRuns, 'syncWeekStats', async () => {
    throw new Error('quota exhausted');
  });
  let scoredFor = null;
  t.mock.method(scoring, 'scoreMatchups', async ({ leagueId, plays }) => {
    scoredFor = { leagueId, plays };
    return { scored: [] };
  });

  const prevKey = process.env.RAPID_API_KEY;
  const prevHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  try {
    const out = await tickRow(t, 'live-sync', '2026-09-13T17:00:00Z');
    assert.equal(out.result, true);
  } finally {
    if (prevKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = prevKey;
    if (prevHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = prevHost;
  }
  assert.deepEqual(scoredFor, { leagueId: 42, plays: [] });
});

// ---- pick'em-only season lifecycle -------------------------------------------

// Weeks 1..5 of a season: each week's last kickoff is Monday night, 00:15Z Tue.
const kickoffRows = (weeks) =>
  Array.from({ length: weeks }, (_, i) => {
    const mnf = new Date(Date.UTC(2026, 8, 15, 0, 15) + i * 7 * 24 * 60 * 60 * 1000);
    return [
      { week: i + 1, kickoff_at: new Date(mnf.getTime() - 32 * 60 * 60 * 1000).toISOString() },
      { week: i + 1, kickoff_at: mnf.toISOString() },
    ];
  }).flat();

test('runPickemWeekSync moves only the league whose week is stale, reading the schedule once per season', async (t) => {
  const leagues = [
    { id: 1, current_season: 2026, current_week: 3 }, // stale: week 3 closed on Monday night
    { id: 2, current_season: 2026, current_week: 4 }, // already right
  ];
  const { calls } = createFakePool([
    [/FROM "leagues"/, () => ({ rows: leagues })],
    [/FROM "nfl_games"/, () => ({ rows: kickoffRows(5) })],
    // Honour the compare-and-swap: the row only moves when the statement
    // names the week and season it currently has.
    [/^UPDATE "leagues" SET "current_week"/, (text, params) => {
      const league = leagues.find((l) => l.id === params[1]);
      const matches = league && league.current_week === params[2] && league.current_season === params[3];
      return { rows: matches ? [{ id: params[1] }] : [] };
    }],
  ]).install(t);

  // Tuesday noon after week 3's Monday-night game.
  const changes = await runRow(t, 'pickem-week-sync', '2026-09-29T16:00:00Z');

  assert.deepEqual(changes, [{ leagueId: 1, from: 3, to: 4 }]);
  const updates = calls.filter((c) => /^UPDATE "leagues"/.test(c.text));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [4, 1, 3, 2026]);
  // Idempotent by predicate: the write names the week and season it expects
  // to replace, and only ever touches pick'em-only leagues still in season.
  assert.match(updates[0].text, /"pickem_only" = true/);
  assert.match(updates[0].text, /"season_status" <> 'complete'/);
  assert.match(updates[0].text, /"current_week" = \$3/);
  assert.match(updates[0].text, /"current_season" = \$4/);
  assert.equal(calls.filter((c) => /FROM "nfl_games"/.test(c.text)).length, 1, 'bounds fetched once per season');
});

test('runPickemWeekSync moves a league with no picks out of a finished season once a newer schedule is on file', async (t) => {
  // The Jan-May residue: a league created into the finished 2026 season sits
  // at week 18 with every game locked, so it can never pick, never complete
  // and never roll over. When 2027 loads it must follow the calendar. A
  // league that DID pick in 2026 is left for completion (and stays put).
  const leagues = [
    { id: 1, current_season: 2026, current_week: 18 }, // zero picks: move on
    { id: 2, current_season: 2026, current_week: 18 }, // has picks: not ours to move
  ];
  const { calls } = createFakePool([
    [/FROM "leagues"/, () => ({ rows: leagues })],
    [/SELECT MAX\("season"\)/, () => ({ rows: [{ season: 2027 }] })],
    [/SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, (text, params) => ({
      rows: params[0] === 2026
        ? kickoffRows(18)
        : kickoffRows(18).map((r) => ({ week: r.week, kickoff_at: r.kickoff_at.replace('2026', '2027') })),
    })],
    [/SELECT 1 FROM "pickem_picks"/, (text, params) => ({ rows: params[0] === 2 ? [{ '?column?': 1 }] : [] })],
    [/^UPDATE "leagues" SET "current_season"/, (text, params) => ({ rows: [{ id: params[2] }] })],
    [/^UPDATE "leagues" SET "current_week"/, () => { throw new Error('a plain week write must not happen here'); }],
  ]).install(t);

  const changes = await runRow(t, 'pickem-week-sync', '2027-06-01T12:00:00Z');

  assert.deepEqual(changes, [{ leagueId: 1, from: 18, to: 1, fromSeason: 2026, toSeason: 2027 }]);
  const moves = calls.filter((c) => /^UPDATE "leagues" SET "current_season"/.test(c.text));
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].params, [2027, 1, 1, 2026, 18]);
  assert.match(moves[0].text, /"pickem_only" = true/);
  assert.match(moves[0].text, /"season_status" <> 'complete'/);
});

/**
 * A tiny stateful stand-in for the tables season completion touches: the
 * leagues row flips to complete on UPDATE, and the trophies insert honors the
 * (league, season, week, team, type) unique key the way ON CONFLICT DO
 * NOTHING does (no row returned on a repeat).
 */
function pickemSeasonWorld(t, { league, teams, picks, live, games }) {
  const state = {
    league: { ...league },
    result: null,
    trophies: [],
    notifications: [],
    statusUpdates: 0,
  };
  const trophyKeys = new Set();
  let transactionSnapshot = null;
  const snapshotState = () => ({
    league: { ...state.league },
    result: state.result == null ? null : structuredClone(state.result),
    trophies: structuredClone(state.trophies),
    notifications: structuredClone(state.notifications),
    statusUpdates: state.statusUpdates,
    trophyKeys: [...trophyKeys],
  });
  const restoreState = (snapshot) => {
    state.league = snapshot.league;
    state.result = snapshot.result;
    state.trophies.splice(0, state.trophies.length, ...snapshot.trophies);
    state.notifications.splice(0, state.notifications.length, ...snapshot.notifications);
    state.statusUpdates = snapshot.statusUpdates;
    trophyKeys.clear();
    for (const key of snapshot.trophyKeys) trophyKeys.add(key);
  };
  const nflGames = games || [
    { week: 18, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2027-01-10T18:00:00.000Z' },
    { week: 18, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: '2027-01-10T18:00:00.000Z' },
    { week: 18, nfl_team: 'DAL', opponent: 'WAS', kickoff_at: '2027-01-10T21:25:00.000Z' },
    { week: 18, nfl_team: 'WAS', opponent: 'DAL', kickoff_at: '2027-01-10T21:25:00.000Z' },
  ];
  const handlers = [
    [/^BEGIN$/, () => {
      transactionSnapshot = snapshotState();
      return { rows: [] };
    }, 'client'],
    [/^COMMIT$/, () => {
      transactionSnapshot = null;
      return { rows: [] };
    }, 'client'],
    [/^ROLLBACK$/, () => {
      if (transactionSnapshot) restoreState(transactionSnapshot);
      transactionSnapshot = null;
      return { rows: [] };
    }, 'client'],
    [/FROM "leagues" WHERE "pickem_only" = true AND "season_status" <> 'complete'/, () =>
      ({ rows: state.league.season_status === 'complete' ? [] : [state.league] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [state.league] })],
    [/SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: nflGames.map((g) => ({ week: g.week, kickoff_at: g.kickoff_at })),
    })],
    [/FROM "nfl_games"/, () => ({ rows: nflGames })],
    [/FROM "live_game_states"/, () => ({ rows: live })],
    [/FROM "private"\."game_recaps"/, () => ({ rows: [] })],
    [/SELECT 1 FROM "pickem_picks"/, () => ({ rows: picks.length > 0 ? [{ '?column?': 1 }] : [] })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    // pick'em standings members query (#343: owner_id AS user_id, no users JOIN)
    [/"owner_id" AS "user_id"/, () => ({
      rows: teams.filter((team) => team.owner_id != null).map((team) => ({
        user_id: team.owner_id, team_id: team.id, team_name: team.name,
        avatar_url: null, avatar_static_url: null,
      })),
    })],
    [/FROM "pickem_picks" WHERE "league_id" = \$1 AND "season" = \$2$/, () => ({ rows: picks })],
    [/^UPDATE "leagues" SET "season_status" = 'complete'/, () => {
      state.league = { ...state.league, season_status: 'complete' };
      state.statusUpdates += 1;
      return { rows: [{ id: state.league.id }] };
    }],
    [/^INSERT INTO "pickem_season_results"/, (text, params) => {
      if (state.result) return { rows: [] };
      state.result = {
        league_id: params[0],
        season: params[1],
        outcome: params[2],
        scoring_mode: params[3],
        champions: JSON.parse(params[4]),
        declared_at: '2027-01-11T06:00:00.000Z',
      };
      return { rows: [state.result] };
    }],
    [/^SELECT .* FROM "pickem_season_results"/, () => ({ rows: state.result ? [state.result] : [] })],
    [/INSERT INTO "trophies"/, (text, params) => {
      const key = params.slice(0, 5).join(':');
      if (trophyKeys.has(key)) return { rows: [] };
      trophyKeys.add(key);
      state.trophies.push({
        leagueId: params[0], teamId: params[1], season: params[2], week: params[3],
        type: params[4], label: params[5], data: JSON.parse(params[6]),
      });
      return { rows: [{ id: state.trophies.length }] };
    }],
    [/SELECT DISTINCT "owner_id" FROM "teams"/, () => ({
      rows: teams.filter((team) => team.owner_id != null).map((team) => ({ owner_id: team.owner_id })),
    })],
    [/SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: teams.filter((team) => team.id === params[0]).map((team) => ({ owner_id: team.owner_id })),
    })],
    [/INSERT INTO "notifications"/, (text, params) => {
      state.notifications.push({ userId: params[0], type: params[2], message: params[3] });
      return { rows: [] };
    }],
  ];
  // The fake tags pool reads and transaction-client statements separately so
  // a test can see the transaction boundary, not just the statements.
  state.calls = createFakePool(handlers).install(t).calls;
  // The live handler table, for per-test overrides: unshift, not push —
  // entries are tried in order, so a pushed override loses to the defaults.
  state.handlers = handlers;
  return state;
}

const FINALS = [
  { week: 18, tank01_game_id: 'a', home_team: 'BUF', away_team: 'MIA', game_status: 'final', current_score_home: 24, current_score_away: 17, quarter: null, time_remaining: null },
  { week: 18, tank01_game_id: 'b', home_team: 'DAL', away_team: 'WAS', game_status: 'final', current_score_home: 10, current_score_away: 27, quarter: null, time_remaining: null },
];

test('runPickemSeasonCompletion run twice completes the season and writes the champion trophy once', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [
      { id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' },
      { id: 11, owner_id: 101, username: 'bob', name: 'Bob Squad' },
    ],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });
  const now = new Date('2027-01-11T06:00:00Z');

  const first = await runRow(t, 'pickem-season-completion', now);
  const second = await runRow(t, 'pickem-season-completion', now);

  assert.equal(first.length, 1);
  assert.equal(first[0].leagueId, 1);
  assert.deepEqual(first[0].champions.map((c) => c.teamId), [10]);
  assert.deepEqual(second, [], 'a completed league is not a candidate again');
  assert.equal(world.statusUpdates, 1);
  assert.equal(world.league.season_status, 'complete');
  assert.deepEqual(world.trophies, [{
    leagueId: 1, teamId: 10, season: 2026, week: 0, type: 'pickem_champion',
    label: "2026 Pick'em Champion", data: { points: 2, correct: 2, mode: 'straight' },
  }]);
  assert.deepEqual(world.result, {
    league_id: 1,
    season: 2026,
    outcome: 'champions',
    scoring_mode: 'straight',
    champions: [{
      teamId: 10,
      teamName: 'Sunday Ballers',
      avatarUrl: null,
      avatarStaticUrl: null,
      points: 2,
      correct: 2,
      mode: 'straight',
    }],
    declared_at: '2027-01-11T06:00:00.000Z',
  });
  const leagueWide = world.notifications.filter((n) => n.type === 'season');
  assert.deepEqual(leagueWide.map((n) => n.userId).sort(), [100, 101]);
  assert.equal(leagueWide[0].message, "The pick'em season is over. Sunday Ballers wins with 2 points.");
  // The trophy owner is told post-commit, best-effort, exactly once.
  assert.deepEqual(
    world.notifications.filter((n) => n.type === 'trophy'),
    [{ userId: 100, type: 'trophy', message: "Trophy earned: 2026 Pick'em Champion" }]
  );

  // Transaction boundary: everything from BEGIN to COMMIT rides the checked-out
  // client, the season slate (whose recap probe swallows a missing-table
  // error, which would poison an open transaction) is read on the pool
  // BEFORE the transaction, and the owner notification comes after it.
  const clientCalls = world.calls.filter((c) => c.via === 'client').map((c) => c.text);
  assert.equal(clientCalls[0], 'BEGIN');
  assert.equal(clientCalls[clientCalls.length - 1], 'COMMIT');
  assert.ok(!clientCalls.some((text) => /game_recaps|FROM "nfl_games"|FROM "live_game_states"/.test(text)));
  assert.ok(clientCalls.some((text) => /^INSERT INTO "pickem_season_results"/.test(text)));
  assert.ok(clientCalls.some((text) => /^UPDATE "leagues" SET "season_status" = 'complete'/.test(text)));
  assert.ok(clientCalls.some((text) => /INSERT INTO "trophies"/.test(text)));
  const trophyNotice = world.calls.find((c) => /INSERT INTO "notifications"/.test(c.text) && c.params[2] === 'trophy');
  assert.equal(trophyNotice.via, 'pool');
  const commitAt = world.calls.findIndex((c) => c.text === 'COMMIT');
  assert.ok(world.calls.indexOf(trophyNotice) > commitAt, 'owner notification is post-commit');
});

test('co-champions are declared completely and each gets a Co-Champion trophy', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [
      { id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' },
      { id: 11, owner_id: 101, username: 'bob', name: 'Bob Squad' },
      { id: 12, owner_id: 102, username: 'cara', name: 'Cara Crew' },
    ],
    picks: [
      // alice and bob both go 2-0; cara goes 1-1.
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 102, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 102, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });
  const completed = await runRow(t, 'pickem-season-completion', '2027-01-11T06:00:00Z');

  // Co-champions tie on points and correct picks, so they order by Team name
  // now (#343): 'Bob Squad' (team 11) sorts before 'Sunday Ballers' (team 10),
  // where the old username tiebreak put alice's team 10 first.
  assert.deepEqual(completed[0].champions.map((c) => c.teamId), [11, 10]);
  assert.deepEqual(world.result.champions.map((champion) => champion.teamId), [11, 10]);
  assert.deepEqual(world.trophies, [
    {
      leagueId: 1, teamId: 11, season: 2026, week: 0, type: 'pickem_champion',
      label: "2026 Pick'em Co-Champion", data: { points: 2, correct: 2, mode: 'straight' },
    },
    {
      leagueId: 1, teamId: 10, season: 2026, week: 0, type: 'pickem_champion',
      label: "2026 Pick'em Co-Champion", data: { points: 2, correct: 2, mode: 'straight' },
    },
  ]);
  assert.equal(world.league.season_status, 'complete');
  const leagueWide = world.notifications.filter((n) => n.type === 'season');
  assert.equal(leagueWide[0].message, "The pick'em season is over. Bob Squad and Sunday Ballers share the title with 2 points.");
});

test('a former picker leading the standings does not block completion, the top current Team is champion', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Broken Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [
      // user 101's Team was removed mid-season: 2-0 and leading, with no Team row.
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });
  const completed = await runRow(t, 'pickem-season-completion', '2027-01-11T06:00:00Z');

  assert.deepEqual(completed[0].champions.map((champion) => champion.teamId), [10]);
  assert.equal(world.league.season_status, 'complete');
  assert.deepEqual(world.result.champions.map((champion) => champion.teamId), [10]);
  assert.ok(world.calls.some((call) => call.text === 'COMMIT'));
});

test('a former picker missing Team identity does not block a current Team champion', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Former Picker Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
      { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null },
      { user_id: 101, week: 18, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
    ],
    live: FINALS,
  });

  const completed = await runRow(t, 'pickem-season-completion', '2027-01-11T06:00:00Z');

  assert.deepEqual(completed[0].champions.map((champion) => champion.teamId), [10]);
  assert.equal(world.league.season_status, 'complete');
  assert.deepEqual(world.result.champions.map((champion) => champion.teamId), [10]);
  assert.ok(world.calls.some((call) => call.text === 'COMMIT'));
});

test('a league-wide notification failure rolls back result, status, and trophies together', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Atomic Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
    ],
    live: FINALS,
  });
  world.handlers.unshift([
    /^INSERT INTO "notifications"/,
    () => { throw new Error('notification write failed'); },
    'client',
  ]);

  const completed = await runRow(t, 'pickem-season-completion', '2027-01-11T06:00:00Z');

  assert.deepEqual(completed, []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.result, null);
  assert.deepEqual(world.trophies, []);
  assert.deepEqual(world.notifications, []);
  assert.equal(world.statusUpdates, 0);
  assert.ok(world.calls.some((call) => call.text === 'ROLLBACK'));
  assert.ok(!world.calls.some((call) => call.text === 'COMMIT'));
});

test('completion declares an explicit no-champion result when every manager finishes at zero', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Zero Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [{ user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null }],
    live: FINALS,
  });

  const completed = await runRow(t, 'pickem-season-completion', '2027-01-11T06:00:00Z');

  assert.equal(completed.length, 1);
  assert.deepEqual(completed[0].champions, []);
  assert.equal(world.league.season_status, 'complete');
  assert.equal(world.result.outcome, 'no_champion');
  assert.deepEqual(world.result.champions, []);
  assert.deepEqual(world.trophies, []);
  assert.deepEqual(
    world.notifications.filter((notification) => notification.type === 'season').map((notification) => notification.message),
    ["The pick'em season is over."]
  );
});

test('zombie guard: a league with no picks this season, or created after week 18 kicked off, never completes', async (t) => {
  const noPicks = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Ghost Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [],
    live: FINALS,
  });
  assert.deepEqual(await runRow(t, 'pickem-season-completion', '2027-01-11T06:00:00Z'), []);
  assert.equal(noPicks.league.season_status, 'regular');
  assert.equal(noPicks.trophies.length, 0);
  // The zombie-guard bail is a read-only early return now (#1071): it opens the
  // transaction, takes the row lock, then returns null - which COMMITs the empty
  // transaction and releases the lock exactly as the old bare ROLLBACK did. The
  // guard is still checked under the row lock (BEGIN + FOR UPDATE precede it) and
  // still writes nothing (no season_status UPDATE); the close is now a COMMIT.
  assert.ok(noPicks.calls.some((c) => c.text === 'BEGIN'), 'the guard runs inside a transaction');
  assert.ok(
    noPicks.calls.some((c) => /FROM "leagues" WHERE "id" = \$1 FOR UPDATE/.test(c.text)),
    'the row is locked FOR UPDATE before the guard fires'
  );
  assert.ok(
    !noPicks.calls.some((c) => /UPDATE "leagues" SET "season_status"/.test(c.text)),
    'the guard bails before any write'
  );
  assert.ok(noPicks.calls.some((c) => c.text === 'COMMIT'), 'the read-only bail closes with COMMIT');

  const lateCreate = pickemSeasonWorld(t, {
    // Created in the dead window between week 18 and the next schedule sync:
    // seeded to the finished season at week 18 with picks somehow present.
    league: { id: 2, name: 'Late Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2027-02-01T00:00:00.000Z' },
    teams: [{ id: 20, owner_id: 200, username: 'zed', name: 'Zed Heads' }],
    picks: [{ user_id: 200, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }],
    live: FINALS,
  });
  assert.deepEqual(await runRow(t, 'pickem-season-completion', '2027-03-01T06:00:00Z'), []);
  assert.equal(lateCreate.league.season_status, 'regular');
  assert.ok(!lateCreate.calls.some((c) => c.text === 'BEGIN'), 'skipped without opening a transaction');
});

test('runPickemSeasonCompletion does not read the season slate before week 18 has kicked off', async (t) => {
  // Every 5 minutes, all season: the cheap week-bounds query decides whether
  // completion is even possible; the three-query season slate is only pulled
  // once week 18's last kickoff has passed.
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 8, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [{ user_id: 100, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }],
    live: [],
  });
  assert.deepEqual(await runRow(t, 'pickem-season-completion', '2026-10-15T12:00:00Z'), []);
  assert.equal(world.calls.filter((c) => /SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/.test(c.text)).length, 1);
  assert.equal(world.calls.filter((c) => /fn_normalize_nfl_team|FROM "live_game_states"|game_recaps/.test(c.text)).length, 0);
  assert.equal(world.calls.filter((c) => c.text === 'BEGIN').length, 0);
});

test('a season with no week-18 rows on file is held (and warned about), never completed on week 17', async (t) => {
  // Tank01 drops TBD-time week-18 games until the nflverse re-sync fills
  // them. Completing on week 17 would crown a champion before week 18 is
  // played, so the league waits for the rows; the warning every tick is the
  // operator's cue.
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Office Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [{ id: 10, owner_id: 100, username: 'alice', name: 'Sunday Ballers' }],
    picks: [{ user_id: 100, week: 17, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }],
    live: [],
    games: [
      { week: 17, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2027-01-03T18:00:00.000Z' },
      { week: 17, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: '2027-01-03T18:00:00.000Z' },
    ],
  });
  assert.deepEqual(await runRow(t, 'pickem-season-completion', '2027-03-01T12:00:00Z'), []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.calls.filter((c) => c.text === 'BEGIN').length, 0);
  assert.equal(world.calls.filter((c) => /fn_normalize_nfl_team|game_recaps/.test(c.text)).length, 0, 'gate closed: no slate read');
  assert.ok(warnings.some((w) => /week 18 has no games on file/.test(w)));
});

// ---- nightly projection run (#1305) -----------------------------------
// The nightly-projection-fill row's gate is `anyOf` two `nightly-projection-run`
// cadences: one inside the off-peak UTC hour (09:00-09:59Z), one for an owed
// refill outside it. Each test uses distinct calendar days: the same-day memo is
// state of the row's gate, shared across every test in this file. The fakes
// here keep a real data_sync_runs table (runsTable), so a pass the fill records
// is what settles its day.

const NO_GAME_WINDOW = [/FROM "live_game_states"/, () => ({ rows: [] })];

test('the nightly-projection-fill row only runs inside its own off-peak UTC hour', async (t) => {
  const calls = [];
  const table = runsTable();
  createFakePool([
    [/FROM "leagues"/, () => { calls.push('leagues'); return { rows: [] }; }],
    // Outside the window the second member asks the cadence gate (#1511);
    // nothing has ever run, so `after: 'stat-corrections'` is unsatisfied and
    // the gate itself answers not due - the fixture does not need a real owed
    // scenario for this test, which is only about the hour boundary.
    ...table.handlers,
    NO_GAME_WINDOW,
  ]).install(t);

  assert.equal((await tickRow(t, 'nightly-projection-fill', '2026-09-20T08:59:00Z')).ran, false);
  assert.equal((await tickRow(t, 'nightly-projection-fill', '2026-09-20T10:00:00Z')).ran, false);
  assert.equal(calls.length, 0, 'no query at all outside the window, not even the eligibility read');

  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-20T09:30:00Z');
  const { elapsedMs, ...counts } = out.result;
  assert.ok(Number.isFinite(elapsedMs), 'the result carries the elapsed ms (#2081)');
  assert.deepEqual(counts, { weeksGenerated: 0, weeksSkipped: 0, leagues: 0 });
});

test('the nightly-projection-fill row queries leagues with the same live-season eligibility the hourly syncs use', async (t) => {
  const table = runsTable();
  const fake = createFakePool([
    [/FROM "leagues"/, (text) => {
      assert.match(text, /"draft_status" = 'complete'/);
      assert.match(text, /"season_status" <> 'complete'/);
      return { rows: [] };
    }],
    ...table.handlers,
    NO_GAME_WINDOW,
  ]);
  fake.install(t);
  const out = await tickRow(t, 'nightly-projection-fill', '2026-09-12T09:00:00Z');
  const { elapsedMs, ...counts } = out.result;
  assert.ok(Number.isFinite(elapsedMs));
  assert.deepEqual(counts, { weeksGenerated: 0, weeksSkipped: 0, leagues: 0 });
});

test('the nightly-projection-fill row fills every week from each league\'s current week through its OWN last playoff week', async (t) => {
  const projection = require('../services/projection.service');
  const calls = [];
  t.mock.method(projection, 'getWeeklyProjections', async (args) => {
    const { league, week, playerIds } = args;
    calls.push({ leagueId: league.id, week, args });
    return { projections: new Map(playerIds.map((id) => [id, { median: 10, cached: false }])) };
  });
  // #1789: the post-fill availability sweep is a SEPARATE players read from
  // the #1403 shared-pool read this test pins; stubbed out (no live scope) so
  // it stays out of this test's own "read once per pass" invariant below.
  t.mock.method(projection, 'liveReconcileScope', async () => null);
  const table = runsTable();
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [
        // 14 regular weeks + 2 rounds (4 playoff teams) -> last playoff week 16.
        { id: 1, current_season: 2026, current_week: 15, regular_season_weeks: 14, playoff_teams: 4 },
        // 13 regular weeks + 1 round (2 playoff teams, a straight final) -> last
        // playoff week 14: a genuinely DIFFERENT stop from league 1's (#1305 f1),
        // so a bug that shared one through-week across the whole pass would fail
        // this test rather than pass it by coincidence.
        { id: 2, current_season: 2026, current_week: 10, regular_season_weeks: 13, playoff_teams: 2 },
      ],
    })],
    // #1403: one player-pool read shared by every league's unit.
    [/FROM "players"/, () => ({ rows: [{ id: 101 }, { id: 202 }] })],
    ...table.handlers,
    NO_GAME_WINDOW,
  ]);
  fake.install(t);

  const { result } = await tickRow(t, 'nightly-projection-fill', '2026-09-15T09:00:00Z');

  const league1Weeks = calls.filter((c) => c.leagueId === 1).map((c) => c.week);
  const league2Weeks = calls.filter((c) => c.leagueId === 2).map((c) => c.week);
  assert.deepEqual(league1Weeks, [15, 16]);
  assert.deepEqual(league2Weeks, [10, 11, 12, 13, 14]);
  // #1403: every player in the pool, for every league, not each league's roster.
  assert.ok(calls.every((c) => JSON.stringify(c.args.playerIds) === JSON.stringify([101, 202])));
  assert.equal(fake.calls.filter((c) => c.text.includes('FROM "players"')).length, 1, 'the pool is read once per pass');
  assert.equal(result.weeksGenerated, league1Weeks.length + league2Weeks.length);
  assert.equal(result.weeksSkipped, 0);
  assert.equal(result.leagues, 2);

  // #1305 f5: apply must never host getWeeklyProjections' writes inside the
  // unit's transaction. A `client` key here would mean the caller handed it
  // the per-unit transactional client instead of letting it autocommit
  // against the pool.
  assert.ok(calls.length > 0);
  for (const c of calls) assert.ok(!('client' in c.args), 'getWeeklyProjections must never receive a client');

  // #1305 f6: the shape every real multi-league night actually records -
  // runSyncJob's `{ results: [...] }` for more than one unit - carrying each
  // league's own weeksGenerated/weeksSkipped, not just the summed return value.
  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.ok(inserted, 'one data_sync_runs row is written');
  const detail = JSON.parse(inserted.params[3]);
  assert.equal(detail.results.length, 2);
  const byLeague = new Map(detail.results.map((r) => [r.leagueId, r]));
  assert.deepEqual(byLeague.get(1), { leagueId: 1, weeksGenerated: 2, weeksSkipped: 0 });
  assert.deepEqual(byLeague.get(2), { leagueId: 2, weeksGenerated: 5, weeksSkipped: 0 });
});

test('the nightly-projection-fill row skips a week every player already has cached, and runs at most once per UTC day', async (t) => {
  const projection = require('../services/projection.service');
  const logs = [];
  t.mock.method(require('../services/projectionExplanation.service'), 'generateForWeek', async () => ({}));
  t.mock.method(console, 'log', (...args) => { logs.push(args.join(' ')); });
  let call = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    call += 1;
    const cachedFlag = call === 1; // first week fully cached, second week needs generation
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: cachedFlag }])) };
  });
  const table = runsTable();
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [{ id: 1, current_season: 2026, current_week: 15, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    ...table.handlers,
    NO_GAME_WINDOW,
  ]).install(t);

  const { result } = await tickRow(t, 'nightly-projection-fill', '2026-09-16T09:05:00Z');
  assert.equal(result.weeksSkipped, 1);
  assert.equal(result.weeksGenerated, 1);
  assert.equal(call, 2);
  // #2081: the success line ends with the elapsed wall time, and the result carries it.
  assert.ok(Number.isFinite(result.elapsedMs));
  const fillLine = logs.find((l) => l.startsWith('scheduler: nightly projection fill generated 1 week(s), skipped 1 already-cached week(s) across 1 league(s)'));
  assert.match(fillLine, / in \d+ ms$/);

  // Same UTC day, still inside the window: the pass does not run again.
  assert.equal((await tickRow(t, 'nightly-projection-fill', '2026-09-16T09:40:00Z')).ran, false);
  assert.equal(call, 2, 'no further getWeeklyProjections calls on the second same-day tick');
});

test('one league\'s failure does not stop another\'s fill; the day stays open so the window keeps retrying (#1305 f3)', async (t) => {
  const projection = require('../services/projection.service');
  const seen = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, playerIds }) => {
    seen.push(league.id);
    if (league.id === 1) throw new Error('feature bundle unavailable');
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  const table = runsTable();
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [
        { id: 1, current_season: 2026, current_week: 16, regular_season_weeks: 14, playoff_teams: 4 },
        { id: 2, current_season: 2026, current_week: 16, regular_season_weeks: 14, playoff_teams: 4 },
      ],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    ...table.handlers,
    NO_GAME_WINDOW,
  ]).install(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });

  const first = await tickRow(t, 'nightly-projection-fill', '2026-09-17T09:05:00Z');
  assert.equal(first.result, null, 'runSyncJob rethrows the unit failure; the pass is never recorded as this day\'s success');
  assert.equal(first.error, undefined, 'and the row contains it, so it never reaches lastTickError');
  assert.deepEqual(seen, [1, 2], 'league 2 was still attempted, and its week already committed on its own transaction, despite league 1 throwing first');
  assert.ok(errors.some((e) => e.includes('nightly projection fill failed') && e.includes('feature bundle unavailable')));

  // The day was never settled, so a later tick inside the SAME window retries
  // everything rather than losing the whole night to one transient failure.
  const second = await tickRow(t, 'nightly-projection-fill', '2026-09-17T09:15:00Z');
  assert.equal(second.result, null, 'league 1 keeps failing in this fixture, so it still does not settle the day');
  assert.deepEqual(seen, [1, 2, 1, 2], 'the retry re-attempted both leagues');
});

test('the nightly-projection-fill row records one Sync run through runSyncJob for the whole pass, detail carrying the weeks generated and skipped (#1305 f3)', async (t) => {
  const projection = require('../services/projection.service');
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => (
    { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) }
  ));
  const table = runsTable();
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [{ id: 1, current_season: 2026, current_week: 16, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    ...table.handlers,
    NO_GAME_WINDOW,
  ]);
  fake.install(t);

  const { result } = await tickRow(t, 'nightly-projection-fill', '2026-09-14T09:00:00Z');
  const { elapsedMs, ...counts } = result;
  assert.ok(Number.isFinite(elapsedMs));
  assert.deepEqual(counts, { weeksGenerated: 1, weeksSkipped: 0, leagues: 1 });

  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.ok(inserted, 'one data_sync_runs row is written, by runSyncJob itself');
  assert.equal(inserted.params[0], 'nightly-projection-run');
  assert.equal(inserted.params[2], true, 'ok: every unit (one league) succeeded');
  const detail = JSON.parse(inserted.params[3]);
  assert.equal(detail.leagueId, 1);
  assert.equal(detail.weeksGenerated, 1);
  assert.equal(detail.weeksSkipped, 0);
});

// ---- stat-corrections: failed weeks (#1674) -----------------------------------
// The pass reports weeks whose sync threw; a run with any is not ok, leaves the
// day open and retries no sooner than an hour later. Driven through the
// real cadence gate over a fake data_sync_runs table that the pass's own row
// insert updates.

function statCorrectionsWorld(t, { latest = null, latestOk = null } = {}) {
  const inserts = [];
  const world = { latest, latestOk, inserts };
  createFakePool([
    [/INSERT INTO "data_sync_runs"/, (text, params) => {
      inserts.push({ job: params[0], ok: params[2], detail: JSON.parse(params[3]) });
      const row = { id: inserts.length + 1, finished_at: new Date(), ok: params[2], detail: JSON.parse(params[3]) };
      world.latest = row;
      if (params[2]) world.latestOk = row;
      return { rows: [] };
    }],
    [/FROM "data_sync_runs"/, () => ({ rows: [{ latest: world.latest, latestOk: world.latestOk }] })],
  ]).install(t);
  return world;
}

const runRow2 = (finishedAt, ok, day) => ({ id: 1, finished_at: finishedAt, ok, detail: { day } });

test('a stat-corrections pass with a failed week records ok false with the failed weeks and does not settle the day', async (t) => {
  const correction = require('../services/correction.service');
  const world = statCorrectionsWorld(t);
  const failed = [{ season: 2026, week: 3, error: 'nflverse 503' }];
  let passes = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    passes += 1;
    return { corrected: [], invalidated: [], failed };
  });
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });

  const out = await tickRow(t, 'stat-corrections', '2026-09-22T12:00:00Z');

  assert.equal(out.result.failedWeeks.length, 1);
  assert.equal(world.inserts.length, 1);
  assert.equal(world.inserts[0].job, 'stat-corrections');
  assert.equal(world.inserts[0].ok, false);
  assert.deepEqual(world.inserts[0].detail.failedWeeks, failed);
  assert.equal(world.inserts[0].detail.day, '2026-09-22');
  assert.ok(warnings.some((line) => /stat corrections failed for 2026 week 3; retrying after 60 minutes/.test(line)));
  // Not settled: the failed row is not an ok row, so once the one hour retry
  // wait has passed the same day's next pass is due again.
  assert.equal((await tickRow(t, 'stat-corrections', '2026-09-22T12:30:00Z')).ran, false, 'inside the retry wait: no pass');
  await tickRow(t, 'stat-corrections', '2026-09-22T13:30:00Z');
  assert.equal(passes, 2, 'the day was not settled, so the pass ran again');
});

test('after a not-ok stat-corrections run a tick ten minutes later runs no pass and one sixty-one minutes later does', async (t) => {
  const correction = require('../services/correction.service');
  const failedAt = '2026-09-23T12:00:00Z';
  const world = statCorrectionsWorld(t, { latest: runRow2(failedAt, false, '2026-09-23') });
  let passes = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    passes += 1;
    return { corrected: [], invalidated: [], failed: [] };
  });

  const early = await tickRow(t, 'stat-corrections', '2026-09-23T12:10:00Z');
  assert.equal(early.ran, false);
  assert.equal(passes, 0, 'ten minutes after a not-ok run: no pass');
  assert.equal(world.inserts.length, 0);

  await tickRow(t, 'stat-corrections', '2026-09-23T13:01:00Z');
  assert.equal(passes, 1, 'sixty-one minutes after a not-ok run: the pass runs');
});

test('a stat-corrections pass with no failed week still records ok true and settles the day', async (t) => {
  const correction = require('../services/correction.service');
  const world = statCorrectionsWorld(t);
  let passes = 0;
  t.mock.method(correction, 'resyncPriorWeeks', async () => {
    passes += 1;
    return { corrected: [], invalidated: [], failed: [] };
  });

  await tickRow(t, 'stat-corrections', '2026-09-29T12:00:00Z');
  assert.equal(world.inserts.length, 1);
  assert.equal(world.inserts[0].ok, true);
  assert.equal('failed' in world.inserts[0].detail, false);
  await tickRow(t, 'stat-corrections', '2026-09-29T15:00:00Z');
  assert.equal(passes, 1, 'settled: no second pass the same day');
});

// ---- ESPN NFL roster-status Sync run cadence (#1766) ------------------------
// Three triggers, one job ('espn-roster-status'): the daily gate, a Saturday
// run after the 4pm ET elevation deadline, and a run before each week's
// holdout capture. All three are ordered BEFORE the depth-chart job / capture.

const rosterOk = (finishedAt) => ({ latest: { finishedAt }, latestOk: { finishedAt, detail: {} } });
const NEVER_RUN = { latest: null, latestOk: null };
const HOUR_MS = 3600 * 1000;
const sameInstants = (calls, ...nows) => assert.deepEqual(calls.map((c) => c.now.getTime()), nows.map((n) => new Date(n).getTime()));

function stubRosterRun(t, lastRunResult) {
  const espnFactsSync = require('../modules/espnFactsSync');
  const syncRun = require('../modules/syncRun');
  const calls = [];
  t.mock.method(espnFactsSync, 'runRosterStatusSync', async (opts) => { calls.push(opts); return { results: [] }; });
  t.mock.method(syncRun, 'lastRun', async (job) => { assert.equal(job, 'espn-roster-status'); return lastRunResult; });
  return calls;
}

test('the espn-roster-status-daily row runs once per UTC day through the cadence gate', async (t) => {
  const calls = stubRosterRun(t, NEVER_RUN);
  const now = new Date('2026-08-17T12:00:00-05:00');

  assert.deepEqual((await tickRow(t, 'espn-roster-status-daily', now)).result, { results: [] });
  sameInstants(calls, now);
  t.mock.restoreAll();

  // Already succeeded earlier the same UTC day: not due.
  const callsAfter = stubRosterRun(t, rosterOk(new Date('2026-08-18T06:00:00Z')));
  assert.equal((await tickRow(t, 'espn-roster-status-daily', '2026-08-18T12:00:00Z')).ran, false);
  assert.equal(callsAfter.length, 0);
});

// The Saturday elevation deadline and the holdout capture window are no longer
// helpers a test can call: they are the row's own bodies, so each is re-expressed
// at the boundary instants it was tested at.

test('the espn-roster-status-saturday row runs at and after the Saturday 4pm ET deadline (DST-correct), and on no other day or earlier hour', async (t) => {
  const calls = stubRosterRun(t, rosterOk(new Date('2026-01-01T00:00:00Z'))); // the last success predates every instant below
  const ranAtInstant = async (iso) => {
    const before = calls.length;
    await tickRow(t, 'espn-roster-status-saturday', iso);
    return calls.length - before;
  };
  // Sat 2026-10-03 16:00 EDT = 20:00Z
  assert.equal(await ranAtInstant('2026-10-03T20:00:00Z'), 1, 'exactly 4pm ET');
  assert.equal(await ranAtInstant('2026-10-03T23:30:00Z'), 1, 'later that Saturday');
  assert.equal(await ranAtInstant('2026-10-03T19:59:00Z'), 0, 'one minute before 4pm ET');
  assert.equal(await ranAtInstant('2026-10-04T12:00:00Z'), 0, 'Sunday');
  assert.equal(await ranAtInstant('2026-10-02T21:00:00Z'), 0, 'Friday');
  // Sat 2026-12-05 16:00 EST = 21:00Z
  assert.equal(await ranAtInstant('2026-12-05T21:00:00Z'), 1, 'exactly 4pm ET in winter');
  assert.equal(await ranAtInstant('2026-12-05T20:59:00Z'), 0, 'one minute before 4pm EST');
  // 01:00Z Sunday is still Saturday 9pm ET
  assert.equal(await ranAtInstant('2026-12-06T01:00:00Z'), 1, '9pm ET Saturday is 01:00Z Sunday');
});

test('the espn-roster-status-saturday row compares the last success to the DST-correct 4pm ET deadline (EDT and EST, including Sunday 01:00Z)', async (t) => {
  const cases = [
    ['2026-10-03T23:30:00Z', '2026-10-03T20:00:00Z'], // Saturday 7:30pm EDT; deadline 20:00Z
    ['2026-12-06T01:00:00Z', '2026-12-05T21:00:00Z'], // Saturday 8pm EST is Sunday 01:00Z; deadline Saturday 21:00Z
  ];
  for (const [now, deadline] of cases) {
    const deadlineMs = new Date(deadline).getTime();
    let calls = stubRosterRun(t, rosterOk(new Date(deadlineMs - 60 * 1000)));
    await tickRow(t, 'espn-roster-status-saturday', now);
    assert.equal(calls.length, 1, `a success one minute before the ${deadline} deadline does not cover it`);
    t.mock.restoreAll();

    calls = stubRosterRun(t, rosterOk(new Date(deadlineMs + 60 * 1000)));
    await tickRow(t, 'espn-roster-status-saturday', now);
    assert.equal(calls.length, 0, `a success one minute after the ${deadline} deadline already covers it`);
    t.mock.restoreAll();
  }
});

test('the espn-roster-status-saturday row runs once after the Saturday 4pm ET deadline: not before, not again once a run finished after it', async (t) => {
  // The daily run finished 9am ET, before the deadline.
  let calls = stubRosterRun(t, rosterOk(new Date('2026-10-03T13:00:00Z')));
  await tickRow(t, 'espn-roster-status-saturday', '2026-10-03T19:00:00Z');
  assert.equal(calls.length, 0, 'before 4pm ET');
  const now = new Date('2026-10-03T20:05:00Z');
  await tickRow(t, 'espn-roster-status-saturday', now);
  sameInstants(calls, now); // the morning run predates the deadline
  t.mock.restoreAll();

  calls = stubRosterRun(t, rosterOk(new Date('2026-10-03T20:02:00Z')));
  await tickRow(t, 'espn-roster-status-saturday', '2026-10-03T20:30:00Z');
  assert.equal(calls.length, 0, 'a run after the deadline already happened');
  t.mock.restoreAll();

  calls = stubRosterRun(t, NEVER_RUN);
  await tickRow(t, 'espn-roster-status-saturday', '2026-10-03T21:00:00Z');
  assert.equal(calls.length, 1, 'never run at all is due');
});

// The pre-capture run lives in the holdout-snapshots row, ahead of the capture.

function stubHoldoutCapture(t) {
  const holdout = require('../services/holdout.service');
  const captures = [];
  t.mock.method(holdout, 'captureDueSnapshots', async () => { captures.push(true); return { captured: [], failures: [] }; });
  return captures;
}

test('the holdout-snapshots row runs the roster-status pre-capture run only inside an open capture window (from the manifest deadline)', async (t) => {
  const holdout = require('../services/holdout.service');
  const deadline = holdout.captureNotAfterFor(2026, 5);
  assert.ok(deadline, 'the 2026 manifest carries a week 5 deadline');
  const windowOpen = new Date(deadline.getTime() - holdout.CAPTURE_WINDOW_HOURS * HOUR_MS);
  const calls = stubRosterRun(t, NEVER_RUN);
  stubHoldoutCapture(t);

  await tickRow(t, 'holdout-snapshots', new Date('2020-01-01T00:00:00Z'));
  assert.equal(calls.length, 0, 'no manifest week near 2020: no window is open');
  await tickRow(t, 'holdout-snapshots', new Date(windowOpen.getTime() - HOUR_MS));
  assert.equal(calls.length, 0, 'an hour before the window opens');
  await tickRow(t, 'holdout-snapshots', new Date(windowOpen.getTime() + HOUR_MS));
  assert.equal(calls.length, 1, 'an hour into the window');
  await tickRow(t, 'holdout-snapshots', new Date(deadline.getTime() + HOUR_MS));
  assert.equal(calls.length, 1, 'a passed deadline is not an open window');
});

test('the holdout-snapshots row runs the pre-capture roster run once when a week\'s capture window opens: due before any success inside it, not after', async (t) => {
  const holdout = require('../services/holdout.service');
  const deadline = holdout.captureNotAfterFor(2026, 5);
  const windowOpen = new Date(deadline.getTime() - holdout.CAPTURE_WINDOW_HOURS * HOUR_MS);
  const now = new Date(windowOpen.getTime() + HOUR_MS);
  stubHoldoutCapture(t);

  let calls = stubRosterRun(t, rosterOk(new Date(windowOpen.getTime() - HOUR_MS)));
  await tickRow(t, 'holdout-snapshots', now);
  sameInstants(calls, now);
  t.mock.restoreAll();

  stubHoldoutCapture(t);
  calls = stubRosterRun(t, rosterOk(new Date(windowOpen.getTime() + 30 * 60 * 1000)));
  await tickRow(t, 'holdout-snapshots', now);
  assert.equal(calls.length, 0, 'a success inside the window already covers the capture');
});

test('SYNC_RUN_JOBS lists the roster-status Sync run beside the other ESPN facts runs', () => {
  assert.ok(scheduler.SYNC_RUN_JOBS.includes('espn-roster-status'));
});

test('the holdout-snapshots row does not re-run the pre-capture roster run every tick behind a recent failed run: a failure inside the last 30 minutes holds it, an older one does not (#1766 risk review)', async (t) => {
  const holdout = require('../services/holdout.service');
  const deadline = holdout.captureNotAfterFor(2026, 5);
  const windowOpen = new Date(deadline.getTime() - holdout.CAPTURE_WINDOW_HOURS * HOUR_MS);
  const now = new Date(windowOpen.getTime() + 2 * HOUR_MS);
  const before = { finishedAt: new Date(windowOpen.getTime() - HOUR_MS), detail: {} };
  stubHoldoutCapture(t);

  let calls = stubRosterRun(t, { latest: { ok: false, finishedAt: new Date(now.getTime() - 10 * 60 * 1000) }, latestOk: before });
  await tickRow(t, 'holdout-snapshots', now);
  assert.equal(calls.length, 0, 'ESPN failed 10 minutes ago: hold the capture path off the dead host');
  t.mock.restoreAll();

  stubHoldoutCapture(t);
  calls = stubRosterRun(t, { latest: { ok: false, finishedAt: new Date(now.getTime() - 45 * 60 * 1000) }, latestOk: before });
  await tickRow(t, 'holdout-snapshots', now);
  assert.equal(calls.length, 1, 'the failure is old enough to retry');
});

// ---- game-day roster-status run (#1995) -------------------------------------

// A pool.query stub standing in for nfl_games: one kickoff at `kickoff`, matched
// against the [from, to] window the trigger passes, so the window is bound by
// the bounds themselves and not by a canned answer.
function stubKickoff(t, kickoff) {
  t.mock.method(pool, 'query', async (sql, [from, to]) => {
    assert.match(sql, /"nfl_games"/);
    return { rows: kickoff >= from && kickoff <= to ? [{ '?column?': 1 }] : [] };
  });
}

test('the espn-roster-status-game-day row runs when a kickoff is within 4 hours back to 6 hours ahead and no success finished in the last 60 minutes (#1995)', async (t) => {
  const now = new Date('2026-10-04T14:00:00Z');
  stubKickoff(t, new Date(now.getTime() + 3 * HOUR_MS));
  const calls = stubRosterRun(t, rosterOk(new Date(now.getTime() - 61 * 60 * 1000)));
  assert.deepEqual((await tickRow(t, 'espn-roster-status-game-day', now)).result, { results: [] });
  sameInstants(calls, now);
});

test('the espn-roster-status-game-day row: a success 59 minutes old holds it, a never-run job is due (60-minute interval)', async (t) => {
  const now = new Date('2026-10-04T14:00:00Z');
  stubKickoff(t, new Date(now.getTime() + 3 * HOUR_MS));
  const calls = stubRosterRun(t, rosterOk(new Date(now.getTime() - 59 * 60 * 1000)));
  await tickRow(t, 'espn-roster-status-game-day', now);
  assert.equal(calls.length, 0);
  t.mock.method(require('../modules/syncRun'), 'lastRun', async () => NEVER_RUN);
  await tickRow(t, 'espn-roster-status-game-day', now);
  assert.equal(calls.length, 1);
});

test('the espn-roster-status-game-day row: a nearest kickoff 7 hours ahead or 5 hours past does not run, 5 hours ahead and 3 hours past do (window)', async (t) => {
  const now = new Date('2026-10-04T14:00:00Z');
  for (const [offsetH, runs] of [[7, 0], [-5, 0], [5, 1], [-3, 1], [-3.75, 1]]) {
    stubKickoff(t, new Date(now.getTime() + offsetH * HOUR_MS));
    const calls = stubRosterRun(t, rosterOk(new Date(now.getTime() - 2 * HOUR_MS)));
    await tickRow(t, 'espn-roster-status-game-day', now);
    assert.equal(calls.length, runs, `kickoff ${offsetH}h from now`);
    t.mock.restoreAll();
  }
});

test('the espn-roster-status-game-day row: a failed attempt 10 minutes ago holds it, one 31 minutes ago does not (30-minute hold-off)', async (t) => {
  const now = new Date('2026-10-04T14:00:00Z');
  const old = { finishedAt: new Date(now.getTime() - 2 * HOUR_MS), detail: {} };
  stubKickoff(t, new Date(now.getTime() + 3 * HOUR_MS));
  let calls = stubRosterRun(t, { latest: { ok: false, finishedAt: new Date(now.getTime() - 10 * 60 * 1000) }, latestOk: old });
  await tickRow(t, 'espn-roster-status-game-day', now);
  assert.equal(calls.length, 0, 'ESPN failed 10 minutes ago');
  t.mock.restoreAll();

  stubKickoff(t, new Date(now.getTime() + 3 * HOUR_MS));
  calls = stubRosterRun(t, { latest: { ok: false, finishedAt: new Date(now.getTime() - 31 * 60 * 1000) }, latestOk: old });
  await tickRow(t, 'espn-roster-status-game-day', now);
  assert.equal(calls.length, 1);
});

// ---- the tick as a declared job list, one runner (#2049, spec #2042) ----------

const quietErrors = (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.join(' ')); });
  return logged;
};

test('the tick runs the jobs in list order', async () => {
  const ran = [];
  const jobs = ['a', 'b', 'c'].map((name) => ({ name, tier: 'deadline', gate: ALWAYS_DUE, run: async () => { ran.push(name); } }));
  await scheduler.tickUnlocked(jobs);
  assert.deepEqual(ran, ['a', 'b', 'c']);
});

test('the tick logs a throwing job and the next job still runs', async (t) => {
  const logged = quietErrors(t);
  const ran = [];
  await scheduler.tickUnlocked([
    { name: 'first', tier: 'deadline', gate: ALWAYS_DUE, run: async () => { ran.push('first'); } },
    { name: 'boom', tier: 'deadline', gate: ALWAYS_DUE, run: async () => { throw new Error('kaput'); } },
    { name: 'last', tier: 'trailing', gate: ALWAYS_DUE, run: async () => { ran.push('last'); } },
  ]);
  assert.deepEqual(ran, ['first', 'last']);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /boom/);
  assert.match(logged[0], /kaput/);
});

test('tickUnlocked records the last non-feed failure in lastTickError, ignores feed failures, and resets on a clean tick (#2058)', async (t) => {
  quietErrors(t);
  dataSyncRunsPool({}).install(t);
  const boom = (name, extra = {}) => ({ name, tier: 'deadline', gate: ALWAYS_DUE, run: async () => { throw new Error('kaput'); }, ...extra });
  const ok = { name: 'ok', tier: 'deadline', gate: ALWAYS_DUE, run: async () => {} };
  const lastTickError = async (jobs) => {
    await scheduler.tickUnlocked(jobs);
    return (await scheduler.getSchedulerStatus()).lastTickError;
  };

  assert.equal(await lastTickError([ok, boom('waivers'), boom('stale-kickoff-alert'), ok]), 'stale-kickoff-alert: kaput', 'the last non-feed failure');
  assert.equal(await lastTickError([boom('adp', { syncRun: ['x'] }), ok]), null, 'a feed failure alone records nothing');
  assert.equal(await lastTickError([boom('waivers'), boom('adp', { syncRun: ['x'] })]), 'waivers: kaput', 'a later feed failure does not displace it');
  assert.equal(await lastTickError([ok]), null, 'a clean tick resets it');
});

test('the real tick list is the pre-#2049 tickUnlocked order, deadline then housekeeping then trailing', () => {
  assert.deepEqual(scheduler.TICK_JOBS.map((j) => j.name), [
    'stat-corrections',
    'nflverse-finalization',
    'nflverse-game-context-fill',
    'nflverse-current-week',
    'injuries',
    'adp',
    'odds',
    'game-context',
    'holdout-snapshots',
    'kickoff-waiver-hold',
    'waivers',
    'lineup-reminders',
    'pickem-week-sync',
    'pickem-reminders',
    'pickem-season-completion',
    'trades',
    'scheduled-drafts',
    'live-sync',
    'cpu-lineups',
    'override-capture',
    'espn-schedule',
    'stale-kickoff-alert',
    'nflverse-practice',
    'retention',
    'player-sync',
    'weather-snapshots',
    'nightly-projection-fill',
    'nightly-stats-integrity',
    'espn-roster-status-daily',
    'espn-roster-status-saturday',
    'espn-roster-status-game-day',
    'espn-depth-chart',
    'espn-ownership',
  ]);
  const rank = { deadline: 0, housekeeping: 1, trailing: 2 };
  const ranks = scheduler.TICK_JOBS.map((j) => rank[j.tier]);
  assert.ok(ranks.every((r) => r !== undefined), 'every job has a known tier');
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'tiers never go backwards down the list');
  assert.ok(scheduler.TICK_JOBS.every((j) => typeof j.run === 'function'));
});

test('SYNC_RUN_JOBS is derived from the tick list, plus the commissioner-only Sync runs', () => {
  assert.deepEqual(scheduler.SYNC_RUN_JOBS, [
    ...new Set(scheduler.TICK_JOBS.flatMap((job) => job.syncRun || [])),
    ...scheduler.MANUAL_SYNC_RUN_JOBS,
  ]);
  assert.deepEqual([...scheduler.SYNC_RUN_JOBS].sort(), [
    'adp', 'espn-depth-chart', 'espn-ownership', 'espn-roster-status', 'game-context', 'injuries',
    'nflverse-correction', 'nflverse-current-week', 'nflverse-practice', 'nflverse-snaps', 'nflverse-week',
    'odds', 'players', 'retention', 'schedule', 'schedule-nflverse', 'season-stats', 'stat-corrections', 'team-defenses',
    'weather-snapshots', 'week-stats',
  ]);
});

test('the holdout-snapshots row runs the pre-capture roster run first, and a throw there does not skip the capture', async (t) => {
  const holdout = require('../services/holdout.service');
  const order = [];
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  t.mock.method(holdout, 'captureNotAfterFor', () => { order.push('pre-run'); throw new Error('manifest unreadable'); });
  t.mock.method(holdout, 'captureDueSnapshots', async () => { order.push('capture'); return { captured: [], failures: [] }; });

  await tickRow(t, 'holdout-snapshots', '2026-10-04T14:00:00Z');

  assert.deepEqual(order, ['pre-run', 'capture']);
  assert.ok(errors.some((line) => /pre-holdout ESPN roster-status sync failed/.test(line)));
});

test('the holdout-snapshots row ends its capture success line with the elapsed ms (#2081)', async (t) => {
  const holdout = require('../services/holdout.service');
  const logs = [];
  t.mock.method(console, 'log', (...args) => { logs.push(args.join(' ')); });
  t.mock.method(holdout, 'captureNotAfterFor', () => null);
  t.mock.method(holdout, 'captureDueSnapshots', async () => ({
    captured: [{ season: 2026, week: 4, profileName: 'half_ppr', inserted: 1540 }],
    failures: [],
  }));

  await tickRow(t, 'holdout-snapshots', '2026-10-04T14:00:00Z');

  const line = logs.find((l) => l.startsWith('scheduler: captured 1 holdout snapshot(s): 2026 w4 half_ppr (1540 rows)'));
  assert.match(line, / in \d+ ms$/);
});
