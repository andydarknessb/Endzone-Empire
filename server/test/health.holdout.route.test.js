const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const holdout = require('../services/holdout.service');
const healthRouter = require('../routes/health.router');

const app = express();
app.use('/api/health', healthRouter);

test('GET /api/health/holdout returns 200 when every obligation is captured or pending', async (t) => {
  t.mock.method(holdout, 'reconcileObligations', async () => ({
    ok: true,
    obligations: [
      { season: 2026, week: 1, profile: 'standard', state: 'captured' },
      { season: 2026, week: 2, profile: 'standard', state: 'pending' },
    ],
  }));

  const response = await request(app).get('/api/health/holdout');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.obligations.length, 2);
});

test('GET /api/health/holdout returns 503 on a missed obligation', async (t) => {
  t.mock.method(holdout, 'reconcileObligations', async () => ({
    ok: false,
    obligations: [{ season: 2026, week: 1, profile: 'ppr', state: 'missed' }],
  }));

  const response = await request(app).get('/api/health/holdout');
  assert.equal(response.status, 503, 'a missed capture is an alert, not an anecdote');
  assert.equal(response.body.obligations[0].state, 'missed');
});

test('GET /api/health/holdout returns 503 when reconciliation itself cannot run — without leaking the error', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(holdout, 'reconcileObligations', async () => {
    throw new Error('relation "projection_snapshots" does not exist at 10.0.0.7:5432');
  });

  const response = await request(app).get('/api/health/holdout');
  assert.equal(response.status, 503, 'an unreadable ledger must never report healthy');
  assert.equal(response.body.ok, false);
  assert.equal(response.body.unavailable, true);
  assert.equal(response.body.error, undefined, 'raw database errors are not a public API');
  assert.ok(!JSON.stringify(response.body).includes('10.0.0.7'), 'no internal detail escapes');
});

test('GET /api/health/holdout returns 503 on schedule-invalid obligations', async (t) => {
  t.mock.method(holdout, 'reconcileObligations', async () => ({
    ok: false,
    obligations: [{ season: 2026, week: 3, profile: 'standard', state: 'schedule-invalid', scheduleIssues: ['ARI-ATL: 0 row(s), expected 2'] }],
  }));

  const response = await request(app).get('/api/health/holdout');
  assert.equal(response.status, 503, 'a schedule that contradicts the manifest is an alert');
  assert.equal(response.body.obligations[0].state, 'schedule-invalid');
});
