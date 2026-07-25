const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTank01Client,
  cycleStart,
  utcDay,
  endpointKey,
  parseQuotaHeaders,
  quotaMode,
  priorityAllowed,
  readConfig,
  retryAfterMs,
  QuotaExhaustedError,
} = require('../modules/tank01Client');

// A plain in-memory stand-in for the Postgres usage store, so none of these
// tests need a database (or the network).
function memoryStore({ usage = [], snapshot = null } = {}) {
  const calls = new Map(); // 'endpoint|day' -> count
  for (const row of usage) {
    calls.set(`${row.endpoint || 'seed'}|${row.day}`, row.calls);
  }
  let snap = snapshot;
  return {
    calls,
    get snapshot() {
      return snap;
    },
    async readUsage({ since }) {
      let total = 0;
      for (const [key, count] of calls) {
        const day = key.split('|')[1];
        if (day >= since) total += count; // ISO dates sort lexicographically
      }
      return total;
    },
    async readSnapshot() {
      return snap;
    },
    async recordCall({ endpoint, day }) {
      const key = `${endpoint}|${day}`;
      calls.set(key, (calls.get(key) || 0) + 1);
    },
    async saveSnapshot({ limit, remaining, seenAt }) {
      snap = { limit, remaining, seenAt };
    },
    async readBreakdown() {
      return [...calls.entries()].map(([key, count]) => ({
        endpoint: key.split('|')[0],
        day: key.split('|')[1],
        calls: count,
      }));
    },
    total() {
      let sum = 0;
      for (const count of calls.values()) sum += count;
      return sum;
    },
  };
}

function fakeTransport(impl) {
  const seen = [];
  return {
    seen,
    async get(path, opts) {
      seen.push({ path, params: opts && opts.params });
      if (typeof impl === 'function') return impl(path, opts);
      return { data: { statusCode: 200, body: {} }, headers: {} };
    },
  };
}

const CONFIG = { budget: 950, hardCeiling: 1000, softPct: 80, anchorDay: 1 }; // soft limit 760
const NOW = new Date('2026-09-20T18:00:00.000Z');

function clientWith({ usedThisCycle = 0, snapshot = null, transport, config = CONFIG, now = () => NOW } = {}) {
  const store = memoryStore({
    usage: usedThisCycle
      ? [{ endpoint: 'seed', day: utcDay(cycleStart(now(), config.anchorDay)), calls: usedThisCycle }]
      : [],
    snapshot,
  });
  return { store, client: createTank01Client({ store, transport, now, config }) };
}

// --- cycle-window math -------------------------------------------------------

test('cycleStart: anchor day 1 -> the 1st of the current month', () => {
  assert.equal(utcDay(cycleStart(new Date('2026-09-20T00:00:00Z'), 1)), '2026-09-01');
});

test('cycleStart: before the anchor day, the cycle began LAST month', () => {
  assert.equal(utcDay(cycleStart(new Date('2026-09-14T00:00:00Z'), 15)), '2026-08-15');
});

test('cycleStart: on the anchor day, the cycle begins today', () => {
  assert.equal(utcDay(cycleStart(new Date('2026-09-15T00:00:00Z'), 15)), '2026-09-15');
});

test('cycleStart: January before the anchor rolls back into December', () => {
  assert.equal(utcDay(cycleStart(new Date('2027-01-05T00:00:00Z'), 12)), '2026-12-12');
});

test('cycleStart: an out-of-range anchor is clamped into 1-28', () => {
  // 31 clamps to 28, and the 20th is still before it -> last month's cycle.
  assert.equal(utcDay(cycleStart(new Date('2026-09-20T00:00:00Z'), 31)), '2026-08-28');
  assert.equal(utcDay(cycleStart(new Date('2026-09-20T00:00:00Z'), 0)), '2026-09-01');
});

test('usage before the cycle start is not counted against this cycle', async () => {
  const store = memoryStore({
    usage: [
      { endpoint: 'old', day: '2026-08-31', calls: 900 }, // previous cycle
      { endpoint: 'new', day: '2026-09-02', calls: 12 },
    ],
  });
  const client = createTank01Client({ store, now: () => NOW, config: CONFIG });
  const state = await client.getQuotaState();
  assert.equal(state.used, 12);
  assert.equal(state.cycleStart, '2026-09-01');
});

// --- config + pure gate policy ----------------------------------------------

test('readConfig: soft limit is a percentage OF the budget, ceiling never below budget', () => {
  const cfg = readConfig({ budget: 950, softPct: 80, hardCeiling: 100 });
  assert.equal(cfg.softLimit, 760);
  assert.equal(cfg.hardCeiling, 950);
});

test('quotaMode: ok -> degraded -> essential-only -> blocked', () => {
  const cfg = readConfig(CONFIG);
  assert.equal(quotaMode(0, cfg), 'ok');
  assert.equal(quotaMode(759, cfg), 'ok');
  assert.equal(quotaMode(760, cfg), 'degraded');
  assert.equal(quotaMode(950, cfg), 'essential-only');
  assert.equal(quotaMode(1000, cfg), 'blocked');
});

