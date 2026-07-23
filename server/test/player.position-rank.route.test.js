const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const playerRouter = require('../routes/player.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-position-rank-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

test('GET players?sort=position_rank orders by the derived rank in SQL and passes it through', async (t) => {
  let playersSql = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "players"')) {
      playersSql = text;
      return {
        rows: [
          { id: 1, name: 'Alpha', position: 'RB', nfl_team: null, position_rank: 1, total_count: '2' },
          { id: 2, name: 'Bravo', position: 'RB', nfl_team: null, position_rank: 2, total_count: '2' },
        ],
      };
    }
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: 'member' });
  const res = await request(app)
    .get('/api/players?sort=position_rank&dir=asc')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  // Unlike the projected_points sort (re-sorted in JS over the full set), position_rank
  // is a whitelisted DB ordering — the query carries the ORDER BY, the derived column, and a normal LIMIT page.
  assert.match(playersSql, /ORDER BY "position_rank" ASC NULLS LAST/);
  assert.match(playersSql, /AS "position_rank"/);
  assert.ok(playersSql.includes('LIMIT'));
  assert.deepEqual(
    res.body.players.map((p) => ({ id: p.id, position_rank: p.position_rank })),
    [
      { id: 1, position_rank: 1 },
      { id: 2, position_rank: 2 },
    ]
  );
});
