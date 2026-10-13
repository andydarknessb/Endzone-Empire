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

// An anonymous visitor has no refresh cookie, and every cold load of the public
// tree asks. That is "no session", not a failed request: a 4xx here is a console
// error on every landing-page visit.
test('POST /api/auth/refresh with no refresh cookie answers 204: no body, no cookie traffic', async (t) => {
  const rotate = t.mock.method(tokens, 'rotateRefreshToken', async () => {
    throw new Error('rotate must not run without a cookie');
  });
  t.mock.method(pool, 'query', async () => {
    throw new Error('no query without a cookie');
  });

  const response = await request(app).post('/api/auth/refresh');

  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(rotate.mock.callCount(), 0);
});

test('POST /api/auth/refresh with an unrelated cookie and no refresh cookie is still 204', async () => {
  const response = await request(app).post('/api/auth/refresh').set('Cookie', 'theme=dark');
  assert.equal(response.status, 204);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('POST /api/auth/refresh from an untrusted origin in production is 403 before the cookie is read', async (t) => {
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  });

  const response = await request(app)
    .post('/api/auth/refresh')
    .set('Origin', 'https://evil.example');

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'UNTRUSTED_ORIGIN');
});

test('POST /api/auth/refresh with an invalid cookie is still 401 and still clears the cookie', async (t) => {
  t.mock.method(tokens, 'rotateRefreshToken', async () => {
    const error = new Error('invalid refresh token');
    error.statusCode = 401;
    throw error;
  });

  const response = await request(app)
    .post('/api/auth/refresh')
    .set('Cookie', 'endzone_refresh=revoked-or-expired');

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { error: 'invalid refresh token' });
  const cookies = response.headers['set-cookie'] || [];
  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /^endzone_refresh=;/);
});
