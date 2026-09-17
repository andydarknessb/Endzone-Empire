const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const push = require('../services/push.service');
const prefs = require('../services/prefs.service');
const { alertCloseMatchups } = require('../modules/scheduler');

test('close-matchup push targets Game Center instead of the retired Matchups route', async (t) => {
  let sent;
  createFakePool([[/./, () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] })]]).install(t);
  t.mock.method(prefs, 'usersWanting', async (ownerIds, key) => {
    assert.deepEqual(ownerIds, [11, 22]);
    assert.equal(key, 'closeMatchups');
    return ownerIds;
  });
  t.mock.method(push, 'sendPushToUsers', async (ownerIds, payload) => {
    sent = { ownerIds, payload };
    return { sent: ownerIds.length };
  });

  await alertCloseMatchups({
    leagueId: 42,
    week: 7,
    scored: [{ matchupId: 987654, homeTeamId: 3, awayTeamId: 4, homeScore: 101, awayScore: 96.5 }],
  });

  assert.deepEqual(sent.ownerIds, [11, 22]);
  assert.equal(sent.payload.url, '/#/league/42/game-center');
  assert.equal(sent.payload.title, 'Your matchup is close!');
});

// ---- quota-aware stat-sync cadence -----------------------------------------

const scheduler = require('../modules/scheduler');
const tank01Client = require('../modules/tank01Client');
const pool = require('../modules/pool');
const pickClock = require('../services/pickClock.service');
const draftSweepLiveness = require('../modules/draftSweepLiveness');

test('syncEveryTicks doubles the box-score cadence once quota is degraded', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'degraded' }));
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS * 2);
});

// ---- draft-clock tick containment (#600) -----------------------------------

test('draftTick stamps the draft-sweep liveness key after the sweep runs, and not on a skipped tick (#842)', async (t) => {
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

  await scheduler.draftTick();
  assert.equal(stamps.length, 1, 'an acquired tick stamps liveness exactly once');

  locked = false;
  await scheduler.draftTick();
  // Red tell: stamping before the lock (or on skip) would count 2 here and let a
  // worker that never runs its sweep look alive.
  assert.equal(stamps.length, 1, 'a skipped tick does not stamp');
});

test('draftTick contains a failure in the advisory-lock acquisition itself, without throwing', async (t) => {
  // The sweep contains its own failures, and draftTickUnlocked has always caught
  // the sweep. The gap #600 closes is withAdvisoryLock's OWN acquisition - the
  // pool.connect() and the try-lock query - which runs before the work callback
  // and is covered by no inner catch. A rejection there used to reach setInterval
  // as an unhandled rejection and could take the worker (and every live draft's
  // clock) down. draftTick now catches it. Red tell: drop draftTick's try/catch
  // and this rejects, failing the assertion below.
  t.mock.method(pool, 'connect', async () => { throw new Error('pool exhausted acquiring the draft-clock lock'); });

  let threw = false;
  let result;
  try {
    result = await scheduler.draftTick();
  } catch (err) {
    threw = true;
  }

  assert.equal(threw, false, 'draftTick swallowed the lock-acquisition failure instead of rejecting into setInterval');
  assert.equal(result, undefined);
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

test('syncEveryTicks keeps the normal cadence while quota is healthy', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'ok' }));
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS);
});

test('syncEveryTicks falls back to the default when quota state is unavailable', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => {
    throw new Error('quota table missing');
  });
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS);
});

/**
 * #1188: inside a game window, the every-windowMs decision reads the last
 * successful `injuries` run in data_sync_runs, not a module variable, so a
 * worker restart (a fresh module instance) cannot re-run it more often than
 * the window allows. Outside a window the once-a-day decision is the cadence
 * gate's own concern instead (#1509, below), so this world only ever needs to
 * answer the WINDOW-mode read - the outside-window tests stub cadence.due
 * directly and never reach this fake pool at all.
 */
