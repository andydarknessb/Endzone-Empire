const test = require('node:test');
const assert = require('node:assert/strict');
const { hit } = require('../modules/rateLimit');

const WINDOW_MS = 1000;
const MAX = 3;

test('allows requests under the max within the window', () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < MAX; i++) {
    const result = hit(store, 'k1', now + i, WINDOW_MS, MAX);
    assert.equal(result.allowed, true, `hit ${i} should be allowed`);
    assert.equal(result.retryAfterMs, 0);
  }
});

test('blocks once the max is reached within the window', () => {
  const store = new Map();
  const now = 2_000_000;
  for (let i = 0; i < MAX; i++) {
    assert.equal(hit(store, 'k2', now + i, WINDOW_MS, MAX).allowed, true);
  }
  const blocked = hit(store, 'k2', now + MAX, WINDOW_MS, MAX);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0, 'retryAfterMs should be positive when blocked');
  assert.ok(blocked.retryAfterMs <= WINDOW_MS, 'retryAfterMs should not exceed the window size');
});

test('window slides — old hits expire and free up capacity', () => {
  const store = new Map();
  const now = 3_000_000;
  for (let i = 0; i < MAX; i++) {
    assert.equal(hit(store, 'k3', now + i, WINDOW_MS, MAX).allowed, true);
  }
  // Still inside the window: blocked.
  assert.equal(hit(store, 'k3', now + WINDOW_MS - 1, WINDOW_MS, MAX).allowed, false);
  // Past the window relative to the oldest hit: allowed again.
  const afterWindow = hit(store, 'k3', now + WINDOW_MS + 1, WINDOW_MS, MAX);
  assert.equal(afterWindow.allowed, true);
});

test('separate keys are tracked independently', () => {
  const store = new Map();
  const now = 4_000_000;
  for (let i = 0; i < MAX; i++) {
    assert.equal(hit(store, 'user-a', now, WINDOW_MS, MAX).allowed, true);
  }
  // key A is now at its limit, but key B is untouched and should still pass.
  assert.equal(hit(store, 'user-a', now, WINDOW_MS, MAX).allowed, false);
  assert.equal(hit(store, 'user-b', now, WINDOW_MS, MAX).allowed, true);
});

test('retryAfterMs is sane: shrinks as time approaches window expiry', () => {
  const store = new Map();
  const now = 5_000_000;
  hit(store, 'k4', now, WINDOW_MS, 1); // single-slot limiter, immediately full
  const blockedEarly = hit(store, 'k4', now + 100, WINDOW_MS, 1);
  const blockedLate = hit(store, 'k4', now + 900, WINDOW_MS, 1);
  assert.equal(blockedEarly.allowed, false);
  assert.equal(blockedLate.allowed, false);
  assert.ok(blockedLate.retryAfterMs < blockedEarly.retryAfterMs);
  assert.ok(blockedLate.retryAfterMs >= 0);
});

test('retryAfterMs never goes negative even right at window boundary', () => {
  const store = new Map();
  const now = 6_000_000;
  hit(store, 'k5', now, WINDOW_MS, 1);
  const blocked = hit(store, 'k5', now + WINDOW_MS - 1, WINDOW_MS, 1);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs >= 0);
});
