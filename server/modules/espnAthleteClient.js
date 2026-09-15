/**
 * ESPN's unofficial, keyless athlete/fantasy endpoints (#1308, ADR 0041): the
 * one facts source for a player's bio, injury detail, news, depth-chart rank
 * and Ownership. Plain axios, never through `tank01Client` (ADR 0041), same
 * precedent as `espnScoreboard.js`. Server side only.
 *
 * `players.external_id` is already the ESPN athlete id (ADR 0035:15), so no
 * id mapping is needed for `profile`/`overview`. `teamDepthChart` takes OUR
 * canonical Team code (`nflTeam.js`'s output, e.g. `WAS` not `WSH`) and maps
 * it to ESPN's core-API numeric team id, which the depth-chart endpoint
 * requires (`ESPN_TEAM_NUMERIC_ID` below).
 *
 * Caching (ADR 0041 amendment, #1308 Ruling item 1): `profile` and `overview`
 * are called on every card open, so each is an in-process TTL map keyed by
 * kind + athlete id, the `summaryCache` shape `player.router.js` already
 * uses (`{ value, expires }`, bounded past 2000 entries) - a success held six
 * hours, a failure (403, timeout, non-JSON, missing id) held five minutes as
 * a `null` entry so a blocked host is not re-fetched on every card open.
 * `teamDepthChart` and `ownership` are called once a day each by the Sync
 * jobs in `espnFactsSync.js`, never per card open, so neither is cached here
 * at all - the daily `player_depth_chart`/`player_ownership` tables ARE the
 * cache (Ruling item 1).
 */
const axios = require('axios');

const ESPN_TIMEOUT_MS = Number(process.env.ESPN_TIMEOUT_MS) || 10000;
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000; // six hours
const FAILURE_TTL_MS = 5 * 60 * 1000; // five minutes

// A browser UA + referer (#1308 Ruling item 2): ESPN's site-web-api athlete
// endpoints 403 a bare server-side axios request with no headers at all.
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Referer: 'https://www.espn.com/',
};

const ATHLETE_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes';
// ESPN's core API needs a numeric team id AND an explicit season segment
// (`.../teams/{id}/depthcharts` with no season 404s - confirmed by capture,
// see server/test/fixtures/espn/README.md).
const DEPTH_CHART_SEASON = Number(process.env.ESPN_DEPTH_CHART_SEASON) || new Date().getUTCFullYear();
const depthChartUrl = (numericTeamId) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${DEPTH_CHART_SEASON}` +
  `/teams/${numericTeamId}/depthcharts`;
const FANTASY_PLAYER_INFO_URL = (season) =>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/1`;

/**
 * OUR canonical Team code (nflTeam.js's `normalizeNflTeam` output) -> ESPN's
 * core-API numeric team id. Verified against
 * `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams` (all 32
 * teams, #1308). Stable across relocations (ESPN keeps the old franchise's
 * numeric id) - LV kept OAK's 13, LAC kept SD's 24, LAR kept STL's 14.
 */
const ESPN_TEAM_NUMERIC_ID = Object.freeze({
  ATL: 1, BUF: 2, CHI: 3, CIN: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GB: 9, TEN: 10,
  IND: 11, KC: 12, LV: 13, LAR: 14, MIA: 15, MIN: 16, NE: 17, NO: 18, NYG: 19, NYJ: 20,
  PHI: 21, ARI: 22, PIT: 23, LAC: 24, SF: 25, SEA: 26, TB: 27, WAS: 28, CAR: 29, JAX: 30,
  BAL: 33, HOU: 34,
});

const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  if (cache.size > 2000) cache.clear();
  cache.set(key, { value, expires: Date.now() + ttlMs });
}

function client(transport) {
  return transport || axios;
}

/** Pure: the trailing numeric id off an ESPN core-API `$ref` URL, or null. */
function refId(ref) {
  const href = ref && typeof ref === 'object' ? ref.$ref : ref;
  if (!href) return null;
  const match = String(href).match(/\/(\d+)(?:\?[^/]*)?$/);
  return match ? match[1] : null;
}

/**
 * Pure: an athlete v3 profile payload -> `{ age, height, weight, college,
 * experience, draft }` (#1308 Ruling item 4), each null when ESPN's own
 * payload doesn't carry it. ESPN reports height/weight/experience/draft as
 * display strings, not structured numbers - reported verbatim rather than
 * re-parsed into a shape ESPN itself doesn't offer.
 */
