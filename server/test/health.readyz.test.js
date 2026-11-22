const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { performance } = require('node:perf_hooks');
const pool = require('../modules/pool');
const runtimeState = require('../modules/runtimeState');
const { keys } = require('./helpers/payloadShape');

const ROUTER_PATH = require.resolve('../routes/health.router');

const previousRedisUrl = process.env.REDIS_URL;
delete process.env.REDIS_URL;
after(() => {
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
});

// A fresh router per test, so lastDatabaseOkAt starts at -Infinity each time.
function buildApp(t) {
  delete require.cache[ROUTER_PATH];
  const app = express();
  app.use('/api/health', require('../routes/health.router'));
  runtimeState.markReady();
  // No setter restores the boot state (ready false, shuttingDown false); healthPayloadShape does the same.
  t.after(() => runtimeState.markShuttingDown());
  return app;
}

function checkoutFailure() {
  const error = new Error('(ECHECKOUTRETRIES) failed to check out a connection after multiple retries');
  error.code = 'XX000';
  return error;
}

test('readyz answers 503 while the database has never answered', async (t) => {
  t.mock.method(pool, 'query', async () => {
    throw new Error('boom');
  });

  const response = await request(buildApp(t)).get('/api/health/readyz');

  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.db.ok, false);
});

test('readyz does not retry a refused pooler checkout', async (t) => {
  let calls = 0;
  t.mock.method(pool, 'query', async () => {
    calls += 1;
    throw checkoutFailure();
  });

  const response = await request(buildApp(t)).get('/api/health/readyz');

  assert.equal(response.status, 503);
  assert.equal(response.body.db.ok, false);
  assert.equal(calls, 1);
});

test('readyz stays ready through a database gap inside the grace window', async (t) => {
  let failing = false;
  t.mock.method(pool, 'query', async () => {
    if (failing) throw checkoutFailure();
    return { rows: [] };
  });
  const app = buildApp(t);
  assert.equal((await request(app).get('/api/health/readyz')).status, 200);

  failing = true;
  const later = performance.now() + 44 * 1000;
  t.mock.method(performance, 'now', () => later);
  const response = await request(app).get('/api/health/readyz');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.db.ok, false);
  assert.deepEqual(keys(response.body), ['db', 'ok', 'redis', 'release']);
});

test('readyz answers 503 once the gap outlasts the grace window', async (t) => {
  let failing = false;
  t.mock.method(pool, 'query', async () => {
    if (failing) throw new Error('boom');
    return { rows: [] };
  });
  const app = buildApp(t);
  assert.equal((await request(app).get('/api/health/readyz')).status, 200);

  failing = true;
  const later = performance.now() + 46 * 1000;
  t.mock.method(performance, 'now', () => later);
  const response = await request(app).get('/api/health/readyz');

  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
});

test('readyz answers inside the probe timeout when the database hangs', async (t) => {
  let hanging = false;
  t.mock.method(pool, 'query', async () => {
    if (hanging) return new Promise(() => {});
    return { rows: [] };
  });
  const app = buildApp(t);
  assert.equal((await request(app).get('/api/health/readyz')).status, 200);

  hanging = true;
  const started = Date.now();
  const response = await request(app).get('/api/health/readyz');
  const elapsed = Date.now() - started;

  assert.equal(response.status, 200);
  assert.equal(response.body.db.ok, false);
  assert.ok(elapsed >= 2900 && elapsed < 4500, `elapsed ${elapsed} ms`);
});