function injuryWorld(t, { inWindow = true } = {}) {
  const scoring = require('../services/feedSyncRuns.service');
  const previousKey = process.env.RAPID_API_KEY;
  const previousHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  t.after(() => {
    if (previousKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = previousKey;
    if (previousHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = previousHost;
  });
  const world = { runs: [], calls: 0, fail: false, inWindow, clock: null };
  const fake = createFakePool([
    // Serves lastInjurySyncAt's WINDOW-mode read only now (#1509 formal
    // review f3): lastRun('injuries') (#1205), shaped the way syncRun.js's
    // lastRun query does, `{ latest, latestOk }`. The once-a-day OUTSIDE-
    // window decision no longer reaches this fake at all - it is the cadence
    // gate's own concern, stubbed directly in the tests below.
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
    [/FROM "private"."api_usage"|FROM "private"."api_quota_snapshots"/, () => ({ rows: [] })],
  ]);
  fake.install(t);
  t.mock.method(scoring, 'syncInjuries', async () => {
    world.calls += 1;
    if (world.fail) {
      world.runs.push({ ok: false, finished_at: world.clock });
      throw new Error('Tank01 unavailable');
    }
    world.runs.push({ ok: true, finished_at: world.clock });
    return { playersUpdated: 10, irFlags: 1 };
  });
  world.run = (now) => {
    world.clock = now;
    return scheduler.runDailyInjurySync({ now });
  };
  return world;
}

test('runDailyInjurySync: inside a game window it runs every 15 minutes, not every 10 (#1188)', async (t) => {
  const world = injuryWorld(t, { inWindow: true });
  const T = new Date('2026-09-13T12:00:00-05:00'); // Sunday, first kickoff minus 90 min
  assert.ok(await world.run(T), 'first run of the window');
  assert.equal(await world.run(new Date(T.getTime() + 10 * 60 * 1000)), null, 'ten minutes on: not yet');
  assert.ok(await world.run(new Date(T.getTime() + 15 * 60 * 1000)), 'fifteen minutes on: runs');
  assert.equal(world.calls, 2);
});

test('runDailyInjurySync never consults the cadence gate while inside a game window', async (t) => {
  // Inside a window, injurySyncDue/lastInjurySyncAt decide alone; the cadence
  // gate is an outside-window concern only (#1509).
  const world = injuryWorld(t, { inWindow: true });
  const cadence = require('../modules/cadence');
  let dueCalls = 0;
  t.mock.method(cadence, 'due', async () => { dueCalls += 1; return { due: true, reason: 'stubbed due' }; });

  await world.run(new Date('2026-09-13T12:00:00-05:00'));
  assert.equal(dueCalls, 0);
});

test('injurySyncDue is the in-window cadence rule; INJURY_GAME_WINDOW_MS doubles while quota is degraded', () => {
  const now = new Date('2026-09-13T15:00:00-05:00');
  const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60 * 1000);
  assert.equal(scheduler.injurySyncDue({ now, lastRunAt: null, inWindow: false, windowMs: 900000 }), true, 'never run: due regardless of window');
  assert.equal(scheduler.injurySyncDue({ now, lastRunAt: at(30), inWindow: true, windowMs: 900000 }), true);
  assert.equal(scheduler.injurySyncDue({ now, lastRunAt: at(10), inWindow: true, windowMs: 900000 }), false);
  const prev = process.env.INJURY_GAME_WINDOW_MS;
  delete process.env.INJURY_GAME_WINDOW_MS;
  try {
    assert.equal(scheduler.injuryGameWindowMs('ok'), 15 * 60 * 1000);
    assert.equal(scheduler.injuryGameWindowMs('degraded'), 30 * 60 * 1000);
    process.env.INJURY_GAME_WINDOW_MS = '60000';
    assert.equal(scheduler.injuryGameWindowMs('ok'), 60000);
  } finally {
    if (prev === undefined) delete process.env.INJURY_GAME_WINDOW_MS; else process.env.INJURY_GAME_WINDOW_MS = prev;
  }
});

// ---- outside a window: daily injury sync (#1188, #1509) --------------------
// The once-a-day decision is the cadence gate's own concern (server/modules/
// cadence.js, spec #1492 step two, #1509, spec #1493 "UTC day everywhere").
// Same shape as the ADP/ESPN/odds sections above: these stub cadence.due
// directly and assert this function's OWN behavior around that decision and
// delegation to feedSyncRuns.service.syncInjuries.

function withInjuryCreds(t) {
  const previousKey = process.env.RAPID_API_KEY;
  const previousHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  t.after(() => {
    if (previousKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = previousKey;
    if (previousHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = previousHost;
  });
}

test('runDailyInjurySync delegates the outside-a-window due/not-due decision to the cadence gate', async (t) => {
  withInjuryCreds(t);
  const scoring = require('../services/feedSyncRuns.service');
  const cadence = require('../modules/cadence');
  createFakePool([[/FROM "live_game_states"/, () => ({ rows: [] })]]).install(t); // outside any window
  let dueArgs = null;
  t.mock.method(cadence, 'due', async (args) => { dueArgs = args; return { due: true, reason: 'stubbed due' }; });
  const calls = [];
  t.mock.method(scoring, 'syncInjuries', async (opts) => {
    calls.push(opts);
    return { playersUpdated: 10, irFlags: 1 };
  });

  const now = new Date('2026-08-20T12:00:00-05:00');
  assert.deepEqual(await scheduler.runDailyInjurySync({ now }), { playersUpdated: 10, irFlags: 1 });
  assert.deepEqual(calls, [{ now }], 'due: true delegates straight to syncInjuries with the same now');
  assert.deepEqual(dueArgs, { job: 'injuries', every: 'utc-day', now });
});

test('runDailyInjurySync never calls syncInjuries outside a window when the cadence gate says it is not due', async (t) => {
  withInjuryCreds(t);
  const scoring = require('../services/feedSyncRuns.service');
  const cadence = require('../modules/cadence');
  createFakePool([[/FROM "live_game_states"/, () => ({ rows: [] })]]).install(t);
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let calls = 0;
  t.mock.method(scoring, 'syncInjuries', async () => { calls += 1; return { playersUpdated: 10, irFlags: 1 }; });

  const result = await scheduler.runDailyInjurySync({ now: new Date('2026-08-20T12:00:00-05:00') });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('runDailyInjurySync propagates a thrown syncInjuries outside a window so the next tick retries (a throw never moves the gate)', async (t) => {
  withInjuryCreds(t);
  const scoring = require('../services/feedSyncRuns.service');
  const cadence = require('../modules/cadence');
  createFakePool([[/FROM "live_game_states"/, () => ({ rows: [] })]]).install(t);
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  t.mock.method(scoring, 'syncInjuries', async () => { throw new Error('Tank01 unavailable'); });

  await assert.rejects(
    scheduler.runDailyInjurySync({ now: new Date('2026-08-20T12:00:00-05:00') }),
    /Tank01 unavailable/
  );
});

test('tickUnlocked registers the daily injury sync duty', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );

  assert.match(tickBody, /await runDailyInjurySync\(\);/);
});

// ---- daily ADP sync (#747, #1509) -------------------------------------------
// The due/not-due decision is the cadence gate's own concern (server/modules/
// cadence.js, cadence.test.js's table suite covers the 'utc-day' cadence and
// the "a failed run is never latestOk" case generically). No in-memory day
// stamp remains here (#1509 AC1), so these stub cadence.due directly and
// assert this function's OWN behavior around that decision and delegation to
// it.

test('runDailyAdpSync delegates the due/not-due decision to the cadence gate', async (t) => {
  const adp = require('../services/adp.service');
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  let dueOpts = null;
  t.mock.method(cadence, 'due', async (args, opts) => { dueArgs = args; dueOpts = opts; return { due: true, reason: 'stubbed due' }; });
  const calls = [];
  t.mock.method(adp, 'syncAdp', async (opts) => {
    calls.push(opts);
    return { ok: true, playersUpdated: 180 };
  });

  const now = new Date('2026-08-20T12:00:00-05:00');
  assert.deepEqual(await scheduler.runDailyAdpSync({ now }), { ok: true, playersUpdated: 180 });
  assert.deepEqual(calls, [{ now }], 'due: true delegates straight to syncAdp with the same now');
  assert.deepEqual(dueArgs, { job: 'adp', every: 'utc-day', now });
  // Pinned at stub level (formal review, optional item 4): the gate is
  // handed adpLastRun, not its own plain default reader - a same-day
  // refusal must close the gate the same way a success does (#1509 risk
  // review, see the adpLastRun tests below).
  assert.equal(dueOpts && dueOpts.lastRun, scheduler.adpLastRun);
});

test('runDailyAdpSync never calls syncAdp when the cadence gate says it is not due', async (t) => {
  const adp = require('../services/adp.service');
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let calls = 0;
  t.mock.method(adp, 'syncAdp', async () => { calls += 1; return { ok: true }; });

  const result = await scheduler.runDailyAdpSync({ now: new Date('2026-08-20T12:00:00-05:00') });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('runDailyAdpSync propagates a thrown syncAdp so the next tick retries (a throw never moves the gate)', async (t) => {
  const adp = require('../services/adp.service');
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  t.mock.method(adp, 'syncAdp', async () => { throw new Error('FFC unavailable'); });

  await assert.rejects(
    scheduler.runDailyAdpSync({ now: new Date('2026-08-20T12:00:00-05:00') }),
    /FFC unavailable/
  );
});

// The two tests below exercise the REAL cadence gate (not stubbed) against a
// fake data_sync_runs table, because the gate's own `latestOk`-only read is
// exactly what #1509's risk review found wrong for this job: a thin-market/
// thin-match refusal (adp.service.js's wipe guard) resolves rather than
// throws and records ok=false, so on the gate's plain default reader it would
// never close for the day, and every five-minute tick would re-hit FFC for
// the rest of the UTC day while the market stays thin - the exact hazard the
// pre-#1509 in-memory `lastAdpSyncDay` stamp existed to prevent. `adpLastRun`
// (scheduler.js) fixes this by substituting a same-day refusal for `latestOk`
// when it is the newest run.
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

test('runDailyAdpSync: a same-UTC-day refusal (thin market) also closes the gate, not just a success (#1509 risk review)', async (t) => {
  const adp = require('../services/adp.service');
  const cadenceModule = require('../modules/cadence');
  const runs = adpRunsWorld(t);
  let calls = 0;
  t.mock.method(adp, 'syncAdp', async ({ now }) => {
    calls += 1;
    const day = cadenceModule.utcDateKey(now);
    runs.push({ finished_at: now, ok: false, detail: { day, reason: 'refused', refusalReason: 'thin_market', adpPlayers: 40 } });
    return { ok: false, skipped: true, reason: 'thin_market', format: 'half-ppr', teams: 12, adpPlayers: 40, playersMatched: 0, playersUpdated: 0 };
  });

  const firstDay = new Date('2026-08-20T12:00:00-05:00');
  assert.ok(await scheduler.runDailyAdpSync({ now: firstDay }));
  assert.equal(calls, 1);
  // A second tick the same UTC day must NOT re-hit FFC, even though the only
  // recorded run so far is a refusal (ok=false), not a success.
  assert.equal(await scheduler.runDailyAdpSync({ now: new Date('2026-08-20T18:00:00-05:00') }), null);
  assert.equal(calls, 1, 'a same-day refusal closes the gate the same way a success would');
  // The next UTC day, the gate opens again.
  assert.ok(await scheduler.runDailyAdpSync({ now: new Date('2026-08-21T12:00:00-05:00') }));
  assert.equal(calls, 2);
});

test('runDailyAdpSync: a thrown syncAdp (fetch_failed/write_failed) never closes the gate, so the very next tick retries', async (t) => {
  const adp = require('../services/adp.service');
  const runs = adpRunsWorld(t);
  let calls = 0;
  t.mock.method(adp, 'syncAdp', async ({ now }) => {
    calls += 1;
    // fetch_failed carries no run-level detail (runSyncJob.js): the throw
    // happens before any { units, detail } wrapper is returned, so there is
    // no detail.day and no detail.reason === 'refused' to substitute for
    // latestOk - this row must never close the gate.
    runs.push({ finished_at: now, ok: false, detail: { reason: 'fetch_failed', message: 'FFC unavailable' } });
    throw new Error('FFC unavailable');
  });

  const now = new Date('2026-08-20T12:00:00-05:00');
  await assert.rejects(scheduler.runDailyAdpSync({ now }), /FFC unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(scheduler.runDailyAdpSync({ now: new Date('2026-08-20T12:05:00-05:00') }), /FFC unavailable/);
  assert.equal(calls, 2, 'a thrown run never closes the gate, so the very next tick retries');
});

test('tickUnlocked runs the daily ADP sync in its own containment, so a throw does not stop the duties after it', () => {
  // The duty is contained exactly like runDailyInjurySync: a thrown ADP sync is
  // caught and logged, and the rest of the tick still runs (a source-order pin
  // in the same spirit as the injury-duty test above).
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runDailyAdpSync\(\);\s*\} catch/);
});

// ---- daily ESPN depth-chart & Ownership syncs (#1308, #1509) ----------------
// Same shape as the ADP section above: the due/not-due decision is the
// cadence gate's own concern, so these stub cadence.due directly and assert
// this function's OWN behavior around that decision and delegation to
// espnFactsSync.runDepthChartSync / runOwnershipSync. No in-memory day stamp
// or lastEspnFactsSyncAt wrapper remains for either job (#1509 AC1).

test('runDailyEspnDepthChartSync delegates the due/not-due decision to the cadence gate', async (t) => {
  const espnFactsSync = require('../modules/espnFactsSync');
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  t.mock.method(cadence, 'due', async (args) => { dueArgs = args; return { due: true, reason: 'stubbed due' }; });
  const calls = [];
  t.mock.method(espnFactsSync, 'runDepthChartSync', async (opts) => {
    calls.push(opts);
    return { results: [] };
  });

  const now = new Date('2026-08-20T12:00:00-05:00');
  assert.deepEqual(await scheduler.runDailyEspnDepthChartSync({ now }), { results: [] });
  assert.deepEqual(calls, [{ now }], 'due: true delegates straight to runDepthChartSync with the same now');
  assert.deepEqual(dueArgs, { job: 'espn-depth-chart', every: 'utc-day', now });
});

test('runDailyEspnDepthChartSync never calls runDepthChartSync when the cadence gate says it is not due', async (t) => {
  const espnFactsSync = require('../modules/espnFactsSync');
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let calls = 0;
  t.mock.method(espnFactsSync, 'runDepthChartSync', async () => { calls += 1; return { results: [] }; });

  const result = await scheduler.runDailyEspnDepthChartSync({ now: new Date('2026-08-20T12:00:00-05:00') });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('tickUnlocked runs the daily ESPN depth-chart sync in its own containment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runDailyEspnDepthChartSync\(\);\s*\} catch/);
});

test('runDailyEspnOwnershipSync delegates the due/not-due decision to the cadence gate', async (t) => {
  const espnFactsSync = require('../modules/espnFactsSync');
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  t.mock.method(cadence, 'due', async (args) => { dueArgs = args; return { due: true, reason: 'stubbed due' }; });
  const calls = [];
  t.mock.method(espnFactsSync, 'runOwnershipSync', async (opts) => {
    calls.push(opts);
    return { written: 4000 };
  });

  const now = new Date('2026-08-20T12:00:00-05:00');
  assert.deepEqual(await scheduler.runDailyEspnOwnershipSync({ now }), { written: 4000 });
  assert.deepEqual(calls, [{ now }], 'due: true delegates straight to runOwnershipSync with the same now');
  assert.deepEqual(dueArgs, { job: 'espn-ownership', every: 'utc-day', now });
});

test('runDailyEspnOwnershipSync never calls runOwnershipSync when the cadence gate says it is not due', async (t) => {
  const espnFactsSync = require('../modules/espnFactsSync');
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let calls = 0;
  t.mock.method(espnFactsSync, 'runOwnershipSync', async () => { calls += 1; return { written: 4000 }; });

  const result = await scheduler.runDailyEspnOwnershipSync({ now: new Date('2026-08-20T12:00:00-05:00') });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('tickUnlocked runs the daily ESPN ownership sync in its own containment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runDailyEspnOwnershipSync\(\);\s*\} catch/);
});

// ---- hourly odds sync (#1234, #1510) ------------------------------------------
// The due/not-due decision is the cadence gate's own concern (server/modules/
// cadence.js, cadence.test.js's table suite covers the { ms } cadence and the
// "a failed run is never latestOk" cases generically). No in-memory epoch
// remains here (#1510 AC2), so these stub cadence.due directly and assert
// this function's OWN behavior around that decision and delegation to it.

test('runHourlyOddsSync delegates the due/not-due decision to the cadence gate', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  t.mock.method(cadence, 'due', async (args) => { dueArgs = args; return { due: true, reason: 'stubbed due' }; });
  const calls = [];
  t.mock.method(espnOdds, 'syncOdds', async ({ season, week }) => {
    calls.push({ season, week });
    return { gamesWritten: 1 };
  });
  createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ current_season: 2026, current_week: 2 }] })],
  ]).install(t);

  const now = new Date('2026-09-11T12:00:00Z');
  assert.deepEqual(await scheduler.runHourlyOddsSync({ now }), [{ gamesWritten: 1 }]);
  assert.deepEqual(calls, [{ season: 2026, week: 2 }], 'due: true delegates straight to the leagues read and syncOdds');
  assert.deepEqual(dueArgs, { job: 'odds', every: { ms: scheduler.ODDS_SYNC_INTERVAL_MS }, now });
});

