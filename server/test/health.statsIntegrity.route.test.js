const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const integrity = require('../services/playerStatsIntegrity.service');
const healthRouter = require('../routes/health.router');

const app = express();
app.use('/api/health', healthRouter);

test('GET /api/health/stats-integrity returns 200 when a fresh scan found nothing open', async (t) => {
  t.mock.method(integrity, 'getIntegrityStatus', async () => ({
    ok: true, open: 0, lastScanAt: new Date('2026-09-16T09:05:00.000Z'), stale: false,
  }));

  const response = await request(app).get('/api/health/stats-integrity');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true, open: 0, lastScanAt: '2026-09-16T09:05:00.000Z', stale: false,
  });
});

test('GET /api/health/stats-integrity returns 503 while any anomaly is open', async (t) => {
  t.mock.method(integrity, 'getIntegrityStatus', async () => ({
    ok: false, open: 23, lastScanAt: new Date('2026-09-16T09:05:00.000Z'), stale: false,
  }));

  const response = await request(app).get('/api/health/stats-integrity');
  assert.equal(response.status, 503, 'an open anomaly is an alert, not an anecdote');
  assert.equal(response.body.open, 23);
});

test('GET /api/health/stats-integrity returns 503 when the scan is stale or has never run', async (t) => {
  t.mock.method(integrity, 'getIntegrityStatus', async () => ({
    ok: false, open: 0, lastScanAt: null, stale: true,
  }));

  const response = await request(app).get('/api/health/stats-integrity');
  assert.equal(response.status, 503, 'never checked is not clean');
  assert.equal(response.body.stale, true);
});

test('GET /api/health/stats-integrity returns 503 when the tables cannot be read, without leaking the error', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(integrity, 'getIntegrityStatus', async () => {
    throw new Error('relation "player_stats_anomalies" does not exist at 10.0.0.7:5432');
  });

  const response = await request(app).get('/api/health/stats-integrity');
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { ok: false, open: null, lastScanAt: null, stale: true, unavailable: true });
  assert.ok(!JSON.stringify(response.body).includes('10.0.0.7'), 'no internal detail escapes');
});
