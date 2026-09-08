const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRefreshToken,
  rotateRefreshToken,
  TokenError,
  REFRESH_TTL_DAYS,
  REUSE_GRACE_MS,
} = require('../services/token.service');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

const NOW = new Date('2026-07-12T12:00:00Z');
const FUTURE = '2026-08-01T00:00:00Z';
const PAST = '2026-07-01T00:00:00Z';

const row = (overrides = {}) => ({
  id: 1,
  user_id: 42,
  family_id: 'fam-1',
  token_hash: 'abc',
  expires_at: FUTURE,
  used: false,
  revoked: false,
  updated_at: PAST, // long before NOW — used tokens read as stale by default
  ...overrides,
});

test('unknown token (no row) is invalid', () => {
  assert.equal(classifyRefreshToken(null, NOW), 'invalid');
  assert.equal(classifyRefreshToken(undefined, NOW), 'invalid');
});

test('fresh unexpired token rotates', () => {
  assert.equal(classifyRefreshToken(row(), NOW), 'rotate');
});

test('already-rotated token is reuse — the replay attack case', () => {
  assert.equal(classifyRefreshToken(row({ used: true }), NOW), 'reuse');
});

test('token rotated seconds ago is classified as a benign multi-tab race', () => {
  const justRotated = new Date(NOW - 5 * 1000).toISOString();
  assert.equal(
    classifyRefreshToken(row({ used: true, updated_at: justRotated }), NOW),
    'race'
  );
});

test('grace window has an edge: one ms past it flips to reuse', () => {
  const atEdge = new Date(NOW - REUSE_GRACE_MS).toISOString();
  const pastEdge = new Date(NOW - REUSE_GRACE_MS - 1).toISOString();
  assert.equal(classifyRefreshToken(row({ used: true, updated_at: atEdge }), NOW), 'race');
  assert.equal(classifyRefreshToken(row({ used: true, updated_at: pastEdge }), NOW), 'reuse');
});

test('used token with no updated_at is treated as stale reuse, not granted grace', () => {
  assert.equal(classifyRefreshToken(row({ used: true, updated_at: null }), NOW), 'reuse');
});

test('revoked token is invalid, not reuse (family already dead)', () => {
  assert.equal(classifyRefreshToken(row({ revoked: true }), NOW), 'invalid');
});

test('revoked wins over used — replaying into a dead family stays invalid', () => {
  assert.equal(classifyRefreshToken(row({ revoked: true, used: true }), NOW), 'invalid');
});

test('expired token is invalid even if never used', () => {
  assert.equal(classifyRefreshToken(row({ expires_at: PAST }), NOW), 'invalid');
});

test('token expiring exactly now is invalid (boundary)', () => {
  assert.equal(classifyRefreshToken(row({ expires_at: NOW.toISOString() }), NOW), 'invalid');
});

test('used takes precedence over expired — stale replays still flag reuse', () => {
  // A replayed token that has also expired must still revoke the family:
  // the attacker holds a sibling that may not be expired yet.
  assert.equal(classifyRefreshToken(row({ used: true, expires_at: PAST }), NOW), 'reuse');
});

test('refresh TTL is long-lived (weeks, not minutes)', () => {
  assert.ok(REFRESH_TTL_DAYS >= 7);
});

// ---- rotateRefreshToken through withTransaction (#1070) ----------------------
// classifyRefreshToken above is pure; these pin the four verdicts as
// rotateRefreshToken drives them THROUGH withTransaction, proving the reshape
// (Ruling 3) changed nothing a caller observes. The auth-critical claim is the
// reuse ordering: the family revoke must COMMIT before the 401 is thrown.