test('runHourlyOddsSync never reads the leagues table when the cadence gate says it is not due', async (t) => {
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ current_season: 2026, current_week: 2 }] })],
  ]).install(t);

  const result = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-11T12:10:00Z') });
  assert.equal(result, null);
  assert.equal(fake.calls.length, 0, 'due: false never reaches the leagues read');
});

test('runHourlyOddsSync syncs every distinct (season, week) a live league is on, and one week failing does not stop another', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  const calls = [];
  t.mock.method(espnOdds, 'syncOdds', async ({ season, week }) => {
    calls.push({ season, week });
    if (week === 2) throw new Error('ESPN unavailable');
    return { gamesWritten: 3 };
  });
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [
        { current_season: 2026, current_week: 2 },
        { current_season: 2026, current_week: 3 },
      ],
    })],
  ]).install(t);

  const results = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-12T12:00:00Z') });
  assert.deepEqual(calls, [{ season: 2026, week: 2 }, { season: 2026, week: 3 }]);
  assert.deepEqual(results, [{ gamesWritten: 3 }], 'the failed week is skipped, not thrown');
});

// The three cases below drive the REAL cadence.due (no stub on cadence
// itself), stubbing only `syncRun.lastRun` - the gate's own default reader -
// so the gate's actual due/not-due arithmetic is what decides each case, per
// the lead's review (pl-endzone, PR #1530 f2).

