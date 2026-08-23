const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { keys, withheld, NEXT_QUARTER } = require('./helpers/payloadShape');

/**
 * The payload contract of every unauthenticated /api/public/* route (#201).
 *
 * public.router.js is the app's only router with no `requireAuth` anywhere by
 * design, and publicRead.service.js already builds every response from a
 * named-column select and an explicit serializer. That is the shape #199 had
 * to convert the presenter board TO, so nothing here needed converting.
 *
 * What was missing is the backstop. public.router.test.js checks that four
 * particular names (`user_id`, `userId`, `league_id`, `leagueId`) are absent,
 * and a payload that grows a FIFTH leaky field passes that check unchanged -
 * which is exactly how `draft_share_token` reached anonymous viewers in #173.
 * So these tests assert the EXACT key set of every public payload and of every
 * nested object inside it. A field added to a serializer fails here by name.
 *
 * Every fixture row is deliberately WIDER than the contract: it carries
 * league- and user-scoped decoys and a stand-in for a column someone adds next
 * quarter. A serializer that spread its row instead of naming its fields would
 * pass a denylist and fail every assertion below, which is the point.
 *
 * Sibling suites: unauthenticatedRouteInventory.test.js (which routes are
 * public at all), authPayloadShape.test.js, healthPayloadShape.test.js,
 * draftPresenterBoard.test.js (#199, the worked example).
 */

function makeApp() {
  // Require the router fresh per app so each test gets its own rate-limiter
  // store and its own module-level TTL caches.
  delete require.cache[require.resolve('../routes/public.router')];
  const publicRouter = require('../routes/public.router');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, 'ip', { value: '203.0.113.9', configurable: true });
    next();
  });
  app.use('/api/public', publicRouter);
  return app;
}

/**
 * These routes are read-only and never check out a client, so the shared fake
 * is used for its matcher dispatch alone: one line, so the fourteen call sites
 * below read as fixtures rather than as plumbing. Matchers are raw regexes
 * because every query here is either a CTE (`WITH ... SELECT`) or reads a
 * table that is not its statement's first FROM - the two cases fakePool's
 * docblock says the `select(table)` shape matcher cannot express.
 */
const fakePool = (t, handlers) => createFakePool(
  // The helper always CALLS its answer; a constant result reads better as a
  // literal in a fixture table this long, so constants are lifted here.
  handlers.map(([pattern, answer]) => [pattern, typeof answer === 'function' ? answer : () => answer])
).install(t);

/**
 * The whole point of these fixtures: an anonymous payload built from a row
 * carrying league and user columns AND a stand-in for a column someone adds
 * next quarter. `withheld` keeps the decoys and the assertion in one object,
 * so a decoy can never be asserted-against without also being supplied.
 */
const { decoys: DECOYS, assertWithheld } = withheld({
  user_id: 9,
  userId: 9,
  league_id: 4,
  leagueId: 4,
  owner_id: 42,
  username: 'account-holder',
  email: 'manager@example.com',
  draft_share_token: 'presenter-share-token',
  invite_code: 'JOIN-ME-42',
  a_column_added_next_quarter: NEXT_QUARTER,
});

// ---------------------------------------------------------------------------
// GET /api/public/rankings
// ---------------------------------------------------------------------------

const RANKING_KEYS = [
  'byeWeek', 'injuryStatus', 'lastWeekPoints', 'name', 'nflTeam', 'photoUrl',
  'playerId', 'position', 'projectedPoints', 'rank', 'seasonPoints', 'trend',
].sort();

const BYE_ROWS = () => {
  const rows = [];
  for (let week = 1; week <= 18; week++) {
    if (week !== 10) rows.push({ nfl_team: 'KC', week });
    if (week !== 7) rows.push({ nfl_team: 'BUF', week });
  }
  return { rows };
};

