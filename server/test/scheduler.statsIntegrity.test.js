const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakePool } = require('./helpers/fakePool');

const scheduler = require('../modules/scheduler');
const integrity = require('../services/playerStatsIntegrity.service');

// Each test uses its own calendar day: the once-a-day stamp is module state
// shared across every test in this file. The window is the projection fill's
// off-peak UTC hour (09:00-09:59Z).

test('runNightlyStatsIntegrityScan only runs inside the off-peak UTC hour, then once per day', async (t) => {
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

test('runNightlyStatsIntegrityScan is a Sync run: the scan runs on the unit client and its result is the recorded detail', async (t) => {
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
  assert.deepEqual(JSON.parse(detail), { scanned: 5, open: 1, resolved: 0 });
});

test('a thrown scan leaves the day unstamped so the next tick inside the window retries', async (t) => {
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