test('runHourlyOddsSync reads the leagues table again on the very next call when no league was live, because nothing ever became latestOk', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const syncRun = require('../modules/syncRun');
  t.mock.method(syncRun, 'lastRun', async (job) => {
    assert.equal(job, 'odds');
    return { latest: null, latestOk: null }; // never run
  });
  let syncCalls = 0;
  t.mock.method(espnOdds, 'syncOdds', async () => { syncCalls += 1; return { gamesWritten: 1 }; });
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [] })],
  ]).install(t);

  const first = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-12T12:00:00Z') });
  assert.deepEqual(first, [], 'no live league, so no odds Sync run is attempted');
  assert.equal(syncCalls, 0);
  assert.equal(fake.calls.filter((c) => c.text.includes('FROM "leagues"')).length, 1);

  // Ten minutes later: nothing was ever written, so `latestOk` is still null
  // and the real gate is still due - the leagues table is read again rather
  // than staying silent for the rest of the hour.
  const second = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-12T12:10:00Z') });
  assert.deepEqual(second, []);
  assert.equal(fake.calls.filter((c) => c.text.includes('FROM "leagues"')).length, 2, 'the gate answers due again, so the leagues read repeats');
});

test('runHourlyOddsSync retries on the very next tick, not the full hour, when every week on a tick fails', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const syncRun = require('../modules/syncRun');
  t.mock.method(syncRun, 'lastRun', async () => ({ latest: null, latestOk: null })); // no week has ever succeeded
  let syncCalls = 0;
  t.mock.method(espnOdds, 'syncOdds', async ({ week }) => {
    syncCalls += 1;
    throw new Error(`ESPN unavailable for week ${week}`);
  });
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [
        { current_season: 2026, current_week: 2 },
        { current_season: 2026, current_week: 3 },
      ],
    })],
  ]).install(t);

  const first = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-12T12:00:00Z') });
  assert.deepEqual(first, [], 'every week failed, so no result is pushed');
  assert.equal(syncCalls, 2);

  // Five minutes later, same never-succeeded lastRun (no failed week's row
  // ever becomes latestOk): the real gate is still due, so both weeks are
  // retried - the retry spec #1493 story 5 wants, rather than waiting out
  // the full hour.
  const second = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-12T12:05:00Z') });
  assert.deepEqual(second, []);
  assert.equal(syncCalls, 4, 'both weeks are retried on the very next tick');
});

