const test = require('node:test');
const assert = require('node:assert/strict');
const { isTransientDatabaseError, withDatabaseRetry } = require('../modules/dbRetry');

test('retries transient pool failures with exponential backoff', async () => {
  let attempts = 0;
  const delays = [];

  const result = await withDatabaseRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('Supavisor: connection pool exhausted');
      error.code = '53300';
      throw error;
    }
    return 'ok';
  }, {
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('does not retry non-transient database errors', async () => {
  let attempts = 0;
  const error = new Error('duplicate key value violates unique constraint');
  error.code = '23505';

  await assert.rejects(
    withDatabaseRetry(async () => {
      attempts += 1;
      throw error;
    }, { sleep: async () => assert.fail('sleep must not run') }),
    error
  );

  assert.equal(attempts, 1);
  assert.equal(error.databaseAttempts, 1);
});

test('stops after three transient attempts', async () => {
  const error = new Error('pgbouncer: pool empty');
  let attempts = 0;

  await assert.rejects(
    withDatabaseRetry(async () => {
      attempts += 1;
      throw error;
    }, { sleep: async () => {} }),
    error
  );

  assert.equal(attempts, 3);
  assert.equal(error.databaseAttempts, 3);
});

test('does not retry a transient error after an operation becomes unsafe to replay', async () => {
  const error = new Error('connection reset after committed correction scores');
  error.code = 'ECONNRESET';
  error.retrySafe = false;
  let attempts = 0;

  await assert.rejects(
    withDatabaseRetry(async () => {
      attempts += 1;
      throw error;
    }, { sleep: async () => assert.fail('sleep must not run') }),
    error
  );

  assert.equal(attempts, 1);
  assert.equal(error.databaseAttempts, 1);
});

test('classifies PostgreSQL, network, and Supavisor pool failures', () => {
  assert.equal(isTransientDatabaseError({ code: '53300' }), true);
  assert.equal(isTransientDatabaseError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientDatabaseError({ message: 'Supavisor connection queue unavailable' }), true);
  assert.equal(isTransientDatabaseError({ code: '23503', message: 'foreign key violation' }), false);
});
