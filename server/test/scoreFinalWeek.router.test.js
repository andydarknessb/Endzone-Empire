/**
 * POST /league/:id/score refuses a final week before it re-scores anything.
 *
 * A final week's Score of record moves only through a Stat correction or a
 * commissioner's manual correction (CONTEXT.md, Score of record). The plain
 * re-score route must not be a third way in, and it must not tell a non-
 * commissioner anything about finality.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const scoring = require('../services/matchupScoring.service');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'score-final-week-router-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const scoringRouter = require('../routes/scoring.router');

const app = express();
app.use(express.json());
app.use('/api/scoring', scoringRouter);

const COMMISSIONER = 7;
const authed = `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;
const SEASON = 2026;
const WEEK = 3;
const FINAL_REFUSAL =
  'Week 3 is final. Its scores change only through a stat correction or a manual score correction.';
const FINALITY_READ = /^SELECT 1 FROM "matchups" .*"final" = true/;

/** The route's reads: the pick'em check, the commissioner probe, the finality read. */
function setup(t, { commissioner, finalRows }) {
  const fake = createFakePool([
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: commissioner ? [{ '?column?': 1 }] : [] })],
    [/FOR NO KEY UPDATE|"board_version" = "board_version" \+ 1/, () => ({ rows: [{ id: 1 }] }), 'client'], // the League write's lock (spec #2693)
    [FINALITY_READ, () => ({ rows: finalRows })],
  ]).install(t);
  const scored = [];
  // The route re-scores through settle.rescoreLive, which runs the in-transaction half on its League write.
  t.mock.method(scoring, 'announceScored', async () => {});
  t.mock.method(scoring, 'scoreMatchupsInTransaction', async (...args) => {
    scored.push(args);
    return { league: null, scored: {}, openMatchups: [] };
  });
  return { fake, scored };
}

const post = () =>
  request(app).post('/api/scoring/league/1/score').set('Authorization', authed).send({ season: SEASON, week: WEEK });

test('score: a commissioner re-scoring a final week is refused 409 and nothing is re-scored', async (t) => {
  const { fake, scored } = setup(t, { commissioner: true, finalRows: [{ '?column?': 1 }] });

  const res = await post();

  assert.equal(res.status, 409);
  assert.equal(res.body.error, FINAL_REFUSAL);
  const [finality] = fake.matching(FINALITY_READ);
  assert.deepEqual(finality.params, [1, SEASON, WEEK]);
  assert.equal(scored.length, 0, 'the week was not re-scored');
  fake.assertClean();
});

test('score: a commissioner re-scoring a week with no final matchup still re-scores it', async (t) => {
  const { fake, scored } = setup(t, { commissioner: true, finalRows: [] });

  const res = await post();

  assert.equal(res.status, 200);
  assert.equal(scored.length, 1, 'the baseline reaches the re-score, so the spy can go non-zero');
  fake.assertClean();
});

test('score: a non-commissioner is refused 403 for a final week, and the finality read never runs', async (t) => {
  const { fake, scored } = setup(t, { commissioner: false, finalRows: [{ '?column?': 1 }] });

  const res = await post();

  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'only the commissioner can do this');
  assert.equal(fake.matching(FINALITY_READ).length, 0, 'a non-commissioner learns nothing about finality');
  assert.equal(scored.length, 0);
  fake.assertClean();
});
