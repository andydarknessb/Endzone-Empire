const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const projectionService = require('../services/projection.service');
const teamRouter = require('../routes/team.router');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'roster-weekly-projection-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);
app.use('/api/league', leagueRouter);

const token = () => signToken({ id: 7, username: 'member' });

test('GET team roster maps weekly projections by player id, preserving zero and null', async (t) => {
  const rosterRows = [
    { id: 1, name: 'Mapped Number', position: 'RB', nfl_team: 'MIN', team_id: 10 },
    { id: 2, name: 'Mapped Zero', position: 'WR', nfl_team: 'BUF', team_id: 10 },
    { id: 3, name: 'Missing Projection', position: 'TE', nfl_team: 'KC', team_id: 10 },
  ];
  const projectionCalls = [];
  t.mock.method(projectionService, 'getWeekProjections', async (options) => {
    projectionCalls.push(options);
    return new Map([
      [2, { points: 0, source: 'extrapolated' }],
      [1, { points: '12.5', source: 'external' }],
    ]);
  });
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "team_players"')) return { rows: rosterRows };
    if (text.includes('FROM "leagues"')) {
      return { rows: [{ current_season: 2026, current_week: 8 }] };
    }
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const response = await request(app)
    .get('/api/team/roster?leagueId=3')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.deepEqual(projectionCalls, [{ season: 2026, week: 8 }]);
  assert.deepEqual(
    response.body.map(({ id, projected_weekly_points }) => ({ id, projected_weekly_points })),
    [
      { id: 1, projected_weekly_points: 12.5 },
      { id: 2, projected_weekly_points: 0 },
      { id: 3, projected_weekly_points: null },
    ]
  );
});

test('GET league rosters maps weekly and rest-of-season projections by player id', async (t) => {
  const projectionCalls = [];
  const rosCalls = [];
  t.mock.method(projectionService, 'getWeekProjections', async (options) => {
    projectionCalls.push(options);
    return new Map([
      [12, { points: 0, source: 'extrapolated' }],
      [11, { points: 19.75, source: 'external' }],
    ]);
  });
  t.mock.method(projectionService, 'getRestOfSeasonProjections', async (options) => {
    rosCalls.push(options);
    return new Map([
      [12, 0],
      [11, 180.2],
    ]);
  });
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "leagues"')) {
      return { rows: [{ current_season: 2026, current_week: 9, regular_season_weeks: 17 }] };
    }
    if (text.includes('FROM "teams"')) {
      return {
        rows: [
          { team_id: 10, team_name: 'One', owner_id: 7, id: 11, name: 'Mapped Number', position: 'QB', nfl_team: 'BUF' },
          { team_id: 10, team_name: 'One', owner_id: 7, id: 12, name: 'Mapped Zero', position: 'RB', nfl_team: 'MIN' },
          { team_id: 20, team_name: 'Two', owner_id: 8, id: 13, name: 'Missing Projection', position: 'WR', nfl_team: 'KC' },
        ],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const response = await request(app)
    .get('/api/league/3/rosters')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.deepEqual(projectionCalls, [{ season: 2026, week: 9 }]);
  assert.deepEqual(rosCalls, [{ season: 2026, fromWeek: 9, throughWeek: 17 }]);
  assert.deepEqual(
    response.body.flatMap((team) => team.players)
      .map(({ id, projected_weekly_points, rest_of_season_points }) => ({
        id,
        projected_weekly_points,
        rest_of_season_points,
      })),
    [
      { id: 11, projected_weekly_points: 19.75, rest_of_season_points: 180.2 },
      { id: 12, projected_weekly_points: 0, rest_of_season_points: 0 },
      { id: 13, projected_weekly_points: null, rest_of_season_points: null },
    ]
  );
});
