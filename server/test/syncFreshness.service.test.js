const test = require('node:test');
const assert = require('node:assert/strict');
const syncRun = require('../modules/syncRun');
const scheduler = require('../modules/scheduler');
const { getSyncFreshness, MAX_AGE_MINUTES } = require('../services/syncFreshness.service');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const LISTED = Object.keys(MAX_AGE_MINUTES).length;
const minutesBefore = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000);

/** Every listed job last ok a minute ago, except that `ages` names (minutes before NOW). */
function lastOkMap(ages = {}) {
  return new Map(Object.keys(MAX_AGE_MINUTES).map((job) => [job, minutesBefore(ages[job] ?? 1)]));
}

test('getSyncFreshness: every listed sync inside its limit is ok, with nothing overdue', async (t) => {
  t.mock.method(syncRun, 'lastOkAtByJob', async () => lastOkMap());

  const result = await getSyncFreshness({ now: NOW });

  assert.deepEqual(result, { ok: true, checked: LISTED, overdue: [] });
});

test('getSyncFreshness: a sync a minute past its limit is overdue, named with its limit', async (t) => {
  t.mock.method(syncRun, 'lastOkAtByJob', async () => lastOkMap({ injuries: 121 }));

  const result = await getSyncFreshness({ now: NOW });

  assert.equal(result.ok, false);
  assert.deepEqual(result.overdue, [{ job: 'injuries', lastOkAt: minutesBefore(121), maxAgeMinutes: 120 }]);
});

test('getSyncFreshness: a sync a minute inside its limit is not overdue', async (t) => {
  t.mock.method(syncRun, 'lastOkAtByJob', async () => lastOkMap({ injuries: 119 }));

  const result = await getSyncFreshness({ now: NOW });

  assert.deepEqual(result, { ok: true, checked: LISTED, overdue: [] });
});

test('getSyncFreshness: a listed sync with no ok run is overdue with lastOkAt null', async (t) => {
  const lastOk = lastOkMap();
  lastOk.delete('players');
  t.mock.method(syncRun, 'lastOkAtByJob', async () => lastOk);

  const result = await getSyncFreshness({ now: NOW });

  assert.equal(result.ok, false);
  assert.deepEqual(result.overdue, [{ job: 'players', lastOkAt: null, maxAgeMinutes: 2880 }]);
});

test('every job the freshness check lists is a Sync run the scheduler records', () => {
  // A renamed job would otherwise leave a limit that nothing ever satisfies.
  for (const job of Object.keys(MAX_AGE_MINUTES)) {
    assert.ok(scheduler.SYNC_RUN_JOBS.includes(job), `${job} is a Sync run the scheduler records`);
  }
});
