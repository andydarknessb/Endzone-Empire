const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const commissionerRouter = require('../routes/commissioner.router');
const { createFakePool, select } = require('./helpers/fakePool');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'commissioner-rollover-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/commissioner', commissionerRouter);

test("POST rollover exposes the Pick'em missing-result integrity response without a candidate", async (t) => {
  const db = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [{
      id: 5,
      owner_id: 100,
      is_commissioner: true,
      pickem_only: true,
      season_status: 'complete',
      current_season: 2026,
    }] })],
    [select('pickem_season_results'), () => ({ rows: [] })],
  ]).install(t);
  const token = signToken({ id: 100, username: 'commissioner' });

  const response = await request(app)
    .post('/api/commissioner/league/5/rollover')
    .set('Authorization', `Bearer ${token}`)
    .send({});

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: 'PICKEM_SEASON_RESULT_MISSING',
    message: "Pick'em season result is missing for league 5, season 2026",
    leagueId: 5,
    season: 2026,
  });
  db.assertClean();
});
