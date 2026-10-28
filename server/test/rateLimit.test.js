const test = require('node:test');
const assert = require('node:assert/strict');
const { hit, createRateLimiter, createCredentialLimiters, accountPart } = require('../modules/rateLimit');

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

// --- Redis branch: counts per caller, never per URL (#2411) ---

const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long';
const redisModule = require('../modules/redis');
const { callerKey } = require('../modules/auth');

function fakeRedis() {
  const counts = new Map();
  return {
    async incr(k) {
      counts.set(k, (counts.get(k) || 0) + 1);
      return counts.get(k);
    },
    keys: () => counts.keys(),
    async pExpire() {},
    async pTTL() {
      return 1000;
    },
  };
}

async function run(limiter, req) {
  const res = {
    code: 200,
    set() {},
    status(c) {
      this.code = c;
      return this;
    },
    json() {},
  };
  let passed = false;
  await limiter({ baseUrl: '/api', id: 'r', ...req }, res, () => {
    passed = true;
  });
  return passed ? 200 : res.code;
}

test('redis branch: paths under one limiter share one count', async () => {
  const original = redisModule.getRedisClient;
  const redis = fakeRedis();
  redisModule.getRedisClient = async () => redis;
  try {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyFn: () => 'caller' });
    assert.equal(await run(limiter, { path: '/players/1' }), 200);
    assert.equal(await run(limiter, { path: '/players/2' }), 429);
  } finally {
    redisModule.getRedisClient = original;
  }
});

function reqWith(token, ip = '2.2.2.2') {
  return {
    ip,
    get: (h) => (h === 'Authorization' && token ? `Bearer ${token}` : undefined),
  };
}

test('callerKey: valid tokens key by user, anonymous by IP, forged by IP', () => {
  const secret = process.env.JWT_SECRET;
  const t7 = jwt.sign({ sub: 7 }, secret);
  const t8 = jwt.sign({ sub: 8 }, secret);
  assert.equal(callerKey(reqWith(t7)), 'user:7');
  assert.notEqual(callerKey(reqWith(t7)), callerKey(reqWith(t8)));
  assert.equal(callerKey(reqWith(null)), 'ip:2.2.2.2');
  assert.equal(callerKey(reqWith(null)), callerKey(reqWith(null)));
  const forged = jwt.sign({ sub: 9 }, 'some-other-secret-that-is-long-enough!!');
  assert.equal(callerKey(reqWith(forged)), 'ip:2.2.2.2');
  const expired = jwt.sign({ sub: 7 }, secret, { expiresIn: -10 });
  assert.equal(callerKey(reqWith(expired)), 'ip:2.2.2.2');
});

// --- Credential limits (#2551) ---

test('register: the 11th request in an hour from one IP gets 429, whatever the username', async () => {
  const { registerIp } = createCredentialLimiters();
  for (let i = 1; i <= 10; i++) {
    assert.equal(await run(registerIp, { ip: '9.9.9.9', body: { username: `u${i}` } }), 200, `request ${i}`);
  }
  assert.equal(await run(registerIp, { ip: '9.9.9.9', body: { username: 'u11' } }), 429);
  assert.equal(await run(registerIp, { ip: '8.8.8.8', body: { username: 'u11' } }), 200);
});

test('login: the 101st request in 10 minutes from one IP gets 429 across usernames; the per-account limit still applies', async () => {
  const { loginIp, account } = createCredentialLimiters();
  for (let i = 1; i <= 100; i++) {
    assert.equal(await run(loginIp, { ip: '9.9.9.9', body: { username: `u${i}` } }), 200, `request ${i}`);
  }
  assert.equal(await run(loginIp, { ip: '9.9.9.9', body: { username: 'u101' } }), 429);
  for (let i = 1; i <= 20; i++) {
    assert.equal(await run(account, { ip: '7.7.7.7', body: { username: 'victim' } }), 200, `account ${i}`);
  }
  assert.equal(await run(account, { ip: '7.7.7.7', body: { username: 'victim' } }), 429);
});

test('forgot-password: the 6th request for one email in an hour gets 429, even from different IPs', async () => {
  const { forgotEmail } = createCredentialLimiters();
  for (let i = 1; i <= 5; i++) {
    assert.equal(await run(forgotEmail, { ip: `10.0.0.${i}`, body: { email: 'A@x.com' } }), 200, `request ${i}`);
  }
  assert.equal(await run(forgotEmail, { ip: '10.0.0.99', body: { email: 'a@X.com' } }), 429);
  assert.equal(await run(forgotEmail, { ip: '10.0.0.99', body: { email: 'b@x.com' } }), 200);
});

test('a 1 MB username yields an account part of at most 254 characters', () => {
  const part = accountPart({ body: { username: 'A'.repeat(1024 * 1024) } });
  assert.ok(part.length > 0 && part.length <= 254);
});

test('redis branch: limiters with different names on one route never share a count', async () => {
  const original = redisModule.getRedisClient;
  const redis = fakeRedis();
  redisModule.getRedisClient = async () => redis;
  try {
    const a = createRateLimiter({ name: 'a', windowMs: 60_000, max: 1, keyFn: () => 'same' });
    const b = createRateLimiter({ name: 'b', windowMs: 60_000, max: 1, keyFn: () => 'same' });
    assert.equal(await run(a, { ip: '1.1.1.1' }), 200);
    assert.equal(await run(b, { ip: '1.1.1.1' }), 200);
    assert.equal(await run(a, { ip: '1.1.1.1' }), 429);
    assert.ok([...redis.keys()].some((k) => k.includes(':a:')) && [...redis.keys()].some((k) => k.includes(':b:')));
  } finally {
    redisModule.getRedisClient = original;
  }
});

test('redis branch: the path case a client types does not buy a fresh count', async () => {
  const original = redisModule.getRedisClient;
  const redis = fakeRedis();
  redisModule.getRedisClient = async () => redis;
  try {
    const limiter = createRateLimiter({ name: 'n', windowMs: 60_000, max: 1, keyFn: () => 'same' });
    assert.equal(await run(limiter, { baseUrl: '/api/auth/register' }), 200);
    assert.equal(await run(limiter, { baseUrl: '/API/Auth/REGISTER' }), 429);
  } finally {
    redisModule.getRedisClient = original;
  }
});
