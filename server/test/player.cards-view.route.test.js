// GET /api/players?view=cards[&sort=upgrade] (#1309, ADR 0040 slice 6): the
// Decision-card-shaped per-row fields on the paginated list, and the new
// `upgrade` sort key.
//
// Most tests below mock `playerCardService.availabilityForMany`/`.upgradesFor`
// wholesale (kept-whole cross-module requires, the same test seam convention
// the router's own comments document) to pin the ROUTER's wiring - which
// field goes where, the sort order, the leagueId gate - without needing the
// full producer machinery. `buildWeeksForPage` is exercised for REAL
// throughout (it is new in this ticket): it only ever calls
// `projectionService.getWeeklyProjections`, no pool access.
//
// Formal review round 1 (formal-1309-f1) caught that this left the batch
// producers' OWN query-count contract (Ruling item 11) unpinned - the mocks
// bypass the SQL entirely. The "real producers" tests near the bottom of this
// file run `availabilityForMany` and `upgradesFor` for real, over a fake pool
// (`./helpers/fakePool`, which also covers the pooled CLIENT the lineup
// transaction inside `upgradesFor` uses), and assert the call counts don't
// scale with page/pool size. formal-1309-f2 then asked for a parity case
// between the N=1 and batch SQL forms those two functions fork into - also
// below, calling `playerCardService` directly rather than through the route.
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const playerRouter = require('../routes/player.router');
const playerCardService = require('../services/playerCard.service');
const projectionService = require('../services/projection.service');
const irPolicy = require('../services/irPolicy.service');
const lineupService = require('../services/lineup.service');
const decisionService = require('../services/decision.service');
const { createFakePool } = require('./helpers/fakePool');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-cards-view-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

const TOKEN = () => `Bearer ${signToken({ id: 7, username: 'member' })}`;
const TEAM = { id: 10, league_id: 1, owner_id: 7, faab_remaining: 50, waiver_priority: 3 };

