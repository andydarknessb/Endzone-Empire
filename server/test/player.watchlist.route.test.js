// PUT/DELETE /api/players/:id/watch and the `watching` field on
// GET /api/players?view=cards and GET /:id/card (#1312, ADR 0040 follow-up,
// grill ruling Q6). The watchlist itself runs for REAL over a stateful fake
// `player_watchlist` table (the "stateful world" convention fakePool.js's
// own docblock names), so this exercises the actual INSERT/DELETE/SELECT
// `playerWatchlist.js` issues, not a mocked service - the red-tell this
// ticket's Ruling names: "PUT then GET ?view=cards shows watching: true for
// that player and DELETE clears it; a second team's GET shows false".
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
const { createFakePool } = require('./helpers/fakePool');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-watchlist-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

const tokenFor = (userId) => `Bearer ${signToken({ id: userId, username: `user${userId}` })}`;

const TEAM_A = { id: 10, league_id: 1, owner_id: 7, faab_remaining: 50, waiver_priority: 3 };
const TEAM_B = { id: 11, league_id: 1, owner_id: 8, faab_remaining: 50, waiver_priority: 4 };

/** A stateful in-memory `player_watchlist` table (fakePool.js's own
 * "stateful worlds are handlers closing over a mutable object" convention):
 * real SQL text match, real INSERT/DELETE/SELECT semantics, no real
 * Postgres. `teamByOwnerId` resolves `requireMember`'s own membership query. */
function watchlistWorld(teamByOwnerId) {
  const rows = new Set(); // "teamId:playerId"
  return {
    key: (teamId, playerId) => `${teamId}:${playerId}`,
    handlers: [
      [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2$/, (text, params) => {
        const team = teamByOwnerId.get(params[1]);
        return { rows: team ? [team] : [] };
      }],
      [/^INSERT INTO "player_watchlist"/, (text, params) => {
        rows.add(`${params[0]}:${params[1]}`);
        return { rows: [] };
      }],
      [/^DELETE FROM "player_watchlist"/, (text, params) => {
        rows.delete(`${params[0]}:${params[1]}`);
        return { rows: [] };
      }],
      [/^SELECT 1 FROM "player_watchlist"/, (text, params) => (
        rows.has(`${params[0]}:${params[1]}`) ? { rows: [{ '?column?': 1 }] } : { rows: [] }
      )],
      [/^SELECT "player_id" FROM "player_watchlist"/, (text, params) => {
        const [teamId, playerIds] = params;
        return { rows: playerIds.filter((id) => rows.has(`${teamId}:${id}`)).map((id) => ({ player_id: id })) };
      }],
    ],
  };
}

