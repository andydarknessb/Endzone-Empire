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

test('lastRun(job): both null when the job has never run', async (t) => {
  createFakePool([
    [/^SELECT\s+\(SELECT row_to_json/, () => ({ rows: [{ latest: null, latestOk: null }] })],
  ]).install(t);

  const { latest, latestOk } = await lastRun('never-run');
  assert.equal(latest, null);
  assert.equal(latestOk, null);
});
