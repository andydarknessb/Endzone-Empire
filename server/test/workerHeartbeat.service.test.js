const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const pool = require('../modules/pool');
const { recordWorkerHeartbeat } = require('../services/workerHeartbeat.service');
const healthRouter = require('../routes/health.router');

/**
 * The worker's release SHA, observable end to end: written by the heartbeat,
 * surfaced by /api/health/worker. Before this, a green web deploy was fully
 * compatible with the worker still running old code - invisible until a
 * holdout capture had already committed under the wrong protocol.
 */

function stashReleaseEnv(t) {
  // Destructured because eslint's testing-library plugin misreads a plain
  // assignment from anything render-shaped as a component render.
  const { RENDER_GIT_COMMIT: prevSha, APP_RELEASE: prevApp } = process.env;
  t.after(() => {
    if (prevSha !== undefined) process.env.RENDER_GIT_COMMIT = prevSha;
    else delete process.env.RENDER_GIT_COMMIT;
    if (prevApp !== undefined) process.env.APP_RELEASE = prevApp;
    else delete process.env.APP_RELEASE;
  });
}

test('heartbeat rows carry the worker release SHA from the environment', async (t) => {
  stashReleaseEnv(t);
  process.env.RENDER_GIT_COMMIT = 'abc123def4567890';
  delete process.env.APP_RELEASE;
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  await recordWorkerHeartbeat({ name: 'jobs', error: null });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /"release_sha"/);
  assert.deepEqual(calls[0].params, ['jobs', null, 'abc123def4567890']);
});

test('a heartbeat without release env records release null rather than fabricating provenance', async (t) => {
  stashReleaseEnv(t);
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.APP_RELEASE;
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  await recordWorkerHeartbeat({ name: 'jobs', error: 'tick failed' });
  assert.deepEqual(calls[0].params, ['jobs', 'tick failed', null]);
});

test('GET /api/health/worker surfaces each worker release SHA', async (t) => {
  const app = express();
  app.use('/api/health', healthRouter);
  t.mock.method(pool, 'query', async () => ({
    rows: [{
      worker_name: 'jobs',
      last_seen_at: new Date().toISOString(),
      last_error: null,
      release_sha: 'abc123def4567890',
    }],
  }));
  const response = await request(app).get('/api/health/worker');
  assert.equal(response.status, 200);
  assert.equal(response.body.workers[0].release, 'abc123def4567890',
    'the deployed-worker check is a poll, not a dashboard ritual');
});
