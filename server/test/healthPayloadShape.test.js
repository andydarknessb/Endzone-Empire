const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const holdout = require('../services/holdout.service');


const { createFakePool } = require('./helpers/fakePool');
const { keys, NEXT_QUARTER } = require('./helpers/payloadShape');
const scheduler = require('../modules/scheduler');
const liveGameEngine = require('../modules/liveGameEngine');
const draftSweepLiveness = require('../modules/draftSweepLiveness');
const { ERROR_CATEGORIES } = require('../modules/errorCategory');

// The published error fields must always be null (healthy) or a member of this
// fixed enum - never the raw error string (#242).
const CATEGORY_ENUM = new Set(Object.values(ERROR_CATEGORIES));

/**
 * The payload contract of every unauthenticated /api/health/* route (#201).
 *
 * health.router.js has no `requireAuth` anywhere - Render's probes and the
 * monitor call it with no credentials - so all five of its routes are public,
 * and every field they carry is public operational detail. Four of the five
 * build their payload from a route-level object literal over named-column
 * reads, which is already the #199 shape.
 *
 * `/holdout` is the one worth naming precisely. The route destructures
 * `{ ok, obligations }`, so its TOP level is a route allowlist like the rest -
 * a third field added to the service's return value does not reach the wire.
 * The obligations ARRAY, though, is published exactly as the service built it:
 * a field added to an obligation reaches an anonymous caller with no
 * route-level decision at all. Hence the key-set assertion below is driven
 * through the real `reconcileObligations`.
 *
 * Sibling suites: unauthenticatedRouteInventory.test.js, publicPayloadShape,
 * authPayloadShape, draftPresenterBoard (#199).
 */

const healthRouter = require('../routes/health.router');

const app = express();
app.use('/api/health', healthRouter);

const previousRedisUrl = process.env.REDIS_URL;
after(() => {
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
});


/** A worker_heartbeats row wider than the contract. */
const wideWorkerRow = (over = {}) => ({
  worker_name: 'scheduler',
  last_seen_at: new Date().toISOString(),
  last_error: null,
  release_sha: 'abc1234',
  a_column_added_next_quarter: NEXT_QUARTER,
  ...over,
});

function healthPool(over = {}) {
  return createFakePool([
    [/^SELECT 1$/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "worker_heartbeats"/, () => ({ rows: over.workers || [wideWorkerRow()] })],
    // The overdue-clock probe (#768): a SELECT over "leagues"; default none.
    // Rows are raw DB-shaped ({ id, pick_deadline_at, age_ms }).
    [/FROM "leagues"/, () => ({ rows: over.overdueClocks || [] })],
    // getSchedulerStatus reads the latest ADP run here (#747); default: none.
    [/FROM "data_sync_runs"/, () => ({ rows: over.adpRuns || [] })],
  ]);
}

/** A raw overdue-clock row as the leagues probe would return it. */
const overdueRow = (over = {}) => ({
  id: 42, pick_deadline_at: '2026-09-03T00:00:00.000Z', age_ms: 45000, ...over,
});

/**
 * There is deliberately no quota stub.
 *
 * `health.router.js` destructures `getQuotaState` at load, exactly as it does
 * `getRedisClient`, so `t.mock.method(tank01Client, 'getQuotaState', ...)`
 * would be INERT - it replaces a property the router already captured. An
 * inert stub is worse than none: it plants a decoy that never enters the code
 * under test while reading like proof that the decoy was withheld.
 *
 * So the composite tests below run the real `getQuotaState`, and the
 * `keys(res.body.quota)` assertions are load-bearing without it: the real
 * function answers thirteen fields (`localUsed`, `headerUsed`, `softLimit`,
 * `hardCeiling`, `providerLimit`, `providerRemaining`, `providerSeenAt`,
 * `backoffUntil` among them) and `quotaStatus` names six. A serializer that
 * spread its input instead of naming its fields fails on the other seven.
 */

function stubHoldout(t, result) {
  t.mock.method(holdout, 'reconcileObligations', async () => result ?? {
    ok: true,
    obligations: [{ season: 2026, week: 1, profile: 'standard', state: 'captured' }],
  });
}

// ---------------------------------------------------------------------------
// /livez and /readyz
// ---------------------------------------------------------------------------

