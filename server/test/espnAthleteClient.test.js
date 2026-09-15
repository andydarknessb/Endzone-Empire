const test = require('node:test');
const assert = require('node:assert/strict');
const athleteProfileFixture = require('./fixtures/espn/athlete-profile.json');
const athleteOverviewFixture = require('./fixtures/espn/athlete-overview.json');
const teamDepthChartFixture = require('./fixtures/espn/team-depth-chart.json');
const fantasyPlayerInfoFixture = require('./fixtures/espn/fantasy-player-info.json');
const {
  profile,
  overview,
  teamDepthChart,
  ownership,
  normalizeBio,
  normalizeEspnNews,
  normalizeInjuryFacts,
  normalizeDepthChart,
  normalizeOwnership,
  refId,
  ESPN_TEAM_NUMERIC_ID,
} = require('../modules/espnAthleteClient');
const espnAthleteClient = require('../modules/espnAthleteClient');
const { createFakePool } = require('./helpers/fakePool');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const byeService = require('../services/bye.service');
const decisionCardContextService = require('../services/decisionCardContext.service');
const irPolicy = require('../services/irPolicy.service');
const { getPlayerCard } = require('../services/playerCard.service');

/** A fake axios-like transport: resolves/rejects per call, and counts calls. */
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    get: async (url, config) => {
      calls.push({ url, config });
      return handler(url, config);
    },
  };
}

function okResponse(data) {
  return { data };
}

function httpError(status) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status };
  return err;
}

// --- pure normalizers, against the real captured fixtures -------------------

test('normalizeBio: athlete-profile.json maps to bio', () => {
  const bio = normalizeBio(athleteProfileFixture);
  assert.equal(bio.age, 24);
  assert.equal(bio.height, `6' 4"`);
  assert.equal(bio.weight, '225 lbs');
  assert.equal(bio.college, 'North Carolina');
  assert.equal(bio.experience, '3rd Season');
  assert.equal(bio.draft, '2024: Rd 1, Pk 3 (NE)');
});

test('normalizeEspnNews: athlete-overview.json maps to news[] ordered newest first', () => {
  const news = normalizeEspnNews(athleteOverviewFixture);
  assert.ok(news.length > 0);
  assert.equal(news[0].source, 'espn');
  assert.ok(typeof news[0].headline === 'string' && news[0].headline.length > 0);
  const timestamps = news.map((n) => new Date(n.publishedAt).getTime());
  const sorted = [...timestamps].sort((a, b) => b - a);
  assert.deepEqual(timestamps, sorted, 'ESPN already orders news newest-first; we must not reorder it');
});

test('normalizeInjuryFacts: no injuries[] entry on the fixture -> null (healthy player)', () => {
  assert.equal(normalizeInjuryFacts(athleteOverviewFixture), null);
});

test('normalizeInjuryFacts: a synthetic injuries[] entry maps to type/practiceNote/expectedReturn', () => {
  const facts = normalizeInjuryFacts({
    injuries: [{
      status: 'Questionable',
      shortComment: 'Limited in practice Thursday.',
      details: { type: 'Ankle', returnDate: '2026-09-21' },
    }],
  });
  assert.deepEqual(facts, {
    type: 'Ankle',
    practiceNote: 'Limited in practice Thursday.',
    expectedReturn: '2026-09-21',
  });
});

test('normalizeInjuryFacts: absent injuries key -> null', () => {
  assert.equal(normalizeInjuryFacts({}), null);
  assert.equal(normalizeInjuryFacts(null), null);
});

test('refId: parses the trailing numeric id off a core-API $ref', () => {
  assert.equal(refId({ $ref: 'https://.../seasons/2025/athletes/4372030?lang=en&region=us' }), '4372030');
  assert.equal(refId('https://.../athletes/99'), '99');
  assert.equal(refId(null), null);
  assert.equal(refId({}), null);
});

