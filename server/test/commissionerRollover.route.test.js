const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const commissionerRouter = require('../routes/commissioner.router');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');

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
    // #274: the rollover's two writes are answered, so the counts below are
    // real assertions rather than fakePool's unexpected-query throw wearing
    // the costume of one.
    //
    // Stated honestly, because the convention says to: this fixture does NOT
    // answer the reads BETWEEN the guard and those writes (the teams read,
    // then getSeasonSlate and getPickemStandings), so a guard moved all the
    // way down would today still die on an unregistered SELECT before it
    // reached either write. Nor does it cover the third write on that path,
    // INSERT INTO "trophies". Building that path out here would duplicate
    // commissioner.rollover.test.js, which already covers this same refusal at
    // the service seam with exact counts over a fixture that does answer it.
    // This is the paired arrangement the guidance describes: the route test
    // owns the HTTP shape, the service test owns the write-absence proof, and
    // the counts below are this test's own floor rather than its only defence.
    [insert('league_history'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
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
  // #274. assertClean() proves clients were released and no transaction was
  // left open, which a rolled-back transaction satisfies by definition - it is
  // strictly weaker even than the no-COMMIT check the convention already rules
  // insufficient. These are the assertions that can fail on a misplaced guard.
  assert.equal(db.matching(insert('league_history')).length, 0, 'no season was archived');
  assert.equal(db.matching(update('leagues')).length, 0, 'the season did not roll over');
  assert.equal(db.matching(/^COMMIT$/).length, 0); // complementary only
  db.assertClean();
});
