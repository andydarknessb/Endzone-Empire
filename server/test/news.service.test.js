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

// ESPN's unauthenticated NFL news document (site.api.espn.com/apis/site/v2/
// sports/football/nfl/news): articles carry headline, description, published
// and links.web.href. The stub serves one and records the URL it was asked for.
function stubTransport(articles, { fail } = {}) {
  let calls = 0;
  const urls = [];
  return {
    get calls() {
      return calls;
    },
    urls,
    async get(url) {
      calls += 1;
      urls.push(url);
      if (fail) throw fail;
      return { data: { header: 'NFL News', articles } };
    },
  };
}

const ARTICLES = [
  {
    headline: 'Headline one',
    description: 'Blurb one',
    published: '2026-10-08T12:00:00Z',
    links: { web: { href: 'https://example.com/one' } },
  },
  {
    headline: 'Headline two',
    published: '2026-10-08T11:00:00Z',
    links: { web: { href: 'https://example.com/two' } },
  },
];
const ITEMS = [
  { title: 'Headline one', link: 'https://example.com/one' },
  { title: 'Headline two', link: 'https://example.com/two' },
];

test('headlines come from ESPN with zero Tank01 calls, in the existing {title, link} shape', async (t) => {
  news.__resetNewsCache();
  const tank01 = t.mock.method(tank01Client, 'tank01Get', async () => {
    throw new Error('Tank01 must not be called');
  });
  const transport = stubTransport(ARTICLES);
  assert.deepEqual(await news.getLatestNews({ transport }), ITEMS);
  assert.equal(transport.urls[0], 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news');
  assert.equal(tank01.mock.callCount(), 0);
});

test('articles without a headline or link are dropped, and the list caps at MAX_ITEMS', async () => {
  news.__resetNewsCache();
  const many = Array.from({ length: MAX_ITEMS + 3 }, (_, i) => ({
    headline: `H${i}`,
    links: { web: { href: `https://example.com/${i}` } },
  }));
  const junk = [{ description: 'no headline' }, { headline: 'no link' }];
  const out = await news.getLatestNews({ transport: stubTransport([...junk, ...many]) });
  assert.equal(out.length, MAX_ITEMS);
  assert.equal(out[0].title, 'H0');
});

test('two dashboard loads inside the TTL cost exactly one upstream call', async () => {
  news.__resetNewsCache();
  const transport = stubTransport(ARTICLES);
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
    const transport = stubTransport(ARTICLES);
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
    await news.getLatestNews({ transport: stubTransport(ARTICLES) });
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

test('an ESPN block (403) still serves stale headlines', async () => {
  news.__resetNewsCache();
  const prev = process.env.NEWS_CACHE_TTL_MS;
  process.env.NEWS_CACHE_TTL_MS = '1'; // prime, then let the fresh window lapse
  await news.getLatestNews({ transport: stubTransport(ARTICLES) });
  const blocked = stubTransport(null, { fail: new Error('Request failed with status code 403') });
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

// ---- #1188: game-day cadence --------------------------------------------------

test('on a game day the cache TTL is one hour; otherwise six', () => {
  const prevDay = process.env.NEWS_CACHE_TTL_GAME_DAY_MS;
  const prev = process.env.NEWS_CACHE_TTL_MS;
  delete process.env.NEWS_CACHE_TTL_GAME_DAY_MS;
  delete process.env.NEWS_CACHE_TTL_MS;
  try {
    assert.equal(news.cacheTtlMs({ gameDay: true }), 60 * 60 * 1000);
    assert.equal(news.cacheTtlMs({ gameDay: false }), 6 * 60 * 60 * 1000);
    assert.equal(news.cacheTtlMs(), 6 * 60 * 60 * 1000);
    process.env.NEWS_CACHE_TTL_GAME_DAY_MS = '1234';
    assert.equal(news.cacheTtlMs({ gameDay: true }), 1234, 'env-tunable');
  } finally {
    if (prevDay === undefined) delete process.env.NEWS_CACHE_TTL_GAME_DAY_MS; else process.env.NEWS_CACHE_TTL_GAME_DAY_MS = prevDay;
    if (prev === undefined) delete process.env.NEWS_CACHE_TTL_MS; else process.env.NEWS_CACHE_TTL_MS = prev;
  }
});

test('a game-day fetch is cached for the game-day TTL, so the second load inside it costs nothing and a load past it refetches', async () => {
  news.__resetNewsCache();
  const prevDay = process.env.NEWS_CACHE_TTL_GAME_DAY_MS;
  process.env.NEWS_CACHE_TTL_GAME_DAY_MS = '1'; // one millisecond: the window lapses at once
  try {
    const transport = stubTransport(ARTICLES);
    await news.getLatestNews({ transport, gameDay: true });
    await new Promise((r) => setTimeout(r, 5));
    await news.getLatestNews({ transport, gameDay: true });
    assert.equal(transport.calls, 2, 'the game-day TTL, not the six-hour one, governed the cache');
  } finally {
    if (prevDay === undefined) delete process.env.NEWS_CACHE_TTL_GAME_DAY_MS; else process.env.NEWS_CACHE_TTL_GAME_DAY_MS = prevDay;
  }
});

test('isGameDay reads nfl_games for the ET day and memoises the answer for that day', async () => {
  news.__resetNewsCache();
  let queries = 0;
  const db = { query: async () => { queries += 1; return { rows: [{ '?column?': 1 }] }; } };
  const now = new Date('2026-09-13T17:00:00Z');
  assert.equal(await news.isGameDay({ now, db }), true);
  assert.equal(await news.isGameDay({ now, db }), true);
  assert.equal(queries, 1, 'one read per day');
});
