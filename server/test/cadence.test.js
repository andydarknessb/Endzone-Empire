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

function okAt(iso, detail = null) {
  return { id: 1, finishedAt: new Date(iso), ok: true, detail };
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
    // No `detail.day` on this row's run: the finishedAt fallback (no job
    // stamped a day) is what decides it.
    name: 'ok today (UTC) is not due again (no detail.day: the finishedAt fallback applies)',
    lastRun: fakeLastRun({ widgets: { latest: okAt('2026-09-16T03:00:00Z'), latestOk: okAt('2026-09-16T03:00:00Z') } }),
    args: { job: 'widgets', every: 'utc-day', now: new Date('2026-09-16T23:59:00Z') },
    expected: { due: false, reason: 'already succeeded today (UTC)' },
  },
  {
    // Also no `detail.day` - the fallback again, this time on the due side.
    name: 'ok yesterday (UTC) is due today (no detail.day: the finishedAt fallback applies)',
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
    // Neither of the four existing `after` cases above has the OWN job never
    // run at all (they all give `widgets` a `latestOk`); this is the gap
    // #1511 AC3 asks for - a brand-new nightly-projection-run/nflverse-week
    // job with `after: 'stat-corrections'` before that dependency has ever
    // succeeded either. `latestOk` is null so the `<=` comparison in due()
    // never runs; the missing dependency wins.
    name: '"after" unsatisfied: the job itself has never run and neither has its dependency',
    lastRun: fakeLastRun({
      gizmos: { latest: null, latestOk: null },
      // No entry for widgets: a lookup would throw were the day-cadence read
      // reached with the wrong key, so this also pins that `due()` reads
      // `after`, not `job`, for the dependency check.
    }),
    args: { job: 'widgets', every: 'utc-day', after: 'gizmos', now: new Date('2026-09-16T00:30:00Z') },
    expected: { due: false, reason: 'waiting on "gizmos" to succeed' },
  },
  {
    // The other half of that gap: the job itself has never run, but its
    // dependency already has - due() must not fall into the `<=` comparison
    // at all here (there is no `latestOk` to compare against), so the
    // never-run reason from the job's own cadence wins outright.
    name: '"after" satisfied by default: the job itself has never run, and its dependency already has',
    lastRun: fakeLastRun({
      gizmos: { latest: okAt('2026-09-10T03:00:00Z'), latestOk: okAt('2026-09-10T03:00:00Z') },
    }),
    args: { job: 'widgets', every: 'utc-day', after: 'gizmos', now: new Date('2026-09-16T00:30:00Z') },
    expected: { due: true, reason: 'never run' },
  },
  {
    name: 'green for the wrong reason: a run finished 00:00 UTC but stamped for the previous UTC day is due at 00:01 UTC',
    // finishedAt (2026-09-16T00:00Z) and now (2026-09-16T00:01Z) are only one
    // minute apart AND share the same UTC calendar day, so a finishedAt-only
    // (or naive elapsed-time) cadence reads this as "already succeeded
    // today" and answers not due. But the run stamped detail.day '2026-09-15'
    // at start (spec #1493, "UTC day everywhere"), so it belongs to the PRIOR
    // UTC day and today's pass is due. lastSuccessDayKey's detail.day-first
    // read is what this row pins; it goes red on a finishedAt-only branch and
    // green once detail.day wins (fleet#1508 f2).
    lastRun: fakeLastRun({
      widgets: {
        latest: okAt('2026-09-16T00:00:00Z', { day: '2026-09-15' }),
        latestOk: okAt('2026-09-16T00:00:00Z', { day: '2026-09-15' }),
      },
    }),
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
