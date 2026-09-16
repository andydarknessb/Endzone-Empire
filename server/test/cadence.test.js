const { test } = require('node:test');
const assert = require('node:assert/strict');
const { due, utcDateKey } = require('../modules/cadence');

/**
 * Pure table suite for the cadence gate (spec #1492 step two): no pool, no
 * timers. Every case injects its own fake `lastRun(job)` reader instead of
 * touching `server/modules/syncRun.js`'s real, pool-backed one, and passes
 * `now` explicitly instead of reading the clock.
 */

const NEVER = async () => ({ latest: null, latestOk: null });

function okAt(iso) {
  return { id: 1, finishedAt: new Date(iso), ok: true, detail: null };
}

function failedAt(iso) {
  return { id: 2, finishedAt: new Date(iso), ok: false, detail: null };
}

/** A fake `lastRun` keyed by job name, so an `after` case can answer for two jobs. */
function fakeLastRun(byJob) {
  return async (job) => byJob[job] || { latest: null, latestOk: null };
}

const CASES = [
  {
    name: 'never run',
    lastRun: NEVER,
    args: { job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T12:00:00Z') },
    expected: { due: true, reason: 'never run' },
  },
  {
    name: 'ok today (UTC) is not due again',
    lastRun: fakeLastRun({ widgets: { latest: okAt('2026-09-16T03:00:00Z'), latestOk: okAt('2026-09-16T03:00:00Z') } }),
    args: { job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T23:59:00Z') },
    expected: { due: false, reason: 'already succeeded today (UTC)' },
  },
  {
    name: 'ok yesterday (UTC) is due today',
    lastRun: fakeLastRun({ widgets: { latest: okAt('2026-09-15T03:00:00Z'), latestOk: okAt('2026-09-15T03:00:00Z') } }),
    args: { job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T00:30:00Z') },
    expected: { due: true, reason: 'last success was a prior UTC day' },
  },
  {
    name: 'failed today does not count as an ok run and stays due since none ever succeeded',
    // latest (any outcome) is today and failed; latestOk is null - due() must
    // read latestOk only, never mistaking today's failure for today's success.
    lastRun: fakeLastRun({ widgets: { latest: failedAt('2026-09-16T01:00:00Z'), latestOk: null } }),
    args: { job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T02:00:00Z') },
    expected: { due: true, reason: 'never run' },
  },
  {
    name: '{ ms } cadence not yet elapsed is not due',
    lastRun: fakeLastRun({ widgets: { latest: okAt('2026-09-16T12:00:00Z'), latestOk: okAt('2026-09-16T12:00:00Z') } }),
    args: { job: 'widgets', every: { ms: 30 * 60 * 1000 }, now: new Date('2026-09-16T12:10:00Z') },
    expected: { due: false, reason: '600000ms since the last success, cadence is 1800000ms' },
  },
  {
    name: '{ ms } cadence fully elapsed is due',
    lastRun: fakeLastRun({ widgets: { latest: okAt('2026-09-16T12:00:00Z'), latestOk: okAt('2026-09-16T12:00:00Z') } }),
    args: { job: 'widgets', every: { ms: 30 * 60 * 1000 }, now: new Date('2026-09-16T12:31:00Z') },
    expected: { due: true, reason: '1860000ms since the last success, cadence is 1800000ms' },
  },
  {
    name: '"after" unsatisfied: the dependency has never succeeded',
    lastRun: fakeLastRun({
      widgets: { latest: okAt('2026-09-15T03:00:00Z'), latestOk: okAt('2026-09-15T03:00:00Z') },
      gizmos: { latest: null, latestOk: null },
    }),
    args: { job: 'widgets', every: 'utc-day', after: 'gizmos', now: new Date('2026-09-16T00:30:00Z') },
    expected: { due: false, reason: 'waiting on "gizmos" to succeed' },
  },
  {
    name: '"after" unsatisfied: the dependency has not succeeded again since this job\'s last success',
    lastRun: fakeLastRun({
      widgets: { latest: okAt('2026-09-15T03:00:00Z'), latestOk: okAt('2026-09-15T03:00:00Z') },
      gizmos: { latest: okAt('2026-09-14T03:00:00Z'), latestOk: okAt('2026-09-14T03:00:00Z') },
    }),
    args: { job: 'widgets', every: 'utc-day', after: 'gizmos', now: new Date('2026-09-16T00:30:00Z') },
    expected: { due: false, reason: 'waiting on "gizmos" to succeed again' },
  },
  {
    name: '"after" satisfied: the dependency succeeded again after this job\'s last success',
    lastRun: fakeLastRun({
      widgets: { latest: okAt('2026-09-15T03:00:00Z'), latestOk: okAt('2026-09-15T03:00:00Z') },
      gizmos: { latest: okAt('2026-09-16T00:10:00Z'), latestOk: okAt('2026-09-16T00:10:00Z') },
    }),
    args: { job: 'widgets', every: 'utc-day', after: 'gizmos', now: new Date('2026-09-16T00:30:00Z') },
    expected: { due: true, reason: 'last success was a prior UTC day' },
  },
  {
    name: '"after" is never consulted when the job\'s own cadence already says not due',
    lastRun: fakeLastRun({
      widgets: { latest: okAt('2026-09-16T03:00:00Z'), latestOk: okAt('2026-09-16T03:00:00Z') },
      // No entry for gizmos at all: a lookup would throw were this reached.
    }),
    args: { job: 'widgets', every: 'utc-day', after: 'gizmos', now: new Date('2026-09-16T23:00:00Z') },
    expected: { due: false, reason: 'already succeeded today (UTC)' },
  },
  {
    name: 'green for the wrong reason: 00:01 UTC with a run finished 00:00 UTC the previous day is due',
    // Only one minute has elapsed - a naive elapsed-time cadence would call
    // this not due - but the calendar day crossed, so utc-day cadence is due.
    lastRun: fakeLastRun({ widgets: { latest: okAt('2026-09-15T00:00:00Z'), latestOk: okAt('2026-09-15T00:00:00Z') } }),
    args: { job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T00:01:00Z') },
    expected: { due: true, reason: 'last success was a prior UTC day' },
  },
];

for (const c of CASES) {
  test(`cadence.due: ${c.name}`, async () => {
    const result = await due(c.args, { lastRun: c.lastRun });
    assert.deepEqual(result, c.expected);
  });
}

test('cadence.due defaults `now` to the current instant when omitted', async () => {
  const result = await due(
    { job: 'widgets', every: 'utc-day' },
    { lastRun: NEVER }
  );
  assert.equal(result.due, true);
  assert.equal(result.reason, 'never run');
});

test('cadence.due rejects an invalid `every` value', async () => {
  await assert.rejects(
    () => due({ job: 'widgets', every: 'weekly', now: new Date() }, { lastRun: NEVER }),
    /invalid 'every' value/
  );
});

test('cadence.due defaults `lastRun` to the Sync run module\'s reader when no override is given', async (t) => {
  const syncRun = require('../modules/syncRun');
  let calledWith = null;
  // No pool: the Sync run module's real `lastRun` is swapped out for this one
  // call, so this only proves the wiring (the default param reads
  // `syncRun.lastRun` fresh, not a reference captured at require time) - it
  // never reaches the database.
  t.mock.method(syncRun, 'lastRun', async (job) => { calledWith = job; return { latest: null, latestOk: null }; });
  const result = await due({ job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T00:00:00Z') });
  assert.equal(calledWith, 'widgets');
  assert.equal(result.due, true);
});

test('utcDateKey: a Date\'s UTC calendar day as YYYY-MM-DD', () => {
  assert.equal(utcDateKey(new Date('2026-09-16T00:00:00Z')), '2026-09-16');
  assert.equal(utcDateKey(new Date('2026-09-16T23:59:59.999Z')), '2026-09-16');
  assert.equal(utcDateKey(new Date('2026-09-15T23:59:59.999Z')), '2026-09-15');
});