const dbRow = (overrides = {}) => ({
  id: 7,
  user_id: 42,
  family_id: 'fam-1',
  token_hash: 'hashed',
  expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  authenticated_at: '2026-07-01T00:00:00Z',
  used: false,
  revoked: false,
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

test('rotateRefreshToken rejects a missing token before any connect', async (t) => {
  const fake = createFakePool([]).install(t);
  await assert.rejects(rotateRefreshToken({ token: '' }), (e) =>
    e instanceof TokenError && e.statusCode === 400);
  assert.equal(fake.matching(/^BEGIN$/).length, 0, 'no transaction is opened for a missing token');
});

test('rotateRefreshToken (rotate): marks used, issues a successor, COMMITs, returns the happy shape', async (t) => {
  const fake = createFakePool([
    [select('refresh_tokens'), () => ({ rows: [dbRow()] })],
    [update('refresh_tokens'), () => ({ rows: [], rowCount: 1 })],
    [insert('refresh_tokens'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const result = await rotateRefreshToken({ token: 'raw-token' });

  assert.deepEqual(Object.keys(result).sort(), ['authenticatedAt', 'refreshToken', 'userId']);
  assert.equal(result.userId, 42);
  assert.equal(result.authenticatedAt, '2026-07-01T00:00:00Z');
  assert.match(result.refreshToken, /^[0-9a-f]{64}$/, 'a fresh 32-byte hex successor token');
  assert.equal(fake.matching(/^COMMIT$/).length, 1, 'the rotation COMMITs');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 0, 'no ROLLBACK on the happy path');
  assert.equal(fake.matching(update('refresh_tokens')).length, 1, 'the presented token is marked used');
  assert.equal(fake.matching(insert('refresh_tokens')).length, 1, 'a successor is inserted');
  fake.assertClean();
  assert.equal(fake.releaseArgs()[0], undefined, 'the healthy client is returned to the pool bare');
});

test('rotateRefreshToken (reuse): revokes the family and COMMITs BEFORE throwing the 401', async (t) => {
  // The security-critical ordering: a replayed token must leave the family
  // revoked even though the call ends in a 401. work does the revoke and
  // returns, so the wrapper COMMITs; the caller throws afterward. Red-tell:
  // throwing inside work (instead of returning) would ROLLBACK the revoke.
  const fake = createFakePool([
    [select('refresh_tokens'), () => ({ rows: [dbRow({ used: true })] })], // stale used -> reuse
    [update('refresh_tokens'), () => ({ rows: [], rowCount: 3 })],
  ]).install(t);

  await assert.rejects(rotateRefreshToken({ token: 'replayed' }), (e) =>
    e instanceof TokenError && e.statusCode === 401 && e.code === 'INVALID_REFRESH_TOKEN');

  const revokeIdx = fake.calls.findIndex((c) => update('refresh_tokens').test(c.text));
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  assert.ok(revokeIdx >= 0, 'the family is revoked');
  assert.ok(commitIdx > revokeIdx, 'the revoke is COMMITted, not rolled back');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 0, 'the revoke write is kept, never rolled back');
  fake.assertClean();
});

test('rotateRefreshToken (invalid): ROLLBACKs a read-only txn and throws 401 with no write', async (t) => {
  const fake = createFakePool([
    [select('refresh_tokens'), () => ({ rows: [] })], // unknown token -> invalid
  ]).install(t);

  await assert.rejects(rotateRefreshToken({ token: 'unknown' }), (e) =>
    e instanceof TokenError && e.statusCode === 401 && e.code === 'INVALID_REFRESH_TOKEN');
  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'nothing is committed');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the read-only transaction is rolled back');
  assert.equal(fake.matching(update('refresh_tokens')).length, 0, 'no row is written');
  fake.assertClean();
});

test('rotateRefreshToken (race): ROLLBACKs and throws 401 with the REFRESH_RACE code', async (t) => {
  const justRotated = new Date(Date.now() - 5 * 1000).toISOString();
  const fake = createFakePool([
    [select('refresh_tokens'), () => ({ rows: [dbRow({ used: true, updated_at: justRotated })] })],
  ]).install(t);

  await assert.rejects(rotateRefreshToken({ token: 'other-tab' }), (e) =>
    e instanceof TokenError && e.statusCode === 401 && e.code === 'REFRESH_RACE');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the read-only transaction is rolled back');
  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'a benign race commits nothing');
  fake.assertClean();
});
