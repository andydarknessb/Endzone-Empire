const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-create-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const CREATOR = 5;
const authed = () => `Bearer ${signToken({ id: CREATOR, username: 'commish' })}`;

/**
 * SQL-substring dispatch over a mocked transaction client, mirroring the
 * harness in pickem.router.test.js. The leagues INSERT echoes its params back
 * as the returned row, so assertions on the response body pin what the route
 * actually sent to the database.
 */
function mockClient(t, overrides = []) {
  const calls = [];
  const defaults = [
    [/^BEGIN$/, () => ({ rows: [] })],
    [/^COMMIT$/, () => ({ rows: [] })],
    [/^ROLLBACK$/, () => ({ rows: [] })],
    [/INSERT INTO "leagues"/, (text, params) => ({
      rows: [{
        id: 77,
        name: params[0],
        owner_id: params[1],
        max_teams: params[3],
        min_teams: params[4],
        best_ball: params[7],
        pickem_only: params[11],
        current_season: 2026,
        current_week: 1,
      }],
    })],
    [/INSERT INTO "teams"/, () => ({ rows: [] })],
    [/INSERT INTO "pickem_settings"/, () => ({ rows: [] })],
    [/WITH "season_weeks"/, () => ({ rows: [{ season: 2026, week: 7 }] })],
    [/^UPDATE "leagues" SET "current_season"/, (text, params) => ({
      rows: [{ id: params[2], pickem_only: true, current_season: params[0], current_week: params[1] }],
    })],
  ];
  const handlers = [...overrides, ...defaults];
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      for (const [pattern, handler] of handlers) {
        if (pattern.test(text)) return handler(text, params);
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release: () => {},
  }));
  return calls;
}

const statementsMatching = (calls, pattern) => calls.filter((c) => pattern.test(c.text));

test('fantasy create: pickem_only false, no pickem_settings row, no season seed', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Gridiron', maxTeams: 10 });
  assert.equal(res.status, 201);
  assert.equal(res.body.pickem_only, false);
  const leagueInsert = statementsMatching(calls, /INSERT INTO "leagues"/)[0];
  assert.match(leagueInsert.text, /"pickem_only"/);
  assert.equal(leagueInsert.params[11], false);
  assert.equal(statementsMatching(calls, /INSERT INTO "pickem_settings"/).length, 0);
  assert.equal(statementsMatching(calls, /WITH "season_weeks"/).length, 0);
  assert.equal(statementsMatching(calls, /^COMMIT$/).length, 1);
});

test("'both' create: pickem_settings written in the transaction with the chosen mode, no seed", async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Double Duty', leagueType: 'both', pickemMode: 'confidence' });
  assert.equal(res.status, 201);
  assert.equal(res.body.pickem_only, false);
  const settingsInserts = statementsMatching(calls, /INSERT INTO "pickem_settings"/);
  assert.equal(settingsInserts.length, 1);
  assert.match(settingsInserts[0].text, /"enabled".*VALUES \(\$1, true, \$2\)/);
  assert.deepEqual(settingsInserts[0].params, [77, 'confidence']);
  assert.equal(statementsMatching(calls, /WITH "season_weeks"/).length, 0);
});

test('pick\'em create: pickem_only true, settings row, and season/week seeded from the schedule', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Office Pool', leagueType: 'pickem', maxTeams: 50 });
  assert.equal(res.status, 201);
  const leagueInsert = statementsMatching(calls, /INSERT INTO "leagues"/)[0];
  assert.equal(leagueInsert.params[11], true);
  assert.equal(statementsMatching(calls, /INSERT INTO "pickem_settings"/).length, 1);
  const seedUpdate = statementsMatching(calls, /^UPDATE "leagues" SET "current_season"/)[0];
  assert.deepEqual(seedUpdate.params, [2026, 7, 77]);
  // The response carries the seeded pointer, not the column defaults.
  assert.equal(res.body.current_season, 2026);
  assert.equal(res.body.current_week, 7);
});

test('pick\'em create with an empty schedule table: no seed UPDATE, column defaults stand', async (t) => {
  const calls = mockClient(t, [
    [/WITH "season_weeks"/, () => ({ rows: [] })],
  ]);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Preseason Pool', leagueType: 'pickem' });
  assert.equal(res.status, 201);
  assert.equal(statementsMatching(calls, /^UPDATE "leagues" SET "current_season"/).length, 0);
  assert.equal(res.body.current_week, 1);
});

test('pick\'em create honors the 50 cap at the route; fantasy still rejects 50 naming 20', async (t) => {
  mockClient(t);
  const pickem = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Big Pool', leagueType: 'pickem', maxTeams: 50 });
  assert.equal(pickem.status, 201);
  const fantasy = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Big League', maxTeams: 50 });
  assert.equal(fantasy.status, 400);
  assert.match(fantasy.body.error, /between 2 and 20/);
});

test('a failure inside the transaction rolls the whole create back', async (t) => {
  const calls = mockClient(t, [
    [/INSERT INTO "pickem_settings"/, () => { throw new Error('boom'); }],
  ]);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Doomed Pool', leagueType: 'pickem' });
  assert.equal(res.status, 500);
  assert.equal(statementsMatching(calls, /^ROLLBACK$/).length, 1);
  assert.equal(statementsMatching(calls, /^COMMIT$/).length, 0);
});

test('rejected fantasy-only fields never reach the database', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Sneaky', leagueType: 'pickem', bestBall: true });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /bestBall/);
  assert.equal(calls.length, 0);
});
