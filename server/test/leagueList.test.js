const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-list-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

test('GET league list exposes caller team waiver balances and preserves existing fields', async (t) => {
  let leagueQuery = null;
  const rows = [
    {
      id: 1,
      name: 'Priority League',
      draft_status: 'complete',
      waiver_type: 'priority',
      my_team_id: 11,
      my_team_name: 'Priority Team',
      my_team_avatar_url: 'https://example.com/avatar.webp',
      my_team_avatar_static_url: null,
      my_team_waiver_priority: 3,
      my_team_faab_remaining: 100,
      team_count: 10,
    },
    {
      id: 2,
      name: 'New Priority League',
      draft_status: 'pending',
      waiver_type: 'priority',
      my_team_id: 22,
      my_team_name: 'New Team',
      my_team_avatar_url: null,
      my_team_avatar_static_url: null,
      my_team_waiver_priority: null,
      my_team_faab_remaining: 75,
      team_count: 4,
    },
  ];

  t.mock.method(pool, 'query', async (sql, params) => {
    leagueQuery = String(sql);
    assert.deepEqual(params, [7]);
    return { rows };
  });

  const token = signToken({ id: 7, username: 'member' });
  const response = await request(app)
    .get('/api/league')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.match(leagueQuery, /"teams"\."waiver_priority" AS "my_team_waiver_priority"/);
  assert.match(leagueQuery, /"teams"\."faab_remaining" AS "my_team_faab_remaining"/);
  assert.deepEqual(response.body, rows);
  assert.equal(response.body[0].my_team_waiver_priority, 3);
  assert.equal(response.body[0].my_team_faab_remaining, 100);
  assert.equal(response.body[1].my_team_waiver_priority, null);
  assert.equal(response.body[0].my_team_id, 11);
  assert.equal(response.body[0].my_team_name, 'Priority Team');
  assert.equal(response.body[0].team_count, 10);
});
