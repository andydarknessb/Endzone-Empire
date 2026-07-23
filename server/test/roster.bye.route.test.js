const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const projectionService = require('../services/projection.service');
const teamRouter = require('../routes/team.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'roster-bye-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);

// A completed regular season for one team with a single missing week — that
// gap is the bye. Another team gets no schedule rows at all (undetermined).
const minScheduleRows = () => {
  const rows = [];
  for (let week = 1; week <= 18; week++) {
    if (week === 6) continue; // MIN's bye week
    rows.push({ nfl_team: 'MIN', week });
  }
  return rows;
};

test('GET roster annotates each player with a schedule-derived bye_week', async (t) => {
  const rosterRows = [
    { id: 1, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', acquired_at: '2026-01-01', team_id: 10 },
    { id: 2, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', acquired_at: '2026-01-02', team_id: 10 },
  ];
  let nflGamesTeams = null;

  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());

  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "team_players"')) return { rows: rosterRows };
    if (text.includes('FROM "leagues"')) return { rows: [{ current_season: 2026, current_week: 8 }] };
    if (text.includes('FROM "nfl_games"')) {
      nflGamesTeams = params[1]; // batched: one query for every roster team
      return { rows: minScheduleRows() }; // BUF absent -> undetermined
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: 'member' });
  const response = await request(app)
    .get('/api/team/roster?leagueId=3')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  // Bye present and correct for a player whose schedule has a known gap...
  assert.equal(response.body[0].bye_week, 6);
  // ...and null when the team's schedule is undetermined (no nfl_games rows).
  assert.equal(response.body[1].bye_week, null);
  // Existing fields are preserved (response shape is otherwise unchanged).
  assert.equal(response.body[0].name, 'Justin Jefferson');
  assert.equal(response.body[1].position, 'QB');
  // The bye lookup is batched into a single query over all roster teams.
  assert.deepEqual(nflGamesTeams, ['MIN', 'BUF']);
});
