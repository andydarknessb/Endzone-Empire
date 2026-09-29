const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const userRouter = require('../routes/user.router');

/**
 * The Postgame cutscene routes on the user router (ADR 0052): the due list
 * and the idempotent seen write. The service has its own suite; here the
 * concern is the HTTP contract: status codes, the body shape, and that the
 * routes are authenticated.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'user-router-postgame-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/user', userRouter);

const VIEWER = 7;
const authed = () => `Bearer ${signToken({ id: VIEWER, username: 'viewer' })}`;

const LEAGUE = { id: 71, name: 'Winsconsota', current_season: 2026, current_week: 5, my_team_id: 248, my_team_name: 'Crunchers' };
const MATCHUPS = {
  904: { id: 904, league_id: 71, season: 2026, week: 4, home_team_id: 248, away_team_id: 488, home_score: '114.50', away_score: '98.20', final: true, is_playoff: false },
  905: { id: 905, league_id: 71, season: 2026, week: 4, home_team_id: 488, away_team_id: 500, home_score: '101.00', away_score: '99.00', final: true, is_playoff: false },
};

function mockPool(t) {
  return createFakePool([
    [/FROM "notification_prefs"/, () => ({ rows: [] })],
    [/AS "my_team_id"/, () => ({ rows: [LEAGUE] })],
    [/"avatar_static_url" FROM "teams"/, () => ({ rows: [] })],
    [/^SELECT "teams"."id", "teams"."league_id", "teams"."name" FROM "teams"/, () => ({
      rows: [
        { id: 248, league_id: 71, name: 'Crunchers' },
        { id: 488, league_id: 71, name: 'Hitmen' },
        { id: 500, league_id: 71, name: 'Third Wheels' },
      ],
    })],
    [/FROM "matchups" JOIN "leagues"/, () => ({ rows: [MATCHUPS[904], MATCHUPS[905]] })],
    [/FROM "matchups" WHERE "id"/, (text, params) => ({ rows: MATCHUPS[params[0]] ? [MATCHUPS[params[0]]] : [] })],
    [/FROM "postgame_cutscene_views"/, () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/^INSERT INTO "postgame_cutscene_views"/, () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
}

test('GET /api/user/postgame-cutscenes answers { cutscenes } with the viewer\'s due Matchup', async (t) => {
  mockPool(t);
  const res = await request(app).get('/api/user/postgame-cutscenes').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), ['cutscenes']);
  assert.equal(res.body.cutscenes.length, 1);
  const [item] = res.body.cutscenes;
  assert.deepEqual(Object.keys(item), [
    'matchupId', 'leagueId', 'leagueName', 'season', 'week', 'playoff', 'outcome', 'me', 'opponent', 'record', 'standing',
  ]);
  assert.equal(item.matchupId, 904);
  assert.equal(item.outcome, 'win');
  assert.equal(item.me.teamId, 248);
});

test('the routes require authentication', async (t) => {
  mockPool(t);
  assert.equal((await request(app).get('/api/user/postgame-cutscenes')).status, 401);
  assert.equal((await request(app).post('/api/user/postgame-cutscenes/904/seen')).status, 401);
});

test('POST .../:matchupId/seen answers 204 twice for the same Matchup (idempotent)', async (t) => {
  const fake = mockPool(t);
  for (let i = 0; i < 2; i += 1) {
    const res = await request(app).post('/api/user/postgame-cutscenes/904/seen').set('Authorization', authed());
    assert.equal(res.status, 204);
    assert.equal(res.text, '');
  }
  const inserts = fake.matching(/^INSERT INTO "postgame_cutscene_views"/);
  assert.equal(inserts.length, 2);
  assert.match(inserts[0].text, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(inserts[0].params, [VIEWER, 904]);
});

test('POST .../:matchupId/seen answers 404 for a Matchup the viewer holds no Team in', async (t) => {
  const fake = mockPool(t);
  for (const id of ['905', '424242']) {
    const res = await request(app).post(`/api/user/postgame-cutscenes/${id}/seen`).set('Authorization', authed());
    assert.equal(res.status, 404);
  }
  assert.equal(fake.matching(/^INSERT INTO/).length, 0);
});

test('POST .../:matchupId/seen answers 400 for a non-integer id, before touching the database', async (t) => {
  const fake = mockPool(t);
  for (const id of ['abc', '1.5', '-3', '0', '99999999999']) {
    const res = await request(app).post(`/api/user/postgame-cutscenes/${id}/seen`).set('Authorization', authed());
    assert.equal(res.status, 400, `id ${id}`);
  }
  assert.equal(fake.calls.length, 0);
});

test('a failing read answers 500 without leaking the error', async (t) => {
  createFakePool([[/./, () => { throw new Error('boom: secret detail'); }]]).install(t);
  t.mock.method(console, 'error', () => {});
  const res = await request(app).get('/api/user/postgame-cutscenes').set('Authorization', authed());
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /secret detail/);
});
