const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-transactions-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const authed = () => `Bearer ${signToken({ id: 9, username: 'member' })}`;

test('GET transactions selects the joined positions and fills trade item positions from players', async (t) => {
  let listSql = null;
  let positionParams = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) return { rows: [{ 1: 1 }] };
    if (text.includes('FROM "transactions"')) {
      listSql = text;
      return {
        rows: [
          { id: 1, type: 'add', player_name: 'X', player_position: 'WR', detail: { playerId: 1 } },
          {
            id: 2,
            type: 'trade',
            detail: {
              items: [
                { playerId: 5, playerName: 'A', fromTeamId: 1, toTeamId: 2 },
                { playerId: 6, playerName: 'B', fromTeamId: 2, toTeamId: 1 },
              ],
            },
          },
          { id: 3, type: 'commissioner', detail: {} },
        ],
      };
    }
    if (text.includes('FROM "players"')) {
      positionParams = params;
      return { rows: [{ id: 5, position: 'QB' }, { id: 6, position: 'RB' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app).get('/api/league/12/transactions').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.match(listSql, /"players"\."position" AS "player_position"/);
  assert.match(listSql, /"dropped_player"\."position" AS "dropped_player_position"/);
  assert.equal(res.body[0].player_position, 'WR');
  assert.deepEqual(positionParams, [[5, 6]]);
  assert.deepEqual(res.body[1].detail.items.map((i) => i.position), ['QB', 'RB']);
  assert.equal(res.body[2].detail.items, undefined);
});