test('priorityAllowed: spend sheds news, then standard, then everything', () => {
  assert.deepEqual(
    ['low', 'standard', 'essential'].map((p) => priorityAllowed(p, 'ok')),
    [true, true, true]
  );
  assert.deepEqual(
    ['low', 'standard', 'essential'].map((p) => priorityAllowed(p, 'degraded')),
    [false, true, true]
  );
  assert.deepEqual(
    ['low', 'standard', 'essential'].map((p) => priorityAllowed(p, 'essential-only')),
    [false, false, true]
  );
  assert.deepEqual(
    ['low', 'standard', 'essential'].map((p) => priorityAllowed(p, 'blocked')),
    [false, false, false]
  );
});

// --- priority gating end to end ---------------------------------------------

test('under the soft limit every priority passes', async () => {
  const transport = fakeTransport();
  const { client } = clientWith({ usedThisCycle: 700, transport });
  const state = await client.getQuotaState();
  assert.equal(state.mode, 'ok');
  for (const priority of ['low', 'standard', 'essential']) {
    await client.get('/getNFLNews', { priority });
  }
  assert.equal(transport.seen.length, 3);
});

test('at 80% of budget news is shed but the clock and stat pulls continue', async () => {
  const transport = fakeTransport();
  const { client } = clientWith({ usedThisCycle: 770, transport });
  assert.equal((await client.getQuotaState()).mode, 'degraded');
  await assert.rejects(() => client.get('/getNFLNews', { priority: 'low' }), QuotaExhaustedError);
  await client.get('/getNFLScoresOnly', { priority: 'standard' });
  await client.get('/getNFLBoxScore', { priority: 'essential' });
  assert.equal(transport.seen.length, 2);
});

test('at the budget only essential calls pass', async () => {
  const transport = fakeTransport();
  const { client } = clientWith({ usedThisCycle: 960, transport });
  assert.equal((await client.getQuotaState()).mode, 'essential-only');
  await assert.rejects(() => client.get('/getNFLNews', { priority: 'low' }), /essential-only/);
  await assert.rejects(
    () => client.get('/getNFLBoxScore', { priority: 'standard' }),
    /essential-only/
  );
  await client.get('/getNFLBoxScore', { priority: 'essential' });
  assert.equal(transport.seen.length, 1);
});

test('at the hard ceiling every priority is blocked with a 503', async () => {
  const transport = fakeTransport();
  const { client } = clientWith({ usedThisCycle: 1005, transport });
  assert.equal((await client.getQuotaState()).mode, 'blocked');
  for (const priority of ['low', 'standard', 'essential']) {
    await assert.rejects(
      () => client.get('/getNFLBoxScore', { priority }),
      (err) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.code, 'TANK01_QUOTA_EXHAUSTED');
        return true;
      }
    );
  }
  assert.equal(transport.seen.length, 0);
});

test("a blocked call is never counted (it didn't happen)", async () => {
  const transport = fakeTransport();
  const { client, store } = clientWith({ usedThisCycle: 1005, transport });
  const before = store.total();
  await assert.rejects(() => client.get('/getNFLNews', { priority: 'low' }));
  assert.equal(store.total(), before);
});

// --- header snapshot precedence ---------------------------------------------

test('a fresh header snapshot outranks a lower local count', async () => {
  const { client } = clientWith({
    usedThisCycle: 100,
    snapshot: { limit: 1000, remaining: 100, seenAt: new Date(NOW.getTime() - 60_000) },
  });
  const state = await client.getQuotaState();
  assert.equal(state.headerUsed, 900);
  assert.equal(state.used, 900); // header view, not our own 100
  assert.equal(state.mode, 'degraded'); // past the 760 soft limit on the header number alone
});

test('a stale (>24h) header snapshot is ignored in favor of local counts', async () => {
  const { client } = clientWith({
    usedThisCycle: 100,
    snapshot: { limit: 1000, remaining: 0, seenAt: new Date(NOW.getTime() - 48 * 3600_000) },
  });
  const state = await client.getQuotaState();
  assert.equal(state.headerUsed, null);
  assert.equal(state.used, 100);
  assert.equal(state.mode, 'ok');
});

test('a higher local count wins over a rosier header snapshot', async () => {
  const { client } = clientWith({
    usedThisCycle: 980,
    snapshot: { limit: 1000, remaining: 900, seenAt: new Date(NOW.getTime() - 60_000) },
  });
  const state = await client.getQuotaState();
  assert.equal(state.used, 980);
});

test('quota headers on a response are persisted as the new snapshot', async () => {
  const transport = fakeTransport(() => ({
    data: { body: {} },
    headers: { 'x-ratelimit-requests-limit': '1000', 'x-ratelimit-requests-remaining': '412' },
  }));
  const { client, store } = clientWith({ transport });
  await client.get('/getNFLBoxScore', { priority: 'essential' });
  assert.equal(store.snapshot.limit, 1000);
  assert.equal(store.snapshot.remaining, 412);
  const state = await client.getQuotaState();
  assert.equal(state.used, 588); // 1000 - 412, straight from the provider
});

