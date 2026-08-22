const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const playerRouter = require('../routes/player.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-projection-sort-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

const playerRows = Array.from({ length: 28 }, (_, index) => ({
  id: index + 1,
  name: `Player ${index + 1}`,
  position: 'RB',
  nfl_team: null,
  total_count: '28',
}));

const seasonRows = [
  ...Array.from({ length: 26 }, (_, index) => ({
    player_id: index + 1,
    season: 2025,
    games_played: 17,
    stats: { rushingYards: (index + 1) * 10 },
  })),
  {
    player_id: 27,
    season: 2025,
    games_played: 17,
    // Exact zero returns null by producer design; a positive value that rounds to zero pins present-zero vs absent.
    stats: { rushingYards: 0.1 },
  },
];

test('GET players globally sorts and stably paginates projections with zero before null', async (t) => {
  const playerQueries = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "players"')) {
      playerQueries.push(text);
      return { rows: playerRows };
    }
    if (text.includes('FROM "player_season_stats"')) return { rows: seasonRows };
    throw new Error(`unexpected query: ${text}`);
  });

  const token = signToken({ id: 7, username: 'member' });
  const getPage = (page) => request(app)
    .get(`/api/players?sort=projected_points&dir=desc&page=${page}`)
    .set('Authorization', `Bearer ${token}`);

  const [firstPage, secondPage] = await Promise.all([getPage(1), getPage(2)]);

  assert.equal(firstPage.status, 200);
  assert.equal(secondPage.status, 200);
  assert.equal(playerQueries.length, 2);
  assert.ok(playerQueries.every((sql) => !sql.includes('LIMIT')));

  const combined = [...firstPage.body.players, ...secondPage.body.players];
  assert.deepEqual(
    combined.map((player) => player.id),
    [...Array.from({ length: 26 }, (_, index) => 26 - index), 27, 28]
  );
  assert.equal(new Set(combined.map((player) => player.id)).size, 28);
  assert.equal(firstPage.body.players.at(-1).id, 2);
  assert.equal(secondPage.body.players[0].id, 1);
  assert.equal(secondPage.body.players[1].projected_points, 0);
  assert.equal(secondPage.body.players[2].projected_points, null);
});