function normalizeBio(payload) {
  const athlete = payload && payload.athlete;
  if (!athlete) return null;
  return {
    age: typeof athlete.age === 'number' ? athlete.age : null,
    height: athlete.displayHeight || null,
    weight: athlete.displayWeight || null,
    college: (athlete.college && athlete.college.name) || null,
    experience: athlete.displayExperience || null,
    draft: athlete.displayDraft || null,
  };
}

/**
 * Pure: an athlete overview payload's `news[]` -> our News shape
 * (CONTEXT.md) `{ headline, source, publishedAt, url }`, newest first as
 * ESPN already orders it. Empty array, never
 * null, when ESPN reports none - `getPlayerCard` supplies the feed-note
 * fallback itself (ADR 0041/CONTEXT.md "News").
 */
function normalizeEspnNews(payload) {
  const news = payload && Array.isArray(payload.news) ? payload.news : [];
  return news
    .filter((item) => item && item.headline)
    .map((item) => ({
      headline: String(item.headline),
      source: 'espn',
      publishedAt: item.lastModified || item.categorized || null,
      // The story itself: ESPN's web link, so the card can make the headline
      // clickable. null (never undefined) when an item carries no links block.
      url: (item.links && item.links.web && item.links.web.href) || null,
    }));
}

/**
 * Pure: an athlete overview payload's `injuries[]` -> `{ type, practiceNote,
 * expectedReturn }` for the most recent entry, or null when ESPN reports no
 * current injury (#1308 Ruling item 4/owner answer 3) - `injury.designation`
 * stays the feed sync's; this is only the sibling detail ESPN adds beside it.
 */
function normalizeInjuryFacts(payload) {
  const injuries = payload && Array.isArray(payload.injuries) ? payload.injuries : [];
  const latest = injuries[0];
  if (!latest) return null;
  const details = latest.details || {};
  const practiceNote = latest.shortComment || latest.longComment || latest.status || null;
  const type = details.type || latest.type || null;
  const expectedReturn = details.returnDate || latest.date || null;
  if (!type && !practiceNote && !expectedReturn) return null;
  return { type: type || null, practiceNote: practiceNote || null, expectedReturn: expectedReturn || null };
}

/**
 * Pure: one team's core-API depth-chart document -> a flat array of `{
 * athleteId, teamCode, positionGroup, rank }`, one entry per athlete per
 * chart slot (a player can appear more than once across formations/slots -
 * the sync job's `ON CONFLICT (player_id, captured_date) DO NOTHING` keeps
 * only the first written today, so charts are read offense-first). The
 * athlete id is parsed off each slot's `$ref` (the document never inlines
 * it), never resolved by a second HTTP call per athlete (#1308 README).
 */
function normalizeDepthChart(payload, teamCode) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const rows = [];
  for (const chart of items) {
    const positions = (chart && chart.positions) || {};
    for (const key of Object.keys(positions)) {
      const entry = positions[key];
      const positionGroup = (entry && entry.position && (entry.position.abbreviation || entry.position.name)) || null;
      const athletes = (entry && Array.isArray(entry.athletes)) ? entry.athletes : [];
      for (const slot of athletes) {
        const athleteId = refId(slot && slot.athlete);
        if (!athleteId) continue;
        rows.push({
          athleteId,
          teamCode,
          positionGroup: positionGroup ? String(positionGroup).slice(0, 20) : null,
          rank: typeof slot.rank === 'number' ? slot.rank : null,
        });
      }
    }
  }
  return rows;
}

/**
 * Pure: a fantasy `kona_player_info` payload -> `{ athleteId, percentOwned,
 * percentStarted, percentChange }[]`, one per `players[]` entry that carries
 * an `ownership` block. No `draftRanksByRankType`/`rankings`/projection field
 * is ever read here (ADR 0041, #1308 red-tell).
 */
function normalizeOwnership(payload) {
  const players = payload && Array.isArray(payload.players) ? payload.players : [];
  const rows = [];
  for (const entry of players) {
    const player = entry && entry.player;
    const ownership = player && player.ownership;
    const athleteId = player && player.id != null ? String(player.id) : (entry.id != null ? String(entry.id) : null);
    if (!athleteId || !ownership) continue;
    rows.push({
      athleteId,
      percentOwned: typeof ownership.percentOwned === 'number' ? ownership.percentOwned : null,
      percentStarted: typeof ownership.percentStarted === 'number' ? ownership.percentStarted : null,
      percentChange: typeof ownership.percentChange === 'number' ? ownership.percentChange : null,
    });
  }
  return rows;
}

/** Shared GET, resolving null (never throwing) on any failure - a 403, a
 * timeout, or a non-JSON body all read the same to a caller: ESPN has no
 * usable answer right now. */