test('normalizeDepthChart: team-depth-chart.json maps to flat {athleteId, teamCode, positionGroup, rank} rows', () => {
  const rows = normalizeDepthChart(teamDepthChartFixture, 'NE');
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.equal(row.teamCode, 'NE');
    assert.match(row.athleteId, /^\d+$/);
    assert.ok(row.positionGroup === null || typeof row.positionGroup === 'string');
    assert.ok(row.rank === null || typeof row.rank === 'number');
  }
});

test('normalizeOwnership: fantasy-player-info.json maps to {athleteId, percentOwned, percentStarted, percentChange}, no projection field reaches it', () => {
  const rows = normalizeOwnership(fantasyPlayerInfoFixture);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.athleteId, '4431452');
  assert.equal(typeof row.percentOwned, 'number');
  assert.equal(typeof row.percentStarted, 'number');
  assert.equal(typeof row.percentChange, 'number');
  assert.deepEqual(Object.keys(row).sort(), ['athleteId', 'percentChange', 'percentOwned', 'percentStarted']);
});

test('ESPN_TEAM_NUMERIC_ID: NE is 17, all 32 our-canonical codes are present', () => {
  assert.equal(ESPN_TEAM_NUMERIC_ID.NE, 17);
  assert.equal(Object.keys(ESPN_TEAM_NUMERIC_ID).length, 32);
  assert.equal(ESPN_TEAM_NUMERIC_ID.WAS, 28); // our canonical code, not ESPN's own WSH
});

// --- profile()/overview(): failure resolution + caching ---------------------

test('profile: a 403 resolves null, not a throw', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  const bio = await profile('9990001', { transport });
  assert.equal(bio, null);
});

test('profile: a timeout resolves null, not a throw', async () => {
  const transport = fakeTransport(() => { throw new Error('timeout of 10000ms exceeded'); });
  const bio = await profile('9990002', { transport });
  assert.equal(bio, null);
});

test('profile: a missing id resolves null with no transport call', async () => {
  const transport = fakeTransport(() => okResponse({ athlete: {} }));
  assert.equal(await profile(null, { transport }), null);
  assert.equal(await profile(undefined, { transport }), null);
  assert.equal(transport.calls.length, 0);
});

test('profile: two calls for the same athlete inside six hours make one transport call', async () => {
  const transport = fakeTransport(() => okResponse(athleteProfileFixture));
  const first = await profile('9990003', { transport });
  const second = await profile('9990003', { transport });
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 1);
});

test('profile: two calls after a 403 inside five minutes make one transport call (negative cache)', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  const first = await profile('9990004', { transport });
  const second = await profile('9990004', { transport });
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(transport.calls.length, 1);
});

test('profile: two CONCURRENT calls for the same cold athlete make exactly one transport call (in-flight dedupe, #1308 risk review)', async () => {
  let resolveGet;
  const transport = fakeTransport(() => new Promise((resolve) => { resolveGet = resolve; }));
  const firstCall = profile('9990010', { transport });
  const secondCall = profile('9990010', { transport });
  resolveGet(okResponse(athleteProfileFixture));
  const [first, second] = await Promise.all([firstCall, secondCall]);
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 1, 'both callers shared the one in-flight fetch');
});

test('profile: two concurrent calls where the shared fetch fails both resolve null from one transport call, and the negative cache then stands undisturbed (#1308 risk review)', async () => {
  // Before in-flight dedupe, two concurrent callers for the same cold id each
  // issued their own fetch, and whichever settled LAST won the cache write -
  // a slow failure could overwrite a fresh success moments after it landed,
  // cutting its 6h life down to 5 minutes. With dedupe there is only ever one
  // fetch per key in flight, so there is nothing left to race: both callers
  // await the SAME settled outcome, and the one write that follows is final.
  let rejectGet;
  const transport = fakeTransport(() => new Promise((resolve, reject) => { rejectGet = reject; }));
  const firstCall = profile('9990011', { transport });
  const secondCall = profile('9990011', { transport });
  rejectGet(httpError(403));
  const [first, second] = await Promise.all([firstCall, secondCall]);
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(transport.calls.length, 1, 'one shared fetch, not two');

  // The negative cache it wrote stands: a later call in the same five-minute
  // window makes no further transport call.
  const third = await profile('9990011', { transport });
  assert.equal(third, null);
  assert.equal(transport.calls.length, 1);
});