const rankingsHandlers = () => [
  [/FROM "player_projections"/, { rows: [
    { player_id: 1, projected_points: '22.4', source: 'extrapolated', ...DECOYS },
    { player_id: 2, projected_points: '18.1', source: 'extrapolated' },
  ] }],
  [/MAX\("season"\)::int/, { rows: [{ season: 2026 }] }],
  [/MAX\("week"\)::int/, { rows: [{ week: 3 }] }],
  [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, { rows: [{ season: 2026 }] }],
  [/fn_normalize_nfl_team/, BYE_ROWS],
  [/FROM "players" "p"/, { rows: [
    { id: 1, name: 'Alpha Back', position: 'RB', nfl_team: 'KC', photo_url: 'http://x/1.png',
      injury_status: null, season_points: '120.5', ...DECOYS },
    { id: 2, name: 'Bravo Wide', position: 'WR', nfl_team: 'BUF', photo_url: null,
      injury_status: 'Q', season_points: '90.0', ...DECOYS },
  ] }],
  [/"week" <= \$3/, { rows: [
    { player_id: 1, week: 1, fantasy_points: '10', ...DECOYS },
    { player_id: 1, week: 2, fantasy_points: '15' },
    { player_id: 2, week: 1, fantasy_points: '12' },
    { player_id: 2, week: 2, fantasy_points: '8' },
  ] }],
];

test('GET /rankings publishes exactly season, week and rankings', async (t) => {
  fakePool(t, rankingsHandlers());
  const res = await request(makeApp()).get('/api/public/rankings');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), ['rankings', 'season', 'week']);
  assertWithheld(res.body);
});

test('a rankings[] entry publishes exactly the ranking allowlist, however wide the row is', async (t) => {
  fakePool(t, rankingsHandlers());
  const res = await request(makeApp()).get('/api/public/rankings');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.rankings.length, 2);
  for (const entry of res.body.rankings) {
    assert.deepEqual(keys(entry), RANKING_KEYS);
  }
});

test('a rankings[] entry keeps every key when the row and its lookups are empty', async (t) => {
  // The other half of the contract: the key set is a property of the
  // serializer, not of whatever the row happened to hold, so a client may read
  // every field unconditionally. A missing projection, week history or bye
  // answers null; it never drops the key.
  fakePool(t, [
    [/FROM "player_projections"/, { rows: [] }],
    [/array_agg\("fantasy_points"\)/, { rows: [] }],
    [/MAX\("season"\)::int/, { rows: [{ season: 2026 }] }],
    [/MAX\("week"\)::int/, { rows: [{ week: 3 }] }],
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, { rows: [{ season: 2026 }] }],
    [/fn_normalize_nfl_team/, { rows: [] }],
    [/FROM "players" "p"/, { rows: [
      { id: 1, name: 'Sparse Player', position: 'RB', nfl_team: 'KC', season_points: '5' },
    ] }],
    [/"week" <= \$3/, { rows: [] }],
  ]);
  const res = await request(makeApp()).get('/api/public/rankings');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const entry = res.body.rankings[0];
  assert.deepEqual(keys(entry), RANKING_KEYS);
  assert.equal(entry.projectedPoints, null);
  assert.equal(entry.lastWeekPoints, null);
  assert.equal(entry.byeWeek, null);
  // The columns the row does not carry at all: present, and null.
  assert.equal(entry.photoUrl, null);
  assert.equal(entry.injuryStatus, null);
});

// ---------------------------------------------------------------------------
// GET /api/public/draft-pool
// ---------------------------------------------------------------------------

const DRAFT_POOL_KEYS = [
  'adp', 'byeWeek', 'injuryStatus', 'name', 'nflTeam', 'photoUrl',
  'playerId', 'position', 'positionRank', 'projectedPoints',
].sort();

const draftPoolHandlers = () => [
  [/"market_ranks" AS/, { rows: [
    { id: 1, name: 'Alpha Back', position: 'RB', nfl_team: 'KC', photo_url: 'http://x/1.png',
      injury_status: null, adp: '1.4', position_rank: 1, ...DECOYS },
    { id: 2, name: 'Bravo Wide', position: 'WR', nfl_team: 'BUF', photo_url: null,
      injury_status: 'Q', adp: '8.2', position_rank: 2, ...DECOYS },
  ] }],
  [/"idp_ranks" AS/, { rows: [
    { id: 3, name: 'Charlie Backer', position: 'LB', nfl_team: 'KC', photo_url: null,
      injury_status: null, position_rank: 1, ...DECOYS },
  ] }],
  [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, { rows: [{ season: 2026 }] }],
  [/FROM "player_season_stats" WHERE "player_id" = ANY/, { rows: [
    { player_id: 1, season: 2025, games_played: 17, stats: { rushingYards: 1700 }, fantasy_points: '170', ...DECOYS },
  ] }],
  [/fn_normalize_nfl_team/, BYE_ROWS],
];

