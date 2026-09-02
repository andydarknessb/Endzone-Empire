const { test } = require('node:test');
const assert = require('node:assert/strict');
const bootGates = require('../modules/bootGates');
const { assertRedisUrlForBoot } = bootGates;

// A production process without REDIS_URL refuses to boot; any non-production
// NODE_ENV keeps working without Redis (#744, ADR 0025). The gate is the sole
// determinant of that decision and is the first statement of each startup
// function, so the pure-gate tests below cover the "test env does not refuse"
// direction without booting the whole process, and the two startup-function
// tests prove the real entries are wired to it and reject naming REDIS_URL.

function stashEnv(keys) {
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

test('the boot gate refuses a production process with no REDIS_URL, naming REDIS_URL', () => {
  assert.throws(
    () => assertRedisUrlForBoot({ NODE_ENV: 'production' }, { role: 'worker' }),
    /REDIS_URL/,
  );
  assert.throws(
    () => assertRedisUrlForBoot({ NODE_ENV: 'production' }, { role: 'api' }),
    /REDIS_URL/,
  );
});

test('the boot gate does not refuse a non-production process, or a production process with REDIS_URL', () => {
  assert.doesNotThrow(() => assertRedisUrlForBoot({ NODE_ENV: 'test' }, { role: 'worker' }));
  assert.doesNotThrow(() => assertRedisUrlForBoot({ NODE_ENV: 'test' }, { role: 'api' }));
  assert.doesNotThrow(() => assertRedisUrlForBoot({ NODE_ENV: 'development' }, { role: 'worker' }));
  assert.doesNotThrow(
    () => assertRedisUrlForBoot({ NODE_ENV: 'production', REDIS_URL: 'redis://x:6379' }, { role: 'api' }),
  );
});

test('the worker startup function rejects in production without REDIS_URL (gate wired first)', async (t) => {
  const restore = stashEnv(['NODE_ENV', 'REDIS_URL']);
  t.after(restore);
  const { startWorker } = require('../worker');

  process.env.NODE_ENV = 'production';
  delete process.env.REDIS_URL;
  // The gate is the first statement, so it rejects before any I/O (heartbeat,
  // scheduler); in NODE_ENV=test the gate does not fire (covered above).
  await assert.rejects(startWorker(), /REDIS_URL/);
});

test('the API startup function rejects in production without REDIS_URL (gate wired first)', async (t) => {
  const restore = stashEnv(['NODE_ENV', 'REDIS_URL']);
  t.after(restore);
  const { startServer } = require('../server');

  process.env.NODE_ENV = 'production';
  delete process.env.REDIS_URL;
  // The gate is the first statement, so it rejects before validateEnvironment,
  // io.redisReady or server.listen; in NODE_ENV=test it does not fire.
  await assert.rejects(startServer(), /REDIS_URL/);
});

// The pair above proves the production-rejects half against the real startup
// functions. These two prove the OTHER half without booting the scheduler/DB:
// each startup calls the gate first, with the process env, so in any
// environment the gate (already shown above not to fire in non-production) is
// what decides. A mis-wiring that skipped it or hardcoded a throw fails here.
test('startWorker calls the boot gate first, with the process env (wiring, no boot)', async (t) => {
  const restore = stashEnv(['NODE_ENV', 'REDIS_URL']);
  t.after(restore);
  const calls = [];
  const sentinel = new Error('boot-gate-sentinel');
  t.mock.method(bootGates, 'assertRedisUrlForBoot', (env, opts) => { calls.push({ env, opts }); throw sentinel; });
  const { startWorker } = require('../worker');

  process.env.NODE_ENV = 'test';
  delete process.env.REDIS_URL;
  await assert.rejects(startWorker(), /boot-gate-sentinel/); // aborts at the gate, before any I/O
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env, process.env);
  assert.deepEqual(calls[0].opts, { role: 'worker' });
});

test('startServer calls the boot gate first, with the process env (wiring, no boot)', async (t) => {
  const restore = stashEnv(['NODE_ENV', 'REDIS_URL']);
  t.after(restore);
  const calls = [];
  const sentinel = new Error('boot-gate-sentinel');
  t.mock.method(bootGates, 'assertRedisUrlForBoot', (env, opts) => { calls.push({ env, opts }); throw sentinel; });
  const { startServer } = require('../server');

  process.env.NODE_ENV = 'test';
  delete process.env.REDIS_URL;
  await assert.rejects(startServer(), /boot-gate-sentinel/); // aborts at the gate, before any I/O
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env, process.env);
  assert.deepEqual(calls[0].opts, { role: 'api' });
});
