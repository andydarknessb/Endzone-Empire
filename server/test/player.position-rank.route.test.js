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

test('the derived rank falls back to rollup points for IDP rows only', async (t) => {
  let playersSql = null;
  let playersParams = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('COUNT(*) OVER()')) {
      playersSql = text;
      playersParams = params;
      return {
        rows: [
          // What the DB would derive: LB ranked from rollup points, rookie
          // LB (no rollup row) and undrafted WR both null. nfl_team stays null
          // so the bye-week lookup doesn't add a query to mock.
          { id: 10, name: 'Zaire Franklin', position: 'LB', nfl_team: null, adp: null, position_rank: 2, total_count: '3' },
          { id: 11, name: 'Rookie Backer', position: 'LB', nfl_team: null, adp: null, position_rank: null, total_count: '3' },
          { id: 12, name: 'Deep Bench Wide', position: 'WR', nfl_team: null, adp: null, position_rank: null, total_count: '3' },
        ],
      };
    }
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: 'member' });
  const res = await request(app)
    .get('/api/players')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  // Market branch keys off ADP presence; the IDP fallback comes from a
  // once-per-query ranked CTE (global — deliberately not under the outer
  // WHERE) joined 1:1, with a NOT NULL guard so a missing/void rollup can
  // never rank a player 1st.
  assert.match(playersSql, /WITH "player_identities" AS \(/);
  assert.match(playersSql, /"canonical_players" AS \(/);
  assert.match(playersSql, /"idp_ranks" AS \(/);
  assert.match(playersSql, /RANK\(\) OVER \(\s*PARTITION BY "p"\."position" ORDER BY "pss"\."fantasy_points" DESC\s*\)/);
  assert.match(playersSql, /"p"\."position" = ANY\(\$\d+\)/);
  assert.match(playersSql, /"pss"\."fantasy_points" IS NOT NULL/);
  assert.match(playersSql, /WHEN "players"\."adp" IS NOT NULL THEN/);
  assert.match(playersSql, /ELSE "idp_ranks"\."rank" END AS "position_rank"/);
  assert.match(playersSql, /LEFT JOIN "idp_ranks" ON "idp_ranks"\."player_id" = "players"\."id"/);
  // The bound inputs: the IDP position list and the last completed season.
  assert.ok(playersParams.some((p) => Array.isArray(p) && p.includes('LB') && p.includes('CB') && !p.includes('DEF')));
  assert.ok(playersParams.includes(2025)); // default currentSeasonYear 2026 - 1
  assert.deepEqual(
    res.body.players.map((p) => ({ id: p.id, position_rank: p.position_rank })),
    [
      { id: 10, position_rank: 2 },
      { id: 11, position_rank: null },
      { id: 12, position_rank: null },
    ]
  );
});
