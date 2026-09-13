// GET /api/players/:id/card - route-level auth/caching regression coverage
// (issue #1306 risk review): the cache must never be read before membership
// is checked, and its key must never let one team's caller-varying payload
// (availability.state, faabRemaining, waiverPriority, upgrade, ...) leak to
// another team in the same league.
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const playerCardService = require('../services/playerCard.service');
const playerRouter = require('../routes/player.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-card-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

const tokenFor = (userId) => `Bearer ${signToken({ id: userId, username: `user${userId}` })}`;

/** teamByOwnerId: Map ownerId -> team row (or absent -> non-member). */
function mockMembership(t, teamByOwnerId) {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2')) {
      const team = teamByOwnerId.get(params[1]);
      return { rows: team ? [team] : [] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

// Each test below uses its OWN playerId (the in-memory summary cache is a
// module-level singleton shared across every test in this process, keyed by
// player/league/team/week) so one test's cache entries can never be mistaken
// for test pollution masking as - or hiding - a real cross-team leak.

test('GET /:id/card refuses a non-member with 403 even when a member has already warmed the cache', async (t) => {
  mockMembership(t, new Map([[7, { id: 10, league_id: 3, owner_id: 7, faab_remaining: 50 }]]));
  let calls = 0;
  t.mock.method(playerCardService, 'getPlayerCard', async () => {
    calls += 1;
    return { player: { id: 55 }, availability: { state: 'my_team' }, decision: {} };
  });

  const memberRes = await request(app)
    .get('/api/players/55/card?leagueId=3')
    .set('Authorization', tokenFor(7));
  assert.equal(memberRes.status, 200);
  assert.equal(calls, 1);

  // A different, non-member caller hits the SAME player+league within the
  // cache TTL. Before the risk-review fix the cache was read before
  // requireMember ran, so this returned the member's cached 200 payload.
  const nonMemberRes = await request(app)
    .get('/api/players/55/card?leagueId=3')
    .set('Authorization', tokenFor(999));
  assert.equal(nonMemberRes.status, 403);
  assert.equal(calls, 1); // never reached the service for the refused caller
});

test('GET /:id/card never serves one team\'s cached payload to a different team in the same league', async (t) => {
  mockMembership(t, new Map([
    [7, { id: 10, league_id: 3, owner_id: 7 }],
    [8, { id: 11, league_id: 3, owner_id: 8 }],
  ]));
  const payloadByTeamId = {
    10: { player: { id: 56 }, availability: { state: 'my_team' }, decision: { upgrade: null } },
    11: { player: { id: 56 }, availability: { state: 'rostered' }, decision: { upgrade: { points: 4.2 } } },
  };
  t.mock.method(playerCardService, 'getPlayerCard', async ({ userId }) => {
    const teamId = userId === 7 ? 10 : 11;
    return payloadByTeamId[teamId];
  });

  const teamAResponse = await request(app)
    .get('/api/players/56/card?leagueId=3')
    .set('Authorization', tokenFor(7));
  const teamBResponse = await request(app)
    .get('/api/players/56/card?leagueId=3')
    .set('Authorization', tokenFor(8));

  assert.equal(teamAResponse.body.availability.state, 'my_team');
  assert.equal(teamAResponse.body.decision.upgrade, null);
  assert.equal(teamBResponse.body.availability.state, 'rostered');
  assert.equal(teamBResponse.body.decision.upgrade.points, 4.2);
});

test('GET /:id/card still caches per (player, league, team, week): a second identical request is a cache hit', async (t) => {
  mockMembership(t, new Map([[7, { id: 10, league_id: 3, owner_id: 7 }]]));
  let calls = 0;
  t.mock.method(playerCardService, 'getPlayerCard', async () => {
    calls += 1;
    return { player: { id: 57 }, availability: { state: 'my_team' }, decision: {} };
  });

  await request(app).get('/api/players/57/card?leagueId=3').set('Authorization', tokenFor(7));
  await request(app).get('/api/players/57/card?leagueId=3').set('Authorization', tokenFor(7));
  assert.equal(calls, 1);
});

test('GET /:id/card rejects a non-integer or out-of-range week without reaching the service', async (t) => {
  mockMembership(t, new Map([[7, { id: 10, league_id: 3, owner_id: 7 }]]));
  let calls = 0;
  t.mock.method(playerCardService, 'getPlayerCard', async () => {
    calls += 1;
    return {};
  });

  const badWeek = await request(app)
    .get('/api/players/58/card?leagueId=3&week=abc')
    .set('Authorization', tokenFor(7));
  assert.equal(badWeek.status, 400);

  const outOfRange = await request(app)
    .get('/api/players/58/card?leagueId=3&week=99')
    .set('Authorization', tokenFor(7));
  assert.equal(outOfRange.status, 400);
  assert.equal(calls, 0);
});
