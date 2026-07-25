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

function mockLeagueDetail(t, { isCommissioner = true, coCommissioners = [] } = {}) {
  const seen = {};
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('owner_username')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', owner_username: 'alice' }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('SELECT 1 FROM "leagues"')) {
      return { rows: isCommissioner ? [{ '?column?': 1 }] : [] };
    }
    if (text.includes('FROM "league_commissioners"')) return { rows: coCommissioners };
    if (text.includes('COUNT("team_players"."id")')) {
      seen.teamsQuery = text;
      return {
        rows: [{
          id: 11,
          name: "Alice's Team",
          owner_id: 42,
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
  return seen;
}

test('GET league detail selects and serializes team readiness', async (t) => {
  let teamsQuery = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('owner_username')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', owner_username: 'alice' }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('SELECT 1 FROM "leagues"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_commissioners"')) return { rows: [] };
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

test('GET league detail exposes the invite code and co-commissioner roster to a commissioner', async (t) => {
  const seen = mockLeagueDetail(t, {
    isCommissioner: true,
    coCommissioners: [{ user_id: 42, username: 'alice' }],
  });

  const token = signToken({ id: 99, username: 'co-commish' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.league.is_commissioner, true);
  assert.equal(response.body.league.invite_code, 'invite');
  assert.deepEqual(response.body.league.co_commissioners, [{ user_id: 42, username: 'alice' }]);
  // The promote/demote UI needs user ids, not just usernames.
  assert.match(seen.teamsQuery, /"teams"\."owner_id"/);
  assert.equal(response.body.teams[0].owner_id, 42);
});

test('GET league detail hides the invite code from a plain member', async (t) => {
  mockLeagueDetail(t, { isCommissioner: false, coCommissioners: [{ user_id: 42, username: 'alice' }] });

  const token = signToken({ id: 55, username: 'member' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.league.is_commissioner, false);
  assert.equal(response.body.league.invite_code, undefined);
  // Who holds power is not secret — only the join code is.
  assert.deepEqual(response.body.league.co_commissioners, [{ user_id: 42, username: 'alice' }]);
});
