const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const encryptLib = require('../modules/encryption');
const account = require('../services/account.service');
const tokens = require('../services/token.service');
const { createFakePool } = require('./helpers/fakePool');
const { withheld, NEXT_QUARTER } = require('./helpers/payloadShape');

/**
 * The payload contract of every unauthenticated /api/auth/* route (#201).
 *
 * auth.router.js has no `requireAuth` at its root - it cannot: it is where a
 * session comes from - so seven of its eight routes are reachable with no
 * credentials at all. Their payloads are public in the sense that matters:
 * whatever they carry is what a caller obtains by presenting credentials, and
 * a field added to any of them is published the day it lands.
 *
 * `/login` was the one delete-list this audit found outside the presenter
 * board. Its query must SELECT the password hash to compare it, and it used
 * to answer `result.rows[0]` with the hash `delete`d off afterwards: exactly
 * the default-publish shape #173 removed from the presenter board, with a
 * bcrypt hash one moved line away from the wire. It now builds the response
 * from a named allowlist, and these tests pin the exact key set of all three
 * account payloads plus every acknowledgement and refusal on the router.
 *
 * Every fixture row is WIDER than the contract - the password hash, account
 * flags, and a stand-in for a column added next quarter - so the assertions
 * bite on the router's allowlist rather than on the fixture's shape.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'auth-payload-shape-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const authRouter = require('../routes/auth.router');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const HASH = '$2a$10$notarealbcrypthashbutlongenoughtolooklikeone';

/**
 * Everything on a `users` row that must NOT reach the wire, kept in one object
 * with the assertion that checks for it. A forbidden-key loop can only prove
 * what the fixture actually supplied, so the decoys are spread into the row
 * rather than merely named in the assertion.
 */
const { decoys: SECRETS, assertWithheld } = withheld({
  password: HASH,
  deleted_at: null,
  email_verified: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  a_column_added_next_quarter: NEXT_QUARTER,
});

/** Everything a `users` row can hand these routes today, plus tomorrow's column. */
const wideUserRow = (over = {}) => ({
  id: 42,
  username: 'alice',
  email: 'alice@example.com',
  ...SECRETS,
  ...over,
});

/** The account object, in full. A field appears here only because someone published it. */
const USER_KEYS = ['email', 'id', 'username'];

/** The account payload is `{ token, user }`, and `user` is exactly USER_KEYS. */
function assertAccountPayload(res) {
  assert.equal(res.status < 400, true, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['token', 'user']);
  assert.deepEqual(Object.keys(res.body.user).sort(), USER_KEYS);
  assert.equal(typeof res.body.token, 'string');
  assertWithheld(res.body);
}

function stubTokens(t) {
  t.mock.method(tokens, 'issueRefreshToken', async () => 'raw-refresh-token');
  t.mock.method(tokens, 'revokeRefreshToken', async () => ({ ok: true }));
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

function registerPool(row = wideUserRow()) {
  return createFakePool([
    [/^SELECT 1 FROM "users"/, () => ({ rows: [] })],
    [/^INSERT INTO "users"/, () => ({ rows: [row] })],
  ]);
}

const registerBody = { username: 'alice', email: 'alice@example.com', password: 'correct horse' };

test('POST /register publishes exactly a token and the account allowlist', async (t) => {
  const fake = registerPool().install(t);
  stubTokens(t);
  t.mock.method(encryptLib, 'encryptPassword', async () => HASH);

  const res = await request(app).post('/api/auth/register').send(registerBody);

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assertAccountPayload(res);
  assert.deepEqual(res.body.user, { id: 42, username: 'alice', email: 'alice@example.com' });
  fake.assertClean();
});

test('POST /register refusals publish exactly an error', async (t) => {
  stubTokens(t);
  t.mock.method(encryptLib, 'encryptPassword', async () => HASH);

  // A missing field, a short password, and a name already taken.
  const taken = createFakePool([
    [/^SELECT 1 FROM "users"/, () => ({ rows: [{ '?column?': 1 }] })],
  ]).install(t);
  for (const body of [{}, { ...registerBody, password: 'short' }, registerBody]) {
    const res = await request(app).post('/api/auth/register').send(body);
    assert.ok(res.status >= 400, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body), ['error']);
  }
  taken.assertClean();
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

function loginPool(row = wideUserRow()) {
  return createFakePool([
    [/^SELECT .* FROM "users"/, () => ({ rows: row ? [row] : [] })],
  ]);
}

test('the login query still selects the password hash, which is why the response is an allowlist', async (t) => {
  // The reason this contract exists. If the query ever stops selecting the
  // hash the allowlist can be reconsidered; until then it is the only thing
  // between a bcrypt hash and an anonymous caller who guessed a password.
  const fake = loginPool().install(t);
  stubTokens(t);
  t.mock.method(encryptLib, 'comparePassword', async () => true);

  await request(app).post('/api/auth/login').send({ username: 'alice', password: 'correct horse' });

  assert.ok(
    fake.calls.some((call) => /^SELECT .*"password".* FROM "users"/.test(call.text)),
    'login reads the password hash in order to compare it'
  );
  fake.assertClean();
});

test('POST /login publishes exactly a token and the account allowlist, hash and all excluded', async (t) => {
  const fake = loginPool().install(t);
  stubTokens(t);
  t.mock.method(encryptLib, 'comparePassword', async () => true);

  const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'correct horse' });

  assertAccountPayload(res);
  assert.deepEqual(res.body.user, { id: 42, username: 'alice', email: 'alice@example.com' });
  fake.assertClean();
});