test('GET /draft-pool publishes exactly season, includeIdp and players', async (t) => {
  fakePool(t, draftPoolHandlers());
  const res = await request(makeApp()).get('/api/public/draft-pool');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), ['includeIdp', 'players', 'season']);
  assertWithheld(res.body);
});

test('a players[] entry publishes exactly the draft-pool allowlist, base and IDP alike', async (t) => {
  fakePool(t, draftPoolHandlers());
  const res = await request(makeApp()).get('/api/public/draft-pool?idp=1');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.players.length, 3);
  for (const player of res.body.players) {
    assert.deepEqual(keys(player), DRAFT_POOL_KEYS);
  }
  // The IDP tranche carries a null ADP on purpose, and still carries the key.
  const idp = res.body.players.find((p) => p.position === 'LB');
  assert.equal(idp.adp, null);
  assertWithheld(res.body);
});

test('a draft-pool row missing its identity columns entirely still publishes every key', async (t) => {
  // The half the wide-row test above cannot reach. Without it, `name`,
  // `position` and `nflTeam` are asserted against the FIXTURE's shape rather
  // than the serializer's: a query that stopped selecting `p.name` would
  // narrow the public contract and nothing here would fail. (It caught exactly
  // that: those three were the raw passthroughs this audit missed on its first
  // pass through the file.)
  fakePool(t, [
    [/"market_ranks" AS/, { rows: [{ id: 1, adp: '1.4', position_rank: 1 }] }],
    [/"idp_ranks" AS/, { rows: [] }],
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, { rows: [{ season: 2026 }] }],
    [/FROM "player_season_stats" WHERE "player_id" = ANY/, { rows: [] }],
    [/fn_normalize_nfl_team/, { rows: [] }],
  ]);
  const res = await request(makeApp()).get('/api/public/draft-pool');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.players.length, 1);
  assert.deepEqual(keys(res.body.players[0]), DRAFT_POOL_KEYS);
  for (const field of ['name', 'position', 'nflTeam', 'photoUrl', 'injuryStatus']) {
    assert.equal(res.body.players[0][field], null, `${field} answers null rather than dropping out`);
  }
});

// ---------------------------------------------------------------------------
// GET /api/public/players/:id
// ---------------------------------------------------------------------------

const PROFILE_KEYS = [
  'adp', 'injuryDetail', 'injuryStatus', 'jerseyNumber', 'name', 'news',
  'nflTeam', 'photoUrl', 'playerId', 'posRank', 'posRankOf', 'position',
  'recentGames', 'season', 'seasonSummary', 'seasons', 'weeklyLogPartial',
].sort();
const POINTS_KEYS = ['halfPpr', 'ppr', 'standard'];
const SEASON_SUMMARY_KEYS = ['fantasyPoints', 'gamesPlayed', 'points', 'pointsPerGame', 'season'];
const RECENT_GAME_KEYS = ['fantasyPoints', 'opponent', 'points', 'season', 'statLine', 'week'];

const profileHandlers = (overrides = {}) => [
  // Must precede the rollup needle: the rank window query also reads player_season_stats.
  [/RANK\(\) OVER/, overrides.posRank || { rows: [{ rank: 3, group_size: 60, ...DECOYS }] }],
  [/UNION SELECT DISTINCT "season"/, overrides.seasons || { rows: [{ season: 2025, ...DECOYS }] }],
  [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, { rows: [{ season: 2026 }] }],
  [/FROM "player_season_stats"/, overrides.rollup || { rows: [{
    games_played: 17,
    stats: { rushingYards: 200, rushingTDs: 3, receptions: 40, receivingYards: 500, receivingTDs: 2 },
    ...DECOYS,
  }] }],
  [/COUNT\(\*\)::int AS "n"/, overrides.count || { rows: [{ n: 2 }] }],
  [/LEFT JOIN "nfl_games"/, overrides.recent || { rows: [{
    season: 2025, week: 3, fantasy_points: '20',
    stats: { rushingYards: 100, rushingTDs: 1 }, opponent: 'DEN', ...DECOYS,
  }] }],
  [/FROM "players" WHERE "id" = \$1/, overrides.player || { rows: [{
    id: 1, name: 'Alpha Back', position: 'RB', nfl_team: 'KC', photo_url: 'http://x/1.png',
    jersey_number: '25', injury_status: null, injury_detail: null, news: null, adp: '12.5',
    ...DECOYS,
  }] }],
];