test('parseQuotaHeaders tolerates missing or unparsable headers', () => {
  assert.deepEqual(parseQuotaHeaders(undefined), { limit: null, remaining: null });
  assert.deepEqual(parseQuotaHeaders({ 'x-ratelimit-requests-limit': 'n/a' }), {
    limit: null,
    remaining: null,
  });
});

// --- counting ----------------------------------------------------------------

test('each call increments its own endpoint/day counter', async () => {
  const transport = fakeTransport();
  const { client, store } = clientWith({ transport });
  await client.get('/getNFLBoxScore', { priority: 'essential' });
  await client.get('/getNFLBoxScore', { priority: 'essential' });
  await client.get('/getNFLNews', { priority: 'low' });
  assert.equal(store.calls.get(`getNFLBoxScore|${utcDay(NOW)}`), 2);
  assert.equal(store.calls.get(`getNFLNews|${utcDay(NOW)}`), 1);
  assert.equal((await client.getQuotaState()).used, 3);
});

test('a failed request still counts — RapidAPI charged for the attempt', async () => {
  const transport = fakeTransport(() => {
    const err = new Error('boom');
    err.response = { status: 500, headers: {} };
    throw err;
  });
  const { client, store } = clientWith({ transport });
  await assert.rejects(() => client.get('/getNFLBoxScore', { priority: 'essential' }), /boom/);
  assert.equal(store.total(), 1);
});

test('an injected per-call transport bypasses the counter entirely', async () => {
  const injected = fakeTransport();
  const { client, store } = clientWith({ usedThisCycle: 1005 }); // even fully blocked
  const response = await client.get('/getNFLBoxScore', { priority: 'essential', transport: injected });
  assert.ok(response);
  assert.equal(injected.seen.length, 1);
  assert.equal(store.total(), 1005); // unchanged: only the seeded row
});

test('endpointKey strips the leading slash and any query string', () => {
  assert.equal(endpointKey('/getNFLBoxScore'), 'getNFLBoxScore');
  assert.equal(endpointKey('getNFLNews?fantasyNews=true'), 'getNFLNews');
  assert.equal(endpointKey(''), 'unknown');
});

// --- 429 backoff -------------------------------------------------------------

test('retryAfterMs: honors Retry-After on a 429, ignores other statuses', () => {
  assert.equal(retryAfterMs({ response: { status: 429, headers: { 'retry-after': '7' } } }), 7000);
  assert.equal(retryAfterMs({ response: { status: 429, headers: {} } }), 30_000);
  assert.equal(retryAfterMs({ response: { status: 429, headers: { 'retry-after': '999' } } }), 120_000);
  assert.equal(retryAfterMs({ response: { status: 500, headers: {} } }), null);
  assert.equal(retryAfterMs(new Error('no response')), null);
});

test('a 429 backs off every subsequent caller, not just the one that hit it', async () => {
  let hits = 0;
  const transport = fakeTransport(() => {
    hits += 1;
    const err = new Error('rate limited');
    err.response = { status: 429, headers: { 'retry-after': '30' } };
    throw err;
  });
  const { client } = clientWith({ transport });

  await assert.rejects(() => client.get('/getNFLBoxScore', { priority: 'essential' }), /rate limited/);
  assert.equal(hits, 1);

  // A different call site, different priority: still short-circuited locally.
  await assert.rejects(
    () => client.get('/getNFLScoresOnly', { priority: 'standard' }),
    (err) => {
      assert.equal(err.response.status, 429); // shaped so the recap queue requeues
      assert.equal(err.code, 'TANK01_BACKOFF');
      return true;
    }
  );
  assert.equal(hits, 1); // no second upstream request during the backoff
  assert.ok(client.backoffUntil > Date.now());

  client.reset();
  assert.equal(client.backoffUntil, 0);
});

test('backoff short-circuits are not counted as spend', async () => {
  const transport = fakeTransport(() => {
    const err = new Error('rate limited');
    err.response = { status: 429, headers: { 'retry-after': '30' } };
    throw err;
  });
  const { client, store } = clientWith({ transport });
  await assert.rejects(() => client.get('/getNFLBoxScore', { priority: 'essential' }));
  await assert.rejects(() => client.get('/getNFLBoxScore', { priority: 'essential' }));
  assert.equal(store.total(), 1); // only the request that actually went out
});

// --- memoization -------------------------------------------------------------

test('quota state is memoized between calls but refreshed after spend', async () => {
  const transport = fakeTransport();
  const { client, store } = clientWith({ transport });
  let reads = 0;
  const originalRead = store.readUsage.bind(store);
  store.readUsage = async (args) => {
    reads += 1;
    return originalRead(args);
  };
  await client.getQuotaState();
  await client.getQuotaState();
  assert.equal(reads, 1, 'second read came from the memo');
  await client.get('/getNFLNews', { priority: 'low' });
  const state = await client.getQuotaState();
  assert.equal(reads, 2, 'the counted call invalidated the memo, forcing one fresh read');
  assert.equal(state.used, 1);
});
