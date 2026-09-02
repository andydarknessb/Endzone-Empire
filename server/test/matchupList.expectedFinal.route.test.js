const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const projectionService = require('../services/projection.service');

/**
 * GET /api/league/:id/matchups carries each side's expected final and
 * players remaining (`home_expected_final`, `away_expected_final`,
 * `home_players_remaining`, `away_players_remaining`; number or null) so
 * Game Center can show them without one detail fetch per matchup. The
 * numbers come from expectedFinal.service, the one producer shared with the
 * detail route and the live-score socket; this suite drives the real route
 * and the real producer over the fake pool, mocking only the projection
 * run, and checks the route's contract: the league row is fetched only when
 * an open matchup exists, rows are decorated in place, and a projection
 * outage still answers 200 with nulls.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-list-expected-final-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const LEAGUE_ID = 1;
const LEAGUE = { id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false };
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

const row = (overrides = {}) => ({
  id: 7,
  league_id: LEAGUE_ID,
  season: 2026,
  week: 2,
  home_team_id: 11,
  away_team_id: 12,
  home_score: '0',
  away_score: '0',
  final: false,
  home_team_name: 'Gridiron Ghosts',
  away_team_name: 'Sunday Scaries',
  home_team_avatar_url: null,
  away_team_avatar_url: null,
  home_team_avatar_static_url: null,
  away_team_avatar_static_url: null,
  ...overrides,
});

const OPEN = row({ id: 7, week: 2 });
const FINAL = row({ id: 6, week: 1, final: true, home_score: '90', away_score: '80' });

// Home has two starters not yet kicked off (projections 20.25 + 30.1);
// away has one whose game is final at 5.0 actual (50 rushing yards).
const STARTERS = [
  { team_id: 11, player_id: 101, nfl_team: 'KC', injury_status: null, stats: null },
  { team_id: 11, player_id: 102, nfl_team: 'BUF', injury_status: null, stats: null },
  { team_id: 12, player_id: 201, nfl_team: 'DAL', injury_status: null, stats: { rushingYards: 50 } },
];
const PROJECTIONS = new Map([
  [101, { points: 20.25 }],
  [102, { points: 30.1 }],
  [201, { points: 12 }],
]);
const SCHEDULE = [
  { nfl_team: 'KC', kickoff_at: '2026-09-13T17:00:00.000Z' },
  { nfl_team: 'BUF', kickoff_at: '2026-09-13T17:00:00.000Z' },
  { nfl_team: 'DAL', kickoff_at: '2026-09-10T00:20:00.000Z' },
];
const LIVE = [{ home_team: 'DAL', away_team: 'PHI', game_status: 'final' }];
const BYE_ROWS = [];
for (let w = 1; w <= 18; w++) for (const team of ['KC', 'BUF', 'DAL']) BYE_ROWS.push({ nfl_team: team, week: w });

async function listMatchups(t, { matchups, starters = STARTERS, projections = PROJECTIONS }) {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => {
    if (projections instanceof Error) throw projections;
    return { modelVersion: 'test', projections };
  });
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  const fake = createFakePool([
    [select('matchups'), () => ({ rows: matchups.map((m) => ({ ...m })) })],
    [select('leagues'), () => ({ rows: [{ ...LEAGUE }] })],
    [/FROM "lineup_entries"/, () => ({ rows: starters })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: BYE_ROWS })],
    [/FROM "live_game_states"/, () => ({ rows: LIVE })],
    [/FROM "nfl_games" WHERE/, () => ({ rows: SCHEDULE })],
  ]);
  fake.install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { body: res.body, fake };
}

test('an open matchup carries both sides; a final one carries null; the projection run is scored under the league row', async (t) => {
  const { body, fake } = await listMatchups(t, { matchups: [OPEN, FINAL] });
  const open = body.find((m) => m.id === 7);
  const done = body.find((m) => m.id === 6);
  // The route's clock is real time. With no live row the schedule decides:
  // before kickoff the two home starters are their full projection, and
  // after it, with no points yet, they are in progress at that same figure.
  // Either way the home side sums to 50.35, so the assertion holds whenever
  // this suite runs relative to the fixture's 2026-09-13 kickoffs.
  assert.equal(open.home_expected_final, 50.35);
  assert.equal(open.away_expected_final, 5);
  assert.equal(open.home_players_remaining, 2);
  assert.equal(open.away_players_remaining, 0);
  for (const key of ['home_expected_final', 'away_expected_final', 'home_players_remaining', 'away_players_remaining']) {
    assert.equal(done[key], null);
  }
  // The shipped contract carries no projected-total field any more.
  assert.equal('home_projected_total' in open, false);
  // One projection run, for every starter, under this league.
  const calls = projectionService.getWeeklyProjections.mock.calls;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments[0].league.id, LEAGUE_ID);
  assert.deepEqual([...calls[0].arguments[0].playerIds].sort(), [101, 102, 201]);
  // The league row was read exactly once.
  assert.equal(fake.matching(/FROM "leagues"/).length, 1);
  // Everything the row carried before still rides along.
  assert.equal(open.home_team_name, 'Gridiron Ghosts');
  assert.equal(done.home_score, '90');
});

test('a team with no starter rows stays null, not zero', async (t) => {
  const { body } = await listMatchups(t, {
    matchups: [OPEN],
    starters: STARTERS.filter((s) => s.team_id === 11),
  });
  assert.equal(body[0].home_expected_final, 50.35);
  assert.equal(body[0].away_expected_final, null);
  assert.equal(body[0].away_players_remaining, null);
});

test('a projection outage leaves the four fields null and the list still answers', async (t) => {
  const { body } = await listMatchups(t, {
    matchups: [OPEN],
    projections: new Error('projection store down'),
  });
  assert.equal(body.length, 1);
  assert.equal(body[0].home_expected_final, null);
  assert.equal(body[0].away_expected_final, null);
});

test('a list with only final matchups never reads the league row, lineups or projections', async (t) => {
  const { body, fake } = await listMatchups(t, { matchups: [FINAL] });
  assert.equal(body[0].home_expected_final, null);
  assert.equal(fake.matching(/FROM "leagues"/).length, 0);
  assert.equal(fake.matching(/lineup_entries/).length, 0);
  assert.equal(projectionService.getWeeklyProjections.mock.calls.length, 0);
});