test('overview: a 403 resolves null, not a throw, and getPlayerCard-facing shape is {news, injuryFacts} on success', async () => {
  const failing = fakeTransport(() => { throw httpError(403); });
  assert.equal(await overview('9990005', { transport: failing }), null);

  const ok = fakeTransport(() => okResponse(athleteOverviewFixture));
  const result = await overview('9990006', { transport: ok });
  assert.ok(Array.isArray(result.news));
  assert.equal(result.injuryFacts, null);
});

test('overview: two calls inside six hours make one transport call', async () => {
  const transport = fakeTransport(() => okResponse(athleteOverviewFixture));
  await overview('9990007', { transport });
  await overview('9990007', { transport });
  assert.equal(transport.calls.length, 1);
});

// --- teamDepthChart()/ownership(): never cached, resolve null on failure ----
// (Ruling item 4: every client export resolves null on 403/timeout/missing
// id, formal review f3 - espnFactsSync.js is what tells "ESPN failed" (null)
// apart from "ESPN answered, nothing here" ([]).)

test('teamDepthChart: an unknown team code resolves null with no transport call', async () => {
  const transport = fakeTransport(() => okResponse(teamDepthChartFixture));
  const rows = await teamDepthChart('ZZ', { transport });
  assert.equal(rows, null);
  assert.equal(transport.calls.length, 0);
});

test('teamDepthChart: a fetch failure resolves null rather than throwing', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  const rows = await teamDepthChart('NE', { transport });
  assert.equal(rows, null);
});

test('teamDepthChart: NE resolves real rows from the fixture and is never cached (two calls, two transport hits)', async () => {
  const transport = fakeTransport(() => okResponse(teamDepthChartFixture));
  const first = await teamDepthChart('NE', { transport });
  const second = await teamDepthChart('NE', { transport });
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 2);
});

test('ownership: a fetch failure resolves null rather than throwing', async () => {
  const transport = fakeTransport(() => { throw httpError(403); });
  assert.equal(await ownership({ transport }), null);
});

test('ownership: resolves real rows from the fixture and is never cached (two calls, two transport hits)', async () => {
  const transport = fakeTransport(() => okResponse(fantasyPlayerInfoFixture));
  const first = await ownership({ transport });
  const second = await ownership({ transport });
  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assert.equal(transport.calls.length, 2);
});

test('ownership: the request carries view=kona_player_info AND the x-fantasy-filter header - dropping either means ESPN answers with no players key at all (formal review f1, verified live)', async () => {
  const transport = fakeTransport(() => okResponse(fantasyPlayerInfoFixture));
  await ownership({ transport, season: 2026 });
  assert.equal(transport.calls.length, 1);
  const [{ url, config }] = transport.calls;
  assert.match(url, /\/seasons\/2026\/segments\/0\/leaguedefaults\/1$/);
  assert.equal(config.params && config.params.view, 'kona_player_info');
  assert.ok(config.headers && typeof config.headers['x-fantasy-filter'] === 'string' && config.headers['x-fantasy-filter'].length > 0);
});

// ---------------------------------------------------------------------------
// getPlayerCard's ESPN wiring (formal review f2) - the three Red-tell clauses
// the Ruling places in THIS file: a failed ESPN read still returns a whole
// card with bio: null; the feed sync's injury.designation/.detail are
// unchanged by whatever ESPN's injuries[] says, which lands only in the new
// injury.facts sibling; and no key of the fantasy fixture's projection/
// ranking blocks reaches the card. Each assertion below was proven red once
// during review by seeding the wrong mapping (facts.type onto designation,
// or spreading the raw fantasy player object into ownership) before being
// trusted green against the real implementation.
// ---------------------------------------------------------------------------

