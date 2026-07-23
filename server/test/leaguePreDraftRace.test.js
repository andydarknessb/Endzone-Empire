const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-predraft-race-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

test('pre-draft settings reject a draft that starts between status check and update', async (t) => {
  let updateQuery = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', min_teams: 2, max_teams: 12, draft_date: null,
          roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
          keepers_enabled: false, keeper_count: 0, team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      updateQuery = text;
      // Simulate draftStart committing after the status read but before this UPDATE.
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', `Bearer ${token}`)
    .send({ pickTimeSeconds: 90 });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /locked once the draft starts/);
  assert.match(updateQuery, /AND "draft_status" = 'pending'/);
});

test('administrative-only updates remain available after draft start', async (t) => {
  let updateQuery = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.startsWith('UPDATE "leagues"')) {
      updateQuery = text;
      return { rows: [{ id: 1, owner_id: 7, name: 'Renamed League', draft_status: 'active' }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Renamed League' });

  assert.equal(response.status, 200);
  assert.doesNotMatch(updateQuery, /AND "draft_status" = 'pending'/);
});
