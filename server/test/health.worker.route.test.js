const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const draftSweepLiveness = require('../modules/draftSweepLiveness');
const healthRouter = require('../routes/health.router');

// #2758: the worker's heartbeat timer runs apart from the scheduler tick, so a
// tick that stopped returning keeps the jobs row fresh. /api/health/worker reads
// the tick's lastTickAt from the jobs row and fails once it is 15 minutes old.

const app = express();
app.use('/api/health', healthRouter);

const MINUTE = 60 * 1000;

function workerPool(lastTickAt) {
  return async (sql) => {
    if (/FROM "leagues"/.test(String(sql))) return { rows: [] };
    return {
      rows: [{
        worker_name: 'jobs',
        last_seen_at: new Date().toISOString(),
        last_error: null,
        release_sha: null,
        job_status: { scheduler: { lastTickAt } },
      }],
    };
  };
}

function freshDraftSweep(t) {
  t.mock.method(draftSweepLiveness, 'readDraftSweepLiveness', async () => ({
    lastDraftSweepAt: new Date().toISOString(), draftSweepStale: false,
  }));
}

test('GET /api/health/worker answers 503 when the scheduler tick is 16 minutes old', async (t) => {
  freshDraftSweep(t);
  t.mock.method(pool, 'query', workerPool(new Date(Date.now() - 16 * MINUTE).toISOString()));

  const response = await request(app).get('/api/health/worker');
  assert.equal(response.status, 503, 'a stuck scheduler fails the worker check');
  assert.equal(response.body.ok, false);
});

test('GET /api/health/worker answers 200 when the scheduler tick is 14 minutes old', async (t) => {
  freshDraftSweep(t);
  t.mock.method(pool, 'query', workerPool(new Date(Date.now() - 14 * MINUTE).toISOString()));

  const response = await request(app).get('/api/health/worker');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});

test('GET /api/health/worker answers 200 when no tick has stamped lastTickAt yet', async (t) => {
  freshDraftSweep(t);
  t.mock.method(pool, 'query', workerPool(null));

  const response = await request(app).get('/api/health/worker');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});
