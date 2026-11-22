const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const freshness = require('../services/syncFreshness.service');
const healthRouter = require('../routes/health.router');

const app = express();
app.use('/api/health', healthRouter);

test('GET /api/health/sync-freshness returns 200 when every listed sync is inside its limit', async (t) => {
  t.mock.method(freshness, 'getSyncFreshness', async () => ({ ok: true, checked: 7, overdue: [] }));

  const response = await request(app).get('/api/health/sync-freshness');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, checked: 7, overdue: [] });
});

test('GET /api/health/sync-freshness returns 503 naming each overdue sync with its last ok run', async (t) => {
  t.mock.method(freshness, 'getSyncFreshness', async () => ({
    ok: false,
    checked: 7,
    overdue: [{ job: 'injuries', lastOkAt: new Date('2026-11-20T10:00:00.000Z'), maxAgeMinutes: 120 }],
  }));

  const response = await request(app).get('/api/health/sync-freshness');
  assert.equal(response.status, 503, 'a sync gone too long is an alert');
  assert.deepEqual(response.body, {
    ok: false,
    checked: 7,
    overdue: [{ job: 'injuries', lastOkAt: '2026-11-20T10:00:00.000Z', maxAgeMinutes: 120 }],
  });
});

test('GET /api/health/sync-freshness returns 503 when the check cannot run, without leaking the error', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(freshness, 'getSyncFreshness', async () => {
    throw new Error('relation "data_sync_runs" does not exist at 10.0.0.7:5432');
  });

  const response = await request(app).get('/api/health/sync-freshness');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { ok: false, checked: null, overdue: null, unavailable: true });
  assert.ok(!JSON.stringify(response.body).includes('10.0.0.7'), 'no internal detail escapes');
});
