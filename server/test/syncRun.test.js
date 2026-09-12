/**
 * Unit tests for the Sync run module (#1200, ADR 0036): `runSyncJob` owns the
 * shape shared by every feed sync (fetch outside any transaction, apply each
 * unit inside its own `withTransaction` under the job's lock, record exactly
 * one `data_sync_runs` row), and `lastRun(job)` reads it back. The Postgres
 * proof that the lock and the transaction are real lives in
 * syncRun.pg.test.js; this file is the fake-pool proof of the module's own
 * control flow and the shape of what it records.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select } = require('./helpers/fakePool');
const { runSyncJob, lastRun } = require('../modules/syncRun');

const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));

test('runSyncJob success: one unit applies inside a transaction, one ok=true row is recorded', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'widgets',
    lock: 12345,
    fetch: async () => [{ id: 'w1' }],
    apply: async (client, unit) => {
      assert.equal(unit.id, 'w1');
      return { written: 1 };
    },
  });

  assert.deepEqual(result, { written: 1 }, 'a single-unit run resolves to that unit\'s apply result');
  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row is appended');
  assert.equal(records[0].via, 'pool', 'the record is written on the pool, outside the transaction');
  assert.equal(records[0].params[0], 'widgets');
  assert.equal(records[0].params[2], true, 'ok is true');
  assert.deepEqual(JSON.parse(records[0].params[3]), { written: 1 }, 'detail is the apply result');
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const recordIdx = fake.calls.findIndex((c) => insert('data_sync_runs').test(c.text));
  assert.ok(commitIdx >= 0 && commitIdx < recordIdx, 'the record follows COMMIT');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  assert.deepEqual(fake.calls[lockIdx].params, [12345], 'the module takes the job\'s own lock');
  fake.assertClean();
});

test('runSyncJob with no lock never queries pg_advisory_xact_lock', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await runSyncJob({
    job: 'widgets',
    lock: null,
    fetch: async () => [{ id: 'w1' }],
    apply: async () => ({ written: 1 }),
  });

  assert.equal(fake.calls.filter((c) => /pg_advisory_xact_lock/.test(c.text)).length, 0);
  fake.assertClean();
});

test('runSyncJob: an untagged fetch throw is recorded and rethrown as fetch_failed, no transaction opens', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(
    runSyncJob({
      job: 'widgets',
      lock: 12345,
      fetch: async () => { throw new Error('upstream blew up'); },
      apply: async () => ({}),
    }),
    /upstream blew up/,
  );

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1);
  assert.equal(records[0].params[2], false);
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed');
  assert.equal(detail.message, 'upstream blew up');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'fetch runs before any transaction');
  fake.assertClean();
});

test('runSyncJob: a pre-tagged fetch throw (bad_response) keeps its own tag, not fetch_failed', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(
    runSyncJob({
      job: 'widgets',
      lock: 12345,
      fetch: async () => {
        const err = new Error('bad shape');
        err.syncFailureReason = 'bad_response';
        throw err;
      },
      apply: async () => ({}),
    }),
    /bad shape/,
  );

  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.equal(detail.reason, 'bad_response', 'a job-supplied tag wins over the module default');
  fake.assertClean();
});

test('runSyncJob: fetch returning { refused: true, reason } records ok=false without throwing', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'widgets',
    lock: 12345,
    fetch: async () => ({ refused: true, reason: 'thin_market' }),
    apply: async () => { throw new Error('apply must never run on a refusal'); },
  });

  assert.deepEqual(result, { refused: true, reason: 'thin_market' });
  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.equal(detail.reason, 'refused');
  assert.equal(detail.refusalReason, 'thin_market');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'a refusal never opens a transaction');
  fake.assertClean();
});

test('runSyncJob: a refusal\'s detail reaches both the recorded row and the resolved value (#1201)', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'adp',
    lock: 23004,
    fetch: async () => ({ refused: true, reason: 'thin_market', detail: { adpPlayers: 50 } }),
    apply: async () => { throw new Error('apply must never run on a refusal'); },
  });

  assert.deepEqual(result, { refused: true, reason: 'thin_market', detail: { adpPlayers: 50 } });
  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.equal(detail.reason, 'refused');
  assert.equal(detail.refusalReason, 'thin_market');
  assert.equal(detail.adpPlayers, 50, 'the fetch-supplied detail is merged into the recorded row');
  fake.assertClean();
});

test('runSyncJob: a refusal detail cannot clobber the reason/refusalReason markers (qa-reviewer, #1201)', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'adp',
    lock: 23004,
    fetch: async () => ({ refused: true, reason: 'thin_market', detail: { reason: 'oops', refusalReason: 'oops' } }),
    apply: async () => { throw new Error('apply must never run on a refusal'); },
  });

  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.equal(detail.reason, 'refused', 'the module\'s own marker wins over a caller-supplied detail.reason');
  assert.equal(detail.refusalReason, 'thin_market', 'the module\'s own marker wins over a caller-supplied detail.refusalReason');
  assert.equal(result.reason, 'thin_market');
});

test('runSyncJob: an apply throw is tagged write_failed, recorded in detail.failed[], and the original error is rethrown', async (t) => {
  const boom = new Error('apply blew up');
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = runSyncJob({
    job: 'widgets',
    lock: 12345,
    fetch: async () => [{ id: 'w1' }],
    apply: async () => { throw boom; },
  });

  await assert.rejects(promise, /apply blew up/);
  const error = await promise.catch((e) => e);
  assert.equal(error, boom, 'the exact original error object is rethrown, not a copy');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1);
  assert.equal(records[0].params[2], false);
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'write_failed');
  assert.equal(detail.failed.length, 1);
  assert.equal(detail.failed[0].message, 'apply blew up');
  assert.equal(detail.failed[0].unit, 0);
  // An ordinary in-transaction error keeps its healthy connection (ADR 0033).
  assert.equal(fake.releaseArgs()[0], undefined);
  fake.assertClean();
});

test('runSyncJob: a rejecting ROLLBACK attaches rollbackError to the rethrown original error', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => { throw new Error('scan blew up'); }, 'client'],
    [/^ROLLBACK$/, () => { throw new Error('rollback rejected'); }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = runSyncJob({
    job: 'widgets',
    lock: 12345,
    fetch: async () => [{}],
    apply: async (client) => { await client.query('SELECT * FROM "players"'); },
  });

  await assert.rejects(promise, /scan blew up/);
  const error = await promise.catch((e) => e);
  assert.equal(error.rollbackError.message, 'rollback rejected');
  assert.ok(fake.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
  fake.assertClean();
});

test('lastRun(job): one query returns { latest, latestOk }, decoding the row_to_json payloads', async (t) => {
  const fake = createFakePool([
    [/^SELECT\s+\(SELECT row_to_json/, (text, params) => {
      assert.deepEqual(params, ['widgets']);
      return {
        rows: [{
          latest: { id: 5, finished_at: '2026-09-10T00:00:00.000Z', ok: false, detail: { reason: 'write_failed' } },
          latestOk: { id: 3, finished_at: '2026-09-08T00:00:00.000Z', ok: true, detail: { written: 4 } },
        }],
      };
    }],
  ]).install(t);

  const { latest, latestOk } = await lastRun('widgets');
  assert.equal(latest.id, 5);
  assert.equal(latest.ok, false);
  assert.ok(latest.finishedAt instanceof Date);
  assert.equal(latestOk.id, 3);
  assert.equal(latestOk.ok, true);
  assert.deepEqual(latestOk.detail, { written: 4 });
  assert.equal(fake.calls.length, 1, 'one round trip');
});

test('runSyncJob: multiple units resolve to { results: [...] }, matching what is recorded', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'widgets',
    lock: null,
    fetch: async () => [{ id: 'w1' }, { id: 'w2' }],
    apply: async (client, unit) => ({ id: unit.id }),
  });

  assert.deepEqual(result, { results: [{ id: 'w1' }, { id: 'w2' }] });
  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.deepEqual(detail, result, 'the recorded detail matches the resolved value');
});

test('runSyncJob: fetch returning { units, detail } merges detail into a single-unit ok row without changing the resolved value (#1202)', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'widgets',
    lock: null,
    fetch: async () => ({ units: [{ id: 'w1' }], detail: { skipped: ['w0'] } }),
    apply: async (client, unit) => ({ id: unit.id, written: 1 }),
  });

  assert.deepEqual(result, { id: 'w1', written: 1 }, 'the resolved value is the unit result alone, no wrapper leaks through');
  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.deepEqual(detail, { skipped: ['w0'], id: 'w1', written: 1 }, 'fetchDetail and the unit result both land in the recorded row');
});

test('runSyncJob: fetch returning { units, detail } merges detail into a multi-unit ok row, surviving alongside { results } (#1202)', async (t) => {
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await runSyncJob({
    job: 'widgets',
    lock: null,
    fetch: async () => ({ units: [{ id: 'w1' }, { id: 'w2' }], detail: { skipped: ['w3'] } }),
    apply: async (client, unit) => ({ id: unit.id }),
  });

  // The resolved value is exactly runSyncJob's normal multi-unit shape - the
  // wrapper's detail never reaches a caller's return value, only the recorded row.
  assert.deepEqual(result, { results: [{ id: 'w1' }, { id: 'w2' }] });
  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.deepEqual(detail.skipped, ['w3'], 'run-level detail is recorded even with two-or-more units, unlike a bare units array (formal review, PR #1244 f1)');
  assert.deepEqual(detail.results, result.results);
});

test('runSyncJob: fetch returning { units, detail } merges detail into a write_failed row, with reason/failed still winning on collision (#1202)', async (t) => {
  const boom = new Error('unit 2 blew up');
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(
    runSyncJob({
      job: 'widgets',
      lock: null,
      // A caller-supplied detail.reason/detail.failed must not survive - the
      // module's own write_failed markers win, same rule as the refusal path.
      fetch: async () => ({ units: [{ id: 'w1' }, { id: 'w2' }], detail: { skipped: ['w3'], reason: 'oops', failed: 'oops' } }),
      apply: async (client, unit) => {
        if (unit.id === 'w2') throw boom;
        return { id: unit.id };
      },
    }),
    /unit 2 blew up/,
  );

  const detail = JSON.parse(dataSyncRuns(fake.calls)[0].params[3]);
  assert.deepEqual(detail.skipped, ['w3'], 'fetch-supplied run-level detail survives on a write_failed row too');
  assert.equal(detail.reason, 'write_failed', 'the module\'s own marker wins over a caller-supplied detail.reason');
  assert.equal(detail.failed.length, 1, 'the module\'s own marker wins over a caller-supplied detail.failed');
  assert.equal(detail.failed[0].message, 'unit 2 blew up');
});

test('runSyncJob: a frozen fetch error still records one row and rethrows the original object', async (t) => {
  const boom = Object.freeze(new Error('frozen boom'));
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = runSyncJob({
    job: 'widgets',
    lock: null,
    fetch: async () => { throw boom; },
    apply: async () => ({}),
  });

  await assert.rejects(promise, /frozen boom/);
  const error = await promise.catch((e) => e);
  assert.equal(error, boom, 'the frozen original is rethrown untouched, not a TypeError from tagging it');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'a frozen throw still gets its one data_sync_runs row');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed', 'the fallback reason still applies when the tag write itself fails');
  assert.equal(detail.message, 'frozen boom');
});

test('runSyncJob: a non-object apply throw (a plain string) still records write_failed and rethrows it', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = runSyncJob({
    job: 'widgets',
    lock: 12345,
    fetch: async () => [{}],
    apply: async () => { throw 'plain string failure'; }, // eslint-disable-line no-throw-literal
  });

  await assert.rejects(promise);
  const error = await promise.catch((e) => e);
  assert.equal(error, 'plain string failure');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'a non-object throw still gets its one data_sync_runs row');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'write_failed');
  assert.equal(detail.failed[0].message, 'plain string failure');
});

test('lastRun(job): both null when the job has never run', async (t) => {
  createFakePool([
    [/^SELECT\s+\(SELECT row_to_json/, () => ({ rows: [{ latest: null, latestOk: null }] })],
  ]).install(t);

  const { latest, latestOk } = await lastRun('never-run');
  assert.equal(latest, null);
  assert.equal(latestOk, null);
});
