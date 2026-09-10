const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { recordWorkerHeartbeat } = require('../services/workerHeartbeat.service');
const healthRouter = require('../routes/health.router');

function stashReleaseEnv(t) {
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
  assert.deepEqual(calls[0].params, [
    'jobs', null, 'abc123def4567890', JSON.stringify({ scheduler: null, liveGameEngine: null }),
  ]);
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
  assert.deepEqual(calls[0].params, [
    'jobs', 'tick failed', null, JSON.stringify({ scheduler: null, liveGameEngine: null }),
  ]);
});

test('recordWorkerHeartbeat persists the worker job snapshots', async (t) => {
  stashReleaseEnv(t);
  process.env.RENDER_GIT_COMMIT = 'release-test';
  let query;
  t.mock.method(pool, 'query', async (text, params) => {
    query = { text, params };
    return { rows: [] };
  });

  await recordWorkerHeartbeat({
    name: 'jobs',
    error: null,
    scheduler: { lastTickAt: '2026-09-10T00:40:00.000Z' },
    liveGameEngine: { lastRunAt: '2026-09-10T00:40:30.000Z' },
  });

  assert.match(query.text, /"job_status"/);
  assert.equal(query.params[0], 'jobs');
  assert.equal(query.params[1], null);
  assert.equal(query.params[2], 'release-test');
  assert.deepEqual(JSON.parse(query.params[3]), {
    scheduler: { lastTickAt: '2026-09-10T00:40:00.000Z' },
    liveGameEngine: { lastRunAt: '2026-09-10T00:40:30.000Z' },
  });
});

test('GET /api/health/worker surfaces each worker release SHA', async (t) => {
  const app = express();
  app.use('/api/health', healthRouter);
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM "leagues"/.test(String(sql))) return { rows: [] };
    return {
      rows: [{
        worker_name: 'jobs',
        last_seen_at: new Date().toISOString(),
        last_error: null,
        release_sha: 'abc123def4567890',
        job_status: null,
      }],
    };
  });
  const response = await request(app).get('/api/health/worker');
  assert.equal(response.status, 200);
  assert.equal(response.body.workers[0].release, 'abc123def4567890',
    'the deployed-worker check is a poll, not a dashboard ritual');
});