test('runHourlyOddsSync is not due when the job already succeeded inside the hour (contrast case)', async (t) => {
  const espnOdds = require('../services/espnOdds.provider');
  const syncRun = require('../modules/syncRun');
  t.mock.method(syncRun, 'lastRun', async () => ({
    latest: { id: 1, finishedAt: new Date('2026-09-12T11:55:00Z'), ok: true, detail: { gamesWritten: 3 } },
    latestOk: { id: 1, finishedAt: new Date('2026-09-12T11:55:00Z'), ok: true, detail: { gamesWritten: 3 } },
  }));
  let syncCalls = 0;
  t.mock.method(espnOdds, 'syncOdds', async () => { syncCalls += 1; return { gamesWritten: 1 }; });
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ current_season: 2026, current_week: 2 }] })],
  ]).install(t);

  // Only 10 minutes after the last success - well inside the hour.
  const result = await scheduler.runHourlyOddsSync({ now: new Date('2026-09-12T12:05:00Z') });
  assert.equal(result, null);
  assert.equal(syncCalls, 0);
  assert.equal(fake.calls.length, 0, 'not due, so the leagues table is never read');
});

test('tickUnlocked runs the hourly odds sync in its own containment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runHourlyOddsSync\(\);\s*\} catch/);
});

// ---- nflverse IDP-finalization pass (#1511) --------------------------------
// The second consumer of the cadence gate (server/modules/cadence.js, spec
// #1492 step two): `syncNflverseWeek` (nflverseSync.service.js) already
// writes a `nflverse-week` Sync run through `runSyncJob` for every
// (season, week) `finalizePriorWeeks` processes, on every run regardless of
// outcome (ADR 0036), so the gate reads that job directly - no second,
// scheduler-level row, same as `runHourlyOddsSync`'s `job: 'odds'` gate
// above. Deliberately no `after: 'stat-corrections'` (pl-endzone formal
// review f1, #1511): this pass runs Mon-Thu, stat-corrections only ever
// succeeds Tue/Wed, and an `after` dependency here starved Monday and
// Thursday outright (on those days stat-corrections' last success is never
// fresher than nflverse-week's own). Every "is it actually due" case is the
// cadence table suite's job (cadence.test.js); these stub the gate directly
// and assert only this function's OWN delegation to it and its Mon-Thu day
// filter, which has no gate equivalent and so stays a plain check beside the
// gate call.

test('runNflverseFinalization delegates the due/not-due decision to the cadence gate', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const cadence = require('../modules/cadence');
  let dueArgs = null;
  t.mock.method(cadence, 'due', async (args) => { dueArgs = args; return { due: true, reason: 'stubbed due' }; });
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] }; });

  const now = new Date('2026-09-22T12:00:00Z'); // a Tuesday, inside the Mon-Thu window
  const result = await scheduler.runNflverseFinalization({ now });

  assert.equal(finalizeCalls, 1, 'due: true delegates straight to finalizePriorWeeks');
  assert.deepEqual(dueArgs, { job: 'nflverse-week', every: 'utc-day', now }, 'no `after` (f1): this pass never depended on stat-corrections');
  assert.deepEqual(result, { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] });
});

test('runNflverseFinalization never calls finalizePriorWeeks when the cadence gate says it is not due', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const cadence = require('../modules/cadence');
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [] }; });

  const now = new Date('2026-09-23T12:00:00Z'); // a Wednesday, inside the window, a different day from above
  const result = await scheduler.runNflverseFinalization({ now });

  assert.equal(result, null);
  assert.equal(finalizeCalls, 0, 'due: false never reaches finalizePriorWeeks');
});

// The Mon-Thu day filter (`isNflverseFinalizationDay`) has no cadence
// equivalent, so it is pinned at the SCHEDULER, not the gate: a day outside
// the window must never even ask the gate, and Thursday - the window's last
// day - must still reach it.

test('runNflverseFinalization never consults the gate on a Friday, outside its Mon-Thu window', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const cadence = require('../modules/cadence');
  let dueCalls = 0;
  t.mock.method(cadence, 'due', async () => { dueCalls += 1; return { due: true, reason: 'stubbed due' }; });
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [] }; });

  const result = await scheduler.runNflverseFinalization({ now: new Date('2026-09-25T12:00:00Z') }); // Friday
  assert.equal(result, null);
  assert.equal(dueCalls, 0, 'the day filter short-circuits before the gate is ever asked');
  assert.equal(finalizeCalls, 0);
});