test('the login key set is the allowlist, not the row: a narrower row still answers every field', async (t) => {
  // The other half of the contract. A query that stops selecting `email`
  // answers null for it; it never drops the key from a payload the client
  // reads unconditionally.
  const fake = loginPool({ id: 42, username: 'alice', password: HASH }).install(t);
  stubTokens(t);
  t.mock.method(encryptLib, 'comparePassword', async () => true);

  const res = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'correct horse' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body.user).sort(), USER_KEYS);
  assert.equal(res.body.user.email, null, 'a column the query stopped selecting answers null');
  assertWithheld(res.body);
  fake.assertClean();
});

test('POST /login refusals publish exactly an error, and never say which half was wrong', async (t) => {
  stubTokens(t);

  const missing = loginPool(null).install(t);
  const unknown = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'x' });
  assert.equal(unknown.status, 401);
  assert.deepEqual(Object.keys(unknown.body), ['error']);
  missing.assertClean();

  const wrong = loginPool().install(t);
  t.mock.method(encryptLib, 'comparePassword', async () => false);
  const badPassword = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'wrong' });
  assert.equal(badPassword.status, 401);
  assert.deepEqual(Object.keys(badPassword.body), ['error']);
  assert.equal(badPassword.body.error, unknown.body.error);
  assertWithheld(badPassword.body);
  wrong.assertClean();

  const blank = await request(app).post('/api/auth/login').send({});
  assert.equal(blank.status, 400);
  assert.deepEqual(Object.keys(blank.body), ['error']);
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh and /logout
// ---------------------------------------------------------------------------

test('POST /refresh publishes exactly a token and the account allowlist', async (t) => {
  const fake = createFakePool([
    [/^SELECT .* FROM "users"/, () => ({ rows: [wideUserRow()] })],
  ]).install(t);
  t.mock.method(tokens, 'rotateRefreshToken', async () => ({
    userId: 42,
    refreshToken: 'new-raw-refresh-token',
    authenticatedAt: '2026-06-01T00:00:00.000Z',
  }));

  const res = await request(app)
    .post('/api/auth/refresh')
    .set('Cookie', 'endzone_refresh=old-raw-refresh-token');

  assertAccountPayload(res);
  // The rotated refresh token travels in an httpOnly cookie, never the body.
  assert.ok(!JSON.stringify(res.body).includes('new-raw-refresh-token'));
  fake.assertClean();
});

test('POST /refresh refusals publish exactly an error', async (t) => {
  const fake = createFakePool([
    [/^SELECT .* FROM "users"/, () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(tokens, 'rotateRefreshToken', async () => ({
    userId: 42, refreshToken: 'x', authenticatedAt: '2026-06-01T00:00:00.000Z',
  }));

  const res = await request(app).post('/api/auth/refresh');
  assert.equal(res.status, 401);
  assert.deepEqual(Object.keys(res.body), ['error']);
  fake.assertClean();
});

test('POST /logout publishes exactly an acknowledgement', async (t) => {
  stubTokens(t);
  const res = await request(app).post('/api/auth/logout');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body), ['ok']);
  assert.equal(res.body.ok, true);
});

// ---------------------------------------------------------------------------
// The account-recovery routes.
// ---------------------------------------------------------------------------

test('POST /forgot-password publishes exactly ok and a message, the same one either way', async (t) => {
  // The message must not vary with whether the address exists: the key set is
  // pinned here, and the value is pinned because it is the account-enumeration
  // guard.
  t.mock.method(account, 'requestPasswordReset', async () => ({ delivered: 'smtp' }));
  const known = await request(app).post('/api/auth/forgot-password').send({ email: 'alice@example.com' });
  assert.equal(known.status, 200, JSON.stringify(known.body));
  assert.deepEqual(Object.keys(known.body).sort(), ['message', 'ok']);

  t.mock.method(account, 'requestPasswordReset', async () => ({ delivered: 'suppressed' }));
  const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
  assert.deepEqual(Object.keys(unknown.body).sort(), ['message', 'ok']);
  assert.deepEqual(unknown.body, known.body, 'an unknown address is indistinguishable from a known one');
});

test('POST /reset-password publishes exactly an acknowledgement, and its refusal exactly an error', async (t) => {
  // The refusal runs FIRST, against the real service: a missing token is
  // rejected before any database call, so mocking would only hide it.
  const refused = await request(app).post('/api/auth/reset-password').send({});
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.deepEqual(Object.keys(refused.body), ['error']);

  t.mock.method(account, 'resetPassword', async () => ({ ok: true }));
  const done = await request(app).post('/api/auth/reset-password').send({ token: 't', password: 'correct horse' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(Object.keys(done.body), ['ok']);
});

test('POST /verify-email publishes exactly an acknowledgement, and its refusal exactly an error', async (t) => {
  const refused = await request(app).post('/api/auth/verify-email').send({});
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.deepEqual(Object.keys(refused.body), ['error']);

  t.mock.method(account, 'verifyEmail', async () => ({ ok: true }));
  const done = await request(app).post('/api/auth/verify-email').send({ token: 't' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(Object.keys(done.body), ['ok']);
});