async function getJson(transport, url, { params, headers } = {}) {
  try {
    const response = await client(transport).get(url, {
      timeout: ESPN_TIMEOUT_MS,
      params,
      headers: { ...BROWSER_HEADERS, ...headers },
    });
    return response && typeof response.data === 'object' ? response.data : null;
  } catch (err) {
    return null;
  }
}

// In-flight fetches per cache key (#1308 risk review): without this, two
// concurrent card opens for the same cold athlete both miss the cache and
// both call ESPN, and whichever settles LAST wins the write - a slow failure
// (cached 5 min) can then overwrite a fresh success (meant to stand 6h),
// cutting its real life by up to 72x. Coalescing to one in-flight promise per
// key means at most one fetch is ever running for it, so there is nothing
// left to race: the single result is the only thing `cacheSet` ever writes.
const inFlight = new Map();

async function cachedFetch(kind, id, transport, fetchFn) {
  const key = `${kind}:${id}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const value = await fetchFn();
      cacheSet(key, value, value === null ? FAILURE_TTL_MS : SUCCESS_TTL_MS);
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

/** `{ age, height, weight, college, experience, draft } | null`, cached six
 * hours on success / five minutes on failure. `null` for a missing id. */
async function profile(athleteId, { transport } = {}) {
  if (athleteId == null || athleteId === '') return null;
  return cachedFetch('profile', athleteId, transport, async () => {
    const payload = await getJson(transport, `${ATHLETE_BASE}/${athleteId}`);
    return payload ? normalizeBio(payload) : null;
  });
}

/** `{ news: [...], injuryFacts: {...}|null } | null`, same cache rule as
 * `profile`. `null` for a missing id. */
async function overview(athleteId, { transport } = {}) {
  if (athleteId == null || athleteId === '') return null;
  return cachedFetch('overview', athleteId, transport, async () => {
    const payload = await getJson(transport, `${ATHLETE_BASE}/${athleteId}/overview`);
    if (!payload) return null;
    return { news: normalizeEspnNews(payload), injuryFacts: normalizeInjuryFacts(payload) };
  });
}

/** This team's depth chart -> `{ athleteId, teamCode, positionGroup, rank
 * }[]` (never cached - see docblock above). `null` for an unknown team code
 * or any fetch failure (Ruling item 4: every export resolves null on 403,
 * timeout or a missing id) - `espnFactsSync.js`'s `fetchDepthCharts` is what
 * tells that apart from "ESPN answered, this team has nothing" (`[]`).
 * Never throws. */
async function teamDepthChart(teamCode, { transport } = {}) {
  const numericId = ESPN_TEAM_NUMERIC_ID[String(teamCode || '').toUpperCase()];
  if (!numericId) return null;
  const payload = await getJson(transport, depthChartUrl(numericId), { params: { lang: 'en', region: 'us' } });
  return payload ? normalizeDepthChart(payload, teamCode) : null;
}

/**
 * The whole pool's Ownership -> `{ athleteId, percentOwned, percentStarted,
 * percentChange }[]` (never cached). `season` is the fantasy season year
 * (`ESPN_FANTASY_SEASON` env, else the current UTC year). A high `limit`
 * sorted by percent owned, ESPN's own bulk-read shape for this endpoint,
 * since "the whole pool" has no per-athlete filter. `view=kona_player_info`
 * is REQUIRED (formal review f1): without it `leaguedefaults/1` answers 200
 * with no `players` key at all (verified live), so `normalizeOwnership`
 * silently returns `[]` forever - the same shape as a real empty pool, which
 * is exactly why this was never caught by a status-code check. `null` on any
 * fetch failure (Ruling item 4) - never throws.
 */
async function ownership({ transport, season } = {}) {
  const year = season || Number(process.env.ESPN_FANTASY_SEASON) || new Date().getUTCFullYear();
  const filter = { players: { limit: 4000, sortPercOwned: { sortAsc: false, sortPriority: 1 } } };
  const payload = await getJson(transport, FANTASY_PLAYER_INFO_URL(year), {
    params: { view: 'kona_player_info' },
    headers: { 'x-fantasy-filter': JSON.stringify(filter) },
  });
  return payload ? normalizeOwnership(payload) : null;
}

module.exports = {
  profile,
  overview,
  teamDepthChart,
  ownership,
  // pure - unit tested
  normalizeBio,
  normalizeEspnNews,
  normalizeInjuryFacts,
  normalizeDepthChart,
  normalizeOwnership,
  refId,
  ESPN_TEAM_NUMERIC_ID,
};
