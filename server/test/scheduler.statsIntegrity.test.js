const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');

const scheduler = require('../modules/scheduler');
const integrity = require('../services/playerStatsIntegrity.service');

// Each test uses its own calendar day: the row's same-day memo (the cadence
// gate's) is state shared across every test in this file. The window is the
// projection fill's off-peak UTC hour (09:00-09:59Z).
//
// The nightly-stats-integrity row is driven through the tick
// (tickUnlocked([row])) over a mocked Date. The due/not-due decision itself is
// the cadence gate's own concern (server/modules/cadence.js, cadence.test.js's
// table suite covers the 'utc-day' cadence generically), read here off a fake
// data_sync_runs table (#1509); what is pinned is the row's OWN behavior around
// that decision: the off-peak hour `when`, the same-process day memo, and
// delegation to the scan itself.

const clocked = new WeakSet();
async function tickRow(t, at, name = 'nightly-stats-integrity') {
  const ms = new Date(at).getTime();
  if (clocked.has(t)) t.mock.timers.setTime(ms);
  else { t.mock.timers.enable({ apis: ['Date'], now: ms }); clocked.add(t); }
  const row = scheduler.TICK_JOBS.find((job) => job.name === name);
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

/** data_sync_runs as a table the fake pool reads and the scan's own INSERT appends to. */
function runsTable(seed = []) {
  const runs = [...seed];
  const shape = (r) => (r ? { id: 1, finished_at: r.finished_at, ok: r.ok, detail: r.detail } : null);
  return {
    runs,
    handlers: [
      [/^INSERT INTO "data_sync_runs"/, (text, params) => {
        runs.push({ job: params[0], ok: params[2], detail: params[3] ? JSON.parse(params[3]) : null, finished_at: new Date() });
        return { rows: [] };
      }],
      [/FROM "data_sync_runs"/, (text, [job]) => {
        const mine = runs.filter((r) => r.job === job).reverse();
        return { rows: [{ latest: shape(mine[0]), latestOk: shape(mine.find((r) => r.ok)) }] };
      }],
    ],
  };
}

test('the nightly-stats-integrity row only runs inside the off-peak UTC hour, then once per day', async (t) => {
  let calls = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => {
    calls += 1;
    return { scanned: 48210, open: 0, resolved: 0 };
  });
  createFakePool(runsTable().handlers).install(t);

  assert.equal((await tickRow(t, '2026-09-20T08:59:00Z')).ran, false);
  assert.equal((await tickRow(t, '2026-09-20T03:00:00Z')).ran, false, 'a Sunday-night restart never scans');
  assert.equal(calls, 0);

  const out = await tickRow(t, '2026-09-20T09:30:00Z');
  assert.deepEqual(out.result, { scanned: 48210, open: 0, resolved: 0 });
  assert.equal((await tickRow(t, '2026-09-20T09:45:00Z')).ran, false, 'a second tick the same day does not rescan');
  assert.equal(calls, 1);
});

test('the nightly-stats-integrity row reads its own job name with every: utc-day (formal review, optional item 4)', async (t) => {
  t.mock.method(integrity, 'scanPlayerStats', async () => ({ scanned: 1, open: 0, resolved: 0 }));
  const fake = createFakePool(runsTable().handlers).install(t);

  await tickRow(t, '2026-09-25T09:10:00Z');
  const reads = fake.calls.filter((c) => /^SELECT .*FROM "data_sync_runs"/.test(c.text));
  assert.deepEqual(reads.map((c) => c.params[0]), [integrity.JOB]);
});

test('the nightly-stats-integrity row never calls the scan when the job already succeeded today', async (t) => {
  let calls = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => { calls += 1; return { scanned: 1, open: 0, resolved: 0 }; });
  const fake = createFakePool(runsTable([
    { job: integrity.JOB, ok: true, detail: { day: '2026-09-24' }, finished_at: new Date('2026-09-24T09:05:00Z') },
  ]).handlers).install(t);

  const out = await tickRow(t, '2026-09-24T09:10:00Z');
  assert.equal(out.ran, false);
  assert.equal(calls, 0);
  // The same-day memo still moves on a "not due" answer, so a second tick the
  // same day never reads the table again either.
  const reads = () => fake.calls.filter((c) => /^SELECT .*FROM "data_sync_runs"/.test(c.text)).length;
  const before = reads();
  assert.equal((await tickRow(t, '2026-09-24T09:45:00Z')).ran, false);
  assert.equal(reads(), before, 'the memo short-circuits before the gate is read again');
});