test('GET /players/:id publishes exactly the public profile allowlist', async (t) => {
  fakePool(t, profileHandlers());
  const res = await request(makeApp()).get('/api/public/players/1');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), PROFILE_KEYS);
  assertWithheld(res.body);
});

test('every nested object in a public profile publishes an exact key set too', async (t) => {
  fakePool(t, profileHandlers());
  const res = await request(makeApp()).get('/api/public/players/1');

  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.seasons.length, 2, 'the loop below has something to assert against');
  for (const season of res.body.seasons) {
    assert.deepEqual(keys(season), ['season', 'status']);
  }

  assert.deepEqual(keys(res.body.seasonSummary), SEASON_SUMMARY_KEYS);
  assert.deepEqual(keys(res.body.seasonSummary.points), POINTS_KEYS);
  assert.deepEqual(keys(res.body.seasonSummary.pointsPerGame), POINTS_KEYS);

  assert.equal(res.body.recentGames.length, 1);
  for (const game of res.body.recentGames) {
    assert.deepEqual(keys(game), RECENT_GAME_KEYS);
    assert.deepEqual(keys(game.points), POINTS_KEYS);
  }
});

test('a profile for a season with no data keeps the same key set, summary and all', async (t) => {
  // The pending-season branch returns early through a different call to the
  // serializer, without a posRank. It must publish the same contract: a client
  // reads these fields unconditionally.
  fakePool(t, profileHandlers());
  const res = await request(makeApp()).get('/api/public/players/1?season=2026');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), PROFILE_KEYS);
  assert.equal(res.body.seasonSummary, null);
  assert.equal(res.body.posRank, null);
  assert.equal(res.body.posRankOf, null);
  assert.deepEqual(res.body.recentGames, []);
  assertWithheld(res.body);
});

test('a profile row missing its optional columns entirely still publishes every key', async (t) => {
  fakePool(t, profileHandlers({
    player: { rows: [{ id: 1, name: 'Sparse Player', position: 'RB', nfl_team: 'KC' }] },
  }));
  const res = await request(makeApp()).get('/api/public/players/1');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), PROFILE_KEYS);
  assert.equal(res.body.adp, null);
  for (const field of ['photoUrl', 'jerseyNumber', 'injuryStatus', 'injuryDetail', 'news']) {
    assert.equal(res.body[field], null, `${field} answers null rather than dropping out`);
  }
});

// ---------------------------------------------------------------------------
// GET /api/public/recaps and /api/public/recaps/:gameId
// ---------------------------------------------------------------------------

const TOP_PERFORMER_KEYS = [
  'fantasyPoints', 'name', 'nflTeam', 'photoUrl', 'playerId', 'position', 'statLine',
].sort();
const RECAP_LIST_KEYS = [
  'awayScore', 'awayTeam', 'dataVersion', 'finalAt', 'gameId', 'generatedAt',
  'generatorVersion', 'homeScore', 'homeTeam', 'hook', 'season', 'topPerformer', 'week',
].sort();
const RECAP_DETAIL_KEYS = [
  'awayScore', 'awayTeam', 'dataVersion', 'finalAt', 'gameId', 'generatedAt',
  'generatorVersion', 'homeScore', 'homeTeam', 'lineScore', 'narrative',
  'scoringPlays', 'season', 'topPerformers', 'week',
].sort();
const SCORING_PLAY_KEYS = ['awayScore', 'clock', 'description', 'homeScore', 'quarter', 'team'];

/**
 * The recap row's `data` is a stored JSON document, not a set of columns, so
 * it is the widest input on this router: whatever the generator wrote lands
 * there. The decoys go INSIDE it as well as beside it.
 */
