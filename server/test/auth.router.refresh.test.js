const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const tokens = require('../services/token.service');
const authRouter = require('../routes/auth.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'auth-refresh-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

test('POST /api/auth/refresh signs the new token with the original login time, not the rotation time', async (t) => {
  const originalLoginAt = new Date('2026-06-01T00:00:00Z');
  t.mock.method(tokens, 'rotateRefreshToken', async () => ({
    userId: 42,
    refreshToken: 'new-raw-refresh-token',
    authenticatedAt: originalLoginAt.toISOString(),
  }));
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "users"')) {
      return { rows: [{ id: 42, username: 'alice', email: 'alice@example.com' }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await request(app)
    .post('/api/auth/refresh')
    .set('Cookie', 'endzone_refresh=some-old-refresh-token');

  assert.equal(response.status, 200);
  const decoded = jwt.decode(response.body.token);
  assert.equal(decoded.auth_time, Math.floor(originalLoginAt.getTime() / 1000));
});
