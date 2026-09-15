const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scheduler = require('../modules/scheduler');
const integrity = require('../services/playerStatsIntegrity.service');

test('runNightlyStatsIntegrityScan runs once per local day and retries a thrown day', async (t) => {
  let fail = false;
  let calls = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => {
    calls += 1;
    if (fail) throw new Error('relation does not exist');
    return { scanId: 1, seasons: [2025, 2026], scanned: 48210, open: 0, resolved: 0 };
  });

  const firstDay = new Date('2026-09-16T03:00:00-05:00');
  const first = await scheduler.runNightlyStatsIntegrityScan({ now: firstDay });
  assert.equal(first.scanned, 48210);
  assert.equal(await scheduler.runNightlyStatsIntegrityScan({ now: firstDay }), null, 'a second tick the same day does not rescan');
  assert.equal(calls, 1);

  fail = true;
  const nextDay = new Date('2026-09-17T03:00:00-05:00');
  await assert.rejects(scheduler.runNightlyStatsIntegrityScan({ now: nextDay }), /relation does not exist/);
  fail = false;
  assert.equal((await scheduler.runNightlyStatsIntegrityScan({ now: nextDay })).scanned, 48210, 'a thrown day is retried');
  assert.equal(await scheduler.runNightlyStatsIntegrityScan({ now: nextDay }), null);
});

test('the tick contains the integrity scan in its own try/catch so a failure cannot abort other duties', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  assert.match(source, /try \{\s*await runNightlyStatsIntegrityScan\(\);\s*\} catch/);
});
