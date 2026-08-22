const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');

/**
 * GET /api/scoring/league/:id/power-rankings, the payload the Power Rankings
 * page reads: `data.rankings` (each row with its rank movement and the live
 * avatar overlay) plus `viewerTeamId`. Exercised over supertest with a fake
 * pool standing in for league_analytics and teams.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'power-rankings-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const CALLER = 9;
const authed = () => `Bearer ${signToken({ id: CALLER, username: 'u9' })}`;

const app = express();
app.use(express.json());
app.use('/api/scoring', require('../routes/scoring.router'));

const TEAM = { id: 41, league_id: 3, owner_id: CALLER, name: 'Team 9', locked: false };
const AVATARS = [
  { id: 41, avatar_url: 'https://cdn.example/41.gif', avatar_static_url: 'https://cdn.example/41.png' },
  { id: 42, avatar_url: null, avatar_static_url: null },
];
// Two stored weeks: team 42 led in week 7, team 41 leads in week 8.
const RUNS = [
  { season: 2026, week: 8, data: { runs: 500, rankings: [
    { teamId: 41, name: 'Team 9', rank: 1, playoffOdds: 0.9 },
    { teamId: 42, name: 'Rival', rank: 2, playoffOdds: 0.4 },
  ] } },
  { season: 2026, week: 7, data: { runs: 500, rankings: [
    { teamId: 42, name: 'Rival', rank: 1, playoffOdds: 0.6 },
    { teamId: 41, name: 'Team 9', rank: 2, playoffOdds: 0.7 },
  ] } },
];

function fakeDb(t, { runs = RUNS } = {}) {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (/FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/.test(text)) return { rows: [TEAM] };
    if (/FROM "league_analytics"/.test(text)) return { rows: runs };
    if (/SELECT "id", "avatar_url", "avatar_static_url" FROM "teams"/.test(text)) return { rows: AVATARS };
    throw new Error(`unexpected query: ${text}`);
  });
}

test('a member gets the latest run under data.rankings with movement, avatars and their own team id', async (t) => {
  fakeDb(t);
  const res = await request(app).get('/api/scoring/league/3/power-rankings').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.week, 8);
  assert.equal(res.body.viewerTeamId, 41);
  assert.deepEqual(res.body.data.rankings, [
    { teamId: 41, name: 'Team 9', rank: 1, playoffOdds: 0.9, change: 1,
      avatarUrl: 'https://cdn.example/41.gif', avatarStaticUrl: 'https://cdn.example/41.png' },
    { teamId: 42, name: 'Rival', rank: 2, playoffOdds: 0.4, change: -1,
      avatarUrl: null, avatarStaticUrl: null },
  ]);
  assert.equal(res.body.data.runs, 500, 'the rest of the stored run rides along');
});

test('404 until the first run has been stored', async (t) => {
  fakeDb(t, { runs: [] });
  const res = await request(app).get('/api/scoring/league/3/power-rankings').set('Authorization', authed());
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'no power rankings computed yet');
});

test('a non-member is refused with the standard 403 before any run is read', async (t) => {
  const reads = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    reads.push(text);
    if (/FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/.test(text)) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const res = await request(app).get('/api/scoring/league/3/power-rankings').set('Authorization', authed());
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'not a member of this league');
  assert.ok(!reads.some((q) => /league_analytics/.test(q)));
});
