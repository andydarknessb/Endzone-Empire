/**
 * Fantasy NFL headlines for the dashboard widget.
 *
 * `GET /api/news` used to call Tank01's `/getNFLNews` on EVERY request (the
 * quietest quota leak in the app; UserPage fetches it on every dashboard
 * mount). Headlines now come from ESPN's unauthenticated news document, which
 * spends no Tank01 quota (#2118: Tank01 is fallback and Final box only).
 *
 * One upstream fetch serves a 6-hour window, cached in Redis so the web
 * process's instances share it (in-memory fallback for dev, where there's no
 * Redis). The last good payload is kept WITHOUT expiry and served stale on an
 * upstream error, rather than turning a nice-to-have widget into a 5xx.
 */
const axios = require('axios');
const { getRedisClient } = require('../modules/redis');

const ESPN_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news';
const ESPN_TIMEOUT_MS = Number(process.env.ESPN_TIMEOUT_MS) || 10000;
const MAX_ITEMS = 6;
const CACHE_KEY = 'news:latest';
const STALE_KEY = 'news:last-good'; // no TTL — the stale-serve safety net

/**
 * How long one headline fetch serves: NEWS_CACHE_TTL_MS (6 h) most days,
 * NEWS_CACHE_TTL_GAME_DAY_MS (1 h) on a day with an NFL game (#1188). News stays
 * low priority, the first thing degraded quota sheds.
 */
function cacheTtlMs({ gameDay = false } = {}) {
  const read = (name, fallback) => {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return gameDay
    ? read('NEWS_CACHE_TTL_GAME_DAY_MS', 60 * 60 * 1000)
    : read('NEWS_CACHE_TTL_MS', 6 * 60 * 60 * 1000);
}

// One answer per ET calendar day: is there an NFL game today? Memoised so a
// dashboard mount costs no query after the first of the day.
const gameDayMemo = { day: null, value: false };

/**
 * Is today (US Eastern) a game day? Read from nfl_games' kickoffs; a read
 * failure answers false, which is the cheaper (6 h) cadence.
 *
 * @param {{ now?: Date, db?: { query: Function } }} [deps]
 */
async function isGameDay({ now = new Date(), db } = {}) {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (gameDayMemo.day === day) return gameDayMemo.value;
  let value = false;
  try {
    const pool = db || require('../modules/pool');
    const res = await pool.query(
      `SELECT 1 FROM "nfl_games"
        WHERE ("kickoff_at" AT TIME ZONE 'America/New_York')::date = $1::date
        LIMIT 1`,
      [day]
    );
    value = Boolean(res.rows[0]);
  } catch (err) {
    value = false;
  }
  gameDayMemo.day = day;
  gameDayMemo.value = value;
  return value;
}

// Dev/no-Redis fallback. Process-local, which is fine: it's a strictly weaker
// version of the same cache, and it still collapses repeated dashboard mounts.
const memory = { fresh: null, freshUntil: 0, lastGood: null };

// Trim headlines down to what the dashboard widget needs, in case the
// upstream shape grows extra fields later.
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

async function write(items, { ttlMs = cacheTtlMs() } = {}) {
  const payload = JSON.stringify(items);
  memory.fresh = items;
  memory.freshUntil = Date.now() + ttlMs;
  memory.lastGood = items;
  const client = await redis();
  if (!client) return;
  try {
    await client.set(CACHE_KEY, payload, { PX: ttlMs });
    await client.set(STALE_KEY, payload); // deliberately no expiry
  } catch (err) {
    console.error('news cache write failed:', err.message);
  }
}

// ESPN's NFL news document → [{ title, link }]. Articles missing either are
// dropped (normalizeNewsItems then caps the list).
function espnArticles(body) {
  return (body?.articles || [])
    .map((a) => ({ title: a.headline, link: a.links?.web?.href }))
    .filter((a) => a.title && a.link);
}

/**
 * NFL headlines from ESPN's unauthenticated news document (same family as the
 * scoreboard; no key, no Tank01 quota). Cached for NEWS_CACHE_TTL_MS; serves
 * the last good payload if the upstream call fails.
 *
 * @param {{transport?: object, gameDay?: boolean}} [deps] injectable axios-like
 *   client for tests; `gameDay` overrides the nfl_games read (tests inject)
 */
async function getLatestNews({ transport, gameDay } = {}) {
  const cached = await readFresh();
  if (cached) return cached;

  try {
    const response = await (transport || axios).get(ESPN_NEWS_URL, { timeout: ESPN_TIMEOUT_MS });
    const items = normalizeNewsItems(espnArticles(response.data));
    // An undocumented feed: a shape change must not cache [] and wipe the stale safety net.
    if (!items.length) throw new Error('ESPN news returned no usable articles');
    const onGameDay = gameDay === undefined ? await isGameDay() : Boolean(gameDay);
    await write(items, { ttlMs: cacheTtlMs({ gameDay: onGameDay }) });
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
  gameDayMemo.day = null;
  gameDayMemo.value = false;
}

module.exports = {
  getLatestNews,
  normalizeNewsItems,
  cacheTtlMs,
  isGameDay,
  __resetNewsCache,
  MAX_ITEMS,
  CACHE_KEY,
  STALE_KEY,
};