test('the nightly-stats-integrity row is a Sync run: the scan runs on the unit client and its result is the recorded detail', async (t) => {
  let seenDb = null;
  t.mock.method(integrity, 'scanPlayerStats', async ({ db }) => {
    seenDb = db;
    return { scanned: 5, open: 1, resolved: 0 };
  });
  t.mock.method(console, 'warn', () => {});
  const table = runsTable();
  createFakePool(table.handlers).install(t);

  await tickRow(t, '2026-09-21T09:10:00Z');

  assert.ok(seenDb && seenDb !== require('../modules/pool'), 'the scan is handed the transaction client, not the bare pool');
  assert.equal(table.runs.length, 1);
  assert.equal(table.runs[0].job, 'player-stats-integrity');
  assert.equal(table.runs[0].ok, true);
  assert.deepEqual(table.runs[0].detail, { day: '2026-09-21', scanned: 5, open: 1, resolved: 0 });
});

test('the nightly-stats-integrity row stamps the UTC day, not the local en-CA day, into detail.day (#1509)', async (t) => {
  // Pinned so this discriminates regardless of the host's own ambient
  // timezone: 09:30 UTC falls on the SAME calendar day in UTC and in every US
  // zone (including this suite's own America/Chicago), so a bare UTC `now`
  // here passed unchanged even after reverting the scan to
  // `now.toLocaleDateString('en-CA')` (formal review f1). Pacific/Honolulu is
  // UTC-10 with no DST, far enough behind that any `now` inside the 00:00-
  // 09:59 UTC off-peak window lands on the PREVIOUS calendar day there.
  const prevTz = process.env.TZ;
  process.env.TZ = 'Pacific/Honolulu';
  t.after(() => {
    if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
  });

  t.mock.method(integrity, 'scanPlayerStats', async () => ({ scanned: 1, open: 0, resolved: 0 }));
  const table = runsTable();
  createFakePool(table.handlers).install(t);

  // 09:30 UTC is already inside the window. Under the pinned Pacific/Honolulu
  // zone this is 2026-08-20 23:30 local - a different calendar day from the
  // UTC one - so a reversion to `now.toLocaleDateString('en-CA')` stamps
  // '2026-08-20' here and this assertion goes red for the right reason.
  await tickRow(t, '2026-08-21T09:30:00Z');

  assert.equal(table.runs[0].detail.day, '2026-08-21');
});

test('a thrown scan leaves the day open so the next tick inside the window retries', async (t) => {
  let fail = true;
  t.mock.method(integrity, 'scanPlayerStats', async () => {
    if (fail) throw new Error('relation does not exist');
    return { scanned: 1, open: 0, resolved: 0 };
  });
  createFakePool(runsTable().handlers).install(t);

  const first = await tickRow(t, '2026-09-22T09:10:00Z');
  assert.match(first.error.message, /relation does not exist/);
  fail = false;
  const second = await tickRow(t, '2026-09-22T09:15:00Z');
  assert.deepEqual(second.result, { scanned: 1, open: 0, resolved: 0 });
});

test('the tick contains the integrity scan, so a failure cannot abort other duties', async (t) => {
  // Date pinned inside the scan's off-peak window, on a day no other test
  // uses (the row's same-day memo would short-circuit the scan), so the job
  // really reaches it.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-17T09:10:00Z') });
  let scans = 0;
  t.mock.method(integrity, 'scanPlayerStats', async () => { scans += 1; throw new Error('relation does not exist'); });
  createFakePool(runsTable().handlers).install(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  const job = scheduler.TICK_JOBS.find((j) => j.name === 'nightly-stats-integrity');
  let ranAfter = false;

  await scheduler.tickUnlocked([job, { name: 'after', tier: 'trailing', gate: { due: async () => ({ due: true }) }, run: async () => { ranAfter = true; } }]);

  assert.equal(scans, 1, 'the job reached the scan');
  assert.ok(ranAfter, 'the job after it still ran');
  assert.ok(errors.some((line) => /nightly-stats-integrity/.test(line) && /relation does not exist/.test(line)));
});