const recapRow = () => ({
  tank01_game_id: '20260112_KC@BUF', season: 2026, week: 19,
  home_team: 'BUF', away_team: 'KC', home_score: 24, away_score: 27,
  final_at: '2026-01-12T23:00:00Z', generated_at: '2026-01-13T00:00:00Z',
  data_version: 1, generator_version: '1.0.0',
  data: {
    narrative: 'Kansas City edged Buffalo 27-24. A late field goal decided it.',
    lineScore: { home: [7, 10, 0, 7], away: [3, 14, 3, 7], ...DECOYS },
    scoringPlays: [{
      quarter: 1, clock: '5:00', team: 'BUF', description: 'TD',
      homeScore: 7, awayScore: 0, ...DECOYS,
    }],
    topPerformers: [{
      playerId: 9, name: 'Star Back', position: 'RB', nflTeam: 'KC',
      photoUrl: null, fantasyPoints: 28.4, statLine: '130 rush yds', ...DECOYS,
    }],
    ...DECOYS,
  },
  ...DECOYS,
});

test('GET /recaps publishes exactly a recaps list, and each entry an exact key set', async (t) => {
  fakePool(t, [[/FROM "private"\."game_recaps"/, { rows: [recapRow()] }]]);
  const res = await request(makeApp()).get('/api/public/recaps');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), ['recaps']);
  assert.equal(res.body.recaps.length, 1);
  assert.deepEqual(keys(res.body.recaps[0]), RECAP_LIST_KEYS);
  assert.deepEqual(keys(res.body.recaps[0].topPerformer), TOP_PERFORMER_KEYS);
  assertWithheld(res.body);
});

test('GET /recaps/:gameId publishes exactly the recap detail allowlist', async (t) => {
  fakePool(t, [
    [/FROM "private"\."game_recaps" WHERE "tank01_game_id" = \$1/, { rows: [recapRow()] }],
  ]);
  const res = await request(makeApp()).get('/api/public/recaps/20260112_KC@BUF');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), RECAP_DETAIL_KEYS);
  assertWithheld(res.body);
});

test('every nested object in a recap detail publishes an exact key set too', async (t) => {
  fakePool(t, [
    [/FROM "private"\."game_recaps" WHERE "tank01_game_id" = \$1/, { rows: [recapRow()] }],
  ]);
  const res = await request(makeApp()).get('/api/public/recaps/20260112_KC@BUF');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body.lineScore), ['away', 'home']);
  assert.equal(res.body.scoringPlays.length, 1);
  for (const play of res.body.scoringPlays) {
    assert.deepEqual(keys(play), SCORING_PLAY_KEYS);
  }
  assert.equal(res.body.topPerformers.length, 1);
  for (const player of res.body.topPerformers) {
    assert.deepEqual(keys(player), TOP_PERFORMER_KEYS);
  }
});

test('a recap whose stored document is empty still publishes the same key set', async (t) => {
  const row = recapRow();
  row.data = {};
  fakePool(t, [
    [/FROM "private"\."game_recaps" WHERE "tank01_game_id" = \$1/, { rows: [row] }],
  ]);
  const res = await request(makeApp()).get('/api/public/recaps/20260112_KC@BUF');

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body), RECAP_DETAIL_KEYS);
  assert.equal(res.body.lineScore, null);
  assert.deepEqual(res.body.scoringPlays, []);
  assert.deepEqual(res.body.topPerformers, []);
  assert.equal(res.body.narrative, '');
});

// ---------------------------------------------------------------------------
// The refusals.
// ---------------------------------------------------------------------------

test('every public refusal publishes exactly an error message and nothing else', async (t) => {
  // A 400/404/500 is a public payload too. None of them may grow a field.
  fakePool(t, [
    [/FROM "players" WHERE "id" = \$1/, { rows: [] }],
    [/RANK\(\) OVER/, { rows: [] }],
    [/UNION SELECT DISTINCT "season"/, { rows: [] }],
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, { rows: [{ season: 2026 }] }],
    [/FROM "private"\."game_recaps" WHERE "tank01_game_id" = \$1/, { rows: [] }],
  ]);
  const app = makeApp();

  for (const path of [
    '/api/public/rankings?position=OL',
    '/api/public/rankings?week=x',
    '/api/public/draft-pool?idp=maybe',
    '/api/public/players/0',
    '/api/public/players/abc',
    '/api/public/players/1',
    '/api/public/recaps/not a game id',
    '/api/public/recaps/20260112_KC@BUF',
  ]) {
    const res = await request(app).get(path);
    assert.ok(res.status >= 400, `${path} refuses`);
    assert.deepEqual(Object.keys(res.body), ['error'], `${path} publishes only an error`);
    assert.equal(typeof res.body.error, 'string');
  }
});
