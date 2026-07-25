/**
 * Fantasy NFL headlines for the dashboard widget.
 *
 * This was the quietest quota leak in the app: `GET /api/news` called Tank01's
 * `/getNFLNews` on EVERY request, and UserPage fetches it on every dashboard
 * mount — so a handful of users tabbing around could out-spend a whole Sunday
 * of live scoring against a ~1,000-request MONTHLY plan.
 *
 * Now one upstream fetch serves a 6-hour window, cached in Redis so the web
 * process's instances share it (in-memory fallback for dev, where there's no
 * Redis). Headlines are 'low' priority in modules/tank01Client, meaning they're
 * the first thing shed as the budget tightens — so the last good payload is
 * kept WITHOUT expiry and served stale on a quota block or an upstream error,
 * rather than turning a nice-to-have widget into a 5xx.
 */
const { tank01Body } = require('./scoring.service');
const { tank01Get } = require('../modules/tank01Client');
const { getRedisClient } = require('../modules/redis');

const MAX_ITEMS = 6;
const CACHE_KEY = 'news:latest';
const STALE_KEY = 'news:last-good'; // no TTL — the stale-serve safety net

function cacheTtlMs() {
  const parsed = Number(process.env.NEWS_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6 * 60 * 60 * 1000;
}

// Dev/no-Redis fallback. Process-local, which is fine: it's a strictly weaker
// version of the same cache, and it still collapses repeated dashboard mounts.
const memory = { fresh: null, freshUntil: 0, lastGood: null };

// Trim Tank01's getNFLNews payload down to what the dashboard widget needs,
// in case the upstream shape grows extra fields later.
function normalizeNewsItems(items) {
  return (items || []).slice(0, MAX_ITEMS).map((item) => ({ title: item.title, link: item.link }));
}

async function redis() {
  try {
    return await getRedisClient();
  } catch (err) {
    return null; // Redis down is not a reason to fail a headline request
  }
}

function parseItems(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

/** Cached-and-fresh payload, or null. */
async function readFresh() {
  const client = await redis();
  if (client) return parseItems(await client.get(CACHE_KEY).catch(() => null));
  if (memory.fresh && Date.now() < memory.freshUntil) return memory.fresh;
  return null;
}

/** Last known good payload regardless of age, or null. */
async function readStale() {
  const client = await redis();
  if (client) {
    const items = parseItems(await client.get(STALE_KEY).catch(() => null));
    if (items) return items;
  }
  return memory.lastGood;
}

async function write(items) {
  const payload = JSON.stringify(items);
  memory.fresh = items;
  memory.freshUntil = Date.now() + cacheTtlMs();
  memory.lastGood = items;
  const client = await redis();
  if (!client) return;
  try {
    await client.set(CACHE_KEY, payload, { PX: cacheTtlMs() });
    await client.set(STALE_KEY, payload); // deliberately no expiry
  } catch (err) {
    console.error('news cache write failed:', err.message);
  }
}

/**
 * Fantasy-relevant NFL headlines from Tank01 (same RapidAPI subscription
 * already used for live scoring — no separate key). Cached for
 * NEWS_CACHE_TTL_MS; serves the last good payload if the upstream call fails or
 * is shed for quota.
 *
 * @param {{transport?: object}} [deps] injectable Tank01 client for tests
 */
async function getLatestNews({ transport } = {}) {
  const cached = await readFresh();
  if (cached) return cached;

  try {
    // 'low' priority — headlines are shed first when quota gets tight.
    const response = await tank01Get('/getNFLNews', {
      params: { fantasyNews: true, maxItems: MAX_ITEMS },
      priority: 'low',
      transport,
    });
    const items = normalizeNewsItems(tank01Body(response.data));
    await write(items);
    return items;
  } catch (err) {
    const stale = await readStale();
    if (stale) {
      console.warn('news: serving stale headlines (%s)', err.message);
      return stale;
    }
    throw err;
  }
}

/** Test/ops helper: forget everything cached in this process. */
function __resetNewsCache() {
  memory.fresh = null;
  memory.freshUntil = 0;
  memory.lastGood = null;
}

module.exports = { getLatestNews, normalizeNewsItems, __resetNewsCache, MAX_ITEMS, CACHE_KEY, STALE_KEY };