test('Thursday: runNflverseFinalization still consults the gate, the last day of its Mon-Thu window (pinned at the scheduler)', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const cadence = require('../modules/cadence');
  let dueCalls = 0;
  t.mock.method(cadence, 'due', async () => { dueCalls += 1; return { due: true, reason: 'stubbed due' }; });
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [] }; });

  await scheduler.runNflverseFinalization({ now: new Date('2026-09-24T12:00:00Z') }); // Thursday
  assert.equal(dueCalls, 1, 'Thursday is still inside the window, so the gate is consulted');
  assert.equal(finalizeCalls, 1);
});

// pl-endzone formal review f1 (#1511): finalization's behaviour no longer
// depends on stat-corrections at all (no `after`), driving the REAL
// cadence.due (no stub) through a fake `syncRun.lastRun`, same style as
// `runHourlyOddsSync`'s real-gate cases. `lastRun` asserts it is never asked
// for 'stat-corrections' - proving independence, not merely a case where
// corrections happens to be irrelevant.

test('runNflverseFinalization runs on a Tuesday off its own cadence alone, never reading stat-corrections (pinned at the gate)', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const syncRun = require('../modules/syncRun');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] }; });
  t.mock.method(syncRun, 'lastRun', async (job) => {
    assert.equal(job, 'nflverse-week', 'no `after` dependency: stat-corrections is never read');
    // Last succeeded Monday, a prior UTC day relative to Tuesday's `now`.
    return { latest: { id: 2, finishedAt: new Date('2026-09-21T09:10:00Z'), ok: true, detail: null }, latestOk: { id: 2, finishedAt: new Date('2026-09-21T09:10:00Z'), ok: true, detail: null } };
  });

  const result = await scheduler.runNflverseFinalization({ now: new Date('2026-09-22T12:00:00Z') }); // Tuesday
  assert.deepEqual(result, { finalized: [{ season: 2026, week: 2, playersUpdated: 4 }] });
  assert.equal(finalizeCalls, 1);
});

test('runNflverseFinalization runs on a Thursday after a Wednesday success (regression pin: an after: stat-corrections dependency would starve this day, f1)', async (t) => {
  const nflverseSync = require('../services/nflverseSync.service');
  const syncRun = require('../modules/syncRun');
  let finalizeCalls = 0;
  t.mock.method(nflverseSync, 'finalizePriorWeeks', async () => { finalizeCalls += 1; return { finalized: [{ season: 2026, week: 3, playersUpdated: 2 }] }; });
  t.mock.method(syncRun, 'lastRun', async (job) => {
    assert.equal(job, 'nflverse-week');
    // Wednesday's run is the last success; stat-corrections' own last success
    // (also Wednesday) would never look fresher than this under `after` -
    // exactly the starvation f1 found. Without `after`, the plain daily
    // cadence alone is due: Wednesday is a prior UTC day relative to Thursday.
    return { latest: { id: 3, finishedAt: new Date('2026-09-23T09:10:00Z'), ok: true, detail: null }, latestOk: { id: 3, finishedAt: new Date('2026-09-23T09:10:00Z'), ok: true, detail: null } };
  });

  const result = await scheduler.runNflverseFinalization({ now: new Date('2026-09-24T12:00:00Z') }); // Thursday
  assert.deepEqual(result, { finalized: [{ season: 2026, week: 3, playersUpdated: 2 }] });
  assert.equal(finalizeCalls, 1);
});

test('tickUnlocked runs the nflverse finalization pass in its own containment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runNflverseFinalization\(\);\s*\} catch/);
});

// ---- hourly game-context Sync run (#1262, ADR 0038) ------------------------
// Named for what it writes, not "Line" (pl-endzone formal review, #1262 f1):
// CONTEXT.md's Line is the spread/total Sync run tested above as
// runHourlyOddsSync.

test('runHourlyGameContextSync runs once per hour, syncing every distinct live-league week', async (t) => {
  const gameContextSync = require('../services/gameContextSync.service');
  const calls = [];
  t.mock.method(gameContextSync, 'syncGameContext', async ({ season, week }) => {
    calls.push({ season, week });
    return { gamesUpdated: 1 };
  });
  createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ current_season: 2026, current_week: 2 }] })],
  ]).install(t);

  const first = new Date('2026-09-13T12:00:00Z');
  assert.deepEqual(await scheduler.runHourlyGameContextSync({ now: first }), [{ gamesUpdated: 1 }]);
  assert.deepEqual(calls, [{ season: 2026, week: 2 }]);

  // A tick 10 minutes later is not due yet.
  const soon = new Date('2026-09-13T12:10:00Z');
  assert.equal(await scheduler.runHourlyGameContextSync({ now: soon }), null);
  assert.equal(calls.length, 1);

  // An hour later it runs again.
  const later = new Date('2026-09-13T13:01:00Z');
  await scheduler.runHourlyGameContextSync({ now: later });
  assert.equal(calls.length, 2);
});

test('runHourlyGameContextSync syncs every distinct (season, week) a live league is on, and one week failing does not stop another', async (t) => {
  const gameContextSync = require('../services/gameContextSync.service');
  const calls = [];
  t.mock.method(gameContextSync, 'syncGameContext', async ({ season, week }) => {
    calls.push({ season, week });
    if (week === 2) throw new Error('ESPN unavailable');
    return { gamesUpdated: 3 };
  });
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [
        { current_season: 2026, current_week: 2 },
        { current_season: 2026, current_week: 3 },
      ],
    })],
  ]).install(t);

  // A day past the previous test's own last stamp, so this module-level
  // interval gate (shared across every test in this file) is unambiguously
  // due regardless of run order.
  const results = await scheduler.runHourlyGameContextSync({ now: new Date('2026-09-14T12:00:00Z') });
  assert.deepEqual(calls, [{ season: 2026, week: 2 }, { season: 2026, week: 3 }]);
  assert.deepEqual(results, [{ gamesUpdated: 3 }], 'the failed week is skipped, not thrown');
});

