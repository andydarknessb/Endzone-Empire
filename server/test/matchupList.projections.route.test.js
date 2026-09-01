const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const projectionService = require('../services/projection.service');

/**
 * GET /api/league/:id/matchups carries each side's projected starter total
 * (`home_projected_total` / `away_projected_total`) so Game Center can show
 * a projection per team without one detail fetch per matchup. The number is
 * built the way the matchup detail route builds `projectedTotal`: the
 * pool-wide week projection summed over the team's non-bench, non-IR lineup
 * rows, rounded to two decimals, read as the lineup stands (no materialize
 * on a list GET). Final matchups carry null and never fetch a week's
 * projections (a cache miss on the pool-wide producer writes one row per
 * player, so the list must not fan out across settled weeks).
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-list-projections-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const LEAGUE_ID = 1;
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

async function listMatchups(t, { matchups, lineupRows, projections }) {
  const projectionCalls = [];
  t.mock.method(projectionService, 'getWeekProjections', async (args) => {
    projectionCalls.push({ season: args.season, week: args.week });
    if (projections instanceof Error) throw projections;
    return projections;
  });
  const fake = createFakePool([
    [select('matchups'), () => ({ rows: matchups.map((m) => ({ ...m })) })],
    [/FROM "lineup_entries"/, () => {
      if (lineupRows instanceof Error) throw lineupRows;
      return { rows: lineupRows };
    }],
  ]);
  fake.install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { body: res.body, projectionCalls, fake };
}

const PROJECTIONS = new Map([
  [101, { points: 20.25, source: 'extrapolated' }],
  [102, { points: 30.1, source: 'extrapolated' }],
  [201, { points: 5, source: 'extrapolated' }],
]);

test("an open matchup carries each side's projected starter total; a final one carries null", async (t) => {
  const { body, projectionCalls } = await listMatchups(t, {
    matchups: [OPEN, FINAL],
    lineupRows: [
      { team_id: 11, season: 2026, week: 2, player_ids: [101, 102] },
      { team_id: 12, season: 2026, week: 2, player_ids: [201, 999] }, // 999: no projection row
    ],
    projections: PROJECTIONS,
  });
  const open = body.find((m) => m.id === 7);
  const done = body.find((m) => m.id === 6);
  assert.equal(open.home_projected_total, 50.35);
  assert.equal(open.away_projected_total, 5);
  assert.equal(done.home_projected_total, null);
  assert.equal(done.away_projected_total, null);
  // Only the open week's projections were fetched, and only once.
  assert.deepEqual(projectionCalls, [{ season: 2026, week: 2 }]);
  // Everything the row carried before still rides along.
  assert.equal(open.home_team_name, 'Gridiron Ghosts');
  assert.equal(done.home_score, '90');
});

test('a team with no lineup rows for the week gets null, not zero', async (t) => {
  const { body } = await listMatchups(t, {
    matchups: [OPEN],
    lineupRows: [{ team_id: 11, season: 2026, week: 2, player_ids: [101] }],
    projections: PROJECTIONS,
  });
  assert.equal(body[0].home_projected_total, 20.25);
  assert.equal(body[0].away_projected_total, null);
});

test('a projection outage leaves the totals null and the list still answers', async (t) => {
  const { body } = await listMatchups(t, {
    matchups: [OPEN],
    lineupRows: [{ team_id: 11, season: 2026, week: 2, player_ids: [101] }],
    projections: new Error('projection store down'),
  });
  assert.equal(body.length, 1);
  assert.equal(body[0].home_projected_total, null);
  assert.equal(body[0].away_projected_total, null);
});

test('an open week nobody has a lineup for yet carries null and never fetches projections', async (t) => {
  // A fresh schedule: weeks 2 and 3 are both open, only week 2 has lineups.
  const { body, projectionCalls } = await listMatchups(t, {
    matchups: [OPEN, row({ id: 8, week: 3 })],
    lineupRows: [{ team_id: 11, season: 2026, week: 2, player_ids: [101] }],
    projections: PROJECTIONS,
  });
  const later = body.find((m) => m.id === 8);
  assert.equal(later.home_projected_total, null);
  assert.equal(later.away_projected_total, null);
  assert.equal(body.find((m) => m.id === 7).home_projected_total, 20.25);
  assert.deepEqual(projectionCalls, [{ season: 2026, week: 2 }]);
});

test('an old-season leftover never pulls a settled week into the projections fetch', async (t) => {
  // Season rollover keeps matchup history and only the current week is ever
  // finalized, so one unfinalized 2025 matchup puts 2025 into the season
  // filter. The lineup query's season/week cross product then returns the
  // settled 2025 week 2 rows too; they must not trigger a projections read.
  const { body, projectionCalls } = await listMatchups(t, {
    matchups: [OPEN, row({ id: 5, season: 2025, week: 14 })],
    lineupRows: [
      { team_id: 11, season: 2026, week: 2, player_ids: [101] },
      { team_id: 11, season: 2025, week: 2, player_ids: [101] }, // cross-product noise
    ],
    projections: PROJECTIONS,
  });
  assert.deepEqual(projectionCalls, [{ season: 2026, week: 2 }]);
  assert.equal(body.find((m) => m.id === 7).home_projected_total, 20.25);
  assert.equal(body.find((m) => m.id === 5).home_projected_total, null);
});

test('a failed starter read leaves every total null and the list still answers', async (t) => {
  const { body, projectionCalls } = await listMatchups(t, {
    matchups: [OPEN],
    lineupRows: new Error('statement timeout'),
    projections: PROJECTIONS,
  });
  assert.equal(body.length, 1);
  assert.equal(body[0].home_projected_total, null);
  assert.equal(body[0].away_projected_total, null);
  assert.deepEqual(projectionCalls, []);
});

test('a list with only final matchups never touches lineups or projections', async (t) => {
  const { body, projectionCalls, fake } = await listMatchups(t, {
    matchups: [FINAL],
    lineupRows: [],
    projections: PROJECTIONS,
  });
  assert.equal(body[0].home_projected_total, null);
  assert.deepEqual(projectionCalls, []);
  assert.equal(fake.matching(/lineup_entries/).length, 0);
});
