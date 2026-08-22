// GET /api/players — NFL Team and Bye sort/filter, applied across the full
// eligible pool BEFORE the fixed 25-row pagination (issue #119, parent #108).
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const { REG_SEASON_WEEKS } = require('../services/bye.service');
const playerRouter = require('../routes/player.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-pool-schedule-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

const authHeader = `Bearer ${signToken({ id: 7, username: 'member' })}`;

// A tiny synthetic schedule: DAL is on bye week 6, ATL and KC share week 9,
// and NYJ has no rows at all (an unsynced/unknown schedule).
const NFL_GAMES = (() => {
  const byeByTeam = { DAL: 6, ATL: 9, KC: 9 };
  const rows = [];
  for (const [team, bye] of Object.entries(byeByTeam)) {
    for (let week = 1; week <= REG_SEASON_WEEKS; week++) {
      if (week === bye) continue;
      rows.push({ nfl_team: team, week });
    }
  }
  return rows;
})();

function installMock(t, playerRows) {
  let playersSql = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "players"')) {
      playersSql = text;
      return { rows: playerRows };
    }
    if (text.includes('FROM "nfl_games"')) return { rows: NFL_GAMES };
    if (text.includes('FROM "player_season_stats"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  return () => playersSql;
}

test('GET players?sort=nfl_team orders by team in SQL and keeps a normal LIMIT page', async (t) => {
  const getSql = installMock(t, [
    { id: 1, name: 'Alpha', position: 'RB', nfl_team: 'DAL', total_count: '2' },
    { id: 2, name: 'Bravo', position: 'RB', nfl_team: 'ATL', total_count: '2' },
  ]);

  const res = await request(app).get('/api/players?sort=nfl_team&dir=asc').set('Authorization', authHeader);

  assert.equal(res.status, 200);
  assert.match(getSql(), /ORDER BY "nfl_team" ASC NULLS LAST/);
  assert.ok(getSql().includes('LIMIT'), 'a plain column sort keeps the SQL-side page, unlike Bye/pace');
});

test('GET players?sort=bye_week fetches the full pool (no LIMIT) and sorts null-last in both directions', async (t) => {
  const rows = [
    { id: 1, name: 'Late Bye', position: 'RB', nfl_team: 'ATL', total_count: '4' }, // bye 9
    { id: 2, name: 'Early Bye', position: 'RB', nfl_team: 'DAL', total_count: '4' }, // bye 6
    { id: 3, name: 'Unsynced Team', position: 'RB', nfl_team: 'NYJ', total_count: '4' }, // unknown -> null
    { id: 4, name: 'No Team', position: 'RB', nfl_team: null, total_count: '4' }, // no team -> null
  ];

  const getSql = installMock(t, rows);
  const asc = await request(app).get('/api/players?sort=bye_week&dir=asc').set('Authorization', authHeader);
  assert.equal(asc.status, 200);
  assert.ok(!getSql().includes('LIMIT'), 'a computed field needs the full pool assembled before slicing');
  assert.deepEqual(asc.body.players.map((p) => p.id), [2, 1, 3, 4]);
  assert.deepEqual(asc.body.players.map((p) => p.bye_week), [6, 9, null, null]);

  const desc = await request(app).get('/api/players?sort=bye_week&dir=desc').set('Authorization', authHeader);
  assert.equal(desc.status, 200);
  // Nulls stay LAST in both directions — a naive "sort ascending, then
  // .reverse()" would flip them to the front here instead.
  assert.deepEqual(desc.body.players.map((p) => p.id), [1, 2, 3, 4]);
});

test('GET players?byeWeeks=6,9 filters the full pool before the page, excluding unknown byes', async (t) => {
  // 30 rows split across three teams — DAL (bye 6), ATL (bye 9), NYJ (unknown)
  // — well past one 25-row page, so a page-scoped filter would miss most of it.
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: `Player ${i + 1}`,
    position: 'RB',
    nfl_team: ['DAL', 'ATL', 'NYJ'][i % 3],
    total_count: '30',
  }));

  const getSql = installMock(t, rows);
  const res = await request(app).get('/api/players?byeWeeks=6,9').set('Authorization', authHeader);

  assert.equal(res.status, 200);
  assert.ok(!getSql().includes('LIMIT'));
  assert.equal(res.body.total, 20); // 30 rows minus the 10 unsynced-team (NYJ) rows
  assert.equal(res.body.totalPages, 1);
  assert.equal(res.body.players.length, 20);
  assert.ok(res.body.players.every((p) => p.bye_week === 6 || p.bye_week === 9));
});

test('sorting/filtering by Bye only queries season stats (17-game pace) for the returned page, not the whole pool', async (t) => {
  // 30 rows past one 25-row page, sorted/filtered by the schedule-derived
  // Bye field - the expensive per-player pace lookup should still only run
  // over the 25 actually returned, not all 30 that matched.
  const rows = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: `Player ${i + 1}`,
    position: 'RB',
    nfl_team: ['DAL', 'ATL'][i % 2],
    total_count: '30',
  }));
  let seasonStatsIds = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "players"')) return { rows };
    if (text.includes('FROM "nfl_games"')) return { rows: NFL_GAMES };
    if (text.includes('FROM "player_season_stats"')) {
      seasonStatsIds = params[0];
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app).get('/api/players?sort=bye_week').set('Authorization', authHeader);

  assert.equal(res.status, 200);
  assert.equal(res.body.players.length, 25);
  assert.equal(seasonStatsIds.length, 25);
});

test('GET players?byeWeeks=abc rejects a non-numeric bye filter without querying', async (t) => {
  const spy = t.mock.method(pool, 'query', async () => {
    throw new Error('must not query');
  });

  const res = await request(app).get('/api/players?byeWeeks=abc').set('Authorization', authHeader);

  assert.equal(res.status, 400);
  assert.equal(spy.mock.callCount(), 0);
});

test('GET players?byeWeeks=25 rejects a week outside 1..REG_SEASON_WEEKS', async (t) => {
  const spy = t.mock.method(pool, 'query', async () => {
    throw new Error('must not query');
  });

  const res = await request(app).get(`/api/players?byeWeeks=${REG_SEASON_WEEKS + 1}`).set('Authorization', authHeader);

  assert.equal(res.status, 400);
  assert.equal(spy.mock.callCount(), 0);
});
