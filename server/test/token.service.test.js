const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRefreshToken,
  REFRESH_TTL_DAYS,
  REUSE_GRACE_MS,
} = require('../services/token.service');

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
