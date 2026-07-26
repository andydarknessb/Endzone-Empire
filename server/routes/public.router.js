/**
 * Public Layer API — the ONLY unauthenticated data router in the app.
 *
 * Mounted at /api/public. Deliberately has NO requireAuth anywhere: every
 * endpoint serves global, league-free NFL data for the no-login top-of-funnel
 * pages (rankings, player profiles, game recaps). Guardrails:
 *
 *  - Its own rate limiter instance (separate from the app-wide /api limiter),
 *    keyed by IP, so public traffic can't exhaust the authed budget and vice
 *    versa.
 *  - Cache-Control on every response (these are CDN-cacheable).
 *  - All data goes through publicRead.service serializers — no league/user
 *    fields ever reach the response (enforced by the leak test).
 *  - Strict input validation: integer regex, position whitelist, 400/404 JSON.
 */
const express = require('express');
const { createRateLimiter } = require('../modules/rateLimit');
const {
  POSITION_WHITELIST,
  getRankings,
  getPlayerProfile,
  getDraftPool,
  listRecaps,
  getRecap,
} = require('../services/publicRead.service');
const {
  getSitemapEntries,
  buildSitemapXml,
} = require('../services/publicSitemap.service');

const router = express.Router();

// Public-only limiter: generous (public pages fan out several reads) but its
// own store, keyed by IP since there is no authenticated user here.
const publicLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => req.ip,
});
router.use(publicLimiter);

const LIST_CACHE = 'public, max-age=60, s-maxage=300';
const DETAIL_CACHE = 'public, max-age=300, s-maxage=3600';
const SITEMAP_CACHE = 'public, max-age=300, s-maxage=3600';

// Short-lived in-memory cache for the expensive rankings query (same TTL-cache
// pattern as player.router.js). Keyed by the normalized query params.
const RANKINGS_TTL_MS = 60_000;
const rankingsCache = new Map();
function rankingsCacheGet(key) {
  const hit = rankingsCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    rankingsCache.delete(key);
    return null;
  }
  return hit.value;
}
function rankingsCacheSet(key, value) {
  if (rankingsCache.size > 500) rankingsCache.clear();
  rankingsCache.set(key, { value, expires: Date.now() + RANKINGS_TTL_MS });
}

// The draft pool is a bulk read (one window function + one rollup fan-out) that
// every mock draft opens with, and it changes at most once a day, so it gets a
// much longer module TTL than rankings. Two entries at most (idp on/off).
const DRAFT_POOL_TTL_MS = 600_000;
const draftPoolCache = new Map();
function draftPoolCacheGet(key) {
  const hit = draftPoolCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    draftPoolCache.delete(key);
    return null;
  }
  return hit.value;
}
function draftPoolCacheSet(key, value) {
  draftPoolCache.set(key, { value, expires: Date.now() + DRAFT_POOL_TTL_MS });
}

