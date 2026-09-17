const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakePool } = require('./helpers/fakePool');

const scheduler = require('../modules/scheduler');
const cadence = require('../modules/cadence');
const integrity = require('../services/playerStatsIntegrity.service');

// Each test uses its own calendar day: the once-a-day stamp is module state
// shared across every test in this file. The window is the projection fill's
// off-peak UTC hour (09:00-09:59Z).
//
// The due/not-due decision itself is the cadence gate's own concern
// (server/modules/cadence.js, cadence.test.js's table suite covers the
// 'utc-day' cadence generically), so these stub cadence.due directly rather
// than fabricate a `FROM "data_sync_runs"` read for it (#1509) - what is left
// here is the scheduler's OWN behavior around that decision: the off-peak
// hour window, the in-memory same-process short-circuit, and delegation to
// the gate and to the scan itself.

test('runNightlyStatsIntegrityScan only runs inside the off-peak UTC hour, then once per day', async (t) => {
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  let calls = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => {
    calls += 1;
    return { scanned: 48210, open: 0, resolved: 0 };
  });
  createFakePool([[/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })]]).install(t);

  assert.equal(await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-20T08:59:00Z') }), null);
  assert.equal(await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-20T03:00:00Z') }), null, 'a Sunday-night restart never scans');
  assert.equal(calls, 0);

  const result = await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-20T09:30:00Z') });
  assert.deepEqual(result, { scanned: 48210, open: 0, resolved: 0 });
  assert.equal(await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-20T09:45:00Z') }), null, 'a second tick the same day does not rescan');
  assert.equal(calls, 1);
});

test('runNightlyStatsIntegrityScan never calls the scan when the cadence gate says it is not due', async (t) => {
  t.mock.method(cadence, 'due', async () => ({ due: false, reason: 'stubbed not due' }));
  let calls = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => { calls += 1; return { scanned: 1, open: 0, resolved: 0 }; });

  const result = await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-24T09:10:00Z') });
  assert.equal(result, null);
  assert.equal(calls, 0);
  // The in-memory short-circuit still moves on a "not due" answer (the same
  // shape runDailyStatCorrections keeps), so a second tick the same day never
  // consults the gate again either.
  let dueCalls = 0;
  t.mock.method(cadence, 'due', async () => { dueCalls += 1; return { due: false, reason: 'stubbed not due' }; });
  assert.equal(await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-24T09:45:00Z') }), null);
  assert.equal(dueCalls, 0, 'the in-memory stamp short-circuits before the gate is consulted again');
});

test('runNightlyStatsIntegrityScan is a Sync run: the scan runs on the unit client and its result is the recorded detail', async (t) => {
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  let seenDb = null;
  t.mock.method(integrity, 'scanPlayerStats', async ({ db }) => {
    seenDb = db;
    return { scanned: 5, open: 1, resolved: 0 };
  });
  t.mock.method(console, 'warn', () => {});
  const recorded = [];
  const fake = createFakePool([
    [/INSERT INTO "data_sync_runs"/, (text, params) => { recorded.push(params); return { rows: [] }; }],
  ]);
  fake.install(t);

  await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-21T09:10:00Z') });

  assert.ok(seenDb && seenDb !== require('../modules/pool'), 'the scan is handed the transaction client, not the bare pool');
  assert.equal(recorded.length, 1);
  const [job, , ok, detail] = recorded[0];
  assert.equal(job, 'player-stats-integrity');
  assert.equal(ok, true);
  assert.deepEqual(JSON.parse(detail), { day: '2026-09-21', scanned: 5, open: 1, resolved: 0 });
});

test('runNightlyStatsIntegrityScan stamps the UTC day, not the local en-CA day, into detail.day (#1509)', async (t) => {
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  t.mock.method(integrity, 'scanPlayerStats', async () => ({ scanned: 1, open: 0, resolved: 0 }));
  const recorded = [];
  createFakePool([
    [/INSERT INTO "data_sync_runs"/, (text, params) => { recorded.push(params); return { rows: [] }; }],
  ]).install(t);

  // 09:30 UTC is already inside the window; use a `now` whose UTC and local
  // (en-CA) calendar days differ so a reversion to the old comparison would
  // stamp the wrong day here without any test going red for the wrong reason.
  await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-08-21T09:30:00Z') });

  assert.equal(JSON.parse(recorded[0][3]).day, '2026-08-21');
});

test('a thrown scan leaves the day unstamped so the next tick inside the window retries', async (t) => {
  t.mock.method(cadence, 'due', async () => ({ due: true, reason: 'stubbed due' }));
  let fail = true;
  t.mock.method(integrity, 'scanPlayerStats', async () => {
    if (fail) throw new Error('relation does not exist');
    return { scanned: 1, open: 0, resolved: 0 };
  });
  createFakePool([[/INSERT INTO "data_sync_runs"/, () => ({ rows: [] })]]).install(t);

  await assert.rejects(scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-22T09:10:00Z') }), /relation does not exist/);
  fail = false;
  assert.deepEqual(
    await scheduler.runNightlyStatsIntegrityScan({ now: new Date('2026-09-22T09:15:00Z') }),
    { scanned: 1, open: 0, resolved: 0 }
  );
});

test('the tick contains the integrity scan in its own try/catch so a failure cannot abort other duties', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  assert.match(source, /try \{\s*await runNightlyStatsIntegrityScan\(\);\s*\} catch/);
});