function makeLeague({ bestBall = false, currentWeek = 3 } = {}) {
  return {
    id: 1,
    name: 'Test League',
    current_season: 2026,
    current_week: currentWeek,
    best_ball: bestBall,
    waiver_type: 'faab',
    waivers_clear_at: null,
  };
}

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Player ${i + 1}`,
    position: 'RB',
    nfl_team: null,
    adp: null,
    total_count: String(n),
    identity_ids: [i + 1],
  }));
}

function mockBasePool(t, { league, players, poolQueries = [] }) {
  return t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2')) {
      return { rows: [TEAM] };
    }
    if (text.startsWith('SELECT * FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "players" AS "source"')) {
      poolQueries.push(text);
      return { rows: players };
    }
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    if (text.includes('COUNT(*)::int AS "roster_count"')) return { rows: [{ roster_count: 0 }] };
    // Only reached by plain (non-view=cards) sort=upgrade requests: the
    // default view's attachLeagueAvailability runs regardless of sort.
    if (text.includes('FROM "team_players"')) return { rows: [] };
    if (text.includes('FROM "waiver_players"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
}

function mockCardServices(t, {
  availability = new Map(),
  upgrades = new Map(),
  weeklyProjection = () => ({ median: 5, factors: { availability: { available: true } } }),
  restOfSeason = { total: 12, perGame: 3 },
  seasonEnd = 17,
  rosterCapacity = 16,
} = {}) {
  const weeklyCalls = [];
  t.mock.method(irPolicy, 'rosterCapacity', async () => rosterCapacity);
  t.mock.method(playerCardService, 'availabilityForMany', async () => availability);
  const upgradesForCalls = [];
  t.mock.method(playerCardService, 'upgradesFor', async (options) => {
    upgradesForCalls.push(options);
    return upgrades;
  });
  // #1403: the page's Weekly projections arrive through ONE multi-week read.
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks, playerIds }) => {
    weeklyCalls.push({ weeks, playerIds });
    return new Map(weeks.map((week) => [week, {
      week,
      projections: new Map(playerIds.map((id) => [id, weeklyProjection(week, id)])),
    }]));
  });
  const restOfSeasonCalls = [];
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds, leagueId, options) => {
    restOfSeasonCalls.push({ playerIds, leagueId, options });
    return new Map(playerIds.map((id) => [id, restOfSeason]));
  });
  t.mock.method(projectionService, 'lastPlayoffWeek', () => seasonEnd);
  return { weeklyCalls, upgradesForCalls, restOfSeasonCalls };
}

test('view=cards without leagueId is a 400', async (t) => {
  const res = await request(app).get('/api/players?view=cards').set('Authorization', TOKEN());
  assert.equal(res.status, 400);
  assert.match(res.body.error, /view=cards and sort=upgrade require leagueId/);
});

test('sort=upgrade without leagueId is a 400', async (t) => {
  const res = await request(app).get('/api/players?sort=upgrade').set('Authorization', TOKEN());
  assert.equal(res.status, 400);
  assert.match(res.body.error, /view=cards and sort=upgrade require leagueId/);
});

test('view=cards: a rostered row carries availability.teamId and teamName', async (t) => {
  const league = makeLeague();
  const players = makePlayers(1);
  mockBasePool(t, { league, players });
  mockCardServices(t, {
    availability: new Map([[1, { state: 'rostered', teamId: 77, teamName: 'Rival Team', availableAt: null }]]),
  });

  const res = await request(app)
    .get('/api/players?view=cards&leagueId=1')
    .set('Authorization', TOKEN());

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.players[0].availability.state, 'rostered');
  assert.equal(res.body.players[0].availability.teamId, 77);
  assert.equal(res.body.players[0].availability.teamName, 'Rival Team');
});

test('view=cards: an unavailable week (IR) carries projWeek: { reason: "on IR" } and no points', async (t) => {
  const league = makeLeague({ currentWeek: 3 });
  const players = makePlayers(1);
  mockBasePool(t, { league, players });
  mockCardServices(t, {
    availability: new Map([[1, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }]]),
    weeklyProjection: (week) => (week === 3
      ? { factors: { availability: { available: false, reason: 'ir' } } }
      : { median: 8, factors: { availability: { available: true } } }),
  });

  const res = await request(app)
    .get('/api/players?view=cards&leagueId=1')
    .set('Authorization', TOKEN());

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [player] = res.body.players;
  assert.deepEqual(player.projWeek, { week: 3, reason: 'on IR' });
  assert.equal('points' in player.projWeek, false);
  assert.equal(player.weeks[0].reason, 'on IR');
  assert.equal(player.weeks.length, 16); // weeks 3..18
});

// #1403: the page's Weekly projections are read ONCE for every remaining
// week (it was one getWeeklyProjections call per week, each two cache reads,
// and getRestOfSeason repeated the whole loop on its own), and rest-of-season
// is summed from those same runs rather than re-read.
test('view=cards: ONE getWeeklyProjectionsForWeeks call covers every remaining week for the WHOLE page, whatever its size, and getRestOfSeason receives those same runs', async (t) => {
  const league = makeLeague({ currentWeek: 10 });
  const bigPage = makePlayers(25);
  const smallPage = makePlayers(1);
  const weeks10to18 = [10, 11, 12, 13, 14, 15, 16, 17, 18];

  mockBasePool(t, { league, players: bigPage });
  const { weeklyCalls: bigCalls, restOfSeasonCalls: bigRos } = mockCardServices(t, {
    availability: new Map(bigPage.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
  });
  const bigRes = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', TOKEN());
  assert.equal(bigRes.status, 200, JSON.stringify(bigRes.body));
  t.mock.restoreAll();

  mockBasePool(t, { league, players: smallPage });
  const { weeklyCalls: smallCalls, restOfSeasonCalls: smallRos } = mockCardServices(t, {
    availability: new Map(smallPage.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
  });
  const smallRes = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', TOKEN());
  assert.equal(smallRes.status, 200, JSON.stringify(smallRes.body));

  assert.equal(bigCalls.length, 1, 'one multi-week read for a 25-row page');
  assert.equal(smallCalls.length, 1, 'one multi-week read for a 1-row page');
  assert.deepEqual(bigCalls[0].weeks, weeks10to18);
  assert.deepEqual(smallCalls[0].weeks, weeks10to18);
  assert.equal(bigCalls[0].playerIds.length, 25);
  assert.equal(smallCalls[0].playerIds.length, 1);

  // Rest-of-season sums the runs the weeks bar was built from, never its own read.
  assert.equal(bigRos.length, 1);
  const { runsByWeek } = bigRos[0].options;
  assert.ok(runsByWeek instanceof Map);
  assert.deepEqual([...runsByWeek.keys()], weeks10to18);
  assert.equal(runsByWeek.get(10).projections.size, 25);
  assert.equal(smallRos[0].options.runsByWeek.get(18).projections.size, 1);
  // The weeks bar itself still comes from those runs: 9 entries per row.
  assert.ok(bigRes.body.players.every((p) => p.weeks.length === 9));
});

test('sort=upgrade: rows sort by upgrade.points descending, nulls last', async (t) => {
  const league = makeLeague();
  const players = makePlayers(4);
  const poolQueries = [];
  mockBasePool(t, { league, players, poolQueries });
  mockCardServices(t, {
    availability: new Map(players.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
    upgrades: new Map([
      [1, { points: 2.5, overPlayer: { id: 9, name: 'Bench' }, slot: 'RB' }],
      [2, null],
      [3, { points: 8.1, overPlayer: { id: 9, name: 'Bench' }, slot: 'RB' }],
      [4, { points: 5.0, overPlayer: { id: 9, name: 'Bench' }, slot: 'RB' }],
    ]),
  });

  const res = await request(app)
    .get('/api/players?sort=upgrade&leagueId=1')
    .set('Authorization', TOKEN());

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.players.map((p) => p.id), [3, 4, 1, 2]);
  // #1309 amended Ruling item 3: upgrade is a full-pool JS sort, like
  // projected_points/bye_week - not `ORDER BY "id"` SQL-paged with a LIMIT.
  assert.equal(poolQueries.length, 1);
  assert.ok(!poolQueries[0].includes('LIMIT $'), 'sort=upgrade fetches the full pool, no SQL LIMIT');
});

test('sort=upgrade in a best_ball league falls back to projected_points, descending', async (t) => {
  const league = makeLeague({ bestBall: true });
  const players = makePlayers(3);
  mockBasePool(t, {
    league,
    players,
  });
  // Distinguishable season-stats rows so projectSeasonPoints orders them.
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2')) return { rows: [TEAM] };
    if (text.startsWith('SELECT * FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "players" AS "source"')) return { rows: players };
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    if (text.includes('FROM "player_season_stats"')) {
      return {
        rows: [
          { player_id: 1, season: 2025, games_played: 16, stats: { rushingYards: 50 } },
          { player_id: 2, season: 2025, games_played: 16, stats: { rushingYards: 800 } },
          { player_id: 3, season: 2025, games_played: 16, stats: { rushingYards: 400 } },
        ],
      };
    }
    if (text.includes('COUNT(*)::int AS "roster_count"')) return { rows: [{ roster_count: 0 }] };
    if (text.includes('FROM "team_players"')) return { rows: [] };
    if (text.includes('FROM "waiver_players"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const { upgradesForCalls } = mockCardServices(t, {
    availability: new Map(players.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
  });

  const res = await request(app)
    .get('/api/players?sort=upgrade&leagueId=1')
    .set('Authorization', TOKEN());

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.players.map((p) => p.id), [2, 3, 1]);
  // best_ball never asks for a real Upgrade computation to settle the order.
  assert.equal(upgradesForCalls.length, 0);
});

test('view=cards + sort=upgrade in a best_ball league: still never returns projected_points (item 7)', async (t) => {
  const league = makeLeague({ bestBall: true });
  const players = makePlayers(3);
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2')) return { rows: [TEAM] };
    if (text.startsWith('SELECT * FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "players" AS "source"')) return { rows: players };
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    if (text.includes('FROM "player_season_stats"')) {
      return { rows: [{ player_id: 1, season: 2025, games_played: 16, stats: { rushingYards: 50 } }] };
    }
    if (text.includes('COUNT(*)::int AS "roster_count"')) return { rows: [{ roster_count: 0 }] };
    throw new Error(`unexpected query: ${text}`);
  });
  mockCardServices(t, {
    availability: new Map(players.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
  });

  const res = await request(app)
    .get('/api/players?sort=upgrade&view=cards&leagueId=1')
    .set('Authorization', TOKEN());

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.players.every((p) => !('projected_points' in p)));
  assert.ok(res.body.players.every((p) => p.upgrade === null));
});

// ---------------------------------------------------------------------------
// Real producers (formal-1309-f1): availabilityForMany and upgradesFor run
// for real over a fake pool, so their own query-count contract (Ruling
// item 11) is actually exercised, not bypassed by a mock.
// ---------------------------------------------------------------------------

/** Every query `availabilityForMany`/`upgradesFor` can issue over this
 * fixture's players, none of whom are rostered, on waivers, or a starter -
 * so `upgrade` resolves through `decisionService.upgradeFor` (mocked) for
 * every one of them, and the identity/roster/waiver reads all come back
 * empty. Built for COUNTING calls, not for asserting particular values. */
function realProducerHandlers({ league, players }) {
  const positionById = new Map(players.map((p) => [p.id, p.position]));
  return [
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2$/, () => ({ rows: [TEAM] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({ rows: [league] })],
    [/FROM "players" AS "source"/, () => ({ rows: players })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "player_season_stats"/, () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS "roster_count" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: [{ roster_count: 0 }] })],
    // upgradesFor's lineup transaction: no current starters.
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [] })],
    // upgradesFor's own-roster check: nobody on the caller's roster.
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: [] })],
    [/^SELECT "id", "position" FROM "players" WHERE "id" = ANY/, (text, params) => ({
      rows: params[0].map((id) => ({ id, position: positionById.get(id) ?? null })),
    })],
    // loadIdentityIdsFor: no duplicate identity rows here (see the parity
    // tests below for that case) - single form returns the scalar id,
    // batch form maps every requested id to itself 1:1.
    [/^WITH "target" AS \(/, (text, params) => (text.includes('ANY($1::int[])')
      ? { rows: params[0].map((id) => ({ requested_id: id, identity_id: id })) }
      : { rows: [{ id: params[0] }] })],
    // Roster-with-team-name and waiver reads, single and batch forms alike:
    // nobody rostered, nobody on waivers.
    [/^SELECT "team_players"\."team_id"/, () => ({ rows: [] })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
    // The default (non-cards) view's attachLeagueAvailability, reached by the
    // plain sort=upgrade case below.
    [/^SELECT "team_id", "player_id" FROM "team_players"/, () => ({ rows: [] })],
  ];
}

function mockRealProducerServices(t, { seasonEnd = 17 } = {}) {
  t.mock.method(irPolicy, 'rosterCapacity', async () => 16);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(lineupService, 'parseLineupSettings', () => ({ rosterSlots: [] }));
  t.mock.method(decisionService, 'upgradeFor', () => ({ points: 1, overPlayer: { id: 9, name: 'Bench' }, slot: 'RB' }));
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => ({
    projections: new Map(playerIds.map((id) => [id, { median: 5, factors: { availability: { available: true } } }])),
  }));
  t.mock.method(projectionService, 'getWeeklyProjectionsForWeeks', async ({ weeks, playerIds }) => new Map(
    weeks.map((week) => [week, {
      week,
      projections: new Map(playerIds.map((id) => [id, { median: 5, factors: { availability: { available: true } } }])),
    }]),
  ));
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => new Map(
    playerIds.map((id) => [id, { total: 10, perGame: 2 }]),
  ));
  t.mock.method(projectionService, 'lastPlayoffWeek', () => seasonEnd);
}

/** Runs one request over a fresh fake pool and returns its call counts,
 * split by seam: `pool` is `pool.query` directly, `client` is a query issued
 * on a checked-out client (the lineup transaction inside `upgradesFor` -
 * BEGIN/COMMIT excluded, they are transaction bookkeeping, not reads). */
async function countCallsFor(t, { league, players, qs }) {
  const fake = createFakePool(realProducerHandlers({ league, players })).install(t);
  mockRealProducerServices(t);

  const res = await request(app).get(`/api/players?${qs}`).set('Authorization', TOKEN());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  fake.assertClean();
  t.mock.restoreAll();

  return {
    pool: fake.calls.filter((c) => c.via === 'pool').length,
    client: fake.calls.filter((c) => c.via === 'client' && c.text !== 'BEGIN' && c.text !== 'COMMIT').length,
  };
}

test('view=cards: pool.query and lineup-transaction call counts are the same for a 25-row page and a 1-row page, with the real availabilityForMany/upgradesFor/buildWeeksForPage running', async (t) => {
  const league = makeLeague({ currentWeek: 17 });
  const bigCounts = await countCallsFor(t, { league, players: makePlayers(25), qs: 'view=cards&leagueId=1' });
  const smallCounts = await countCallsFor(t, { league, players: makePlayers(1), qs: 'view=cards&leagueId=1' });

  assert.equal(bigCounts.pool, smallCounts.pool, `pool.query calls: 25-row (${bigCounts.pool}) vs 1-row (${smallCounts.pool})`);
  // The lineup transaction upgradesFor opens runs through a pooled CLIENT,
  // not pool.query directly - counted separately per the same "batched, not
  // per player" contract (Ruling item 11).
  assert.equal(bigCounts.client, smallCounts.client, `lineup transaction reads: 25-row (${bigCounts.client}) vs 1-row (${smallCounts.client})`);
  assert.ok(bigCounts.pool > 0 && bigCounts.client > 0, 'both seams were actually exercised, not skipped entirely');
});

test('sort=upgrade: pool.query and lineup-transaction call counts are the same for an eligible pool of 25 and a pool of 1, with the real upgradesFor running', async (t) => {
  const league = makeLeague({ currentWeek: 17 });
  const bigCounts = await countCallsFor(t, { league, players: makePlayers(25), qs: 'sort=upgrade&leagueId=1' });
  const smallCounts = await countCallsFor(t, { league, players: makePlayers(1), qs: 'sort=upgrade&leagueId=1' });

  assert.equal(bigCounts.pool, smallCounts.pool, `pool.query calls: pool of 25 (${bigCounts.pool}) vs pool of 1 (${smallCounts.pool})`);
  assert.equal(bigCounts.client, smallCounts.client, `lineup transaction reads: pool of 25 (${bigCounts.client}) vs pool of 1 (${smallCounts.client})`);
  assert.ok(bigCounts.pool > 0 && bigCounts.client > 0, 'both seams were actually exercised, not skipped entirely');
});

// ---------------------------------------------------------------------------
// N=1 vs batch parity (formal-1309-f2): loadIdentityIdsFor and
// availabilityForMany each fork on `players.length === 1` into a hand-copied
// scalar SQL branch (forced by playerCard.service.test.js's out-of-Scope
// fixtures, which only tolerate that exact query shape). This fixture
// answers BOTH shapes from one in-memory table, so the same duplicate-
// identity player can be resolved through either path and compared.
// ---------------------------------------------------------------------------

/** One real athlete with TWO `players` rows (id 1, its duplicate-source
 * sibling id 101), rostered by another team (id 55) under the sibling id -
 * exactly the case formal review f1 (on #1306) exists for: a duplicate row
 * must still resolve to the same Availability as the canonical one. */
function duplicateIdentityHandlers() {
  const identityOf = { 1: [1, 101], 2: [2], 3: [3] };
  return [
    [/^WITH "target" AS \(/, (text, params) => {
      if (text.includes('ANY($1::int[])')) {
        const rows = [];
        for (const id of params[0]) {
          for (const identityId of (identityOf[id] || [id])) rows.push({ requested_id: id, identity_id: identityId });
        }
        return { rows };
      }
      return { rows: (identityOf[params[0]] || [params[0]]).map((id) => ({ id })) };
    }],
    [/^SELECT "team_players"\."team_id", "team_players"\."player_id", "teams"\."name"/, (text, params) => ({
      rows: params[1].includes(101) ? [{ team_id: 55, player_id: 101, team_name: 'Other Team' }] : [],
    })],
    [/^SELECT "team_players"\."team_id", "teams"\."name"/, (text, params) => ({
      rows: params[1].includes(101) ? [{ team_id: 55, team_name: 'Other Team' }] : [],
    })],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [] })],
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: [] })],
    [/^SELECT "id", "position" FROM "players" WHERE "id" = ANY/, (text, params) => ({
      rows: params[0].map((id) => ({ id, position: 'RB' })),
    })],
  ];
}

test('formal-1309-f2: availabilityForMany over [p] and over [p, q, r] return the same entry for p, including a duplicate identity row', async (t) => {
  const league = makeLeague();
  createFakePool(duplicateIdentityHandlers()).install(t);

  const p = { id: 1 };
  const single = await playerCardService.availabilityForMany({ league, team: TEAM, players: [p] });
  t.mock.restoreAll();
  createFakePool(duplicateIdentityHandlers()).install(t);
  const batch = await playerCardService.availabilityForMany({ league, team: TEAM, players: [p, { id: 2 }, { id: 3 }] });

  const expected = { state: 'rostered', teamId: 55, teamName: 'Other Team', availableAt: null };
  assert.deepEqual(single.get(1), expected, 'the N=1 SQL shape resolves the duplicate identity row');
  assert.deepEqual(batch.get(1), expected, 'the batch SQL shape resolves the SAME duplicate identity row the same way');
});

test('formal-1309-f2: upgradesFor nulls a player whose duplicate identity row is on the caller\'s own roster, in the batch form', async (t) => {
  const league = makeLeague();
  // Same identity table as above, but player 1's sibling identity (101) is
  // on the CALLER's own roster this time - the own-roster handler goes FIRST
  // so it overrides duplicateIdentityHandlers()'s empty-rows default (fakePool
  // tries handlers in order and takes the first pattern match).
  const handlers = [
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: [{ player_id: 101 }] })],
    ...duplicateIdentityHandlers(),
  ];
  createFakePool(handlers).install(t);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(lineupService, 'parseLineupSettings', () => ({ rosterSlots: [] }));
  t.mock.method(decisionService, 'upgradeFor', () => ({ points: 9, overPlayer: { id: 5, name: 'Starter' }, slot: 'RB' }));
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());

  const upgrades = await playerCardService.upgradesFor({
    league, team: TEAM, season: 2026, week: 1, playerIds: [1, 2, 3],
  });

  assert.equal(upgrades.get(1), null, 'player 1 is already on the caller\'s roster via its duplicate identity row 101');
  assert.notEqual(upgrades.get(2), null, 'an unrelated candidate still gets a real Upgrade value');
});