// Validate an optional positive-integer query param. Returns { ok, value } —
// value is undefined when the param was absent.
function optionalInt(raw) {
  if (raw === undefined || raw === '') return { ok: true, value: undefined };
  const str = String(raw);
  if (!/^\d+$/.test(str)) return { ok: false };
  const value = Number(str);
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

// GET /api/public/rankings?position=&season=&week=&limit=
router.get('/rankings', async (req, res) => {
  const position = req.query.position ? String(req.query.position).toUpperCase() : 'ALL';
  if (!POSITION_WHITELIST.includes(position)) {
    return res.status(400).json({ error: `position must be one of ${POSITION_WHITELIST.join(', ')}` });
  }
  const season = optionalInt(req.query.season);
  if (!season.ok) return res.status(400).json({ error: 'season must be a positive integer' });
  const week = optionalInt(req.query.week);
  if (!week.ok) return res.status(400).json({ error: 'week must be a positive integer' });
  const limit = optionalInt(req.query.limit);
  if (!limit.ok) return res.status(400).json({ error: 'limit must be a positive integer' });

  const cacheKey = `${position}|${season.value ?? ''}|${week.value ?? ''}|${limit.value ?? ''}`;
  const cached = rankingsCacheGet(cacheKey);
  if (cached) {
    res.set('Cache-Control', LIST_CACHE);
    return res.json(cached);
  }

  try {
    const payload = await getRankings({
      position,
      season: season.value,
      week: week.value,
      limit: limit.value,
    });
    rankingsCacheSet(cacheKey, payload);
    res.set('Cache-Control', LIST_CACHE);
    res.json(payload);
  } catch (error) {
    console.error('GET /api/public/rankings failed', error);
    res.status(500).json({ error: 'failed to fetch rankings' });
  }
});

// GET /api/public/draft-pool?idp=1 — bulk player pool for the client-side
// Draft Simulator (both the public page and the authed one read this).
router.get('/draft-pool', async (req, res) => {
  const raw = req.query.idp;
  let includeIdp = false;
  if (raw !== undefined && raw !== '') {
    const value = String(raw).toLowerCase();
    if (value === '1' || value === 'true') includeIdp = true;
    else if (value === '0' || value === 'false') includeIdp = false;
    else return res.status(400).json({ error: 'idp must be 0 or 1' });
  }

  const cacheKey = includeIdp ? 'idp' : 'base';
  const cached = draftPoolCacheGet(cacheKey);
  if (cached) {
    res.set('Cache-Control', DETAIL_CACHE);
    return res.json(cached);
  }

  try {
    const payload = await getDraftPool({ includeIdp });
    draftPoolCacheSet(cacheKey, payload);
    res.set('Cache-Control', DETAIL_CACHE);
    res.json(payload);
  } catch (error) {
    console.error('GET /api/public/draft-pool failed', error);
    res.status(500).json({ error: 'failed to fetch the draft pool' });
  }
});

// GET /api/public/players/:id
router.get('/players/:id', async (req, res) => {
  const playerId = optionalInt(req.params.id);
  if (!playerId.ok || playerId.value === undefined) {
    return res.status(400).json({ error: 'player id must be a positive integer' });
  }
  const season = optionalInt(req.query.season);
  if (!season.ok) return res.status(400).json({ error: 'season must be a positive integer' });
  try {
    const profile = await getPlayerProfile(playerId.value, { season: season.value });
    if (!profile) return res.status(404).json({ error: 'player not found' });
    res.set('Cache-Control', DETAIL_CACHE);
    res.json(profile);
  } catch (error) {
    console.error('GET /api/public/players/:id failed', error);
    res.status(500).json({ error: 'failed to fetch player' });
  }
});

// GET /api/public/recaps?season=&week=&limit=
router.get('/recaps', async (req, res) => {
  const season = optionalInt(req.query.season);
  if (!season.ok) return res.status(400).json({ error: 'season must be a positive integer' });
  const week = optionalInt(req.query.week);
  if (!week.ok) return res.status(400).json({ error: 'week must be a positive integer' });
  const limit = optionalInt(req.query.limit);
  if (!limit.ok) return res.status(400).json({ error: 'limit must be a positive integer' });

  try {
    const recaps = await listRecaps({ season: season.value, week: week.value, limit: limit.value });
    res.set('Cache-Control', LIST_CACHE);
    res.json({ recaps });
  } catch (error) {
    console.error('GET /api/public/recaps failed', error);
    res.status(500).json({ error: 'failed to fetch recaps' });
  }
});

// Netlify proxies the apex /sitemap.xml path here before its SPA fallback.
// The result contains concrete static pages plus current public player and
// recap detail URLs; it never reads user- or league-scoped data.
router.get('/sitemap.xml', async (_req, res) => {
  try {
    const entries = await getSitemapEntries();
    res.set('Cache-Control', SITEMAP_CACHE);
    res.type('application/xml').send(buildSitemapXml(entries));
  } catch (error) {
    console.error('GET /api/public/sitemap.xml failed', error);
    res
      .status(500)
      .type('application/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?><error>failed to build sitemap</error>');
  }
});

// GET /api/public/recaps/:gameId — Tank01 game ids are alphanumeric with
// underscores/@ (e.g. "20240908_KC@BAL"); validate against that shape.
router.get('/recaps/:gameId', async (req, res) => {
  if (!/^[A-Za-z0-9_@.-]{1,40}$/.test(req.params.gameId)) {
    return res.status(400).json({ error: 'invalid game id' });
  }
  try {
    const recap = await getRecap(req.params.gameId);
    if (!recap) return res.status(404).json({ error: 'recap not found' });
    res.set('Cache-Control', DETAIL_CACHE);
    res.json(recap);
  } catch (error) {
    console.error('GET /api/public/recaps/:gameId failed', error);
    res.status(500).json({ error: 'failed to fetch recap' });
  }
});

module.exports = router;
