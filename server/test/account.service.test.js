const test = require('node:test');
const assert = require('node:assert/strict');
const { hashToken, resetPassword, verifyEmail } = require('../services/account.service');
const { createFakePool, select } = require('./helpers/fakePool');

test('hashToken is a stable 64-char hex SHA-256', () => {
  const a = hashToken('some-token');
  assert.equal(a, hashToken('some-token'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('hashToken output differs per input and never echoes the raw token', () => {
  const token = 'super-secret-raw-token';
  const hash = hashToken(token);
  assert.notEqual(hash, hashToken('other-token'));
  assert.equal(hash.includes(token), false);
});

test('password reset rejects passwords outside the supported length boundary', async () => {
  await assert.rejects(
    resetPassword({ token: 'fixture', newPassword: 'short' }),
    /between 8 and 128/
  );
  await assert.rejects(
    resetPassword({ token: 'fixture', newPassword: 'x'.repeat(129) }),
    /between 8 and 128/
  );
});

// --- withTransaction routing (ADR 0033, #1065 Ruling 5) ---------------------
// The representative pair for this child: verifyEmail is the thinnest of the
// converted sites - one FOR UPDATE read, then an early throw with zero writes
// on the no-token path - so it proves the routing itself rather than any of
// its own business logic. Both cases hit the SAME throw (no matching token
// row, 400); the only thing that differs is whether the ROLLBACK that follows
// succeeds. No edits to helpers/fakePool.js (the issue forbids it).

const verifyEmailWorldHandlers = () => [
  // No unused, unexpired verification token: verifyEmail throws 400 after the
  // FOR UPDATE read and before any write.
  [select('auth_tokens'), () => ({ rows: [] })],
];

test('verifyEmail: a rejecting ROLLBACK destroys the connection and the original error survives (#1065 Ruling 5)', async (t) => {
  const world = createFakePool([
    ...verifyEmailWorldHandlers(),
    [/^ROLLBACK$/, () => { throw new Error('rollback rejected'); }, 'client'],
  ]).install(t);

  // Red-tell: reverting verifyEmail to its own bare `client.release()` (rather
  // than routing through withTransaction) makes this reject with "rollback
  // rejected" instead of the original 400, since the unhandled ROLLBACK
  // rejection would replace the AccountError.
  const promise = verifyEmail({ token: 'a-raw-token' });
  await assert.rejects(promise, { statusCode: 400, message: 'invalid or expired verification token' });
  const error = await promise.catch((e) => e);
  assert.equal(error.rollbackError.message, 'rollback rejected',
    'the rollback failure is attached to the original error, not swallowed silently');

  // A rejecting ROLLBACK leaves the transaction open on the socket, so
  // withTransaction's finally releases the client WITH an Error: pg-pool
  // destroys the connection and Postgres frees the session's locks on
  // disconnect. Red-tell: making the release unconditional (or reverting to
  // a bare client.release()) makes this fail.
  world.assertClean();
  assert.ok(world.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
});

test('verifyEmail: a clean ROLLBACK returns the healthy connection to the pool (control)', async (t) => {
  const world = createFakePool(verifyEmailWorldHandlers()).install(t);

  await assert.rejects(
    verifyEmail({ token: 'a-raw-token' }),
    { statusCode: 400, message: 'invalid or expired verification token' }
  );

  // Complementary control to the test above: the same early throw, but this
  // time the ROLLBACK succeeds cleanly (fakePool's default auto-answer), so
  // the connection is healthy and must be returned to the pool, not
  // destroyed. Red-tell: destroying on every error path (release with an
  // Error unconditionally) makes this fail.
  assert.equal(world.releaseArgs()[0], undefined, 'a clean ROLLBACK keeps the healthy connection');
  world.assertClean();
});
