const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');
const tokens = require('../services/token.service');
const authRouter = require('../routes/auth.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'auth-login-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

function checkoutFailure() {
  const error = new Error('(ECHECKOUTRETRIES) failed to check out a connection after multiple retries');
  error.code = 'XX000';
  return error;
}

// 2026-11-22: the pooler refused checkouts in bursts and every refused login
// answered 500, which the client shows as "Is the server running?".
test('POST /api/auth/login survives a pooler checkout failure on the user read and the token insert', async (t) => {
  let reads = 0;
  t.mock.method(pool, 'query', async () => {
    reads += 1;
    if (reads === 1) throw checkoutFailure();
    return { rows: [{ id: 7, username: 'alice', email: 'alice@example.com', password: 'hash' }] };
  });
  t.mock.method(encryptLib, 'comparePassword', async () => true);
  t.mock.method(tokens, 'revokeRefreshToken', async () => {});
  let issues = 0;
  t.mock.method(tokens, 'issueRefreshToken', async () => {
    issues += 1;
    if (issues === 1) throw checkoutFailure();
    return 'raw-refresh-token';
  });

  const response = await request(app)
    .post('/api/auth/login')
    .send({ username: 'alice', password: 'pw' });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.username, 'alice');
  assert.equal(reads, 2);
  assert.equal(issues, 2);
});

test('POST /api/auth/login still answers 401 for a wrong password, with one read', async (t) => {
  const query = t.mock.method(pool, 'query', async () => ({
    rows: [{ id: 7, username: 'alice', email: 'alice@example.com', password: 'hash' }],
  }));
  t.mock.method(encryptLib, 'comparePassword', async () => false);

  const response = await request(app)
    .post('/api/auth/login')
    .send({ username: 'alice', password: 'nope' });

  assert.equal(response.status, 401);
  assert.equal(query.mock.callCount(), 1);
});
