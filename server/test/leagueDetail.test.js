const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-detail-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

test('GET league detail selects and serializes team readiness', async (t) => {
  let teamsQuery = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text === 'SELECT * FROM "leagues" WHERE "id" = $1') {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite' }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('COUNT("team_players"."id")')) {
      teamsQuery = text;
      return {
        rows: [{
          id: 11,
          name: "Alice's Team",
          draft_position: 1,
          faab_remaining: 100,
          locked: false,
          draft_ready: true,
          owner: 'alice',
          roster_count: 0,
          total_points: '0',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.match(teamsQuery, /"teams"\."draft_ready"/);
  assert.equal(response.body.teams[0].draft_ready, true);
});
