/**
 * #373: GET /api/scoring/league/:id/standings leaked another manager's
 * account username onto every standings row (`season.getStandings` joined
 * `users` and overlaid `owner`, behind `requireMember` only). This pins the
 * EXACT key set of a served standings row, in the style of the
 * `league_history` route guard added by PR #370 (leagueHistory.route.test.js):
 * a Team row is seeded still carrying `owner` / `username` / `user_id` /
 * `email`, and the test fails if any of those reach the response.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const scoringRouter = require('../routes/scoring.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'scoring-standings-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/scoring', scoringRouter);

const VIEWER = { userId: 42, teamId: 11 };
const authed = `Bearer ${signToken({ id: VIEWER.userId, username: 'viewer' })}`;

// A Team row that still carries the leaked account fields, as if a
// regression re-added the `users` JOIN. Seeding them here (rather than
// omitting them) is what makes the test non-vacuous: it fails if any handler
// in the chain spreads the raw row into the response instead of picking the
// Team identity + avatar fields.
const leakyTeamRow = (over = {}) => ({
  id: VIEWER.teamId,
  name: 'Gridiron Ghosts',
  avatar_url: '/ghosts.png',
  avatar_static_url: null,
  owner: 'ghosts-owner',
  username: 'ghosts-owner',
  user_id: VIEWER.userId,
  owner_id: VIEWER.userId,
  email: 'ghosts-owner@example.com',
  ...over,
});

function standingsFake(t) {
  return createFakePool([
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({
      rows: [{ id: VIEWER.teamId, league_id: 1, owner_id: VIEWER.userId }],
    })],
    [/^SELECT "playoff_teams", "regular_season_weeks", "season_status", "current_week" FROM "leagues"/, () => ({
      rows: [{ playoff_teams: 4, regular_season_weeks: 13, season_status: 'regular', current_week: 3 }],
    })],
    [/FROM "matchups"/, () => ({
      rows: [{
        week: 1,
        home_team_id: VIEWER.teamId,
        away_team_id: 12,
        home_score: 100,
        away_score: 90,
        final: true,
        is_playoff: false,
      }],
    })],
    [/FROM "teams"/, () => ({
      rows: [leakyTeamRow(), leakyTeamRow({ id: 12, name: 'Sunday Scaries', owner: 'scaries-owner', username: 'scaries-owner', user_id: 43, owner_id: 43, email: 'scaries-owner@example.com' })],
    })],
  ]).install(t);
}

test('GET standings: a served row carries the exact key set, no account fields', async (t) => {
  standingsFake(t);

  const res = await request(app)
    .get('/api/scoring/league/1/standings')
    .set('Authorization', authed);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.standings.length > 0);
  for (const row of res.body.standings) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ['avatarStaticUrl', 'avatarUrl', 'losses', 'name', 'pa', 'pf', 'playoffSeed', 'rank', 'streak', 'teamId', 'ties', 'winPct', 'wins'].sort()
    );
    assert.equal('owner' in row, false, 'the manager account username is gone (#373)');
    assert.equal('username' in row, false);
    assert.equal('user_id' in row, false);
    assert.equal('userId' in row, false);
    assert.equal('owner_id' in row, false);
    assert.equal('email' in row, false);
  }
});