test('tickUnlocked runs the hourly game context sync in its own containment', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runHourlyGameContextSync\(\);\s*\} catch/);
});

// Row shape matching syncRun.js's lastRun($job) query: `{ latest, latestOk }`,
// each a row_to_json-shaped object (snake_case) or null. `byJob` maps a job
// literal to that shape; a job with no entry answers { latest: null, latestOk: null }.
function dataSyncRunsPool(byJob) {
  return createFakePool([
    [/FROM "data_sync_runs"/, (text, params) => ({
      rows: [byJob[params[0]] || { latest: null, latestOk: null }],
    })],
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

test('syncAndScoreLiveWeeks still scores when the stat sync fetched nothing', async (t) => {
  // Every game final and already ingested (or quota exhausted): scoreMatchups is
  // DB-only, so it must still run — finals ingested via the recap path get
  // scored promptly this way.
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  const scoring = require('../services/matchupScoring.service');
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
    const ran = await scheduler.syncAndScoreLiveWeeks();
    assert.equal(ran, true);
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
  const changes = await scheduler.runPickemWeekSync({ now: new Date('2026-09-29T16:00:00Z') });

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

  const changes = await scheduler.runPickemWeekSync({ now: new Date('2027-06-01T12:00:00Z') });

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

  const first = await scheduler.runPickemSeasonCompletion({ now });
  const second = await scheduler.runPickemSeasonCompletion({ now });

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
  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

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

test('a champion missing required historical identity aborts completion', async (t) => {
  const world = pickemSeasonWorld(t, {
    league: { id: 1, name: 'Broken Pool', current_season: 2026, current_week: 18, season_status: 'regular', created_at: '2026-08-01T00:00:00.000Z' },
    teams: [],
    picks: [
      { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      { user_id: 100, week: 18, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
    ],
    live: FINALS,
  });
  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

  assert.deepEqual(completed, []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.result, null);
  assert.deepEqual(world.trophies, []);
  assert.deepEqual(world.notifications, []);
  assert.ok(world.calls.some((call) => call.text === 'ROLLBACK'));
  assert.ok(!world.calls.some((call) => call.text === 'COMMIT'));
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

  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

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

  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

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

  const completed = await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') });

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
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2027-01-11T06:00:00Z') }), []);
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
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2027-03-01T06:00:00Z') }), []);
  assert.equal(lateCreate.league.season_status, 'regular');
  assert.ok(!lateCreate.calls.some((c) => c.text === 'BEGIN'), 'skipped without opening a transaction');
});

test('the tick syncs pick\'em-only weeks right before the pick\'em reminders, and completes seasons right after', () => {
  // Same source-order pin as holdout.service.test.js uses for the deadline
  // duties: reminders must read the freshly synced week in the SAME tick.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const body = source.slice(source.indexOf('async function tickUnlocked'));
  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i !== -1, `tickUnlocked does not call ${needle}`);
    return i;
  };
  const weekSync = at('runPickemWeekSync()');
  const reminders = at('sendPickemReminders()');
  const completion = at('runPickemSeasonCompletion()');
  const trades = at('processDueTrades()');
  assert.ok(weekSync < reminders, 'week sync before reminders');
  assert.ok(reminders < completion, 'completion right after reminders');
  assert.ok(completion < trades, 'both pick\'em duties before the fantasy work that follows');
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
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2026-10-15T12:00:00Z') }), []);
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
  assert.deepEqual(await scheduler.runPickemSeasonCompletion({ now: new Date('2027-03-01T12:00:00Z') }), []);
  assert.equal(world.league.season_status, 'regular');
  assert.equal(world.calls.filter((c) => c.text === 'BEGIN').length, 0);
  assert.equal(world.calls.filter((c) => /fn_normalize_nfl_team|game_recaps/.test(c.text)).length, 0, 'gate closed: no slate read');
  assert.ok(warnings.some((w) => /week 18 has no games on file/.test(w)));
});

// ---- nightly projection run (#1305) -----------------------------------
// All `now` values below land inside NIGHTLY_PROJECTION_FILL_UTC_HOUR (9
// UTC, scheduler.js) and use distinct calendar days: the once-a-day stamp is
// shared module state across every test in this file, same as
// lastRetentionDay above.

test('runNightlyProjectionFill only runs inside its own off-peak UTC hour', async (t) => {
  const calls = [];
  createFakePool([
    [/FROM "leagues"/, () => { calls.push('leagues'); return { rows: [] }; }],
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    // Outside the window this hits the cadence gate (#1511); nothing has ever
    // run, so `after: 'stat-corrections'` is unsatisfied and the gate itself
    // answers not due - the fixture does not need a real owed scenario for
    // this test, which is only about the hour boundary.
    [/FROM "data_sync_runs"/, () => ({ rows: [{ latest: null, latestOk: null }] })],
  ]).install(t);

  assert.equal(await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-20T08:59:00Z') }), null);
  assert.equal(await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-20T10:00:00Z') }), null);
  assert.equal(calls.length, 0, 'no query at all outside the window, not even the eligibility read');

  assert.deepEqual(
    await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-20T09:30:00Z') }),
    { weeksGenerated: 0, weeksSkipped: 0, leagues: 0 }
  );
});

test('runNightlyProjectionFill queries leagues with the same live-season eligibility the hourly syncs use', async (t) => {
  const fake = createFakePool([
    [/FROM "leagues"/, (text) => {
      assert.match(text, /"draft_status" = 'complete'/);
      assert.match(text, /"season_status" <> 'complete'/);
      return { rows: [] };
    }],
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]);
  fake.install(t);
  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-12T09:00:00Z') });
  assert.deepEqual(result, { weeksGenerated: 0, weeksSkipped: 0, leagues: 0 });
});

test('runNightlyProjectionFill fills every week from each league\'s current week through its OWN last playoff week', async (t) => {
  const projection = require('../services/projection.service');
  const calls = [];
  t.mock.method(projection, 'getWeeklyProjections', async (args) => {
    const { league, week, playerIds } = args;
    calls.push({ leagueId: league.id, week, args });
    return { projections: new Map(playerIds.map((id) => [id, { median: 10, cached: false }])) };
  });
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
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-15T09:00:00Z') });

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

test('runNightlyProjectionFill skips a week every player already has cached, and runs at most once per local day', async (t) => {
  const projection = require('../services/projection.service');
  let call = 0;
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => {
    call += 1;
    const cachedFlag = call === 1; // first week fully cached, second week needs generation
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: cachedFlag }])) };
  });
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [{ id: 1, current_season: 2026, current_week: 15, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
    // The second call below falls outside `inWindow` (this process already
    // filled today) and so reaches the cadence gate (#1511); nothing owed in
    // this fixture, so it answers not due regardless.
    [/FROM "data_sync_runs"/, () => ({ rows: [{ latest: null, latestOk: null }] })],
  ]).install(t);

  const first = new Date('2026-09-16T09:05:00Z');
  const result = await scheduler.runNightlyProjectionFill({ now: first });
  assert.equal(result.weeksSkipped, 1);
  assert.equal(result.weeksGenerated, 1);
  assert.equal(call, 2);

  // Same local day, still inside the window: the pass does not run again.
  const laterSameDay = new Date('2026-09-16T09:40:00Z');
  assert.equal(await scheduler.runNightlyProjectionFill({ now: laterSameDay }), null);
  assert.equal(call, 2, 'no further getWeeklyProjections calls on the second same-day tick');
});

test('one league\'s failure does not stop another\'s fill; the day stays unstamped so the window keeps retrying (#1305 f3)', async (t) => {
  const projection = require('../services/projection.service');
  const seen = [];
  t.mock.method(projection, 'getWeeklyProjections', async ({ league, playerIds }) => {
    seen.push(league.id);
    if (league.id === 1) throw new Error('feature bundle unavailable');
    return { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) };
  });
  createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [
        { id: 1, current_season: 2026, current_week: 16, regular_season_weeks: 14, playoff_teams: 4 },
        { id: 2, current_season: 2026, current_week: 16, regular_season_weeks: 14, playoff_teams: 4 },
      ],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]).install(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });

  const first = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-17T09:05:00Z') });
  assert.equal(first, null, 'runSyncJob rethrows the unit failure; the pass is never recorded as this day\'s success');
  assert.deepEqual(seen, [1, 2], 'league 2 was still attempted, and its week already committed on its own transaction, despite league 1 throwing first');
  assert.ok(errors.some((e) => e.includes('nightly projection fill failed') && e.includes('feature bundle unavailable')));

  // The day was never stamped, so a later tick inside the SAME window retries
  // everything rather than losing the whole night to one transient failure.
  const second = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-17T09:15:00Z') });
  assert.equal(second, null, 'league 1 keeps failing in this fixture, so it still does not stamp');
  assert.deepEqual(seen, [1, 2, 1, 2], 'the retry re-attempted both leagues');
});