const CARD_LEAGUE = {
  id: 3, current_season: 2026, current_week: 1, best_ball: false, waiver_type: 'faab',
  regular_season_weeks: 14, playoff_teams: 4, waivers_clear_at: null,
};
const CARD_TEAM = { id: 10, league_id: 3, owner_id: 7, name: 'My Team', faab_remaining: 50, waiver_priority: 3 };

function cardPlayer(overrides) {
  return {
    id: 55, name: 'Test Player', position: 'QB', nfl_team: 'NE', jersey_number: '10', photo_url: null,
    injury_status: null, injury_detail: null, news: 'Feed note', adp: null, external_id: 4431452,
    ...overrides,
  };
}

/** The exact set of pool queries getPlayerCard issues for a single, otherwise
 * empty player - card-shaped stand-ins for playerCard.service.test.js's own
 * `buildHandlers`, plus the two ESPN-facts table reads that file's fixture
 * (no `external_id`) never triggers. `ownershipRow`/`depthRow` default to
 * "no row yet" but can be supplied so a test actually exercises the mapping
 * rather than trivially passing on a null field. */
function cardPoolHandlers(player, { ownershipRow = null, depthRow = null } = {}) {
  return [
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({ rows: [CARD_LEAGUE] })],
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2$/, () => ({ rows: [CARD_TEAM] })],
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, () => ({ rows: [player] })],
    [/^SELECT "week", "opponent" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [] })],
    [/^WITH "target" AS \(/, () => ({ rows: [{ id: player.id }] })],
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: [] })],
    [/^SELECT "id", "position" FROM "players" WHERE "id" = ANY/, () => ({ rows: [{ id: player.id, position: player.position }] })],
    [/^SELECT "team_players"\."team_id", "teams"\."name"/, () => ({ rows: [] })],
    [/^SELECT "available_at" FROM "waiver_players"/, () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS "roster_count" FROM "team_players"/, () => ({ rows: [{ roster_count: 0 }] })],
    [/^SELECT "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "week", "stats" FROM "player_stats"/, () => ({ rows: [] })],
    [/^SELECT "season", "games_played", "stats" FROM "player_season_stats"/, () => ({ rows: [] })],
    [/^SELECT "pss"\."player_id"/, () => ({ rows: [] })],
    [/^SELECT "team_code", "position_group", "rank", "captured_date" FROM "player_depth_chart"/, () => ({ rows: depthRow ? [depthRow] : [] })],
    [/^SELECT "percent_owned", "percent_started", "percent_change", "captured_date" FROM "player_ownership"/, () => ({ rows: ownershipRow ? [ownershipRow] : [] })],
  ];
}

function mockCardServices(t) {
  t.mock.method(projectionService, 'getWeekProjections', async (options) => {
    const map = new Map();
    for (const id of options.playerIds) map.set(id, { points: 0 });
    return map;
  });
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => ({
    projections: new Map(playerIds.map((id) => [id, { median: 5, factors: { availability: { available: true } } }])),
  }));
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks, playerIds }) => new Map(
    weeks.map((week) => [week, {
      week,
      projections: new Map(playerIds.map((id) => [id, { median: 5, factors: { availability: { available: true } } }])),
    }]),
  ));
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => new Map(playerIds.map((id) => [id, { total: 0, perGame: 0 }])));
  t.mock.method(byeService, 'computeByeWeek', async () => null);
  t.mock.method(decisionCardContextService, 'loadUsage', async () => null);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(irPolicy, 'rosterCapacity', async () => 16);
}

test('getPlayerCard: ESPN failing entirely still returns a whole card - bio: null, news falls back to the feed note, injury.facts: null (Red-tell)', async (t) => {
  createFakePool(cardPoolHandlers(cardPlayer())).install(t);
  mockCardServices(t);
  t.mock.method(espnAthleteClient, 'profile', async () => null);
  t.mock.method(espnAthleteClient, 'overview', async () => null);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });

  assert.equal(card.bio, null);
  assert.deepEqual(card.news, [{ headline: 'Feed note', source: 'feed', publishedAt: null }]);
  assert.equal(card.player.injury.facts, null);
});

