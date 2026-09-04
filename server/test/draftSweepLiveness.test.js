const { test } = require('node:test');
const assert = require('node:assert/strict');
const redis = require('../modules/redis');
const liveness = require('../modules/draftSweepLiveness');

// Draft sweep liveness (#842): the worker stamps a Redis key after every draft
// sweep; /api/health/worker reads it. These pin the stamp's shape and the
// stale/unknown split that the health fold depends on.

function fakeRedis(store = new Map()) {
  const calls = [];
  return {
    store,
    calls,
    client: {
      async set(key, value, options) { calls.push({ key, value, options }); store.set(key, value); return 'OK'; },
      async get(key) { return store.has(key) ? store.get(key) : null; },
    },
  };
}

test('recordDraftSweep stamps the key with an ISO time and the TTL, and reports true', async (t) => {
  const fake = fakeRedis();
  t.mock.method(redis, 'getRedisClient', async () => fake.client);

  const now = new Date('2026-09-04T01:00:00.000Z');
  assert.equal(await liveness.recordDraftSweep(now), true);
  assert.deepEqual(fake.calls, [{
    key: liveness.DRAFT_SWEEP_KEY,
    value: '2026-09-04T01:00:00.000Z',
    options: { EX: liveness.DRAFT_SWEEP_TTL_SECONDS },
  }]);
});

test('recordDraftSweep never throws: Redis unconfigured reports false, a Redis error reports false', async (t) => {
  t.mock.method(redis, 'getRedisClient', async () => null);
  assert.equal(await liveness.recordDraftSweep(), false);

  t.mock.method(redis, 'getRedisClient', async () => ({ async set() { throw new Error('ECONNRESET'); } }));
  assert.equal(await liveness.recordDraftSweep(), false, 'a failing stamp is swallowed, the tick must not die on it');
});

test('readDraftSweepLiveness: a fresh stamp is not stale, a 61s-old stamp is stale', async (t) => {
  const fake = fakeRedis();
  t.mock.method(redis, 'getRedisClient', async () => fake.client);
  const now = Date.parse('2026-09-04T01:00:00.000Z');

  fake.store.set(liveness.DRAFT_SWEEP_KEY, new Date(now - 5000).toISOString());
  assert.deepEqual(await liveness.readDraftSweepLiveness(now), {
    lastDraftSweepAt: new Date(now - 5000).toISOString(),
    draftSweepStale: false,
  });

  // Red tell: the exact threshold. 60s is still fresh; 60s + 1ms is stale.
  fake.store.set(liveness.DRAFT_SWEEP_KEY, new Date(now - liveness.DRAFT_SWEEP_STALE_AFTER_MS).toISOString());
  assert.equal((await liveness.readDraftSweepLiveness(now)).draftSweepStale, false);
  fake.store.set(liveness.DRAFT_SWEEP_KEY, new Date(now - liveness.DRAFT_SWEEP_STALE_AFTER_MS - 1).toISOString());
  assert.equal((await liveness.readDraftSweepLiveness(now)).draftSweepStale, true);
});

test('readDraftSweepLiveness: a missing key is stale (the worker stamps at boot), an unparseable stamp is stale', async (t) => {
  const fake = fakeRedis();
  t.mock.method(redis, 'getRedisClient', async () => fake.client);

  assert.deepEqual(await liveness.readDraftSweepLiveness(), { lastDraftSweepAt: null, draftSweepStale: true });

  fake.store.set(liveness.DRAFT_SWEEP_KEY, 'not-a-date');
  assert.equal((await liveness.readDraftSweepLiveness()).draftSweepStale, true);
});

test('readDraftSweepLiveness fails open: Redis unconfigured or erroring is unknown, not stale', async (t) => {
  t.mock.method(redis, 'getRedisClient', async () => null);
  assert.deepEqual(await liveness.readDraftSweepLiveness(), { lastDraftSweepAt: null, draftSweepStale: false });

  t.mock.method(redis, 'getRedisClient', async () => { throw new Error('connect ECONNREFUSED'); });
  assert.deepEqual(await liveness.readDraftSweepLiveness(), { lastDraftSweepAt: null, draftSweepStale: false });
});
