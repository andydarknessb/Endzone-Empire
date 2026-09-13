// GET /api/players/:id/in-your-leagues (#1357, parent #1354): the viewer's
// own leagues, each with this player's Availability in that league.
// `availabilityFor` (playerCard.service.js) is the Decision card's own
// function - same four states, same rostering-team identity - projected down
// to `{ state, teamId, teamName }`. A pre-draft league, and a league where
// the viewer has no team (a commissioner-only membership), never appear.
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const playerRouter = require('../routes/player.router');
const publicRouter = require('../routes/public.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-in-your-leagues-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);
app.use('/api/public', publicRouter);

const VIEWER_ID = 7;
const authed = `Bearer ${signToken({ id: VIEWER_ID, username: 'viewer' })}`;

const PLAYER_ROW = { id: 55, name: 'Test Player', position: 'RB', nfl_team: 'ATL' };

// The identity-resolution query availabilityFor's availabilityForMany always
// runs first (loadIdentityIds): same shape and same answer regardless of
// which league is being asked about, so one handler serves every league.
const IDENTITY_HANDLER = [/FROM "players", "target"/, () => ({ rows: [{ id: PLAYER_ROW.id }] })];

// The roster-count read inside availabilityFor: never part of the response
// projection, so its value is arbitrary — only that it resolves.
const ROSTER_COUNT_HANDLER = [/COUNT\(\*\)::int AS "roster_count"/, () => ({ rows: [{ roster_count: 0 }] })];

const PLAYER_LOOKUP_HANDLER = [/^SELECT \* FROM "players" WHERE "id" = \$1$/, () => ({ rows: [PLAYER_ROW] })];

const LEAGUES_JOIN_PATTERN = /FROM "leagues" JOIN "teams" ON "teams"\."league_id" = "leagues"\."id" WHERE "teams"\."owner_id" = \$1/;

function leagueRow({ id, name, draftStatus, seasonStatus, teamId, pickemOnly = false }) {
  return {
    id,
    name,
    waiver_type: 'faab',
    waivers_clear_at: null,
    draft_status: draftStatus,
    season_status: seasonStatus,
    pickem_only: pickemOnly,
    roster_limit: 16,
    ir_slots: 0,
    team_id: teamId,
    team_faab_remaining: 50,
    team_waiver_priority: 3,
  };
}

test('three leagues (pre-draft, my_team, rostered) return two entries, in league-name order, pre-draft absent', async (t) => {
  const leagueRows = [
    leagueRow({ id: 1, name: 'Alpha League', draftStatus: 'pending', seasonStatus: 'regular', teamId: 201 }),
    leagueRow({ id: 2, name: 'Beta League', draftStatus: 'completed', seasonStatus: 'in_season', teamId: 202 }),
    leagueRow({ id: 3, name: 'Gamma League', draftStatus: 'completed', seasonStatus: 'in_season', teamId: 203 }),
  ];

  const fake = createFakePool([
    [LEAGUES_JOIN_PATTERN, () => ({ rows: leagueRows })],
    PLAYER_LOOKUP_HANDLER,
    IDENTITY_HANDLER,
    ROSTER_COUNT_HANDLER,
    [
      /FROM "team_players" JOIN "teams" ON "teams"\."id" = "team_players"\."team_id"/,
      (_text, params) => {
        const [leagueId] = params;
        if (leagueId === 2) return { rows: [{ team_id: 202, team_name: 'Beta Squad' }] }; // viewer's own team
        if (leagueId === 3) return { rows: [{ team_id: 999, team_name: 'Rival Squad' }] }; // another team
        return { rows: [] };
      },
    ],
    [/FROM "waiver_players"/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get('/api/players/55/in-your-leagues')
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.leagues, [
    {
      leagueId: 2,
      leagueName: 'Beta League',
      phase: 'in-season',
      availability: { state: 'my_team', teamId: 202, teamName: 'Beta Squad' },
    },
    {
      leagueId: 3,
      leagueName: 'Gamma League',
      phase: 'in-season',
      availability: { state: 'rostered', teamId: 999, teamName: 'Rival Squad' },
    },
  ]);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(fake.matching(/FROM "team_players" JOIN "teams"/).length, 2, 'one availability lookup per non-pre-draft league');
  // Security-critical: the leagues join must be scoped by the AUTHENTICATED
  // caller's id from the verified JWT, never by anything a client could send
  // (a query param, a body field). Pins req.user.id, not just "some" $1.
  assert.equal(fake.matching(LEAGUES_JOIN_PATTERN)[0].params[0], VIEWER_ID);
  // The title's "in league-name order" claim: the fixture already seeds
  // Alpha/Beta/Gamma sorted, so only pinning the SQL itself (not response
  // order, which would stay green with the ORDER BY removed) actually tests it.
  assert.match(fake.matching(LEAGUES_JOIN_PATTERN)[0].text, /ORDER BY "leagues"\."name" ASC/);
});

test('an unrostered player returns free_agent or waivers exactly as availabilityFor decides', async (t) => {
  const leagueRows = [
    leagueRow({ id: 4, name: 'Delta League', draftStatus: 'completed', seasonStatus: 'in_season', teamId: 204 }),
    leagueRow({ id: 5, name: 'Epsilon League', draftStatus: 'completed', seasonStatus: 'in_season', teamId: 205 }),
  ];

  createFakePool([
    [LEAGUES_JOIN_PATTERN, () => ({ rows: leagueRows })],
    PLAYER_LOOKUP_HANDLER,
    IDENTITY_HANDLER,
    ROSTER_COUNT_HANDLER,
    [/FROM "team_players" JOIN "teams" ON "teams"\."id" = "team_players"\."team_id"/, () => ({ rows: [] })],
    [
      /FROM "waiver_players"/,
      (_text, params) => {
        const [leagueId] = params;
        if (leagueId === 5) return { rows: [{ available_at: '2026-09-20T00:00:00.000Z' }] };
        return { rows: [] };
      },
    ],
  ]).install(t);

  const res = await request(app)
    .get('/api/players/55/in-your-leagues')
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.leagues, [
    {
      leagueId: 4,
      leagueName: 'Delta League',
      phase: 'in-season',
      availability: { state: 'free_agent', teamId: null, teamName: null },
    },
    {
      leagueId: 5,
      leagueName: 'Epsilon League',
      phase: 'in-season',
      availability: { state: 'waivers', teamId: null, teamName: null },
    },
  ]);
});

test('unauthenticated request is refused with 401', async () => {
  const res = await request(app).get('/api/players/55/in-your-leagues');
  assert.equal(res.status, 401);
});

test('unknown player id is 404', async (t) => {
  createFakePool([
    [/^SELECT \* FROM "players" WHERE "id" = \$1$/, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get('/api/players/999999/in-your-leagues')
    .set('Authorization', authed);

  assert.equal(res.status, 404);
});

test('a viewer with no leagues gets an empty array', async (t) => {
  createFakePool([
    PLAYER_LOOKUP_HANDLER,
    [LEAGUES_JOIN_PATTERN, () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .get('/api/players/55/in-your-leagues')
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.leagues, []);
});

test('a pick\'em-only league is omitted: it has no roster, so no Availability to name there', async (t) => {
  // A pick'em-only league still has a `teams` row for the viewer (the same
  // join GET /api/league/ uses returns it), and deriveLeaguePhase resolves it
  // to IN_SEASON/COMPLETE, never PRE_DRAFT — so the PRE_DRAFT filter alone
  // would leave it in. It must be dropped on league type instead.
  const leagueRows = [
    leagueRow({ id: 6, name: 'Zeta Pick\'em', draftStatus: 'pending', seasonStatus: 'in_season', teamId: 206, pickemOnly: true }),
  ];

  createFakePool([
    PLAYER_LOOKUP_HANDLER,
    [LEAGUES_JOIN_PATTERN, () => ({ rows: leagueRows })],
    // No availability-lookup handlers seeded: an unexpected query here (i.e.
    // the route still calling availabilityFor for the pick'em-only league)
    // throws "unexpected query", failing the test.
  ]).install(t);

  const res = await request(app)
    .get('/api/players/55/in-your-leagues')
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.leagues, []);
});

// The public profile route (server/routes/public.router.js) must keep its own,
// very different, Cache-Control, asserted in THIS test file per the issue's
// criteria: this endpoint is viewer-scoped (private, no-store) while the
// public profile is CDN-cacheable (public, s-maxage). Pinned here so a change
// to one can't silently move onto the other.
test("the public profile route's Cache-Control is unchanged", async (t) => {
  createFakePool([
    [select('players'), () => ({ rows: [{
      id: 1, name: 'Public Player', position: 'RB', nfl_team: 'ATL',
      photo_url: null, jersey_number: null, injury_status: null,
      injury_detail: null, news: null, adp: null,
    }] })],
    [/UNION SELECT DISTINCT "season"/, () => ({ rows: [] })],
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, () => ({ rows: [{ season: 2026 }] })],
  ]).install(t);

  const res = await request(app).get('/api/public/players/1?season=2026');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
});
