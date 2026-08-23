/**
 * #194: the scoring router's write routes refuse a fantasy league whose draft
 * has not finished, BEFORE they do any work.
 *
 * The advance-week route is the reason this check exists at the route and not
 * only in the season service: it scores the week first and finalizes second,
 * so a refusal that fired only inside finalizeWeekAndAdvance would answer 409
 * with a full week of scores already written. These tests assert that absence
 * directly rather than inferring it from the status code.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, insert, update } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const scoring = require('../services/scoring.service');
const season = require('../services/season.service');
const { SEASON_BEFORE_DRAFT_MESSAGE } = require('../services/leaguePhase');
const { PICKEM_ONLY_CODE } = require('../services/leagueType');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'scoring-phase-gate-test-secret';
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

const league = (over = {}) => ({
  id: 1,
  pickem_only: false,
  draft_status: 'pending',
  season_status: 'regular',
  current_season: 2026,
  current_week: 1,
  regular_season_weeks: 1,
  ...over,
});

/**
 * The router's own reads: the pick'em type check (router-level middleware),
 * the commissioner probe, and whatever league columns the handler selects.
 */
function routerPool(row, extra = []) {
  return createFakePool([
    ...extra,
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: row.pickem_only }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/^SELECT .* FROM "leagues"/, () => ({ rows: [row] })],
  ]);
}

/** Records every call so "it was never reached" is provable, not inferred. */
function spy(t, mod, name, impl = async () => ({})) {
  const calls = [];
  t.mock.method(mod, name, async (...args) => {
    calls.push(args);
    return impl(...args);
  });
  return calls;
}

/* ------------------------------------------------------------------ *
 * POST /league/:id/advance-week                                       *
 * ------------------------------------------------------------------ */

for (const draftStatus of ['pending', 'active']) {
  test(`advance-week: refuses a league whose draft is ${draftStatus} without scoring the week`, async (t) => {
    const fake = routerPool(league({ draft_status: draftStatus })).install(t);
    const scored = spy(t, scoring, 'scoreMatchups');
    const finalized = spy(t, season, 'finalizeWeekAndAdvance');

    const res = await request(app).post('/api/scoring/league/1/advance-week').set('Authorization', authed);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, SEASON_BEFORE_DRAFT_MESSAGE);
    assert.equal(scored.length, 0, 'no scores were written');
    assert.equal(finalized.length, 0, 'the week was never finalized');
    assert.equal(fake.matching(update('matchups')).length, 0);
    assert.equal(fake.matching(update('leagues')).length, 0);
    fake.assertClean();
  });
}

test('advance-week: a league whose draft is complete scores and advances as before', async (t) => {
  const fake = routerPool(league({ draft_status: 'complete' })).install(t);
  const scored = spy(t, scoring, 'scoreMatchups', async () => ({ scored: 2 }));
  const finalized = spy(t, season, 'finalizeWeekAndAdvance', async () => ({
    advancedTo: 2,
    seasonStatus: 'regular',
  }));
  // The post-week analytics chain is fire-and-forget; keep it out of the test.
  const montecarlo = require('../services/montecarlo.service');
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => {
    throw new Error('background chain stopped by the test');
  });

  const res = await request(app).post('/api/scoring/league/1/advance-week').set('Authorization', authed);

  assert.equal(res.status, 200);
  assert.equal(scored.length, 1);
  assert.equal(finalized.length, 1);
  assert.equal(scored[0][0].season, 2026);
  assert.equal(scored[0][0].week, 1);
  fake.assertClean();
});

test('advance-week: the phase check runs BEFORE scoring, not after', async (t) => {
  // Ordering is the whole point of the route-level check. If the gate moved
  // below scoreMatchups the status would still be 409 and this would fail.
  const fake = routerPool(league({ draft_status: 'active' })).install(t);
  const scored = spy(t, scoring, 'scoreMatchups');

  await request(app).post('/api/scoring/league/1/advance-week').set('Authorization', authed);

  assert.equal(scored.length, 0);
  assert.equal(fake.matching(/"player_stats"|"lineup_entries"/).length, 0, 'no scoring read happened either');
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * POST /league/:id/schedule                                           *
 * ------------------------------------------------------------------ */

test('schedule: refuses a pre-draft league and inserts no matchups', async (t) => {
  const fake = routerPool(league({ draft_status: 'pending' }), [
    [/FROM "teams"/, () => ({ rows: [{ id: 11 }, { id: 12 }] })],
    [/FROM "matchups"/, () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const res = await request(app).post('/api/scoring/league/1/schedule').set('Authorization', authed);

  assert.equal(res.status, 409);
  assert.equal(res.body.error, SEASON_BEFORE_DRAFT_MESSAGE);
  assert.equal(fake.matching(insert('matchups')).length, 0);
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * POST /league/:id/matchups (the legacy per-week pairings route)      *
 * ------------------------------------------------------------------ */

test('matchups: the legacy per-week route refuses a pre-draft league and inserts nothing', async (t) => {
  const fake = routerPool(league({ draft_status: 'pending' }), [
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [/FROM "teams"/, () => ({ rows: [{ id: 11 }, { id: 12 }] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/matchups')
    .set('Authorization', authed)
    .send({ season: 2026, week: 1 });

  assert.equal(res.status, 409);
  assert.equal(res.body.error, SEASON_BEFORE_DRAFT_MESSAGE);
  assert.equal(fake.matching(insert('matchups')).length, 0, 'no matchup was inserted');
  fake.assertClean();
});

test('matchups: a complete draft still generates the week exactly as before', async (t) => {
  const fake = routerPool(league({ draft_status: 'complete' }), [
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [/FROM "teams"/, () => ({ rows: [{ id: 11 }, { id: 12 }] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const res = await request(app)
    .post('/api/scoring/league/1/matchups')
    .set('Authorization', authed)
    .send({ season: 2026, week: 1 });

  assert.equal(res.status, 201);
  assert.equal(res.body.created, 1);
  assert.equal(fake.matching(insert('matchups')).length, 1);
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * Pick'em-only leagues: refused UPSTREAM, not by this gate            *
 * ------------------------------------------------------------------ */

for (const route of ['advance-week', 'schedule', 'matchups']) {
  test(`${route}: a pickem-only league is still refused by requireFantasyLeague, unchanged`, async (t) => {
    // The protection is the router-level middleware, which runs before any
    // handler and therefore before the phase gate. Asserted so it stays true:
    // deriveLeaguePhase reports a pickem-only league in-season, so the phase
    // gate would wave it through if this middleware ever stopped firing.
    const fake = routerPool(league({ pickem_only: true, draft_status: 'pending' })).install(t);

    const res = await request(app)
      .post(`/api/scoring/league/1/${route}`)
      .set('Authorization', authed)
      .send({ season: 2026, week: 1 });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, PICKEM_ONLY_CODE);
    assert.notEqual(res.body.error, SEASON_BEFORE_DRAFT_MESSAGE);
    fake.assertClean();
  });
}