test('GET /livez publishes exactly ok, uptime and release', async () => {
  const res = await request(app).get('/api/health/livez');
  assert.deepEqual(keys(res.body), ['ok', 'release', 'uptimeSec']);
});

test('GET /readyz publishes exactly ok, db, redis and release, with exact nested shapes', async (t) => {
  delete process.env.REDIS_URL;
  const fake = healthPool().install(t);

  const res = await request(app).get('/api/health/readyz');

  assert.deepEqual(keys(res.body), ['db', 'ok', 'redis', 'release']);
  assert.deepEqual(keys(res.body.db), ['latencyMs', 'ok']);
  // Unconfigured Redis reports no latency: there was nothing to time. The
  // configured branch adds exactly `latencyMs` and is not pinned here - the
  // module's client seam is not mockable from this file (health.router
  // destructures getRedisClient at load) and a real connection attempt keeps
  // a reconnect timer alive for the rest of the process.
  assert.deepEqual(keys(res.body.redis), ['configured', 'ok']);
  fake.assertClean();
});

test('a FAILING db check publishes the same key set, never the error detail', async (t) => {
  // A probe that leaked its exception would publish a connection string, so
  // the key set has to be the same whether the check passed or failed and the
  // message has to stay out of it.
  delete process.env.REDIS_URL;
  const fake = createFakePool([
    [/^SELECT 1$/, () => { throw new Error('connect ECONNREFUSED postgres://user:hunter2@db'); }],
    [/FROM "worker_heartbeats"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app).get('/api/health/readyz');

  assert.equal(res.status, 503);
  assert.deepEqual(keys(res.body), ['db', 'ok', 'redis', 'release']);
  assert.deepEqual(keys(res.body.db), ['latencyMs', 'ok']);
  assert.equal(res.body.db.ok, false);
  assert.ok(!JSON.stringify(res.body).includes('hunter2'), 'no credential reaches the probe');
  assert.ok(!JSON.stringify(res.body).includes('ECONNREFUSED'), 'no error detail reaches the probe');
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// /worker
// ---------------------------------------------------------------------------

test('GET /worker publishes exactly ok and workers, each worker an exact key set', async (t) => {
  const fake = healthPool().install(t);

  const res = await request(app).get('/api/health/worker');

  assert.deepEqual(keys(res.body), ['draftSweepStale', 'lastDraftSweepAt', 'ok', 'overdueClocks', 'workers']);
  assert.equal(res.body.workers.length, 1);
  assert.deepEqual(keys(res.body.workers[0]), ['lastError', 'lastSeenAt', 'name', 'release', 'stale']);
  assert.deepEqual(res.body.overdueClocks, [], 'no stuck clocks by default');
  assert.ok(!JSON.stringify(res.body).includes('a_column_added_next_quarter'));
  fake.assertClean();
});

test('GET /worker adds exactly one key when the heartbeat table cannot be read', async (t) => {
  const fake = createFakePool([
    [/FROM "worker_heartbeats"/, () => { throw new Error('relation does not exist'); }],
    // The overdue probe is a separate read and still answers (empty here).
    [/FROM "leagues"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app).get('/api/health/worker');

  assert.equal(res.status, 503);
  assert.deepEqual(keys(res.body), ['draftSweepStale', 'lastDraftSweepAt', 'ok', 'overdueClocks', 'unavailable', 'workers']);
  assert.deepEqual(res.body.workers, []);
  assert.deepEqual(res.body.overdueClocks, []);
  assert.ok(!JSON.stringify(res.body).includes('relation does not exist'));
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// /worker - the overdue-clock alarm (#768, ruling 2)
// ---------------------------------------------------------------------------
// The API-health half of the two detectors: workerStatus reports Overdue clocks
// from the stored deadline, so a DEAD worker (which never runs the sweep) is
// still caught. /worker folds `overdueClocks.length === 0` into its ok and so
// answers 503; the composite / carries the same section as context but keeps
// its own ok rule (runtime, db, redis) - a stuck draft clock must not make the
// API read unhealthy and get the service cycled by Render's probe.

test('GET /worker: an overdue clock publishes the row and fails the check with 503', async (t) => {
  const fake = healthPool({ overdueClocks: [overdueRow()] }).install(t);

  const res = await request(app).get('/api/health/worker');

  // Red tell: return zero overdue rows and this 503 becomes a 200.
  assert.equal(res.status, 503, 'a stuck clock fails /worker');
  assert.equal(res.body.ok, false);
  assert.deepEqual(res.body.overdueClocks, [
    { leagueId: 42, deadlineAt: '2026-09-03T00:00:00.000Z', ageMs: 45000 },
  ]);
  fake.assertClean();
});

test('GET /worker: with no overdue clocks and a healthy heartbeat the check passes 200', async (t) => {
  // The pair to the case above: zero overdue rows must NOT fail the check, which
  // is what makes the 503 there attributable to the overdue fold and not to the
  // heartbeat.
  const fake = healthPool({ overdueClocks: [] }).install(t);

  const res = await request(app).get('/api/health/worker');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.overdueClocks, []);
  fake.assertClean();
});

test('GET /: the SAME overdue fake still answers 200 - the API is healthy when a clock is stuck', async (t) => {
  // Ruling 2's load-bearing distinction, and the outage guard: / keeps its
  // (runtime, db, redis) ok rule. Render probes /api/health/readyz, which is
  // untouched, but / must also not flip to 503 on an overdue clock or an
  // operator wiring the probe at / would cycle a healthy service.
  delete process.env.REDIS_URL;
  // runtime.ready is a load-time capture in the router (not a mockable seam), so
  // this test drives the real flag: mark ready for the "runtime ok" precondition
  // and put it back to not-ready afterward so the later "not ready" case still
  // reads 503.
  const runtimeState = require('../modules/runtimeState');
  runtimeState.markReady();
  t.after(() => runtimeState.markShuttingDown());
  const fake = healthPool({ overdueClocks: [overdueRow()] }).install(t);
  stubHoldout(t);

  const res = await request(app).get('/api/health');

  assert.equal(res.status, 200, 'a stuck draft clock does not make the API unhealthy');
  assert.equal(res.body.ok, true);
  // The section still rides along as context, with the stuck clock named.
  assert.deepEqual(res.body.worker.overdueClocks, [
    { leagueId: 42, deadlineAt: '2026-09-03T00:00:00.000Z', ageMs: 45000 },
  ]);
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// /holdout - the one route that publishes a service snapshot as-is
// ---------------------------------------------------------------------------

test('GET /holdout publishes exactly ok and obligations', async (t) => {
  stubHoldout(t);
  const res = await request(app).get('/api/health/holdout');
  assert.deepEqual(keys(res.body), ['obligations', 'ok']);
});

test('GET /holdout adds exactly one key when reconciliation cannot run, and no error detail', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(holdout, 'reconcileObligations', async () => {
    throw new Error('permission denied for schema private');
  });

  const res = await request(app).get('/api/health/holdout');

  assert.equal(res.status, 503);
  assert.deepEqual(keys(res.body), ['obligations', 'ok', 'unavailable']);
  assert.ok(!JSON.stringify(res.body).includes('permission denied'));
});

test('an obligation publishes exactly the fields holdout.service names, and no database row', async (t) => {
  // Driven through the REAL reconcileObligations, because the route does no
  // filtering of its own: the service's object literal IS the public
  // allowlist here. The fake answers rows wider than the contract.
  const decoy = NEXT_QUARTER;
  const now = new Date('2026-09-01T00:00:00Z');
  const scheduleRows = [
    { season: 2026, week: 1, nfl_team: 'KC', opponent: 'BUF', home_away: 'home',
      kickoff_at: '2026-09-10T00:20:00.000Z', game_key: '2026-01-KC-BUF',
      a_column_added_next_quarter: decoy },
  ];
  const reconcile = (snapshots) => {
    const fake = createFakePool([
      [/FROM "projection_snapshots"/, () => ({ rows: snapshots })],
      [/FROM "holdout_capture_status"/, () => ({ rows: [] })],
      [/FROM "nfl_games"/, () => ({ rows: scheduleRows })],
    ]).install(t);
    return holdout.reconcileObligations({ now }).then((result) => {
      fake.assertClean();
      return result;
    });
  };

  // First pass tells us a real (season, week, profile) key; the second seeds a
  // snapshot at a FOREIGN protocol version for that key, so the payload also
  // carries the two diagnostics only a broken week emits.
  const first = await reconcile([]);
  const sample = first.obligations[0];
  assert.ok(sample, 'the manifest produces obligations to inspect');
  const status = await reconcile([{
    season: sample.season, week: sample.week, scoring_profile: sample.profile,
    capture_kind: 'scheduled', protocol_version: 1, a_column_added_next_quarter: decoy,
  }]);
  const published = JSON.parse(JSON.stringify(status));

  assert.deepEqual(keys(published), ['obligations', 'ok']);
  assert.ok(published.obligations.length > 0, 'the manifest produces obligations to inspect');

  // Two of the fields are diagnostics that only a broken week carries, so the
  // exact set is asserted as the UNION observed across the payload plus the
  // core every entry must carry. Both halves matter: a new field shows up in
  // the union, and a field that stops being emitted breaks the core.
  const CORE = ['attempts', 'captureNotAfter', 'profile', 'protocolVersion', 'season', 'state', 'week'];
  const OPTIONAL = ['foreignProtocols', 'missingArms', 'scheduleIssues'];
  const observed = new Set();
  for (const obligation of published.obligations) {
    for (const key of Object.keys(obligation)) observed.add(key);
    for (const key of CORE) {
      assert.ok(key in obligation, `every obligation carries ${key}`);
    }
    for (const key of Object.keys(obligation)) {
      assert.ok(CORE.includes(key) || OPTIONAL.includes(key), `${key} is a published obligation field`);
    }
  }
  assert.deepEqual([...observed].sort(), [...CORE, ...OPTIONAL].sort());
  assert.ok(!JSON.stringify(published).includes(decoy), 'no database column reaches the probe');
});

// ---------------------------------------------------------------------------
// GET /api/health - the composite
// ---------------------------------------------------------------------------

test('GET / publishes exactly the composite allowlist and every nested status shape', async (t) => {
  delete process.env.REDIS_URL;
  const fake = healthPool().install(t);
  stubHoldout(t);

  const res = await request(app).get('/api/health');

  assert.deepEqual(keys(res.body), [
    'db', 'holdout', 'liveGameEngine', 'ok', 'quota', 'redis', 'release',
    'runtime', 'scheduler', 'uptimeSec', 'worker',
  ]);
  assert.deepEqual(keys(res.body.db), ['latencyMs', 'ok']);
  assert.deepEqual(keys(res.body.redis), ['configured', 'ok']);
  assert.deepEqual(keys(res.body.runtime), ['ready', 'shuttingDown']);
  assert.deepEqual(keys(res.body.worker), ['draftSweepStale', 'lastDraftSweepAt', 'ok', 'overdueClocks', 'workers']);
  assert.deepEqual(keys(res.body.worker.workers[0]), ['lastError', 'lastSeenAt', 'name', 'release', 'stale']);
  assert.deepEqual(keys(res.body.quota), ['budget', 'cycleStart', 'mode', 'provider', 'remaining', 'used']);
  assert.deepEqual(keys(res.body.holdout), ['obligations', 'ok']);
  assert.deepEqual(keys(res.body.scheduler), ['lastAdpSync', 'lastSyncAt', 'lastTickAt', 'lastTickError']);
  assert.deepEqual(keys(res.body.liveGameEngine), [
    'clockSource', 'configuredClockSource', 'espnConsecutiveFailures',
    'lastError', 'lastRunAt', 'lastSourceUsed', 'quotaMode',
  ]);
  assert.ok(!JSON.stringify(res.body).includes('a_column_added_next_quarter'));
  fake.assertClean();
});

test('GET / publishes the same key set when it is not ready and has nothing to report', async (t) => {
  delete process.env.REDIS_URL;
  const fake = healthPool({ workers: [] }).install(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(holdout, 'reconcileObligations', async () => {
    throw new Error('permission denied for schema private');
  });

  const res = await request(app).get('/api/health');

  assert.equal(res.status, 503);
  assert.deepEqual(keys(res.body), [
    'db', 'holdout', 'liveGameEngine', 'ok', 'quota', 'redis', 'release',
    'runtime', 'scheduler', 'uptimeSec', 'worker',
  ]);
  // The section that WIDENS rather than narrows when its source is gone: one
  // extra key, named. (`quota`'s own `{ unavailable }` fallback is not
  // reachable from this seam - getQuotaState is destructured at load, and it
  // swallows its own read failure anyway - so it is reported in the audit
  // rather than pinned here.)
  assert.deepEqual(keys(res.body.holdout), ['obligations', 'ok', 'unavailable']);
  assert.deepEqual(keys(res.body.quota), ['budget', 'cycleStart', 'mode', 'provider', 'remaining', 'used']);
  assert.deepEqual(res.body.worker.workers, []);
  assert.ok(!JSON.stringify(res.body).includes('permission denied'));
  fake.assertClean();
});

test('a third field on the holdout service result does not reach the composite', async (t) => {
  // The route destructures `{ ok, obligations }`, which is what makes its top
  // level an allowlist rather than a passthrough. Pinned so a later
  // `return status` refactor cannot quietly turn it into one.
  delete process.env.REDIS_URL;
  const fake = healthPool().install(t);
  stubHoldout(t, {
    ok: true,
    obligations: [],
    unavailable: true,
    a_field_added_next_quarter: 'publishes by default under a passthrough',
  });

  const res = await request(app).get('/api/health');

  assert.deepEqual(keys(res.body.holdout), ['obligations', 'ok']);
  assert.ok(!JSON.stringify(res.body).includes('a_field_added_next_quarter'));
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// #242 - the three anonymous error fields carry a category, never the string.
//
// These are VALUE-shape assertions, the guard the #201 audit called for and
// the key-set pins above could not give: a hostile message seeded into each
// field's source must come out as a member of the fixed enum, and none of its
// substrings (a connection string, an upstream host, a file path) may survive
// anywhere in the serialized body.
// ---------------------------------------------------------------------------

// A message engineered to carry everything a raw err.message might leak.
const HOSTILE_DB = 'connect ECONNREFUSED postgres://app:hunter2@db.internal:5432/prod';
const HOSTILE_UPSTREAM = 'timeout of 2000ms exceeded calling https://api.tank01.example/getNFLScoresOnly';
const HOSTILE_PATH = 'ENOENT: no such file, open /var/secrets/service-account.json';
const HOSTILE_NEEDLES = [
  'hunter2', 'db.internal', 'ECONNREFUSED', '5432',
  'api.tank01.example', '/var/secrets', 'service-account.json',
];

function assertNoHostileSubstring(body) {
  const published = JSON.stringify(body);
  for (const needle of HOSTILE_NEEDLES) {
    assert.ok(!published.includes(needle), `${needle} does not reach the anonymous payload`);
  }
}

test('GET /worker: a healthy worker publishes null for lastError, worker.ok true', async (t) => {
  const fake = healthPool({ workers: [wideWorkerRow({ last_error: null })] }).install(t);
  const res = await request(app).get('/api/health/worker');
  assert.equal(res.status, 200);
  assert.equal(res.body.workers[0].lastError, null);
  assert.equal(res.body.ok, true);
  fake.assertClean();
});

test('GET /worker: a hostile last_error becomes a category, leaking none of it, and ok is false', async (t) => {
  const fake = healthPool({ workers: [wideWorkerRow({ last_error: HOSTILE_DB })] }).install(t);
  const res = await request(app).get('/api/health/worker');
  assert.equal(res.status, 503, 'a categorized error still fails the check');
  assert.ok(CATEGORY_ENUM.has(res.body.workers[0].lastError), 'lastError is an enum category');
  assert.equal(res.body.ok, false, 'worker.ok truthiness derivation is unchanged');
  assertNoHostileSubstring(res.body);
  fake.assertClean();
});

test('GET /: healthy scheduler and liveGameEngine publish null error fields', async (t) => {
  // Real getters, module state null: the healthy end of the value contract.
  delete process.env.REDIS_URL;
  const fake = healthPool().install(t);
  stubHoldout(t);
  const res = await request(app).get('/api/health');
  assert.equal(res.body.scheduler.lastTickError, null);
  // No ADP run on file yet: the freshness key is present and null (#747 AC7).
  assert.ok('lastAdpSync' in res.body.scheduler, 'scheduler payload carries lastAdpSync');
  assert.equal(res.body.scheduler.lastAdpSync, null);
  assert.equal(res.body.liveGameEngine.lastError, null);
  fake.assertClean();
});

test('GET /: hostile scheduler and liveGameEngine errors become categories, leaking neither', async (t) => {
  delete process.env.REDIS_URL;
  const fake = healthPool().install(t);
  stubHoldout(t);
  // The router reads these through the module object, so the getters are a
  // mockable seam (unlike the load-time-destructured redis/quota clients).
  t.mock.method(scheduler, 'getSchedulerStatus', async () => ({
    lastTickAt: '2026-08-25T00:00:00.000Z',
    lastTickError: HOSTILE_DB,
    lastSyncAt: null,
    lastAdpSync: null,
  }));
  t.mock.method(liveGameEngine, 'getLiveGameEngineStatus', () => ({
    lastRunAt: '2026-08-25T00:00:00.000Z',
    lastError: HOSTILE_UPSTREAM,
    clockSource: 'espn',
    configuredClockSource: 'espn',
    lastSourceUsed: null,
    espnConsecutiveFailures: 0,
    quotaMode: null,
  }));

  const res = await request(app).get('/api/health');

  assert.ok(CATEGORY_ENUM.has(res.body.scheduler.lastTickError), 'scheduler.lastTickError is a category');
  assert.ok(CATEGORY_ENUM.has(res.body.liveGameEngine.lastError), 'liveGameEngine.lastError is a category');
  // Key sets stay exactly as the pins above require, values and all.
  assert.deepEqual(keys(res.body.scheduler), ['lastAdpSync', 'lastSyncAt', 'lastTickAt', 'lastTickError']);
  assert.deepEqual(keys(res.body.liveGameEngine), [
    'clockSource', 'configuredClockSource', 'espnConsecutiveFailures',
    'lastError', 'lastRunAt', 'lastSourceUsed', 'quotaMode',
  ]);
  assertNoHostileSubstring(res.body);
  fake.assertClean();
});

test('GET /worker: a file-path error message also leaks nothing', async (t) => {
  const fake = healthPool({ workers: [wideWorkerRow({ last_error: HOSTILE_PATH })] }).install(t);
  const res = await request(app).get('/api/health/worker');
  assert.ok(CATEGORY_ENUM.has(res.body.workers[0].lastError));
  assertNoHostileSubstring(res.body);
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// /worker - draft sweep liveness (#842)
// ---------------------------------------------------------------------------
// The worker stamps Redis after every draft sweep. A stale or missing stamp
// while a worker row exists means the process heartbeat is green but its sweep
// is not running - the #839 shape the Overdue detector missed because every
// pause/resume re-armed the clock inside the tolerance. It fails /worker.

test('GET /worker: a stale draft-sweep stamp publishes the fields and fails the check with 503 (#842)', async (t) => {
  const fake = healthPool().install(t);
  const stamp = new Date(Date.now() - 61 * 1000).toISOString();
  t.mock.method(draftSweepLiveness, 'readDraftSweepLiveness', async () => ({ lastDraftSweepAt: stamp, draftSweepStale: true }));

  const res = await request(app).get('/api/health/worker');

  // Red tell: drop the stale fold from workerStatus's ok and this reads 200.
  assert.equal(res.status, 503, 'a sweep that stopped running fails /worker');
  assert.equal(res.body.ok, false);
  assert.equal(res.body.draftSweepStale, true);
  assert.equal(res.body.lastDraftSweepAt, stamp);
  fake.assertClean();
});

test('GET /worker: a fresh draft-sweep stamp passes, and an unknown stamp (Redis down) fails open (#842)', async (t) => {
  const fake = healthPool().install(t);
  const stamp = new Date(Date.now() - 5 * 1000).toISOString();
  t.mock.method(draftSweepLiveness, 'readDraftSweepLiveness', async () => ({ lastDraftSweepAt: stamp, draftSweepStale: false }));

  let res = await request(app).get('/api/health/worker');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.lastDraftSweepAt, stamp);

  t.mock.method(draftSweepLiveness, 'readDraftSweepLiveness', async () => ({ lastDraftSweepAt: null, draftSweepStale: false }));
  res = await request(app).get('/api/health/worker');
  assert.equal(res.status, 200, 'Redis unknown never manufactures a 503 here; the composite redis section owns it');
  assert.equal(res.body.lastDraftSweepAt, null);
  fake.assertClean();
});