test('records one Sync run through runSyncJob for the whole pass, detail carrying the weeks generated and skipped (#1305 f3)', async (t) => {
  const projection = require('../services/projection.service');
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => (
    { projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])) }
  ));
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({
      rows: [{ id: 1, current_season: 2026, current_week: 16, regular_season_weeks: 14, playoff_teams: 4 }],
    })],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    [/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })],
  ]);
  fake.install(t);

  const result = await scheduler.runNightlyProjectionFill({ now: new Date('2026-09-14T09:00:00Z') });
  assert.deepEqual(result, { weeksGenerated: 1, weeksSkipped: 0, leagues: 1 });

  const inserted = fake.calls.find((c) => c.text.startsWith('INSERT INTO "data_sync_runs"'));
  assert.ok(inserted, 'one data_sync_runs row is written, by runSyncJob itself');
  assert.equal(inserted.params[0], 'nightly-projection-run');
  assert.equal(inserted.params[2], true, 'ok: every unit (one league) succeeded');
  const detail = JSON.parse(inserted.params[3]);
  assert.equal(detail.leagueId, 1);
  assert.equal(detail.weeksGenerated, 1);
  assert.equal(detail.weeksSkipped, 0);
});

test('tickUnlocked runs the nightly projection fill LAST, after every time-sensitive duty, in its own containment (#1305 f2)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  assert.match(tickBody, /try \{\s*await runNightlyProjectionFill\(\);\s*\} catch/);
  const fillAt = tickBody.indexOf('await runNightlyProjectionFill();');
  const retentionAt = tickBody.indexOf('await runRetention();');
  const waiversAt = tickBody.indexOf('processAllDueWaivers()');
  const tradesAt = tickBody.indexOf('processDueTrades()');
  const lastTickErrorAt = tickBody.indexOf('lastTickError = null;');
  assert.ok(fillAt !== -1 && retentionAt !== -1, 'both calls are present');
  assert.ok(retentionAt < fillAt, 'the fill runs beside runRetention, the other once-a-day housekeeping pass, never ahead of it');
  assert.ok(waiversAt < fillAt && tradesAt < fillAt, 'every time-sensitive duty (waivers, trades, ...) runs before the fill, never after');
  assert.ok(fillAt < lastTickErrorAt, 'the fill is the LAST duty in the tick');
});

test('tickUnlocked runs the kickoff waiver hold before claim processing (#1375, ADR 0043)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const tickBody = source.slice(
    source.indexOf('async function tickUnlocked'),
    source.indexOf('async function runRetention')
  );
  const holdAt = tickBody.indexOf('holdKickedOffPlayers()');
  const waiversAt = tickBody.indexOf('processAllDueWaivers()');
  assert.ok(holdAt !== -1 && waiversAt !== -1, 'both calls are present');
  assert.ok(holdAt < waiversAt, "the hold job writes this tick's kickoff rows before claims are processed");
});
