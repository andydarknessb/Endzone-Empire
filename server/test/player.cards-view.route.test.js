// GET /api/players?view=cards[&sort=upgrade] (#1309, ADR 0040 slice 6): the
// Decision-card-shaped per-row fields on the paginated list, and the new
// `upgrade` sort key.
//
// `playerCardService.availabilityForMany` and `.upgradesFor` are mocked here
// (kept-whole cross-module requires, the same test seam convention the
// router's own comments document) - their query-count contracts belong to
// `server/services/playerCard.service.js`'s own suite, out of this ticket's
// Scope. `buildWeeksForPage` is exercised for REAL (it is new in this
// ticket): it only ever calls `projectionService.getWeeklyProjections`, no
// pool access, so mocking that one seam is enough to drive it, including the
// "one call per week for the whole page" query-count red-tell.
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

function mockBasePool(t, { league, players }) {
  return t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2')) {
      return { rows: [TEAM] };
    }
    if (text.startsWith('SELECT * FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "players" AS "source"')) return { rows: players };
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
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ week, playerIds }) => {
    weeklyCalls.push({ week, playerIds });
    const projections = new Map(playerIds.map((id) => [id, weeklyProjection(week, id)]));
    return { projections };
  });
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => new Map(
    playerIds.map((id) => [id, restOfSeason]),
  ));
  t.mock.method(projectionService, 'lastPlayoffWeek', () => seasonEnd);
  return { weeklyCalls, upgradesForCalls };
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

test('view=cards: buildWeeksForPage makes one getWeeklyProjections call per week for the WHOLE page, not per player', async (t) => {
  const league = makeLeague({ currentWeek: 10 });
  const bigPage = makePlayers(25);
  const smallPage = makePlayers(1);

  mockBasePool(t, { league, players: bigPage });
  const { weeklyCalls: bigCalls } = mockCardServices(t, {
    availability: new Map(bigPage.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
  });
  const bigRes = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', TOKEN());
  assert.equal(bigRes.status, 200, JSON.stringify(bigRes.body));
  t.mock.restoreAll();

  mockBasePool(t, { league, players: smallPage });
  const { weeklyCalls: smallCalls } = mockCardServices(t, {
    availability: new Map(smallPage.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }])),
  });
  const smallRes = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', TOKEN());
  assert.equal(smallRes.status, 200, JSON.stringify(smallRes.body));

  // Weeks 10..18 inclusive = 9 calls, regardless of how many players are on the page.
  assert.equal(bigCalls.length, 9);
  assert.equal(smallCalls.length, 9);
  assert.equal(bigCalls.length, smallCalls.length);
  assert.ok(bigCalls.every((call) => call.playerIds.length === 25));
});

test('sort=upgrade: rows sort by upgrade.points descending, nulls last', async (t) => {
  const league = makeLeague();
  const players = makePlayers(4);
  mockBasePool(t, { league, players });
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
