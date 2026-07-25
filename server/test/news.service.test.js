const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNewsItems, MAX_ITEMS } = require('../services/news.service');

test('normalizeNewsItems keeps only title and link', () => {
  const out = normalizeNewsItems([
    { title: 'Headline one', link: 'https://example.com/one', extra: 'ignored' },
    { title: 'Headline two', link: 'https://example.com/two' },
  ]);
  assert.deepEqual(out, [
    { title: 'Headline one', link: 'https://example.com/one' },
    { title: 'Headline two', link: 'https://example.com/two' },
  ]);
});

test('normalizeNewsItems caps the list at MAX_ITEMS', () => {
  const items = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({
    title: `Headline ${i}`,
    link: `https://example.com/${i}`,
  }));
  assert.equal(normalizeNewsItems(items).length, MAX_ITEMS);
});

test('normalizeNewsItems tolerates a missing/empty payload', () => {
  assert.deepEqual(normalizeNewsItems(null), []);
  assert.deepEqual(normalizeNewsItems(undefined), []);
  assert.deepEqual(normalizeNewsItems([]), []);
});

// ---- caching + stale-serve --------------------------------------------------
//
// GET /api/news used to hit Tank01 on every request, and the dashboard mounts
// the widget every visit — the quietest quota leak in the app. One fetch now
// serves a 6h window, and a shed or failed fetch serves the last good payload
// instead of a 5xx.

const news = require('../services/news.service');
const tank01Client = require('../modules/tank01Client');

function stubTransport(items, { fail } = {}) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async get() {
      calls += 1;
      if (fail) throw fail;
      return { data: { statusCode: 200, body: items } };
    },
  };
}

const ITEMS = [
  { title: 'Headline one', link: 'https://example.com/one' },
  { title: 'Headline two', link: 'https://example.com/two' },
];

test('two dashboard loads inside the TTL cost exactly one upstream call', async () => {
  news.__resetNewsCache();
  const transport = stubTransport(ITEMS);
  const first = await news.getLatestNews({ transport });
  const second = await news.getLatestNews({ transport });
  assert.deepEqual(first, ITEMS);
  assert.deepEqual(second, ITEMS);
  assert.equal(transport.calls, 1);
});

test('an expired cache refetches', async () => {
  news.__resetNewsCache();
  const prev = process.env.NEWS_CACHE_TTL_MS;
  process.env.NEWS_CACHE_TTL_MS = '1';
  try {
    const transport = stubTransport(ITEMS);
    await news.getLatestNews({ transport });
    await new Promise((r) => setTimeout(r, 5));
    await news.getLatestNews({ transport });
    assert.equal(transport.calls, 2);
  } finally {
    if (prev === undefined) delete process.env.NEWS_CACHE_TTL_MS;
    else process.env.NEWS_CACHE_TTL_MS = prev;
  }
});

test('an upstream failure serves the last good payload, not an error', async () => {
  news.__resetNewsCache();
  const prev = process.env.NEWS_CACHE_TTL_MS;
  process.env.NEWS_CACHE_TTL_MS = '1'; // force the second call past the TTL
  try {
    await news.getLatestNews({ transport: stubTransport(ITEMS) });
    await new Promise((r) => setTimeout(r, 5));
    const boom = stubTransport(null, { fail: new Error('upstream 502') });
    const served = await news.getLatestNews({ transport: boom });
    assert.equal(boom.calls, 1, 'it did try');
    assert.deepEqual(served, ITEMS, 'and fell back to the last good payload');
  } finally {
    if (prev === undefined) delete process.env.NEWS_CACHE_TTL_MS;
    else process.env.NEWS_CACHE_TTL_MS = prev;
  }
});

test('a quota block on low priority still serves stale headlines', async () => {
  news.__resetNewsCache();
  const prev = process.env.NEWS_CACHE_TTL_MS;
  process.env.NEWS_CACHE_TTL_MS = '1'; // prime, then let the fresh window lapse
  await news.getLatestNews({ transport: stubTransport(ITEMS) });
  // What the gate actually throws once 'low' is out of budget (the gating
  // thresholds themselves are covered in tank01Client.test.js).
  const blocked = stubTransport(null, {
    fail: new tank01Client.QuotaExhaustedError('quota degraded', {
      mode: 'degraded', used: 800, budget: 950, hardCeiling: 1000, priority: 'low',
    }),
  });
  try {
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(await news.getLatestNews({ transport: blocked }), ITEMS);
    assert.equal(blocked.calls, 1);
  } finally {
    if (prev === undefined) delete process.env.NEWS_CACHE_TTL_MS;
    else process.env.NEWS_CACHE_TTL_MS = prev;
  }
});

test('with nothing cached at all, the error surfaces', async () => {
  news.__resetNewsCache();
  const boom = stubTransport(null, { fail: new Error('upstream 502') });
  await assert.rejects(() => news.getLatestNews({ transport: boom }), /upstream 502/);
});
