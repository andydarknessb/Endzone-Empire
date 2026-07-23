const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long';

const { requireRecentAuth, signToken } = require('../modules/auth');

test('access tokens preserve the original authentication time', () => {
  const authenticatedAt = '2026-07-23T12:34:56.000Z';
  const token = signToken(
    { id: 42, username: 'alice' },
    { authenticatedAt }
  );
  const payload = jwt.decode(token);

  assert.equal(payload.auth_time, Math.floor(new Date(authenticatedAt).getTime() / 1000));
  assert.equal(payload.sub, 42);
});

test('recent-auth middleware rejects a refreshed session whose login is too old', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const req = {
    id: 'request-1',
    user: { id: 42, authenticatedAt: nowSeconds - 601 },
  };
  let response;
  const res = {
    status(statusCode) {
      response = { statusCode };
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };
  let nextCalled = false;

  requireRecentAuth(600)(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'RECENT_AUTH_REQUIRED');
  assert.equal(response.body.requestId, 'request-1');
});

test('recent-auth middleware accepts a newly authenticated session', () => {
  const req = {
    user: {
      id: 42,
      authenticatedAt: Math.floor(Date.now() / 1000) - 60,
    },
  };
  let nextCalled = false;

  requireRecentAuth(600)(req, {}, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});