test('PUT then DELETE /:id/watch: idempotent, returns the settled { watching } state', async (t) => {
  const world = watchlistWorld(new Map([[7, TEAM_A]]));
  createFakePool(world.handlers).install(t);

  const first = await request(app).put('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { watching: true });

  // Watching an already-watched player is a no-op, not a duplicate or an error.
  const again = await request(app).put('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { watching: true });

  const removed = await request(app).delete('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { watching: false });

  // Unwatching a player never watched is a 200, not an error.
  const removedAgain = await request(app).delete('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(removedAgain.status, 200);
  assert.deepEqual(removedAgain.body, { watching: false });
});

test('PUT /:id/watch refuses a non-member with 403', async (t) => {
  createFakePool(watchlistWorld(new Map()).handlers).install(t);

  const res = await request(app).put('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(999));
  assert.equal(res.status, 403);
});

test('PUT/DELETE /:id/watch reject a non-integer player id or a missing leagueId', async (t) => {
  createFakePool(watchlistWorld(new Map([[7, TEAM_A]])).handlers).install(t);

  const badId = await request(app).put('/api/players/abc/watch?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(badId.status, 400);

  const noLeague = await request(app).put('/api/players/55/watch').set('Authorization', tokenFor(7));
  assert.equal(noLeague.status, 400);
});

// GET /:id/card - #1306 payload attaches `watching` for the CALLER's own team.
test('GET /:id/card carries watching: true after a PUT and watching: false after the DELETE', async (t) => {
  const world = watchlistWorld(new Map([[7, TEAM_A]]));
  createFakePool(world.handlers).install(t);
  t.mock.method(playerCardService, 'getPlayerCard', async () => (
    { player: { id: 55 }, availability: { state: 'my_team' }, decision: {} }
  ));

  await request(app).put('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(7));
  const watched = await request(app).get('/api/players/55/card?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(watched.status, 200);
  assert.equal(watched.body.watching, true);

  await request(app).delete('/api/players/55/watch?leagueId=1').set('Authorization', tokenFor(7));
  // A distinct player id sidesteps this route's own 30s summary cache -
  // playerCard.route.test.js already pins that cache's own key contract, and
  // isn't this ticket's concern.
  t.mock.method(playerCardService, 'getPlayerCard', async () => (
    { player: { id: 56 }, availability: { state: 'my_team' }, decision: {} }
  ));
  const unwatched = await request(app).get('/api/players/56/card?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(unwatched.status, 200);
  assert.equal(unwatched.body.watching, false);
});

// Risk review: `watching` used to be baked into the cached payload
// (summaryCacheSet), so a PUT/DELETE between two reads of the SAME
// player+league+team+week within the 30s TTL showed the pre-write value on
// the second read - reproduced and fixed by reading `watching` fresh on
// every request, cache hit or miss.
test('GET /:id/card reads watching fresh even on a cache hit for the SAME player', async (t) => {
  const world = watchlistWorld(new Map([[7, TEAM_A]]));
  createFakePool(world.handlers).install(t);
  const getPlayerCardMock = t.mock.method(playerCardService, 'getPlayerCard', async () => (
    { player: { id: 60 }, availability: { state: 'my_team' }, decision: {} }
  ));

  const first = await request(app).get('/api/players/60/card?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(first.body.watching, false);

  await request(app).put('/api/players/60/watch?leagueId=1').set('Authorization', tokenFor(7));

  // Second read of the SAME player+league+team+week: a cache hit on the rest
  // of the payload, proven directly (formal review f5) by the underlying
  // getPlayerCard mock's own call count, not an inference - yet `watching`
  // still reflects the PUT that just happened.
  const second = await request(app).get('/api/players/60/card?leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(second.status, 200);
  assert.equal(getPlayerCardMock.mock.callCount(), 1, 'the second read must be a cache hit, not a second getPlayerCard call');
  assert.equal(second.body.watching, true, 'a cache hit must not serve a stale watching value');
});

// GET ?view=cards - #1309 row attaches `watching` for the CALLER's own team,
// scoped so a second team's own read never sees the first team's watch.
function makeLeague() {
  return {
    id: 1,
    name: 'Test League',
    current_season: 2026,
    current_week: 3,
    best_ball: false,
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

function mockCardsViewPool(t, { league, players, world }) {
  return t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    for (const [pattern, handler] of world.handlers) {
      if (pattern.test(text)) return handler(text, params);
    }
    if (text.startsWith('SELECT * FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "players" AS "source"')) return { rows: players };
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    if (text.includes('COUNT(*)::int AS "roster_count"')) return { rows: [{ roster_count: 0 }] };
    throw new Error(`unexpected query: ${text}`);
  });
}

function mockCardServices(t) {
  t.mock.method(irPolicy, 'rosterCapacity', async () => 16);
  t.mock.method(playerCardService, 'availabilityForMany', async (opts) => new Map(
    opts.players.map((p) => [p.id, { state: 'free_agent', teamId: null, teamName: null, availableAt: null }]),
  ));
  t.mock.method(playerCardService, 'upgradesFor', async () => new Map());
  t.mock.method(projectionService, 'getWeeklyProjections', async ({ playerIds }) => ({
    projections: new Map(playerIds.map((id) => [id, { median: 5, factors: { availability: { available: true } } }])),
  }));
  t.mock.method(projectionService, 'getRestOfSeason', async (playerIds) => new Map(
    playerIds.map((id) => [id, { total: 10, perGame: 2 }]),
  ));
  t.mock.method(projectionService, 'lastPlayoffWeek', () => 17);
}

test('GET ?view=cards: watching flips true after a PUT and false again after the DELETE', async (t) => {
  const league = makeLeague();
  const players = makePlayers(1);
  const world = watchlistWorld(new Map([[7, TEAM_A]]));
  mockCardsViewPool(t, { league, players, world });
  mockCardServices(t);

  const before = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.players[0].watching, false);

  await request(app).put('/api/players/1/watch?leagueId=1').set('Authorization', tokenFor(7));

  const after1 = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(after1.body.players[0].watching, true);

  await request(app).delete('/api/players/1/watch?leagueId=1').set('Authorization', tokenFor(7));

  const after2 = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(after2.body.players[0].watching, false);
});

test('GET ?view=cards: a second team never sees the first team\'s watch', async (t) => {
  const league = makeLeague();
  const players = makePlayers(1);
  const world = watchlistWorld(new Map([[7, TEAM_A], [8, TEAM_B]]));
  mockCardsViewPool(t, { league, players, world });
  mockCardServices(t);

  await request(app).put('/api/players/1/watch?leagueId=1').set('Authorization', tokenFor(7));

  const teamARes = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', tokenFor(7));
  assert.equal(teamARes.body.players[0].watching, true);

  const teamBRes = await request(app).get('/api/players?view=cards&leagueId=1').set('Authorization', tokenFor(8));
  assert.equal(teamBRes.body.players[0].watching, false);
});