test('getPlayerCard: injury.designation/.detail stay the feed sync\'s no matter what ESPN\'s injuries[] says; ESPN lands only in injury.facts (Red-tell + 2026-09-14 owner ruling)', async (t) => {
  const player = cardPlayer({ injury_status: 'Questionable', injury_detail: 'Ankle per the weekly report' });
  createFakePool(cardPoolHandlers(player)).install(t);
  mockCardServices(t);
  t.mock.method(espnAthleteClient, 'profile', async () => null);
  t.mock.method(espnAthleteClient, 'overview', async () => ({
    news: [],
    // A synthetic ESPN entry that DISAGREES with the feed sync on purpose -
    // proving the two never merge. (A wrong implementation that maps
    // facts.type onto designation, or facts.practiceNote onto detail, fails
    // this assertion; that mutation was checked red before this was trusted.)
    injuryFacts: { type: 'Knee', practiceNote: 'ESPN: DNP Thursday', expectedReturn: '2026-09-30' },
  }));

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });

  assert.equal(card.player.injury.designation, 'Questionable');
  assert.equal(card.player.injury.detail, 'Ankle per the weekly report');
  assert.deepEqual(card.player.injury.facts, { type: 'Knee', practiceNote: 'ESPN: DNP Thursday', expectedReturn: '2026-09-30' });
});

/** Every key name reachable anywhere inside `value`, recursing through plain
 * objects and arrays. */
function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      out.add(key);
      collectKeys(value[key], out);
    }
  }
  return out;
}

test('getPlayerCard: no key of the fantasy fixture\'s projection/ranking blocks reaches the card payload (Red-tell)', async (t) => {
  // Run the REAL client normalizer over the real fixture, exactly as the
  // daily Sync run would, then hand the card a DB row shaped the way that
  // sync's own INSERT writes one (server/modules/espnFactsSync.js) - so this
  // test exercises the actual ownership mapping (a non-null value) rather
  // than trivially passing on a null field.
  const [normalized] = normalizeOwnership(fantasyPlayerInfoFixture);
  const ownershipRow = {
    percent_owned: normalized.percentOwned,
    percent_started: normalized.percentStarted,
    percent_change: normalized.percentChange,
    captured_date: '2026-09-15',
  };
  createFakePool(cardPoolHandlers(cardPlayer(), { ownershipRow })).install(t);
  mockCardServices(t);
  t.mock.method(espnAthleteClient, 'profile', async () => null);
  t.mock.method(espnAthleteClient, 'overview', async () => null);

  const card = await getPlayerCard({ leagueId: 3, userId: 7, playerId: 55 });
  assert.ok(card.ownership, 'the ownership mapping actually ran on a real row, not a null short-circuit');
  const cardKeys = collectKeys(card);

  // Enumerated from the real fixture, not a hand list (formal review f2).
  // `ownership` is the one key that's SUPPOSED to flow through, transformed
  // (percentOwned/percentStarted/change, never this raw block); `id` is
  // excluded because it is our own row-identity convention's key name
  // (card.player.id), not a projection/ranking field - its presence in both
  // objects is coincidence of vocabulary, not a leak.
  const fantasyPlayer = fantasyPlayerInfoFixture.players[0].player;
  const forbiddenKeys = Object.keys(fantasyPlayer).filter((key) => key !== 'ownership' && key !== 'id');
  assert.ok(forbiddenKeys.includes('draftRanksByRankType'));
  assert.ok(forbiddenKeys.includes('rankings'));

  for (const key of forbiddenKeys) {
    assert.equal(cardKeys.has(key), false, `card payload must never carry fantasy-fixture key "${key}"`);
  }
});
